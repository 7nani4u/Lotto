import { LottoResult, PredictionResult, SelectionReason } from '../types';

// ==========================================
// 1. DATA FETCHING
// ==========================================
const START_ROUND = 262;
const STORAGE_KEY = 'korean_lotto_history';

interface DhlotteryResponse {
  resultCode: string | null;
  resultMessage: string | null;
  data: {
    list?: Array<{
      ltEpsd: number;
      tm1WnNo: number; tm2WnNo: number; tm3WnNo: number;
      tm4WnNo: number; tm5WnNo: number; tm6WnNo: number;
      bnsWnNo: number; ltRflYmd: string;
    }>;
  } | null;
}

async function fetchDrawNumber(round: number): Promise<LottoResult | null> {
  try {
    const response = await fetch(`https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=${round}`);
    if (!response.ok) return null;
    const data: DhlotteryResponse = await response.json();
    if (!data?.data?.list || data.data.list.length === 0) return null;
    const result = data.data.list[0];
    const dateStr = result.ltRflYmd;
    const formattedDate = dateStr
      ? `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
      : 'Unknown';
    return {
      round: result.ltEpsd,
      date: formattedDate,
      numbers: [result.tm1WnNo, result.tm2WnNo, result.tm3WnNo, result.tm4WnNo, result.tm5WnNo, result.tm6WnNo],
      bonus: result.bnsWnNo,
    };
  } catch (error) {
    console.error(`Failed to fetch round ${round}:`, error);
    return null;
  }
}

export async function fetchLatestDrawRound(): Promise<number> {
  try {
    const response = await fetch(`https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do`);
    if (!response.ok) throw new Error('Network response was not ok');
    const data: DhlotteryResponse = await response.json();
    if (data?.data?.list && data.data.list.length > 0) return data.data.list[0].ltEpsd;
  } catch (error) {
    console.error('Failed to fetch latest draw:', error);
  }
  return 1218;
}

export const fetchLottoData = async (onProgress?: (progress: number, currentRound: number) => void): Promise<LottoResult[]> => {
  let cachedData: LottoResult[] = [];
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      cachedData = JSON.parse(saved);
      cachedData.sort((a, b) => b.round - a.round);
    }
  } catch (e) { console.error('Failed to parse cached data:', e); }

  const latestRound = await fetchLatestDrawRound();
  const existingRounds = new Set(cachedData.map(r => r.round));
  const missingRounds: number[] = [];
  for (let r = START_ROUND; r <= latestRound; r++) {
    if (!existingRounds.has(r)) missingRounds.push(r);
  }

  if (missingRounds.length > 0) {
    const newResults: LottoResult[] = [];
    const batchSize = 10;
    for (let i = 0; i < missingRounds.length; i += batchSize) {
      const batch = missingRounds.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(round => fetchDrawNumber(round)));
      results.forEach(res => { if (res) newResults.push(res); });
      if (onProgress) {
        const progress = Math.min(100, Math.round(((i + batch.length) / missingRounds.length) * 100));
        onProgress(progress, batch[batch.length - 1]);
      }
    }
    cachedData = [...cachedData, ...newResults].sort((a, b) => b.round - a.round);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedData)); }
    catch (e) { console.warn('localStorage quota exceeded', e); }
  } else {
    if (onProgress) onProgress(100, latestRound);
  }
  return cachedData;
};

// ==========================================
// 2. STATISTICAL ANALYSIS
// ==========================================
export interface LottoStats {
  frequencies: Record<number, number>;
  hotNumbers: number[];
  coldNumbers: number[];
  recentNumbers: Set<number>;
  averageSum: number;
  oddEvenAverage: string;
}

export interface CoOccurrenceEntry {
  number: number;
  count: number;
}

export interface RepeatAnalysis {
  targetNumber: number;
  totalOccurrences: number;
  recent10Occurrences: number;
  recent30Occurrences: number;
  repeatAfterOne: number;
  repeatAfterTwo: number;
  repeatPercentage: number;
  averageGap: number;
  gapTrend: 'INCREASING' | 'DECREASING' | 'STABLE';
  lastSeenRound: number;
  roundsSinceLastSeen: number;
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  insight: string;
  recommendation: string;
  zScore: number;
  // 기술 지표 원시값 (분석 UI 표시용)
  maSignal: number;        // 단기MA − 장기MA: 음수 = 최근 빈도 감소(회귀 기대)
  rsi: number;             // 0~100: <30 과소출현, >70 과다출현
  bollingerPctB: number;   // %B: <0 하단밴드 하회, 0.5 중앙, >1 상단밴드 초과
  aroonOscillator: number; // −100~+100: 음수 = 장기 공백(회귀 기대)
  techScore: number;       // 평균 회귀 방향 종합점수 0~100 (높을수록 회귀 기대)
  // 이산 신호 점수: +1 회귀 / 0 중립 / -1 억제
  maScore: number;
  rsiScore: number;
  bbScore: number;
  aroonScore: number;
  // 가중 합산 신호 점수 (MA 20% + RSI 30% + BB 35% + Aroon 15%) — 범위: −1.0 ~ +1.0
  signalScore: number;
  coOccurrenceTop10: CoOccurrenceEntry[];
}

export function analyzeRepeatProbability(results: LottoResult[], targetNumber: number, lookbackRounds = 100): RepeatAnalysis {
  if (!results || results.length === 0) {
    return {
      targetNumber, totalOccurrences: 0, recent10Occurrences: 0, recent30Occurrences: 0,
      repeatAfterOne: 0, repeatAfterTwo: 0, repeatPercentage: 0, averageGap: 0,
      gapTrend: 'STABLE', lastSeenRound: 0, roundsSinceLastSeen: 0,
      confidenceLevel: 'LOW', insight: '데이터 부족', recommendation: '데이터 부족',
      zScore: 0,
      maSignal: 0, rsi: 50, bollingerPctB: 0.5, aroonOscillator: 0, techScore: 50,
      maScore: 0, rsiScore: 0, bbScore: 0, aroonScore: 0, signalScore: 0,
      coOccurrenceTop10: [],
    };
  }
  const checkRounds = Math.min(lookbackRounds, results.length);
  const latestRound = results[0].round;
  let totalOccurrences = 0, recent10Occurrences = 0, recent30Occurrences = 0;
  let repeatAfterOne = 0, repeatAfterTwo = 0;
  const gaps: number[] = [];
  let lastSeenIdx = -1;

  for (let i = 0; i < checkRounds; i++) {
    const isDrawn = results[i].numbers.includes(targetNumber) || results[i].bonus === targetNumber;
    if (isDrawn) {
      totalOccurrences++;
      if (i < 10) recent10Occurrences++;
      if (i < 30) recent30Occurrences++;
      if (lastSeenIdx !== -1) gaps.push(i - lastSeenIdx);
      lastSeenIdx = i;
      if (i > 0 && (results[i-1].numbers.includes(targetNumber) || results[i-1].bonus === targetNumber)) repeatAfterOne++;
      if (i > 1 && (results[i-2].numbers.includes(targetNumber) || results[i-2].bonus === targetNumber)) repeatAfterTwo++;
    }
  }

  const repeatPercentage = totalOccurrences > 0 ? (repeatAfterOne / (totalOccurrences - 1)) * 100 : 0;
  const averageGap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  let gapTrend: 'INCREASING' | 'DECREASING' | 'STABLE' = 'STABLE';
  if (gaps.length >= 3) {
    const recentAvg = gaps.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
    if (recentAvg < averageGap * 0.7) gapTrend = 'DECREASING';
    else if (recentAvg > averageGap * 1.3) gapTrend = 'INCREASING';
  }
  const lastSeenRoundMatch = results.find(r => r.numbers.includes(targetNumber) || r.bonus === targetNumber);
  const lastSeenRound = lastSeenRoundMatch ? lastSeenRoundMatch.round : 0;
  const roundsSinceLastSeen = lastSeenRoundMatch ? latestRound - lastSeenRound : checkRounds;

  let confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
  let insight = '', recommendation = '';

  if (roundsSinceLastSeen > 15) {
    insight = '장기 미출현 번호'; confidenceLevel = 'HIGH';
    recommendation = `현재 ${roundsSinceLastSeen}회차 연속 미출현 상태로, 통계적 회귀에 의해 조만간 출현할 확률이 매우 높습니다.`;
  } else if (recent10Occurrences >= 3) {
    insight = '최근 급증 번호'; confidenceLevel = 'HIGH';
    recommendation = `최근 10회차 동안 ${recent10Occurrences}회나 집중적으로 출현하는 강한 상승세를 보이고 있습니다.`;
  } else if (repeatPercentage > 15) {
    insight = '강한 연속성 보유'; confidenceLevel = 'MEDIUM';
    recommendation = `이월(연속) 출현 확률이 ${repeatPercentage.toFixed(1)}%로 높은 편입니다.`;
  } else if (gapTrend === 'DECREASING') {
    insight = '출현 주기 단축 중'; confidenceLevel = 'MEDIUM';
    recommendation = `평균 출현 간격(${averageGap.toFixed(1)}회)보다 최근 출현 주기가 짧아지며 상승 곡선을 타고 있습니다.`;
  } else {
    insight = '평범한 출현 흐름'; confidenceLevel = 'LOW';
    recommendation = `특이한 쏠림이나 급증 패턴 없이 평균적인 흐름(${averageGap.toFixed(1)}회 간격)을 유지하고 있습니다.`;
  }
  if (totalOccurrences === 0) {
    insight = '완전 미출현';
    recommendation = `최근 ${checkRounds}회차 동안 단 한 번도 출현하지 않은 극단적 콜드 번호입니다.`;
  }

  // ── Z-Score: 전체 데이터 기준 출현 빈도 통계 ──────────────────────────────
  const allFrequencies: Record<number, number> = {};
  for (let i = 1; i <= 45; i++) allFrequencies[i] = 0;
  results.forEach(r => {
    r.numbers.forEach(n => { allFrequencies[n]++; });
    allFrequencies[r.bonus]++;
  });
  const allFreqValues = Object.values(allFrequencies);
  const freqMean = allFreqValues.reduce((a, b) => a + b, 0) / 45;
  const freqVariance = allFreqValues.reduce((a, b) => a + (b - freqMean) ** 2, 0) / 45;
  const freqStdDev = Math.sqrt(freqVariance);
  const zScore = freqStdDev > 0 ? (allFrequencies[targetNumber] - freqMean) / freqStdDev : 0;

  // ── MA · RSI · 볼린저밴드 · Aroon 기술 지표 계산 ───────────────────────────
  // buildTechnicalWeights는 섹션 4.5에 선언된 hoisted function declaration으로
  // 파일 내 위치와 무관하게 호출 가능합니다.
  const techScores = buildTechnicalWeights(results);
  const techEntry  = techScores.find(s => s.number === targetNumber);

  const maSignal        = techEntry?.maSignal        ?? 0;
  const rsi             = techEntry?.rsi             ?? 50;
  const bollingerPctB   = techEntry?.bollingerPctB   ?? 0.5;
  const aroonOscillator = techEntry?.aroonOscillator ?? 0;

  const techScore = +(techEntry?.hybridCompositeScore ?? 50).toFixed(2);

  // 이산 신호 점수: +1(회귀 신호) / 0(중립) / -1(억제 신호)
  const maScore    = techEntry?.maScore    ?? 0;
  const rsiScore   = techEntry?.rsiScore   ?? 0;
  const bbScore    = techEntry?.bbScore    ?? 0;
  const aroonScore = techEntry?.aroonScore ?? 0;
  // 가중 합산 신호 점수 (MA 20% + RSI 30% + BB 35% + Aroon 15%)
  const signalScore = techEntry?.signalScore ?? 0;

  // 동반 출현 번호 Top 10: 전체 데이터 기준
  const coOccurrenceMap: Record<number, number> = {};
  for (let i = 1; i <= 45; i++) if (i !== targetNumber) coOccurrenceMap[i] = 0;
  results.forEach(r => {
    const allNums = [...r.numbers, r.bonus];
    if (allNums.includes(targetNumber)) {
      allNums.forEach(n => {
        if (n !== targetNumber) coOccurrenceMap[n] = (coOccurrenceMap[n] || 0) + 1;
      });
    }
  });
  const coOccurrenceTop10 = Object.entries(coOccurrenceMap)
    .map(([num, count]) => ({ number: Number(num), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    targetNumber, totalOccurrences, recent10Occurrences, recent30Occurrences,
    repeatAfterOne, repeatAfterTwo, repeatPercentage, averageGap, gapTrend,
    lastSeenRound, roundsSinceLastSeen, confidenceLevel, insight, recommendation,
    zScore, maSignal, rsi, bollingerPctB, aroonOscillator, techScore,
    maScore, rsiScore, bbScore, aroonScore, signalScore,
    coOccurrenceTop10,
  };
}

export function analyzeLotto(results: LottoResult[]): LottoStats {
  const frequencies: Record<number, number> = {};
  for (let i = 1; i <= 45; i++) frequencies[i] = 0;
  let totalSum = 0, totalOdd = 0, totalEven = 0;
  const recentNumbers = new Set<number>();

  results.forEach((r, idx) => {
    let sum = 0;
    r.numbers.forEach(n => {
      frequencies[n]++;
      sum += n;
      if (n % 2 !== 0) totalOdd++; else totalEven++;
      if (idx < 5) recentNumbers.add(n);
    });
    totalSum += sum;
  });

  const avgSum = Math.round(totalSum / results.length);
  const sortedByFreq = Object.entries(frequencies).sort((a, b) => b[1] - a[1]).map(([num]) => parseInt(num, 10));

  return {
    frequencies,
    hotNumbers: sortedByFreq.slice(0, 10),
    coldNumbers: sortedByFreq.slice(-10),
    recentNumbers,
    averageSum: avgSum,
    oddEvenAverage: `${Math.round(totalOdd / results.length)}:${Math.round(totalEven / results.length)}`,
  };
}

// ==========================================
// 3. ADVANCED FILTERING
// ==========================================
export function isValidAC(numbers: number[]): boolean {
  const differences = new Set<number>();
  for (let i = 0; i < numbers.length; i++)
    for (let j = i + 1; j < numbers.length; j++)
      differences.add(Math.abs(numbers[i] - numbers[j]));
  const ac = differences.size - 5;
  return ac >= 5 && ac <= 10;
}

export function isValidSum46(numbers: number[]): boolean {
  let pairs = 0;
  for (let i = 0; i < numbers.length; i++)
    for (let j = i + 1; j < numbers.length; j++)
      if (numbers[i] + numbers[j] === 46) pairs++;
  return pairs <= 2;
}

export function isValidRatio(numbers: number[]): boolean {
  const s = [...numbers].sort((a, b) => a - b);
  const sumSmall = s[0] + s[1] + s[2];
  if (sumSmall === 0) return false;
  const ratio = (s[3] + s[4] + s[5]) / sumSmall;
  // 최적화 반영: 01 02 15 28 39 45 등 편차가 큰 조합도 통과되도록 상한선을 7.5로 확대
  return ratio >= 1.3 && ratio <= 7.5;
}

export function isValidRangePattern(numbers: number[]): boolean {
  const counts = [0, 0, 0, 0, 0];
  numbers.forEach(n => { counts[Math.min(Math.floor((n - 1) / 10), 4)]++; });
  return counts.every(c => c <= 3);
}

export function isValidConsecutive(numbers: number[]): boolean {
  const sorted = [...numbers].sort((a, b) => a - b);
  let pairs = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i] + 1 === sorted[i + 1]) {
      pairs++;
      // 3연속(예: 1,2,3) 이상은 허용하지 않음
      if (i < sorted.length - 2 && sorted[i] + 2 === sorted[i + 2]) return false;
    }
  }
  // 2연번 쌍이 최대 2개까지만 허용됨 (예: 1,2 와 10,11)
  return pairs <= 2;
}

// ==========================================
// 4. MATH ENGINE (6종 수학 기법)
// ==========================================

const PHI = 1.6180339887;
const FIBONACCI_NUMBERS: number[] = (() => {
  const fibs = [1, 2];
  while (true) { const next = fibs[fibs.length - 1] + fibs[fibs.length - 2]; if (next > 45) break; fibs.push(next); }
  return fibs;
})();

function getGoldenRatioCandidates(seed: number): number[] {
  const candidates: number[] = [];
  let n = Math.max(1, Math.min(45, seed));
  for (let i = 0; i < 10; i++) { n = Math.round(((n * PHI - 1) % 44) + 1); candidates.push(n); }
  return [...new Set(candidates)];
}

const PYTHAGOREAN_FREQ: Record<number, number> = (() => {
  const freq: Record<number, number> = {};
  for (let i = 1; i <= 45; i++) freq[i] = 0;
  for (let a = 1; a <= 43; a++)
    for (let b = a + 1; b <= 44; b++) {
      const c = Math.sqrt(a * a + b * b);
      if (Number.isInteger(c) && c <= 45) { freq[a]++; freq[b]++; freq[Math.round(c)]++; }
    }
  return freq;
})();

function gaussianPDF(x: number, mean: number, sigma: number): number {
  return Math.exp(-0.5 * ((x - mean) / (sigma || 1)) ** 2);
}

function buildGaussianWeights(frequencies: Record<number, number>): number[] {
  const vals = Object.values(frequencies);
  const freqMean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const freqSigma = Math.sqrt(vals.reduce((s, v) => s + (v - freqMean) ** 2, 0) / vals.length) || 1;
  return Array.from({ length: 45 }, (_, i) => {
    const freqW = gaussianPDF(frequencies[i + 1], freqMean, freqSigma);
    const posW = gaussianPDF(i + 1, 23, 11);
    return freqW * 0.65 + posW * 0.35;
  });
}

interface ParetoTiers { tier1: number[]; tier2: number[]; tier3: number[]; }

function getParetoTiers(hotNumbers: number[], coldNumbers: number[]): ParetoTiers {
  return { tier1: hotNumbers.slice(0, 9), tier2: hotNumbers.slice(9, 20), tier3: coldNumbers.slice(0, 5) };
}

interface WhitsonPattern {
  targetOdd: number;
  targetHigh: number;
  sumMin: number;
  sumMax: number;
  dominantDecade: number;
}

function analyzeWhitsonPattern(results: LottoResult[]): WhitsonPattern {
  const recent = results.slice(0, 15);
  const oddCounts: number[] = [], highCounts: number[] = [], sums: number[] = [];
  const decadeCounts = [0, 0, 0, 0, 0];
  recent.forEach(r => {
    oddCounts.push(r.numbers.filter(n => n % 2 !== 0).length);
    highCounts.push(r.numbers.filter(n => n > 22).length);
    sums.push(r.numbers.reduce((a, b) => a + b, 0));
    r.numbers.forEach(n => { decadeCounts[Math.min(Math.floor((n - 1) / 10), 4)]++; });
  });
  const avgOdd = Math.round(oddCounts.reduce((a, b) => a + b, 0) / oddCounts.length);
  const avgHigh = Math.round(highCounts.reduce((a, b) => a + b, 0) / highCounts.length);
  const avgSum = sums.reduce((a, b) => a + b, 0) / sums.length;
  return {
    targetOdd: avgOdd,
    targetHigh: avgHigh,
    sumMin: Math.max(ADVANCED_SUM_MIN, Math.round(avgSum - 28)),
    sumMax: Math.min(ADVANCED_SUM_MAX, Math.round(avgSum + 28)),
    dominantDecade: decadeCounts.indexOf(Math.max(...decadeCounts)),
  };
}

function quantumNoise(sigma = 2): number {
  const u1 = Math.random() + 1e-10, u2 = Math.random();
  return Math.round(Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sigma);
}

function applyQuantumFluctuation(num: number, sigma = 2): number {
  return Math.max(1, Math.min(45, num + quantumNoise(sigma)));
}

// ==========================================
// 4.5. TECHNICAL INDICATOR ADAPTATIONS
// ==========================================
//
// All four classic financial indicators are reinterpreted for lottery frequency
// analysis. Key constraint: each draw is an INDEPENDENT event — there is no
// price series, no trend in the financial sense. Instead we track binary
// appearance/absence patterns across a rolling window of draws.
//
// The resulting weight multipliers are intentionally modest (±10-15% max per
// indicator) so they nudge the base statistical weights rather than override them.
// ==========================================

export interface TechnicalIndicatorScore {
  number: number;
  maSignal: number;        // short-MA minus long-MA of binary appearance: + = trending hot
  rsi: number;             // 0–100: <30 = under-appeared (oversold), >70 = over-appeared (overbought)
  bollingerPctB: number;   // %B: 0 = lower band, 1 = upper band; outside [0,1] = extreme deviation
  aroonOscillator: number; // −100 to +100: positive = appeared recently with short droughts
  compositeBoost: number;  // final multiplicative weight from all 4 indicators combined
  zScore: number;
  emaShort: number;
  emaLong: number;
  macdHist: number;
  adx: number;
  atr: number;
  zSubScore: number;
  bbSubScore: number;
  rsiSubScore: number;
  meanReversionScore: number;
  trendScore: number;
  confirmationScore: number;
  hybridCompositeScore: number;
  // 이산 신호 점수: +1 회귀 신호 / 0 중립 / -1 억제 신호
  maScore: number;
  rsiScore: number;
  bbScore: number;
  aroonScore: number;
  // 가중 합산 신호 점수 (MA 20% + RSI 30% + BB 35% + Aroon 15%) — 범위: −1.0 ~ +1.0
  signalScore: number;
}

export interface HybridStrategyConfig {
  emaShortWindow: number;
  emaLongWindow: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  rsiWindow: number;
  bbWindow: number;
  aroonWindow: number;
  adxWindow: number;
  atrWindow: number;
  zWeight: number;
  meanReversionWeight: number;
  trendWeight: number;
  confirmationWeight: number;
}

const DEFAULT_HYBRID_CONFIG: HybridStrategyConfig = {
  emaShortWindow: 5,
  emaLongWindow: 15,
  macdFast: 4,
  macdSlow: 11,
  macdSignal: 4,
  rsiWindow: 12,
  bbWindow: 20,
  aroonWindow: 20,
  adxWindow: 8,
  atrWindow: 18,
  zWeight: 0.25,
  meanReversionWeight: 0.30,
  trendWeight: 0.25,
  confirmationWeight: 0.20,
};

function clampScore(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function resolveHybridConfig(overrides?: Partial<HybridStrategyConfig> | OptimizedWeights): HybridStrategyConfig {
  return {
    ...DEFAULT_HYBRID_CONFIG,
    emaShortWindow: overrides?.emaShortWindow ?? DEFAULT_HYBRID_CONFIG.emaShortWindow,
    emaLongWindow: overrides?.emaLongWindow ?? DEFAULT_HYBRID_CONFIG.emaLongWindow,
    macdFast: overrides?.macdFast ?? DEFAULT_HYBRID_CONFIG.macdFast,
    macdSlow: overrides?.macdSlow ?? DEFAULT_HYBRID_CONFIG.macdSlow,
    macdSignal: overrides?.macdSignal ?? DEFAULT_HYBRID_CONFIG.macdSignal,
    rsiWindow: overrides?.rsiWindow ?? DEFAULT_HYBRID_CONFIG.rsiWindow,
    bbWindow: overrides?.bbWindow ?? DEFAULT_HYBRID_CONFIG.bbWindow,
    aroonWindow: overrides?.aroonWindow ?? DEFAULT_HYBRID_CONFIG.aroonWindow,
    adxWindow: overrides?.adxWindow ?? DEFAULT_HYBRID_CONFIG.adxWindow,
    atrWindow: overrides?.atrWindow ?? DEFAULT_HYBRID_CONFIG.atrWindow,
    zWeight: overrides?.zWeight ?? DEFAULT_HYBRID_CONFIG.zWeight,
    meanReversionWeight: overrides?.meanReversionWeight ?? DEFAULT_HYBRID_CONFIG.meanReversionWeight,
    trendWeight: overrides?.trendWeight ?? DEFAULT_HYBRID_CONFIG.trendWeight,
    confirmationWeight: overrides?.confirmationWeight ?? DEFAULT_HYBRID_CONFIG.confirmationWeight,
  };
}

function buildBinarySeries(results: LottoResult[], num: number, length: number): number[] {
  const size = Math.min(length, results.length);
  return Array.from({ length: size }, (_, idx) => {
    const draw = results[size - 1 - idx];
    return draw && (draw.numbers.includes(num) || draw.bonus === num) ? 1 : 0;
  });
}

function computeEMA(series: number[], period: number): number {
  if (series.length === 0) return 0;
  const alpha = 2 / (period + 1);
  let ema = series[0];
  for (let i = 1; i < series.length; i++) {
    ema = series[i] * alpha + ema * (1 - alpha);
  }
  return ema;
}

function computeLotteryEMA(results: LottoResult[], num: number, window: number): number {
  const series = buildBinarySeries(results, num, window);
  return computeEMA(series, Math.max(1, Math.min(window, series.length || 1)));
}

function computeLotteryMACDHistogram(
  results: LottoResult[],
  num: number,
  fastWindow: number,
  slowWindow: number,
  signalWindow: number
): number {
  const series = buildBinarySeries(results, num, Math.max(slowWindow + signalWindow + 8, 24));
  if (series.length === 0) return 0;
  const macdSeries: number[] = [];
  for (let i = 1; i <= series.length; i++) {
    const slice = series.slice(0, i);
    const fast = computeEMA(slice, Math.max(1, Math.min(fastWindow, slice.length)));
    const slow = computeEMA(slice, Math.max(1, Math.min(slowWindow, slice.length)));
    macdSeries.push(fast - slow);
  }
  const macdLine = macdSeries[macdSeries.length - 1] ?? 0;
  const signal = computeEMA(macdSeries, Math.max(1, Math.min(signalWindow, macdSeries.length)));
  return macdLine - signal;
}

function computeLotteryADX(
  results: LottoResult[],
  num: number,
  window: number
): { adx: number; plusDI: number; minusDI: number } {
  const series = buildBinarySeries(results, num, window + 1);
  if (series.length < 2) return { adx: 0, plusDI: 0, minusDI: 0 };
  let plusDM = 0;
  let minusDM = 0;
  let trueRange = 0;
  for (let i = 1; i < series.length; i++) {
    const delta = series[i] - series[i - 1];
    if (delta > 0) plusDM += delta;
    else if (delta < 0) minusDM += -delta;
    trueRange += Math.abs(delta);
  }
  const tr = trueRange || 1;
  const plusDI = (plusDM / tr) * 100;
  const minusDI = (minusDM / tr) * 100;
  const adx = (Math.abs(plusDI - minusDI) / Math.max(1, plusDI + minusDI)) * 100;
  return { adx, plusDI, minusDI };
}

function computeLotteryATR(results: LottoResult[], num: number, window: number): number {
  const series = buildBinarySeries(results, num, window + 1);
  if (series.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < series.length; i++) {
    total += Math.abs(series[i] - series[i - 1]);
  }
  return total / (series.length - 1);
}

// ------------------------------------------------------------------
// MOVING AVERAGE ADAPTATION
//
// Finance: MA smooths a price series over N periods to reveal trend direction.
//
// Why it does NOT apply directly: A lottery number has no price value to smooth.
// There is no magnitude of change between draws — only presence or absence.
// Applying MA to sequential draw numbers (e.g., "the 5th ball was 23, then 31")
// is meaningless because draw order within a single ticket is arbitrary.
//
// Reinterpretation — "Frequency Moving Average":
//   Treat each draw as a binary signal per number: 1 if appeared, 0 if absent.
//   Short MA (W_s draws) vs Long MA (W_l draws) of this binary stream =
//   rolling appearance rate over different time horizons.
//
//   MA(n, W) = (1/W) × Σ[i=0..W-1] I(n ∈ draw_i)          I = indicator function
//   Signal(n) = MA(n, shortW) − MA(n, longW)
//
//   Signal > 0  → short-window frequency exceeds long-window → number trending hot
//   Signal < 0  → short-window frequency below long-window  → number cooling off
//
// This is analogous to a short MA crossing above a long MA (bullish crossover)
// but applied to frequency rather than price.
// ------------------------------------------------------------------
function computeLotteryMA(
  results: LottoResult[],
  num: number,
  shortWindow = 10,
  longWindow = 30
): number {
  const shortW = Math.min(shortWindow, results.length);
  const longW  = Math.min(longWindow,  results.length);

  let shortCount = 0;
  let longCount  = 0;

  for (let i = 0; i < longW; i++) {
    const appeared = (results[i].numbers.includes(num) || results[i].bonus === num) ? 1 : 0;
    if (i < shortW) shortCount += appeared;
    longCount += appeared;
  }

  // Normalized difference: theoretical range ≈ [−0.3, +0.3] for a 6/45 game
  // (expected rate ≈ 6/45 ≈ 13.3% per draw, so deviations are small)
  return (shortCount / shortW) - (longCount / longW);
}

// ------------------------------------------------------------------
// RSI ADAPTATION
//
// Finance: RSI compares average gains vs average losses over N periods to
// identify overbought (>70) or oversold (<30) price conditions.
//
// Why it does NOT apply directly: A lottery number has no gain/loss magnitude.
// The traditional RS = avg_gain / avg_loss requires a continuous price return
// series — which does not exist for a binary presence/absence sequence.
//
// Reinterpretation — "Appearance Momentum RSI":
//   "Up period"  = draw where number appeared   → contributes to avg_gain
//   "Down period" = draw where it did NOT appear → contributes to avg_loss
//   avg_gain = appearances / W      (normalized appearance rate)
//   avg_loss = absences  / W        (normalized absence rate)
//   RS = avg_gain / avg_loss = appearances / absences
//   RSI(n, W) = 100 − (100 / (1 + RS))
//
//   RSI > 70 → appeared frequently recently → "overbought" in frequency space
//             → mean reversion suggests reducing its weight slightly
//   RSI < 30 → appeared rarely recently → "oversold"
//             → expected return to mean suggests boosting its weight slightly
//
// This is conceptually valid: it measures momentum of binary frequency,
// mirroring how RSI measures momentum of price change magnitude.
// ------------------------------------------------------------------
function computeLotteryRSI(results: LottoResult[], num: number, window = 20): number {
  const W = Math.min(window, results.length);
  let appearances = 0;

  for (let i = 0; i < W; i++) {
    if (results[i].numbers.includes(num) || results[i].bonus === num) appearances++;
  }

  const absences = W - appearances;
  if (absences === 0) return 100; // appeared in every draw — extreme overbought
  if (appearances === 0) return 0; // never appeared — extreme oversold

  const RS = appearances / absences;
  return 100 - (100 / (1 + RS));
}

// ------------------------------------------------------------------
// BOLLINGER BANDS ADAPTATION
//
// Finance: Bollinger Bands place envelopes at ±2σ around a price moving average
// to identify volatility and relative price extremes.
//
// Why it does NOT apply directly: There is no price series. Placing ±2σ bands
// around a single number's appearance count would produce near-zero variance
// because each number appears only 6 times per 45 chances per draw.
//
// Reinterpretation — "Cross-Sectional Frequency Bands":
//   Instead of time-series bands on one number, apply bands ACROSS all 45
//   numbers at the same window W, treating the cross-sectional distribution
//   of rolling frequencies as the data set.
//
//   rollingFreq(n, W) = count of appearances of n in last W draws
//   μ_W = mean of {rollingFreq(n) : n = 1..45}
//   σ_W = std dev of {rollingFreq(n) : n = 1..45}
//
//   Upper Band (UB) = μ_W + 2σ_W    ← unusually hot
//   Lower Band (LB) = μ_W − 2σ_W    ← unusually cold
//
//   %B(n) = (rollingFreq(n) − LB) / (UB − LB)
//     %B > 1.0 → above upper band → over-represented → reduce weight
//     %B < 0.0 → below lower band → under-represented → boost weight
//     %B = 0.5 → exactly at cross-sectional mean → neutral
//
// This is mathematically equivalent to a bounded Z-score across all numbers.
// It complements the existing Z-score by using a rolling window rather than
// all-time totals, making it more sensitive to recent distributional shifts.
// ------------------------------------------------------------------
function computeBollingerBands(results: LottoResult[], window = 30): Record<number, number> {
  const W = Math.min(window, results.length);

  const rollingFreqs: Record<number, number> = {};
  for (let n = 1; n <= 45; n++) rollingFreqs[n] = 0;

  for (let i = 0; i < W; i++) {
    results[i].numbers.forEach(n => { rollingFreqs[n]++; });
    rollingFreqs[results[i].bonus]++;
  }

  const freqValues = Object.values(rollingFreqs);
  const mean   = freqValues.reduce((a, b) => a + b, 0) / 45;
  const stdDev = Math.sqrt(freqValues.reduce((s, v) => s + (v - mean) ** 2, 0) / 45) || 1;

  const upperBand = mean + 2 * stdDev;
  const lowerBand = mean - 2 * stdDev;
  const bandwidth = upperBand - lowerBand;

  const pctB: Record<number, number> = {};
  for (let n = 1; n <= 45; n++) {
    pctB[n] = bandwidth > 0 ? (rollingFreqs[n] - lowerBand) / bandwidth : 0.5;
  }
  return pctB;
}

// ------------------------------------------------------------------
// AROON ADAPTATION
//
// Finance: Aroon measures how many periods have elapsed since the highest (Aroon Up)
// or lowest (Aroon Down) price within a lookback window to detect trend initiation
// or exhaustion.
//
// Why it does NOT apply directly: There is no price high or price low for a
// lottery number. "The highest value of ball number X in the last N draws"
// has no meaning since the number is discrete and fixed (e.g., always "7").
//
// Reinterpretation — "Gap Recency Aroon":
//   Replace "periods since price high" with "draws since last appearance":
//
//   AroonUp(n, W)   = ((W − drawsSinceLastSeen(n, W)) / W) × 100
//     High AroonUp → appeared recently → trending active
//     Low AroonUp  → not seen recently → cooling off
//
//   Replace "periods since price low" with "longest absence streak in window":
//   AroonDown(n, W) = ((W − longestGap(n, W)) / W) × 100
//     High AroonDown → recently had a long drought → pattern of cold streaks
//     Low AroonDown  → no long droughts → consistently appearing
//
//   Aroon Oscillator = AroonUp − AroonDown  (range: −100 to +100)
//     +100 → appeared very recently AND no long cold streaks → strongest momentum
//     −100 → hasn't appeared recently AND had very long droughts → coldest signal
//     ≈ 0  → mixed signals / consolidation
// ------------------------------------------------------------------
function computeAroon(results: LottoResult[], num: number, window = 30): number {
  const W = Math.min(window, results.length);

  let drawsSinceLastSeen = W; // default: never appeared in window
  let longestGap  = 0;
  let currentGap  = 0;

  for (let i = 0; i < W; i++) {
    const appeared = results[i].numbers.includes(num) || results[i].bonus === num;
    if (appeared) {
      if (drawsSinceLastSeen === W) drawsSinceLastSeen = i; // first (most recent) appearance
      if (currentGap > longestGap) longestGap = currentGap;
      currentGap = 0;
    } else {
      currentGap++;
    }
  }
  if (currentGap > longestGap) longestGap = currentGap; // trailing gap at window end

  const aroonUp   = ((W - drawsSinceLastSeen) / W) * 100;
  const aroonDown = ((W - longestGap) / W) * 100;
  return aroonUp - aroonDown; // oscillator
}

// ------------------------------------------------------------------
// COMBINED TECHNICAL WEIGHT BUILDER
//
// Aggregates all four adapted indicators into a single composite weight
// multiplier per number. Signals are additive via multiplication — each
// indicator contributes a modest nudge (±5–12%) rather than a dominant
// override, preserving the integrity of the base statistical weights.
//
// Weight contribution per indicator:
//   MA signal  (−0.3 to +0.3)  → ×(1 ± 0.12 max)    via maSignal × 0.4
//   RSI        (0–100)          → ×0.90/1.00/1.10      threshold-based
//   Bollinger  %B (any real)    → ×0.92/scaled/1.08    band-based
//   Aroon Osc  (−100 to +100)  → ×0.94/scaled/1.06    threshold-based
//
// Max combined boost ≈ ×1.38; max reduction ≈ ×0.73 (capped at [0.5, 2.0]).
// Numbers with all four indicators aligned in the same direction receive
// the strongest weight adjustment — a meaningful but non-deterministic signal.
// ------------------------------------------------------------------
export function buildTechnicalWeights(
  results: LottoResult[],
  overrides?: Partial<HybridStrategyConfig> | OptimizedWeights
): TechnicalIndicatorScore[] {
  const config = resolveHybridConfig(overrides);
  const bbPctB = computeBollingerBands(results, config.bbWindow);
  const allFreq: Record<number, number> = {};
  for (let i = 1; i <= 45; i++) allFreq[i] = 0;
  results.forEach(r => {
    r.numbers.forEach(n => { allFreq[n]++; });
    allFreq[r.bonus]++;
  });
  const freqValues = Object.values(allFreq);
  const freqMean = freqValues.reduce((a, b) => a + b, 0) / 45;
  const freqStd = Math.sqrt(freqValues.reduce((s, v) => s + (v - freqMean) ** 2, 0) / 45) || 1;

  return Array.from({ length: 45 }, (_, i) => {
    const num = i + 1;
    const emaShort = computeLotteryEMA(results, num, config.emaShortWindow);
    const emaLong = computeLotteryEMA(results, num, config.emaLongWindow);
    const maSignal = emaShort - emaLong;
    const macdHist = computeLotteryMACDHistogram(results, num, config.macdFast, config.macdSlow, config.macdSignal);
    const rsi = computeLotteryRSI(results, num, config.rsiWindow);
    const bollingerPctB = bbPctB[num];
    const aroonOscillator = computeAroon(results, num, config.aroonWindow);
    const { adx } = computeLotteryADX(results, num, config.adxWindow);
    const atr = computeLotteryATR(results, num, config.atrWindow);
    const zScore = (allFreq[num] - freqMean) / freqStd;
    const zSubScore = clampScore(((-zScore + 2.6) / 5.2) * 100);
    const bbSubScore = clampScore((1 - bollingerPctB) * 100);
    const rsiSubScore = clampScore(100 - rsi);
    const gapSubScore = clampScore((-aroonOscillator + 100) / 2);
    const trendBaseScore = clampScore(
      50 +
      (-maSignal * 140) +
      (macdHist < 0 ? Math.abs(macdHist) * 190 : -macdHist * 130)
    );
    const roundsSinceSeen = Math.max(0, results.findIndex(r => r.numbers.includes(num) || r.bonus === num));
    const overdueScore = clampScore((roundsSinceSeen / 16) * 100);
    const trendScore = clampScore(trendBaseScore * 0.75 + overdueScore * 0.25);
    const adxScore = clampScore(adx >= 18 ? 55 + Math.min(25, adx * 0.6) : 35 + adx * 0.8);
    const atrScore = clampScore(100 - atr * 100);
    const confirmationScore = clampScore(adxScore * 0.45 + atrScore * 0.30 + gapSubScore * 0.25);
    const meanReversionScore = clampScore(bbSubScore * 0.5 + rsiSubScore * 0.3 + zSubScore * 0.2);
    const hybridCompositeScore = +(
      zSubScore * config.zWeight +
      meanReversionScore * config.meanReversionWeight +
      trendScore * config.trendWeight +
      confirmationScore * config.confirmationWeight
    ).toFixed(2);
    const compositeBoost = Math.max(0.72, Math.min(1.30, 0.72 + (hybridCompositeScore / 100) * 0.58));

    // 이산 신호 점수 (평균 회귀 관점): +1 회귀 신호 / 0 중립 / -1 억제 신호
    const maScore    = maSignal < -0.01 || macdHist < -0.015 ? 1 : maSignal > 0.015 ? -1 : 0;
    const rsiScore   = rsi < 30 ? 1 : rsi > 70 ? -1 : 0;
    const bbScore    = bollingerPctB < 0.15 ? 1 : bollingerPctB > 0.85 ? -1 : 0;
    const aroonScore = gapSubScore >= 65 ? 1 : gapSubScore <= 35 ? -1 : 0;
    // 가중 합산: MA(20%) RSI(30%) BB(35%) Aroon(15%) — 범위: −1.0 ~ +1.0
    const signalScore = +(0.20*maScore + 0.30*rsiScore + 0.35*bbScore + 0.15*aroonScore).toFixed(4);

    return {
      number: num,
      maSignal,
      rsi,
      bollingerPctB,
      aroonOscillator,
      compositeBoost,
      zScore: +zScore.toFixed(2),
      emaShort: +emaShort.toFixed(4),
      emaLong: +emaLong.toFixed(4),
      macdHist: +macdHist.toFixed(4),
      adx: +adx.toFixed(2),
      atr: +atr.toFixed(4),
      zSubScore: +zSubScore.toFixed(1),
      bbSubScore: +bbSubScore.toFixed(1),
      rsiSubScore: +rsiSubScore.toFixed(1),
      meanReversionScore: +meanReversionScore.toFixed(1),
      trendScore: +trendScore.toFixed(1),
      confirmationScore: +confirmationScore.toFixed(1),
      hybridCompositeScore,
      maScore,
      rsiScore,
      bbScore,
      aroonScore,
      signalScore,
    };
  });
}

// ==========================================
// 4.6. FULL 45-NUMBER INDICATOR ANALYSIS TABLE
// ==========================================
//
// buildFullAnalysisTable()는 1~45번 전체에 대해 5종 기술 지표(MA·RSI·볼린저밴드·Aroon·Z-Score)를
// 계산하고 평균 회귀 방향으로 0~100 정규화한 뒤 가중 합산하여
// 번호별 "출현 가능성 점수" 테이블을 반환합니다.
//
// [가중치]
//   Z-Score     30% — 전체 히스토리 기반 빈도 통계 편차 (가장 신뢰도 높음)
//   볼린저 %B   25% — 롤링 30회 횡단면 밴드 위치 (최근 분산 반영)
//   RSI         20% — 최근 20회 출현/미출현 모멘텀
//   MA          15% — 단기(10)/장기(30) 빈도 교차 신호
//   Aroon       10% — 마지막 출현 재귀 + 최장 공백 지표
//
// [정규화 방향 — "과소출현 = 높은 점수"]
//   Z-Score  → (-z + 3) / 6 × 100          (z 음수 = 저출현 → 높은 점수)
//   볼린저%B → (1 − %B) × 100               (하단밴드 근처 → 높은 점수)
//   RSI      → 100 − rsi                    (낮은 RSI = 과소출현 → 높은 점수)
//   MA       → (−signal + 0.30) / 0.60 × 100 (빈도 감소 추세 → 높은 점수)
//   Aroon    → (−osc + 100) / 2             (장기 공백 → 높은 점수)
// ==========================================

export interface FullIndicatorAnalysis {
  number: number;
  totalOccurrences: number;

  // ── 원시 지표값 ──
  maSignal: number;         // 단기(10)−장기(30) 이진 빈도 MA 교차
  rsi: number;              // 출현 모멘텀 RSI (0~100)
  bollingerPctB: number;    // 횡단면 볼린저 %B (0=하단, 1=상단)
  aroonOscillator: number;  // 갭-재귀 Aroon 오실레이터 (−100~+100)
  zScore: number;           // 전체 회차 기준 Z-Score

  // ── 정규화 서브점수 (0~100, 높을수록 평균회귀 기대) ──
  maSubScore: number;
  rsiSubScore: number;
  bbSubScore: number;
  aroonSubScore: number;
  zSubScore: number;

  // ── 종합 출현 가능성 점수 (0~100) ──
  compositeScore: number;

  // ── 전체 45개 중 순위 ──
  rank: number;
}

/**
 * buildFullAnalysisTable
 *
 * 3단계 로직:
 *   1단계: 5종 지표 원시값 계산 (Z-Score=전체 회차, 나머지=롤링 윈도우)
 *   2단계: 각 지표를 "과소출현 = 높은 점수" 방향으로 0~100 정규화
 *   3단계: 가중 합산 → 종합 출현 가능성 점수 (0~100)
 */
export function buildFullAnalysisTable(results: LottoResult[]): FullIndicatorAnalysis[] {
  if (!results || results.length < 10) return [];
  const techScores = buildTechnicalWeights(results);

  const raw: FullIndicatorAnalysis[] = Array.from({ length: 45 }, (_, i) => {
    const num  = i + 1;
    const tech = techScores[i];
    const totalOccurrences = results.filter(r => r.numbers.includes(num) || r.bonus === num).length;
    const maSubScore = tech.trendScore;
    const rsiSubScore = tech.rsiSubScore;
    const bbSubScore = tech.bbSubScore;
    const aroonSubScore = tech.confirmationScore;
    const zSubScore = tech.zSubScore;
    const compositeScore = +tech.hybridCompositeScore.toFixed(1);

    return {
      number: num,
      totalOccurrences,
      maSignal:        tech.maSignal,
      rsi:             +tech.rsi.toFixed(1),
      bollingerPctB:   tech.bollingerPctB,
      aroonOscillator: +tech.aroonOscillator.toFixed(1),
      zScore:          tech.zScore,
      maSubScore:      +maSubScore.toFixed(1),
      rsiSubScore:     +rsiSubScore.toFixed(1),
      bbSubScore:      +bbSubScore.toFixed(1),
      aroonSubScore:   +aroonSubScore.toFixed(1),
      zSubScore:       +zSubScore.toFixed(1),
      compositeScore:  +compositeScore,
      rank:            0,
    };
  });

  // ④ 순위 부여 (종합 점수 내림차순)
  [...raw]
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .forEach((item, idx) => { raw[item.number - 1].rank = idx + 1; });

  return raw;
}

// ==========================================
// 5. STRATEGY ANALYSIS TYPES
// ==========================================
export interface StrategyTestResult {
  name: string;
  key: string;
  avgMatches: number;
  hit2Rate: number;   // 2개+ 일치율 (%)
  hit3Rate: number;   // 3개+ 일치율 (%)
  improvement: number; // vs 기준선 대비 향상률 (%)
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
}

export interface OptimizedWeights {
  gaussianFactor: number;
  fibonacciFactor: number;
  goldenRatioFactor: number;
  pythagoreanFactor: number;
  paretoTier1Factor: number;
  quantumNoiseFactor: number;  // qNoise: 가중치 교란 진폭 (Q = 1 ± qNoise/2)
  quantumSigma: number;        // sigma: Box-Muller 번호 교란 표준편차
  whitsonFilterEnabled: boolean;
  emaShortWindow?: number;
  emaLongWindow?: number;
  macdFast?: number;
  macdSlow?: number;
  macdSignal?: number;
  rsiWindow?: number;
  bbWindow?: number;
  aroonWindow?: number;
  adxWindow?: number;
  atrWindow?: number;
  zWeight?: number;
  meanReversionWeight?: number;
  trendWeight?: number;
  confirmationWeight?: number;
}

// ==========================================
// 양자 요동 파라미터 최적화 타입
// ==========================================
export interface QuantumNoiseTestResult {
  paramValue: number;     // 테스트한 파라미터 값
  label: string;          // 표시용 레이블
  avgMatches: number;     // 평균 일치 번호 수
  hit2Rate: number;       // 2개+ 일치율 (%)
  hit3Rate: number;       // 3개+ 일치율 (%)
  improvement: number;    // 무작위 기준선 대비 향상률 (%)
  stabilityScore: number; // 안정성 점수 (표준편차 역수 기반, 높을수록 안정적)
}

export interface QuantumOptimizationResult {
  qNoiseResults: QuantumNoiseTestResult[];    // 가중치 교란 진폭 스윕
  sigmaResults: QuantumNoiseTestResult[];      // Box-Muller σ 스윕
  optimalQNoise: number;
  optimalSigma: number;
  currentQNoise: number;
  currentSigma: number;
  improvementVsCurrent: number;   // 최적 vs 현재 개선율 (%)
  recommendation: string;
  insights: string[];
  analysedRounds: number;
  randomBaseline: number;
}

export interface StrategyAnalysis {
  individual: StrategyTestResult[];
  comboResults: Array<{ label: string; strategies: string[]; hit3Rate: number; improvement: number }>;
  approachScores: {
    singleBest: number;
    combo2: number;
    combo3: number;
    combo4: number;
    combo5: number;
    combo6: number;
    hybrid: number;
  };
  optimizedWeights: OptimizedWeights;
  analysedRounds: number;
  randomBaseline: number;
  bestSingleName: string;
  recommendation: string;
}

// ==========================================
// 6. ISOLATED STRATEGY GENERATORS (백테스트용)
// ==========================================

function strategyGaussian(stats: LottoStats): number[] {
  const weights = buildGaussianWeights(stats.frequencies);
  return weightedRandomSelect(weights, 6);
}

function strategyFibonacci(stats: LottoStats): number[] {
  const mean = Math.round(stats.averageSum / 6);
  const goldenCands = getGoldenRatioCandidates(mean);
  const weights = Array.from({ length: 45 }, (_, i) => {
    const num = i + 1;
    return (FIBONACCI_NUMBERS.includes(num) ? 4.5 : 1.0) * (goldenCands.includes(num) ? 3.0 : 1.0);
  });
  return weightedRandomSelect(weights, 6);
}

function strategyPythagorean(): number[] {
  const maxF = Math.max(...Object.values(PYTHAGOREAN_FREQ), 1);
  const weights = Array.from({ length: 45 }, (_, i) => Math.max(0.1, (PYTHAGOREAN_FREQ[i + 1] / maxF) * 5));
  return weightedRandomSelect(weights, 6);
}

function strategyPareto(stats: LottoStats): number[] {
  const pareto = getParetoTiers(stats.hotNumbers, stats.coldNumbers);
  const weights = Array.from({ length: 45 }, (_, i) => {
    const num = i + 1;
    return pareto.tier1.includes(num) ? 5.0 : pareto.tier2.includes(num) ? 2.0 : pareto.tier3.includes(num) ? 0.5 : 1.0;
  });
  return weightedRandomSelect(weights, 6);
}

function strategyWhitson(stats: LottoStats, whitson: WhitsonPattern): number[] {
  const targetMean = (whitson.sumMin + whitson.sumMax) / 12;
  const weights = Array.from({ length: 45 }, (_, i) => {
    const num = i + 1;
    const decadeW = Math.min(Math.floor((num - 1) / 10), 4) === whitson.dominantDecade ? 2.0 : 1.0;
    return Math.max(0.05, gaussianPDF(num, targetMean, 8) * decadeW);
  });
  for (let attempt = 0; attempt < 80; attempt++) {
    const candidates = weightedRandomSelect(weights, 6);
    const odd = candidates.filter(n => n % 2 !== 0).length;
    const sum = candidates.reduce((a, b) => a + b, 0);
    if (Math.abs(odd - whitson.targetOdd) <= 1 && sum >= whitson.sumMin && sum <= whitson.sumMax)
      return candidates;
  }
  return weightedRandomSelect(weights, 6);
}

function strategyQuantum(stats: LottoStats): number[] {
  const mean = stats.averageSum / 6;
  const weights = Array.from({ length: 45 }, (_, i) =>
    Math.max(0.01, gaussianPDF(i + 1, mean, 10) * (1.0 + (Math.random() - 0.5) * 0.8))
  );
  return weightedRandomSelect(weights, 6);
}

// ==========================================
// 7. COMBINED WEIGHT ENGINE
// ==========================================

function buildCombinedWeights(
  stats: LottoStats,
  goldenCandidates: number[],
  pareto: ParetoTiers,
  opts?: OptimizedWeights,
  technicalScores?: TechnicalIndicatorScore[]  // MA × RSI × Bollinger × Aroon composite
): number[] {
  const qNoise = opts?.quantumNoiseFactor ?? 0.12;

  return Array.from({ length: 45 }, (_, i) => {
    const tech = technicalScores?.[i];
    const hybrid = tech?.hybridCompositeScore ?? 50;
    const meanReversion = tech?.meanReversionScore ?? 50;
    const trend = tech?.trendScore ?? 50;
    const confirmation = tech?.confirmationScore ?? 50;
    const baseWeight = 0.2 + Math.pow(hybrid / 100, 1.9) * 3.4;
    const meanBoost = 0.92 + (meanReversion / 100) * 0.14;
    const trendBoost = 0.94 + (trend / 100) * 0.10;
    const confirmBoost = 0.94 + (confirmation / 100) * 0.12;
    const coldBoost = tech && tech.zScore < -0.5 ? 1.06 : 1.0;
    const Q = 1.0 + (Math.random() - 0.5) * qNoise;
    return Math.max(0.01, baseWeight * meanBoost * trendBoost * confirmBoost * coldBoost * Q);
  });
}

function weightedRandomSelect(weights: number[], count: number): number[] {
  const selected = new Set<number>();
  const totalW = weights.reduce((a, b) => a + b, 0);
  let attempts = 0;
  while (selected.size < count && attempts < 8000) {
    let rand = Math.random() * totalW;
    for (let i = 0; i < weights.length; i++) {
      rand -= weights[i];
      if (rand <= 0) { selected.add(i + 1); break; }
    }
    attempts++;
  }
  while (selected.size < count) selected.add(Math.floor(Math.random() * 45) + 1);
  return Array.from(selected).sort((a, b) => a - b);
}

// ==========================================
// 8. SELECTION REASON BUILDER
// ==========================================
function buildSelectionReason(
  numbers: number[],
  pareto: ParetoTiers,
  goldenCandidates: number[],
  whitson: WhitsonPattern
): SelectionReason {
  const sum = numbers.reduce((a, b) => a + b, 0);
  const oddCount = numbers.filter(n => n % 2 !== 0).length;
  const highCount = numbers.filter(n => n > 22).length;
  const decadeSpread = [0, 0, 0, 0, 0];
  numbers.forEach(n => { decadeSpread[Math.min(Math.floor((n - 1) / 10), 4)]++; });
  const spreadPattern = decadeSpread.filter(Boolean).join('-');
  return {
    stage1_modelDesign: '팩터 기반 하이브리드 전략: Z-Score 장기 편차 + RSI/Bollinger 평균 회귀 + EMA/MACD 추세 + ADX/ATR 확인 지표를 결합한 6지표 핵심 모델',
    stage2_calcLogic: 'Score(n) = 0.25*Z + 0.30*MeanReversion(RSI+BB) + 0.25*Trend(EMA+MACD) + 0.20*Confirmation(ADX+ATR+Gap) → 상위 후보군 압축 → 동반출현/필터 검증 → 최종 6개 선정',
    stage3_setReason: `합계 ${sum} | 홀짝 ${oddCount}:${6 - oddCount} | 고저 ${highCount}:${6 - highCount} | 구간 분산 ${spreadPattern} | Whitson 목표 ${whitson.targetOdd}:${6 - whitson.targetOdd}`,
  };
}

// ==========================================
// 9. PREDICTION ENGINE
// ==========================================
const ADVANCED_SUM_MIN = 85;
const ADVANCED_SUM_MAX = 189;

const PYTHON_FILTER_FORMULAS = [
  'AC산술복잡도', '합46(Sum46)', '상/하위 비율', '연속번호 제한',
  `총합(${ADVANCED_SUM_MIN}~${ADVANCED_SUM_MAX})`, '번대별 분산',
];

function buildPredictionResult(numbers: number[], confidence: number, formulasUsed: string[], selectionReason?: SelectionReason): PredictionResult {
  const sum = numbers.reduce((a, b) => a + b, 0);
  let odd = 0, even = 0, high = 0, low = 0;
  numbers.forEach(n => { if (n % 2 !== 0) odd++; else even++; if (n > 22) high++; else low++; });
  return { numbers, confidence, formulasUsed: Array.from(new Set(formulasUsed)), selectionReason, stats: { sum, oddEvenRatio: `${odd}:${even}`, highLowRatio: `${high}:${low}` } };
}

function passesPythonFilters(numbers: number[]): boolean {
  const sum = numbers.reduce((a, b) => a + b, 0);
  return sum >= ADVANCED_SUM_MIN && sum <= ADVANCED_SUM_MAX &&
    isValidAC(numbers) && isValidSum46(numbers) &&
    isValidRatio(numbers) && isValidRangePattern(numbers) && isValidConsecutive(numbers);
}

function generateFallbackNumbers(): number[] {
  const selected = new Set<number>();
  while (selected.size < 6) selected.add(Math.floor(Math.random() * 45) + 1);
  return Array.from(selected).sort((a, b) => a - b);
}

export async function fetchGithubCombinations(): Promise<number[][]> {
  try {
    const url = 'https://raw.githubusercontent.com/7nani4u/Lotto/main/lotto_combinations.txt';
    const response = await fetch(url);
    if (!response.ok) { console.warn('GitHub 조합 파일 다운로드 실패'); return []; }
    const text = await response.text();
    const combinations: number[][] = [];
    let startIndex = 0;
    while (startIndex < text.length) {
      let endIndex = text.indexOf('\n', startIndex);
      if (endIndex === -1) endIndex = text.length;
      const line = text.slice(startIndex, endIndex).trim();
      startIndex = endIndex + 1;
      if (!line) continue;
      const nums = line.split(/[,\s]+/).map(p => parseInt(p, 10)).filter(n => !isNaN(n) && n >= 1 && n <= 45);
      if (nums.length === 6) combinations.push(nums.sort((a, b) => a - b));
    }
    return combinations;
  } catch (error) { console.error('GitHub 파일 파싱 오류:', error); return []; }
}

// ==========================================
// 10. BACKTESTING ENGINE (최근 1년 전략 비교)
// ==========================================
/**
 * 무작위 6/45 기준선: P(3+일치) = [C(6,3)×C(39,3) + C(6,4)×C(39,2) + ...] / C(45,6)
 * = (182780 + 11115 + 234 + 1) / 8145060 ≈ 2.38%
 *
 * 백테스트 방법:
 * - 훈련 데이터: allData.slice(testRounds) — 테스트 기간 이전 데이터만 사용
 * - 테스트: 최근 testRounds 회차 각각에 대해 predictionsPerRound회 예측 후 실제 번호와 비교
 * - 이를 통해 각 전략이 최근 1년 패턴에 얼마나 부합하는지 측정
 */
export async function backtestStrategies(
  allData: LottoResult[],
  testRounds = 52,
  predictionsPerRound = 25
): Promise<StrategyAnalysis> {
  const RANDOM_BASELINE = 2.38;
  const rounds = Math.min(testRounds, allData.length - 80);
  if (rounds < 20) {
    throw new Error('분석에 필요한 데이터가 부족합니다 (최소 100회차 이상 필요)');
  }

  type FactorWeights = {
    z: number;
    meanReversion: number;
    trend: number;
    confirmation: number;
  };

  const configCandidates: HybridStrategyConfig[] = [
    { ...DEFAULT_HYBRID_CONFIG },
    { ...DEFAULT_HYBRID_CONFIG, emaShortWindow: 6, emaLongWindow: 13, rsiWindow: 14, adxWindow: 12 },
    { ...DEFAULT_HYBRID_CONFIG, emaShortWindow: 4, emaLongWindow: 11, macdFast: 6, macdSlow: 15, macdSignal: 5, rsiWindow: 16, bbWindow: 18, adxWindow: 12, atrWindow: 10 },
    { ...DEFAULT_HYBRID_CONFIG, emaShortWindow: 5, emaLongWindow: 13, rsiWindow: 14, atrWindow: 10, zWeight: 0.20, meanReversionWeight: 0.32, trendWeight: 0.28, confirmationWeight: 0.20 },
  ];

  const buildRankedNumbers = (training: LottoResult[], cfg: HybridStrategyConfig, factorWeights: FactorWeights): number[] => {
    const table = buildTechnicalWeights(training, cfg)
      .map(entry => ({
        number: entry.number,
        score:
          entry.zSubScore * factorWeights.z +
          entry.meanReversionScore * factorWeights.meanReversion +
          entry.trendScore * factorWeights.trend +
          entry.confirmationScore * factorWeights.confirmation,
      }))
      .sort((a, b) => b.score - a.score || a.number - b.number);
    return table.map(entry => entry.number);
  };

  const evaluateApproach = (cfg: HybridStrategyConfig, factorWeights: FactorWeights) => {
    let totalMatches = 0;
    let totalTop12Matches = 0;
    let hit2 = 0;
    let hit3 = 0;
    for (let i = 0; i < rounds; i++) {
      const training = allData.slice(i + 1);
      const ranked = buildRankedNumbers(training, cfg, factorWeights);
      const actual = allData[i].numbers;
      const hitCount = ranked.slice(0, 6).filter(n => actual.includes(n)).length;
      const hitCount12 = ranked.slice(0, 12).filter(n => actual.includes(n)).length;
      totalMatches += hitCount;
      totalTop12Matches += hitCount12;
      if (hitCount >= 2) hit2++;
      if (hitCount >= 3) hit3++;
    }
    const avgMatches = totalMatches / rounds;
    const hit2Rate = (hit2 / rounds) * 100;
    const hit3Rate = (hit3 / rounds) * 100;
    const avgTop12Matches = totalTop12Matches / rounds;
    const objective = avgMatches * 100 + avgTop12Matches * 18 + hit3Rate * 1.5 + hit2Rate * 0.4;
    return { avgMatches, avgTop12Matches, hit2Rate, hit3Rate, objective };
  };

  const factorProfiles: Array<{ name: string; key: string; weights: FactorWeights }> = [
    { name: '장기 편차(Z-Score)', key: 'z', weights: { z: 1, meanReversion: 0, trend: 0, confirmation: 0 } },
    { name: '평균 회귀(RSI+BB)', key: 'mean_reversion', weights: { z: 0.15, meanReversion: 0.85, trend: 0, confirmation: 0 } },
    { name: '추세(EMA+MACD)', key: 'trend', weights: { z: 0.10, meanReversion: 0, trend: 0.90, confirmation: 0 } },
    { name: '확인(ADX+ATR)', key: 'confirmation', weights: { z: 0.10, meanReversion: 0, trend: 0.10, confirmation: 0.80 } },
  ];

  const comboProfiles: Array<{ label: string; strategies: string[]; weights: FactorWeights }> = [
    { label: '2전략 병합 (Z + 평균 회귀)', strategies: ['장기 편차', '평균 회귀'], weights: { z: 0.45, meanReversion: 0.55, trend: 0, confirmation: 0 } },
    { label: '3전략 병합 (+ 추세)', strategies: ['장기 편차', '평균 회귀', '추세'], weights: { z: 0.25, meanReversion: 0.35, trend: 0.40, confirmation: 0 } },
    { label: '4전략 병합 (+ 확인)', strategies: ['장기 편차', '평균 회귀', '추세', '확인'], weights: { z: 0.22, meanReversion: 0.30, trend: 0.25, confirmation: 0.23 } },
    { label: '5전략 병합 (확인 강화)', strategies: ['장기 편차', '평균 회귀', '추세', '확인 강화'], weights: { z: 0.20, meanReversion: 0.30, trend: 0.23, confirmation: 0.27 } },
    { label: '6전략 병합 (균형형)', strategies: ['전체 팩터 균형'], weights: { z: 0.25, meanReversion: 0.28, trend: 0.24, confirmation: 0.23 } },
  ];

  const configScores = configCandidates.map(cfg => ({
    cfg,
    result: evaluateApproach(cfg, {
      z: cfg.zWeight,
      meanReversion: cfg.meanReversionWeight,
      trend: cfg.trendWeight,
      confirmation: cfg.confirmationWeight,
    }),
  })).sort((a, b) => b.result.objective - a.result.objective);

  const bestConfig = configScores[0].cfg;
  const individualResults: StrategyTestResult[] = factorProfiles.map(profile => {
    const result = evaluateApproach(bestConfig, profile.weights);
    const improvement = ((result.hit3Rate - RANDOM_BASELINE) / RANDOM_BASELINE) * 100;
    const grade: StrategyTestResult['grade'] =
      improvement > 60 ? 'S' : improvement > 25 ? 'A' : improvement > 0 ? 'B' : improvement > -20 ? 'C' : 'D';
    return {
      name: profile.name,
      key: profile.key,
      avgMatches: result.avgMatches,
      hit2Rate: result.hit2Rate,
      hit3Rate: result.hit3Rate,
      improvement,
      grade,
    };
  }).sort((a, b) => b.hit3Rate - a.hit3Rate || b.avgMatches - a.avgMatches);

  const comboResults = comboProfiles.map(profile => {
    const result = evaluateApproach(bestConfig, profile.weights);
    return {
      label: profile.label,
      strategies: profile.strategies,
      hit3Rate: result.hit3Rate,
      improvement: ((result.hit3Rate - RANDOM_BASELINE) / RANDOM_BASELINE) * 100,
    };
  });

  const hybridWeights: FactorWeights = {
    z: bestConfig.zWeight,
    meanReversion: bestConfig.meanReversionWeight,
    trend: bestConfig.trendWeight,
    confirmation: bestConfig.confirmationWeight,
  };
  const hybridResult = evaluateApproach(bestConfig, hybridWeights);

  const optimizedWeights: OptimizedWeights = {
    gaussianFactor: 1,
    fibonacciFactor: 1,
    goldenRatioFactor: 1,
    pythagoreanFactor: 1,
    paretoTier1Factor: 1,
    quantumNoiseFactor: 0.12,
    quantumSigma: 1,
    whitsonFilterEnabled: true,
    emaShortWindow: bestConfig.emaShortWindow,
    emaLongWindow: bestConfig.emaLongWindow,
    macdFast: bestConfig.macdFast,
    macdSlow: bestConfig.macdSlow,
    macdSignal: bestConfig.macdSignal,
    rsiWindow: bestConfig.rsiWindow,
    bbWindow: bestConfig.bbWindow,
    aroonWindow: bestConfig.aroonWindow,
    adxWindow: bestConfig.adxWindow,
    atrWindow: bestConfig.atrWindow,
    zWeight: bestConfig.zWeight,
    meanReversionWeight: bestConfig.meanReversionWeight,
    trendWeight: bestConfig.trendWeight,
    confirmationWeight: bestConfig.confirmationWeight,
  };

  const approachScores = {
    singleBest: individualResults[0].hit3Rate,
    combo2: comboResults[0].hit3Rate,
    combo3: comboResults[1].hit3Rate,
    combo4: comboResults[2].hit3Rate,
    combo5: comboResults[3].hit3Rate,
    combo6: comboResults[4].hit3Rate,
    hybrid: hybridResult.hit3Rate,
  };

  const maxScore = Math.max(...Object.values(approachScores));
  const bestApproach =
    maxScore === approachScores.hybrid ? '팩터 기반 하이브리드' :
    maxScore === approachScores.combo6 ? '균형형 병합' :
    maxScore === approachScores.combo5 ? '확인 강화 병합' :
    maxScore === approachScores.combo4 ? '4팩터 병합' :
    maxScore === approachScores.combo3 ? '3팩터 병합' :
    maxScore === approachScores.combo2 ? '2팩터 병합' :
    `단일 전략 (${individualResults[0].name})`;

  const recommendation =
    `"${bestApproach}"이 최근 ${rounds}회 롤링 백테스트에서 3개+ 일치율 ${maxScore.toFixed(2)}%, ` +
    `상위 6개 평균 적중 ${hybridResult.avgMatches.toFixed(2)}개를 기록했습니다. ` +
    `최적 설정은 EMA(${bestConfig.emaShortWindow}/${bestConfig.emaLongWindow}) · MACD(${bestConfig.macdFast}/${bestConfig.macdSlow}/${bestConfig.macdSignal}) · RSI(${bestConfig.rsiWindow}) · BB(${bestConfig.bbWindow}) · ADX(${bestConfig.adxWindow}) · ATR(${bestConfig.atrWindow})입니다.`;

  return {
    individual: individualResults,
    comboResults,
    approachScores,
    optimizedWeights,
    analysedRounds: rounds,
    randomBaseline: RANDOM_BASELINE,
    bestSingleName: individualResults[0].name,
    recommendation,
  };
}

// ==========================================
// 11. QUANTUM FLUX ENGINE (최적화 가중치 적용)
// ==========================================
export function generateQuantumFlux(
  results: LottoResult[],
  githubCombinations: number[][] = [],
  opts?: OptimizedWeights,
  fixedNumbers: number[] = []   // 반드시 포함할 번호 (최대 5개)
): PredictionResult {
  const stats = analyzeLotto(results);
  const recentAvgNum = Math.round((results[0]?.numbers.reduce((a, b) => a + b, 0) ?? 138) / 6);
  const goldenCandidates = getGoldenRatioCandidates(recentAvgNum);
  const pareto = getParetoTiers(stats.hotNumbers, stats.coldNumbers);
  const whitson = analyzeWhitsonPattern(results);
  const whitsonEnabled = opts?.whitsonFilterEnabled ?? true;
  const quantumSigma = opts?.quantumSigma ?? 1; // Box-Muller σ (최적화 적용: 2 -> 1)

  // Z-Score 및 동반 출현 번호 (Co-Occurrence) 계산
  // 1. Z-Score: 각 번호의 전체 출현 빈도 기반 통계적 편차
  const { frequencies } = stats;
  const freqValues = Object.values(frequencies);
  const freqMean = freqValues.reduce((a, b) => a + b, 0) / freqValues.length;
  const freqStdDev = Math.sqrt(freqValues.reduce((s, v) => s + Math.pow(v - freqMean, 2), 0) / freqValues.length) || 1;
  const zScores: Record<number, number> = {};
  for (let i = 1; i <= 45; i++) {
    zScores[i] = (frequencies[i] - freqMean) / freqStdDev;
  }

  // 2. 동반 출현 번호 (Co-Occurrence) 가중치 행렬 계산
  // 특정 번호가 나왔을 때 함께 잘 나오는 번호들에 가산점을 주기 위한 행렬
  const coOccurrence: Record<number, Record<number, number>> = {};
  for (let i = 1; i <= 45; i++) {
    coOccurrence[i] = {};
    for (let j = 1; j <= 45; j++) {
      coOccurrence[i][j] = 0;
    }
  }
  results.forEach(draw => {
    const nums = draw.numbers;
    for (let i = 0; i < nums.length; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        coOccurrence[nums[i]][nums[j]]++;
        coOccurrence[nums[j]][nums[i]]++;
      }
    }
  });

  // Technical Indicator Weights (MA, RSI, Bollinger Bands, Aroon)
  // Computed once here and passed into every buildCombinedWeights call below.
  // Each indicator is reinterpreted for frequency-based lottery analysis:
  //   MA        → short/long rolling appearance-rate crossover (frequency trend)
  //   RSI       → appearance-momentum ratio (over/under-represented recently)
  //   Bollinger → cross-sectional frequency band deviation across all 45 numbers
  //   Aroon     → gap-recency oscillator (how recently vs how long since drought)
  const technicalScores = buildTechnicalWeights(results, opts);

  const methodLabels = [
    '팩터 기반 하이브리드', 'Z-Score 장기 편차', 'EMA/MACD 추세', 'RSI 평균회귀',
    '볼린저밴드 횡단면편차', 'ADX/ATR 확인 필터', '동반출현(Co-Occurrence) 시너지',
    '양자 요동 노이즈',
  ];
  const optimizedTag = opts ? ['[최적화 가중치 적용]'] : [];

  // 경로 A: GitHub 조합 가중 스코어링
  if (githubCombinations.length > 0) {
    const weights = buildCombinedWeights(stats, goldenCandidates, pareto, opts, technicalScores);
    const scored = githubCombinations
      .filter(combo => {
        // 고정 번호가 있을 경우 해당 번호를 모두 포함하는 조합만 허용
        if (fixedNumbers.length > 0 && !fixedNumbers.every(n => combo.includes(n))) return false;
        return passesPythonFilters(combo);
      })
      .map(combo => ({ combo, score: combo.reduce((sum, n) => sum + (weights[n - 1] ?? 0), 0) }))
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      const topPool = scored.slice(0, Math.max(1, Math.floor(scored.length * 0.05)));
      const selected = topPool[Math.floor(Math.random() * topPool.length)];
      const reason = buildSelectionReason(selected.combo, pareto, goldenCandidates, whitson);
      return buildPredictionResult(selected.combo, 96, ['GitHub 조합 가중 스코어링', ...methodLabels, ...optimizedTag, ...PYTHON_FILTER_FORMULAS], reason);
    }
  }

  // 경로 B: 직접 생성
  let attempts = 2000;
  while (attempts > 0) {
    const weights = buildCombinedWeights(stats, goldenCandidates, pareto, opts, technicalScores);
    
    // Z-Score 보정: 과도하게 적게 나오거나(Z < -1.5) 과도하게 많이 나온(Z > 1.5) 번호의 가중치를 미세 조정
    for (let i = 0; i < 45; i++) {
      const z = zScores[i + 1];
      if (z > 1.5) weights[i] *= 0.85; // 너무 많이 나온 번호는 억제
      else if (z < -1.5) weights[i] *= 1.15; // 너무 안 나온 번호는 약간의 가산점 (회귀 기대)
      const hybridScore = technicalScores[i]?.hybridCompositeScore ?? 50;
      if (hybridScore >= 65) weights[i] *= 1.18;
      else if (hybridScore < 45) weights[i] *= 0.38;
    }

    let candidates: number[];
    if (fixedNumbers.length > 0) {
      // 고정 번호는 확정, 나머지 (6 - fixed) 개만 가중치 선택
      // 고정 번호의 가중치를 0으로 설정해 중복 선택 방지
      const wCopy = [...weights];
      fixedNumbers.forEach(n => { wCopy[n - 1] = 0; });
      const remaining = weightedRandomSelect(wCopy, 6 - fixedNumbers.length);
      candidates = [...new Set([...fixedNumbers, ...remaining])].sort((a, b) => a - b);
    } else {
      candidates = weightedRandomSelect(weights, 6);
    }

    // 동반 출현 시너지 보정: 선택된 6개의 번호 간의 동반 출현 점수를 계산하여 기준 미달이면 다시 뽑기
    // 전체 쌍(15개)의 평균 동반 출현 횟수가 전체 회차 대비 일정 비율 이상이어야 함
    let coOccurrenceScore = 0;
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        coOccurrenceScore += coOccurrence[candidates[i]][candidates[j]];
      }
    }
    // 동반 출현 점수가 너무 낮으면 (서로 전혀 안 어울리는 번호들만 모였을 경우) 패스
    const avgCoOccurrence = coOccurrenceScore / 15;
    const minCoOccurrence = results.length * 0.015; // 전체 데이터의 1.5% 정도는 동반 출현한 경험이 있어야 함
    if (avgCoOccurrence < minCoOccurrence) {
      attempts--;
      continue;
    }

    if (attempts % 4 === 0) {
      // 고정 번호는 양자 요동에서 제외 — 요동 대상은 비고정 번호만
      const fixedSet = new Set(fixedNumbers);
      candidates = candidates.map(n =>
        fixedSet.has(n) ? n : applyQuantumFluctuation(n, quantumSigma)
      );
      candidates = [...new Set(candidates)];
      while (candidates.length < 6) candidates.push(Math.floor(Math.random() * 45) + 1);
      candidates = [...new Set(candidates)].sort((a, b) => a - b).slice(0, 6);
      // 요동 후에도 고정 번호가 모두 포함되어 있는지 확인
      if (fixedNumbers.length > 0 && !fixedNumbers.every(n => candidates.includes(n))) {
        attempts--; continue;
      }
    }

    if (candidates.length !== 6) { attempts--; continue; }

    const sum = candidates.reduce((a, b) => a + b, 0);
    const oddCount = candidates.filter(n => n % 2 !== 0).length;
    const whitsonOk = !whitsonEnabled || (Math.abs(oddCount - whitson.targetOdd) <= 1 && sum >= whitson.sumMin && sum <= whitson.sumMax);

    if (passesPythonFilters(candidates) && whitsonOk) {
      const reason = buildSelectionReason(candidates, pareto, goldenCandidates, whitson);
      return buildPredictionResult(candidates, opts ? 92 : 88, [...methodLabels, ...optimizedTag, ...PYTHON_FILTER_FORMULAS], reason);
    }
    if (attempts < 500 && passesPythonFilters(candidates)) {
      const reason = buildSelectionReason(candidates, pareto, goldenCandidates, whitson);
      return buildPredictionResult(candidates, opts ? 82 : 78, [...methodLabels, ...optimizedTag, ...PYTHON_FILTER_FORMULAS, 'Whitson 조건 완화'], reason);
    }
    attempts--;
  }

  const fallback = generateFallbackNumbers();
  return buildPredictionResult(fallback, 55, ['기본 랜덤 대체', ...PYTHON_FILTER_FORMULAS], {
    stage1_modelDesign: '6종 통합 모델 (폴백)',
    stage2_calcLogic: '필터 통과 실패 → 기본 랜덤 대체',
    stage3_setReason: `합계 ${fallback.reduce((a, b) => a + b, 0)} | 최적화 실패`,
  });
}

// ==========================================
// 12. QUANTUM PARAMETER OPTIMIZATION ENGINE
// ==========================================
/**
 * Box-Muller 양자 요동의 두 핵심 파라미터를 최근 1년 데이터로 그리드 탐색합니다.
 *
 * [파라미터 1] qNoise (가중치 교란 진폭)
 *   Q = 1.0 + (rand - 0.5) × qNoise
 *   - qNoise = 0.0 → 교란 없음, 가중치 완전 결정론적
 *   - qNoise = 0.3 → ±15% 교란 (현재 기본값)
 *   - qNoise = 1.0 → ±50% 교란, 사실상 반-랜덤
 *
 * [파라미터 2] sigma (번호 교란 표준편차)
 *   Box-Muller: z = √(-2ln u1) × cos(2π u2) × sigma
 *   - sigma = 0 → 번호 교란 없음
 *   - sigma = 2 → 약 68%가 ±2 범위 이내 이동 (현재 기본값)
 *   - sigma = 5 → 약 68%가 ±5 범위 이내 이동
 *
 * 백테스팅 방법: 최근 testRounds 회차에 대해 예측하고 실제 번호와 비교
 * 성과 지표: 3개+ 일치율(%), 2개+ 일치율(%), 안정성 점수
 */
export async function optimizeQuantumParameters(
  allData: LottoResult[],
  testRounds = 52,
  predictionsPerRound = 30
): Promise<QuantumOptimizationResult> {
  const RANDOM_BASELINE = 2.38;
  const CURRENT_Q_NOISE = 0.3;
  const CURRENT_SIGMA = 2;

  const rounds = Math.min(testRounds, allData.length - 30);

  // 훈련 데이터: 테스트 기간 이전 데이터만 사용
  const trainingData = allData.slice(rounds);
  const baseStats = analyzeLotto(trainingData);
  const basePareto = getParetoTiers(baseStats.hotNumbers, baseStats.coldNumbers);
  const baseGolden = getGoldenRatioCandidates(Math.round(baseStats.averageSum / 6));
  const baseTechnical = buildTechnicalWeights(trainingData, DEFAULT_HYBRID_CONFIG);

  const countMatches = (pred: number[], actual: number[]) => pred.filter(n => actual.includes(n)).length;

  // --- 공통 가중치 생성 (qNoise 주입용) ---
  const makeWeights = (qNoise: number): number[] => {
    return buildCombinedWeights(baseStats, baseGolden, basePareto, { ...DEFAULT_HYBRID_CONFIG, quantumNoiseFactor: qNoise, quantumSigma: CURRENT_SIGMA, gaussianFactor: 1, fibonacciFactor: 1, goldenRatioFactor: 1, pythagoreanFactor: 1, paretoTier1Factor: 1, whitsonFilterEnabled: true }, baseTechnical);
  };

  // --- qNoise 그리드 탐색 ---
  const qNoiseGrid = [0.0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.8, 1.0];

  const sweepQNoise = (): QuantumNoiseTestResult[] => {
    return qNoiseGrid.map(qNoise => {
      let totalMatches = 0, hit2 = 0, hit3 = 0;
      const roundHit3Rates: number[] = [];

      for (let i = 0; i < rounds; i++) {
        const targetNums = allData[i].numbers;
        let roundHit3 = 0;

        for (let p = 0; p < predictionsPerRound; p++) {
          const weights = makeWeights(qNoise);
          const pred = weightedRandomSelect(weights, 6);
          const m = countMatches(pred, targetNums);
          totalMatches += m;
          if (m >= 2) hit2++;
          if (m >= 3) { hit3++; roundHit3++; }
        }
        roundHit3Rates.push((roundHit3 / predictionsPerRound) * 100);
      }

      const total = rounds * predictionsPerRound;
      const hit3Rate = (hit3 / total) * 100;

      // 안정성: 라운드별 히트율의 표준편차가 낮을수록 안정
      const mean = roundHit3Rates.reduce((a, b) => a + b, 0) / roundHit3Rates.length;
      const stdDev = Math.sqrt(roundHit3Rates.reduce((s, v) => s + (v - mean) ** 2, 0) / roundHit3Rates.length);
      const stabilityScore = Math.max(0, 100 - stdDev * 10); // 100점 만점

      // qNoise → ±% 변환: Q 범위 = [1 - qNoise/2, 1 + qNoise/2]
      const pctRange = Math.round(qNoise * 50);
      const label = qNoise === 0 ? '교란 없음 (0%)' : `±${pctRange}% (qNoise=${qNoise.toFixed(2)})`;

      return {
        paramValue: qNoise,
        label,
        avgMatches: totalMatches / total,
        hit2Rate: (hit2 / total) * 100,
        hit3Rate,
        improvement: ((hit3Rate - RANDOM_BASELINE) / RANDOM_BASELINE) * 100,
        stabilityScore,
      };
    });
  };

  // --- sigma 그리드 탐색 (qNoise=0.3 고정) ---
  const sigmaGrid = [0, 1, 2, 3, 4, 5];

  const sweepSigma = (): QuantumNoiseTestResult[] => {
    return sigmaGrid.map(sigma => {
      let totalMatches = 0, hit2 = 0, hit3 = 0;
      const roundHit3Rates: number[] = [];

      for (let i = 0; i < rounds; i++) {
        const targetNums = allData[i].numbers;
        let roundHit3 = 0;

        for (let p = 0; p < predictionsPerRound; p++) {
          const weights = makeWeights(CURRENT_Q_NOISE);
          let pred = weightedRandomSelect(weights, 6);

          // sigma에 따른 Box-Muller 번호 교란 적용
          if (sigma > 0) {
            pred = pred.map(n => applyQuantumFluctuation(n, sigma));
            pred = [...new Set(pred)];
            // 중복 제거 후 부족한 번호 보충
            while (pred.length < 6) pred.push(Math.floor(Math.random() * 45) + 1);
            pred = [...new Set(pred)].sort((a, b) => a - b).slice(0, 6);
          }

          const m = countMatches(pred, targetNums);
          totalMatches += m;
          if (m >= 2) hit2++;
          if (m >= 3) { hit3++; roundHit3++; }
        }
        roundHit3Rates.push((roundHit3 / predictionsPerRound) * 100);
      }

      const total = rounds * predictionsPerRound;
      const hit3Rate = (hit3 / total) * 100;
      const mean = roundHit3Rates.reduce((a, b) => a + b, 0) / roundHit3Rates.length;
      const stdDev = Math.sqrt(roundHit3Rates.reduce((s, v) => s + (v - mean) ** 2, 0) / roundHit3Rates.length);
      const stabilityScore = Math.max(0, 100 - stdDev * 10);

      // σ에 따른 68% 신뢰구간 범위 계산 (정규분포 1σ = 68%)
      const range68 = `68%가 ±${sigma}칸 이내`;
      const label = sigma === 0 ? '번호 교란 없음 (σ=0)' : `σ=${sigma} (${range68})`;

      return {
        paramValue: sigma,
        label,
        avgMatches: totalMatches / total,
        hit2Rate: (hit2 / total) * 100,
        hit3Rate,
        improvement: ((hit3Rate - RANDOM_BASELINE) / RANDOM_BASELINE) * 100,
        stabilityScore,
      };
    });
  };

  // --- 탐색 실행 ---
  const qNoiseResults = sweepQNoise();
  const sigmaResults  = sweepSigma();

  // --- 최적값 결정: 히트율과 안정성의 균형 점수 기준 ---
  const compositeScore = (r: QuantumNoiseTestResult) => r.hit3Rate * 0.7 + r.stabilityScore * 0.03;

  const optimalQNoiseResult = qNoiseResults.reduce((best, r) => compositeScore(r) > compositeScore(best) ? r : best);
  const optimalSigmaResult  = sigmaResults.reduce((best, r) => compositeScore(r) > compositeScore(best) ? r : best);

  const optimalQNoise = optimalQNoiseResult.paramValue;
  const optimalSigma  = optimalSigmaResult.paramValue;

  const currentResult  = qNoiseResults.find(r => r.paramValue === CURRENT_Q_NOISE) ?? qNoiseResults[6];
  const improvementVsCurrent = ((optimalQNoiseResult.hit3Rate - currentResult.hit3Rate) / Math.max(0.01, currentResult.hit3Rate)) * 100;

  // --- 인사이트 도출 ---
  const insights: string[] = [];

  // qNoise 인사이트
  const noNoiseResult = qNoiseResults.find(r => r.paramValue === 0)!;
  const highNoiseResult = qNoiseResults.find(r => r.paramValue >= 0.8)!;
  if (noNoiseResult.hit3Rate < optimalQNoiseResult.hit3Rate * 0.9) {
    insights.push(`교란 없음(0%) 대비 최적값(${(optimalQNoise * 50).toFixed(0)}%)이 ${((optimalQNoiseResult.hit3Rate / noNoiseResult.hit3Rate - 1) * 100).toFixed(0)}% 우수 → 교란이 탐색 다양성을 향상시킵니다.`);
  }
  if (highNoiseResult.hit3Rate < optimalQNoiseResult.hit3Rate * 0.95) {
    insights.push(`과도한 교란(±40%+)은 가중치 구조를 희석시켜 성과가 저하됩니다.`);
  }
  if (optimalQNoise < CURRENT_Q_NOISE) {
    insights.push(`최적 교란 진폭(±${(optimalQNoise * 50).toFixed(0)}%)이 현재(±15%)보다 낮습니다 → 최근 1년 패턴에서 수학적 가중치가 더 결정적입니다.`);
  } else if (optimalQNoise > CURRENT_Q_NOISE) {
    insights.push(`최적 교란 진폭(±${(optimalQNoise * 50).toFixed(0)}%)이 현재(±15%)보다 높습니다 → 더 넓은 탐색이 최근 패턴에 유리합니다.`);
  } else {
    insights.push(`현재 설정(±15%)이 최적에 매우 근접합니다.`);
  }

  // sigma 인사이트
  const noSigmaResult = sigmaResults.find(r => r.paramValue === 0)!;
  if (optimalSigmaResult.hit3Rate > noSigmaResult.hit3Rate) {
    insights.push(`σ=${optimalSigma} 번호 교란이 교란 없음 대비 성과를 향상시킵니다 → Box-Muller 변환이 유효합니다.`);
  } else {
    insights.push(`번호 교란 없음이 더 나은 성과를 보입니다 → 현재 번호 교란 주기(매 4번째 시도)를 줄이는 것을 권장합니다.`);
  }
  if (optimalSigma !== CURRENT_SIGMA) {
    insights.push(`번호 교란 σ를 ${CURRENT_SIGMA} → ${optimalSigma}로 조정하면 68% 신뢰구간이 ±${CURRENT_SIGMA}칸에서 ±${optimalSigma}칸으로 변경됩니다.`);
  }

  const recommendation =
    `[최적 qNoise] ±${(optimalQNoise * 50).toFixed(0)}% (qNoise = ${optimalQNoise.toFixed(2)}) / ` +
    `[최적 sigma] σ = ${optimalSigma} (68%가 ±${optimalSigma}칸 이내). ` +
    (improvementVsCurrent > 1
      ? `현재 설정(±15%, σ=2) 대비 ${improvementVsCurrent.toFixed(1)}% 성과 향상. 자동 적용을 권장합니다.`
      : `현재 설정이 이미 최적에 근접합니다 (차이 ${Math.abs(improvementVsCurrent).toFixed(1)}% 이내).`);

  return {
    qNoiseResults,
    sigmaResults,
    optimalQNoise,
    optimalSigma,
    currentQNoise: CURRENT_Q_NOISE,
    currentSigma: CURRENT_SIGMA,
    improvementVsCurrent,
    recommendation,
    insights,
    analysedRounds: rounds,
    randomBaseline: RANDOM_BASELINE,
  };
}

export function calculateBallColor(num: number): string {
  if (num <= 10) return 'bg-yellow-400 text-yellow-900';
  if (num <= 20) return 'bg-blue-500 text-white';
  if (num <= 30) return 'bg-red-500 text-white';
  if (num <= 40) return 'bg-gray-500 text-white';
  return 'bg-green-500 text-white';
}
