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
}

export function analyzeRepeatProbability(results: LottoResult[], targetNumber: number, lookbackRounds = 100): RepeatAnalysis {
  if (!results || results.length === 0) {
    return {
      targetNumber, totalOccurrences: 0, recent10Occurrences: 0, recent30Occurrences: 0,
      repeatAfterOne: 0, repeatAfterTwo: 0, repeatPercentage: 0, averageGap: 0,
      gapTrend: 'STABLE', lastSeenRound: 0, roundsSinceLastSeen: 0,
      confidenceLevel: 'LOW', insight: '데이터 부족', recommendation: '데이터 부족',
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
  return {
    targetNumber, totalOccurrences, recent10Occurrences, recent30Occurrences,
    repeatAfterOne, repeatAfterTwo, repeatPercentage, averageGap, gapTrend,
    lastSeenRound, roundsSinceLastSeen, confidenceLevel, insight, recommendation,
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
  return differences.size - 5 >= 7;
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
  return ratio >= 1.5 && ratio <= 4.5;
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
      if (i < sorted.length - 2 && sorted[i] + 2 === sorted[i + 2]) return false;
    }
  }
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
  opts?: OptimizedWeights
): number[] {
  const gaussWeights = buildGaussianWeights(stats.frequencies);
  const maxPythFreq = Math.max(...Object.values(PYTHAGOREAN_FREQ), 1);

  const gaussFactor   = opts?.gaussianFactor      ?? 1.0;
  const fibFactor     = opts?.fibonacciFactor      ?? 1.4;
  const goldenFactor  = opts?.goldenRatioFactor    ?? 1.6;
  const pythFactor    = opts?.pythagoreanFactor    ?? 0.4;
  const paretoT1      = opts?.paretoTier1Factor    ?? 2.5;
  const qNoise        = opts?.quantumNoiseFactor   ?? 0.3;

  return Array.from({ length: 45 }, (_, i) => {
    const num = i + 1;
    const G  = gaussWeights[i] * gaussFactor + (1 - gaussFactor) * 0.5;
    const P  = pareto.tier1.includes(num) ? paretoT1
              : pareto.tier2.includes(num) ? 1.5
              : pareto.tier3.includes(num) ? 0.7 : 1.0;
    const F  = FIBONACCI_NUMBERS.includes(num) ? fibFactor : 1.0;
    const Gd = goldenCandidates.includes(num) ? goldenFactor : 1.0;
    const Py = 1.0 + (PYTHAGOREAN_FREQ[num] / maxPythFreq) * pythFactor;
    const Q  = 1.0 + (Math.random() - 0.5) * qNoise;
    return Math.max(0.01, G * P * F * Gd * Py * Q);
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
  const fibInSet = numbers.filter(n => FIBONACCI_NUMBERS.includes(n));
  const goldenInSet = numbers.filter(n => goldenCandidates.includes(n));
  const paretoT1 = numbers.filter(n => pareto.tier1.includes(n));
  const paretoT3 = numbers.filter(n => pareto.tier3.includes(n));
  const pythInSet = numbers.filter(n => PYTHAGOREAN_FREQ[n] > 2);
  const reasons: string[] = [];
  if (fibInSet.length > 0) reasons.push(`피보나치 수열 [${fibInSet.join(',')}]`);
  if (goldenInSet.length > 0) reasons.push(`황금비(φ) 파생 [${goldenInSet.join(',')}]`);
  if (paretoT1.length >= 2) reasons.push(`Pareto Top-20% Hot ${paretoT1.length}개`);
  if (paretoT3.length > 0) reasons.push(`Pareto 역추적 Cold ${paretoT3.length}개`);
  if (Math.abs(oddCount - whitson.targetOdd) <= 1) reasons.push(`Whitson 홀짝 패턴(${oddCount}:${6 - oddCount}) 일치`);
  if (pythInSet.length >= 2) reasons.push(`피타고라스 구조 수 [${pythInSet.join(',')}]`);
  return {
    stage1_modelDesign: '피타고라스 비율 구조 · 피보나치/황금비 · 가우스 정규분포 · Pareto 80/20 · Whitson 패턴 반복 · 양자 요동 노이즈 — 6종 기법 통합 확률 최적화 모델',
    stage2_calcLogic: `W(n) = G(μ,σ) × P(파레토 Tier) × F(피보나치 ${fibInSet.length > 0 ? '✓' : '-'}) × φ(황금비 ${goldenInSet.length > 0 ? '✓' : '-'}) × Py(피타고라스) × Q(양자노이즈) → 룰렛 휠 가중 샘플링 → Python 6종 필터 검증`,
    stage3_setReason: `합계 ${sum} | 홀짝 ${oddCount}:${6 - oddCount} | 고저 ${highCount}:${6 - highCount} | ${reasons.length > 0 ? reasons.join(' · ') : '가우스 분포 중심 기반 균형 조합'}`,
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
  const RANDOM_BASELINE = 2.38; // 이론적 무작위 기준선 (%)
  const rounds = Math.min(testRounds, allData.length - 30);

  // 훈련 데이터: 테스트 기간 이전 데이터만 사용 (데이터 누수 방지)
  const trainingData = allData.slice(rounds);
  if (trainingData.length < 20) {
    throw new Error('분석에 필요한 데이터가 부족합니다 (최소 30회차 이상 필요)');
  }

  const baseStats = analyzeLotto(trainingData);
  const baseWhitson = analyzeWhitsonPattern(trainingData);
  const countMatches = (pred: number[], actual: number[]) => pred.filter(n => actual.includes(n)).length;

  // 단일 전략 백테스트 실행기
  const runTest = (generatorFn: (s: LottoStats, w: WhitsonPattern) => number[]) => {
    let totalMatches = 0, hit2 = 0, hit3 = 0;
    const total = rounds * predictionsPerRound;
    for (let i = 0; i < rounds; i++) {
      const targetNums = allData[i].numbers;
      for (let p = 0; p < predictionsPerRound; p++) {
        const pred = generatorFn(baseStats, baseWhitson);
        const m = countMatches(pred, targetNums);
        totalMatches += m;
        if (m >= 2) hit2++;
        if (m >= 3) hit3++;
      }
    }
    return { avgMatches: totalMatches / total, hit2Rate: (hit2 / total) * 100, hit3Rate: (hit3 / total) * 100 };
  };

  // 6종 개별 전략 테스트
  const strategies: Array<{ name: string; key: string; fn: (s: LottoStats, w: WhitsonPattern) => number[] }> = [
    { name: '가우스 정규분포',    key: 'gaussian',    fn: (s) => strategyGaussian(s) },
    { name: '피보나치/황금비(φ)', key: 'fibonacci',   fn: (s) => strategyFibonacci(s) },
    { name: '피타고라스 수열',    key: 'pythagorean', fn: ()  => strategyPythagorean() },
    { name: 'Pareto 80/20',       key: 'pareto',      fn: (s) => strategyPareto(s) },
    { name: 'Whitson 패턴법칙',   key: 'whitson',     fn: (s, w) => strategyWhitson(s, w) },
    { name: '양자 요동 노이즈',   key: 'quantum',     fn: (s) => strategyQuantum(s) },
  ];

  const individualResults: StrategyTestResult[] = strategies.map(strategy => {
    const result = runTest(strategy.fn);
    const improvement = ((result.hit3Rate - RANDOM_BASELINE) / RANDOM_BASELINE) * 100;
    const grade: StrategyTestResult['grade'] =
      improvement > 60 ? 'S' : improvement > 25 ? 'A' : improvement > 0 ? 'B' : improvement > -20 ? 'C' : 'D';
    return { name: strategy.name, key: strategy.key, ...result, improvement, grade };
  });

  individualResults.sort((a, b) => b.hit3Rate - a.hit3Rate);

  // 전략별 점수 맵
  const scoreMap: Record<string, number> = {};
  individualResults.forEach(r => { scoreMap[r.key] = r.hit3Rate; });

  // 조합 전략 테스트 (Pareto+Gaussian을 핵심으로 단계적 추가)
  type ComboFlags = { gaussian: boolean; fibonacci: boolean; pythagorean: boolean; pareto: boolean; whitson: boolean; quantum: boolean };

  const buildComboWeights = (flags: ComboFlags) => {
    const pareto = getParetoTiers(baseStats.hotNumbers, baseStats.coldNumbers);
    const goldenCands = getGoldenRatioCandidates(Math.round(baseStats.averageSum / 6));
    const gaussW = flags.gaussian ? buildGaussianWeights(baseStats.frequencies) : null;
    const maxPyth = Math.max(...Object.values(PYTHAGOREAN_FREQ), 1);
    return Array.from({ length: 45 }, (_, i) => {
      const num = i + 1;
      let w = 1.0;
      if (flags.gaussian && gaussW) w *= (gaussW[i] * 2 + 0.3);
      if (flags.pareto)      w *= pareto.tier1.includes(num) ? 2.5 : pareto.tier2.includes(num) ? 1.5 : pareto.tier3.includes(num) ? 0.7 : 1.0;
      if (flags.fibonacci)   w *= (FIBONACCI_NUMBERS.includes(num) ? 1.4 : 1.0) * (goldenCands.includes(num) ? 1.6 : 1.0);
      if (flags.pythagorean) w *= 1.0 + (PYTHAGOREAN_FREQ[num] / maxPyth) * 0.4;
      if (flags.quantum)     w *= 1.0 + (Math.random() - 0.5) * 0.3;
      return Math.max(0.01, w);
    });
  };

  const runComboTest = (flags: ComboFlags) => {
    let totalMatches = 0, hit2 = 0, hit3 = 0;
    const total = rounds * predictionsPerRound;
    for (let i = 0; i < rounds; i++) {
      const targetNums = allData[i].numbers;
      for (let p = 0; p < predictionsPerRound; p++) {
        const weights = buildComboWeights(flags);
        let pred = weightedRandomSelect(weights, 6);
        // Whitson 필터 (활성화 시 최대 50회 재시도)
        if (flags.whitson) {
          for (let attempt = 0; attempt < 50; attempt++) {
            const odd = pred.filter(n => n % 2 !== 0).length;
            const sum = pred.reduce((a, b) => a + b, 0);
            if (Math.abs(odd - baseWhitson.targetOdd) <= 1 && sum >= baseWhitson.sumMin && sum <= baseWhitson.sumMax) break;
            pred = weightedRandomSelect(buildComboWeights(flags), 6);
          }
        }
        const m = countMatches(pred, targetNums);
        totalMatches += m;
        if (m >= 2) hit2++;
        if (m >= 3) hit3++;
      }
    }
    return { avgMatches: totalMatches / total, hit2Rate: (hit2 / total) * 100, hit3Rate: (hit3 / total) * 100 };
  };

  const comboDefs = [
    { label: '2전략 병합 (Pareto + 가우스)', strategies: ['Pareto 80/20', '가우스 정규분포'], flags: { gaussian: true, fibonacci: false, pythagorean: false, pareto: true, whitson: false, quantum: false } },
    { label: '3전략 병합 (+ Whitson)', strategies: ['Pareto 80/20', '가우스 정규분포', 'Whitson 패턴법칙'], flags: { gaussian: true, fibonacci: false, pythagorean: false, pareto: true, whitson: true, quantum: false } },
    { label: '4전략 병합 (+ 피타고라스)', strategies: ['Pareto 80/20', '가우스 정규분포', 'Whitson', '피타고라스'], flags: { gaussian: true, fibonacci: false, pythagorean: true, pareto: true, whitson: true, quantum: false } },
    { label: '5전략 병합 (+ 양자요동)', strategies: ['Pareto', '가우스', 'Whitson', '피타고라스', '양자요동'], flags: { gaussian: true, fibonacci: false, pythagorean: true, pareto: true, whitson: true, quantum: true } },
    { label: '6전략 병합 (전체)', strategies: ['전체 6종'], flags: { gaussian: true, fibonacci: true, pythagorean: true, pareto: true, whitson: true, quantum: true } },
  ];

  const comboResults = comboDefs.map(def => {
    const result = runComboTest(def.flags as ComboFlags);
    const improvement = ((result.hit3Rate - RANDOM_BASELINE) / RANDOM_BASELINE) * 100;
    return { label: def.label, strategies: def.strategies, hit3Rate: result.hit3Rate, improvement };
  });

  // 하이브리드: 개별 점수를 지수로 사용한 동적 가중치
  const hybridResult = runComboTest({
    gaussian: true, fibonacci: scoreMap['fibonacci'] > RANDOM_BASELINE,
    pythagorean: scoreMap['pythagorean'] > RANDOM_BASELINE,
    pareto: true, whitson: scoreMap['whitson'] > RANDOM_BASELINE,
    quantum: true,
  });

  // 최적화 가중치 계산
  const norm = (key: string, defaultVal: number, min: number, max: number) => {
    const ratio = (scoreMap[key] ?? RANDOM_BASELINE) / RANDOM_BASELINE;
    return Math.max(min, Math.min(max, defaultVal * ratio));
  };

  const optimizedWeights: OptimizedWeights = {
    gaussianFactor:      norm('gaussian',    1.0, 0.5, 2.0),
    fibonacciFactor:     norm('fibonacci',   1.4, 0.8, 2.0),
    goldenRatioFactor:   norm('fibonacci',   1.6, 0.9, 2.4),
    pythagoreanFactor:   norm('pythagorean', 0.4, 0.1, 0.8),
    paretoTier1Factor:   norm('pareto',      2.5, 1.5, 4.0),
    quantumNoiseFactor:  norm('quantum',     0.3, 0.1, 0.5),
    quantumSigma:        2,   // 양자 파라미터 최적화에서 별도 결정됨
    whitsonFilterEnabled: (scoreMap['whitson'] ?? 0) >= RANDOM_BASELINE,
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
    maxScore === approachScores.hybrid    ? '팩터 하이브리드 전략' :
    maxScore === approachScores.singleBest ? `단일 전략 (${individualResults[0].name})` :
    maxScore === approachScores.combo6    ? '6전략 전체 병합' :
    maxScore === approachScores.combo5    ? '5전략 병합' :
    maxScore === approachScores.combo4    ? '4전략 병합' :
    maxScore === approachScores.combo3    ? '3전략 병합' : '2전략 병합';

  const recommendation =
    `"${bestApproach}"이 최고 3+매치율 ${maxScore.toFixed(2)}%를 달성했습니다 ` +
    `(무작위 기준선 ${RANDOM_BASELINE}% 대비 ${((maxScore / RANDOM_BASELINE - 1) * 100).toFixed(0)}% 향상). ` +
    `최적화 가중치가 양자 변동 엔진에 자동 적용되었습니다.`;

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
  opts?: OptimizedWeights
): PredictionResult {
  const stats = analyzeLotto(results);
  const recentAvgNum = Math.round((results[0]?.numbers.reduce((a, b) => a + b, 0) ?? 138) / 6);
  const goldenCandidates = getGoldenRatioCandidates(recentAvgNum);
  const pareto = getParetoTiers(stats.hotNumbers, stats.coldNumbers);
  const whitson = analyzeWhitsonPattern(results);
  const whitsonEnabled = opts?.whitsonFilterEnabled ?? true;
  const quantumSigma = opts?.quantumSigma ?? 2; // Box-Muller σ (최적화 적용)

  const methodLabels = ['피타고라스 비율', '피보나치/황금비(φ)', '가우스 정규분포', 'Pareto 80/20', 'Whitson 패턴법칙', '양자 요동 노이즈'];
  const optimizedTag = opts ? ['[최적화 가중치 적용]'] : [];

  // 경로 A: GitHub 조합 가중 스코어링
  if (githubCombinations.length > 0) {
    const weights = buildCombinedWeights(stats, goldenCandidates, pareto, opts);
    const scored = githubCombinations
      .filter(combo => passesPythonFilters(combo))
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
    const weights = buildCombinedWeights(stats, goldenCandidates, pareto, opts);
    let candidates = weightedRandomSelect(weights, 6);

    if (attempts % 4 === 0) {
      candidates = candidates.map(n => applyQuantumFluctuation(n, quantumSigma));
      candidates = [...new Set(candidates)];
      while (candidates.length < 6) candidates.push(Math.floor(Math.random() * 45) + 1);
      candidates = [...new Set(candidates)].sort((a, b) => a - b).slice(0, 6);
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
  const maxPythFreq = Math.max(...Object.values(PYTHAGOREAN_FREQ), 1);

  const countMatches = (pred: number[], actual: number[]) => pred.filter(n => actual.includes(n)).length;

  // --- 공통 가중치 생성 (qNoise 주입용) ---
  const makeWeights = (qNoise: number): number[] => {
    const gaussW = buildGaussianWeights(baseStats.frequencies);
    return Array.from({ length: 45 }, (_, i) => {
      const num = i + 1;
      const G  = gaussW[i];
      const P  = basePareto.tier1.includes(num) ? 2.5
               : basePareto.tier2.includes(num) ? 1.5
               : basePareto.tier3.includes(num) ? 0.7 : 1.0;
      const F  = FIBONACCI_NUMBERS.includes(num) ? 1.4 : 1.0;
      const Gd = baseGolden.includes(num) ? 1.6 : 1.0;
      const Py = 1.0 + (PYTHAGOREAN_FREQ[num] / maxPythFreq) * 0.4;
      // ← 여기가 최적화 대상: qNoise 값에 따라 Q 교란 크기가 달라짐
      const Q  = 1.0 + (Math.random() - 0.5) * qNoise;
      return Math.max(0.01, G * P * F * Gd * Py * Q);
    });
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
