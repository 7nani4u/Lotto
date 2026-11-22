import { LottoResult, PredictionResult, PredictionSource, SelectionReason } from '../types';

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
  return estimateLatestRound();
}

/**
 * 네트워크 실패 시 대체값. 기존에는 1218 로 고정되어 이후 회차를 영원히 건너뛰었습니다.
 * 1회차 = 2002-12-07(토) 20:45 KST(=11:45 UTC), 이후 매주 1회 → 날짜로 현재 회차를 추정합니다.
 * (추정값이 아직 발표 전 회차여도 fetchDrawNumber 가 null 을 돌려줄 뿐이라 안전)
 */
export function estimateLatestRound(now: number = Date.now()): number {
  const WEEK_MS = 7 * 24 * 3600 * 1000;
  return Math.max(START_ROUND, Math.floor((now - Date.UTC(2002, 11, 7, 11, 45)) / WEEK_MS) + 1);
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
  windowRounds: number;          // totalOccurrences·recent*·repeat*·averageGap 을 센 최근 회차 수 (lookbackRounds, 예: 100)
  totalOccurrences: number;      // 최근 windowRounds 회차 안의 출현 횟수 (본번호+보너스) — 전체 기간이 아님
  allTimeOccurrences: number;    // 전체 데이터에서의 출현 횟수 (본번호+보너스)
  allTimeRounds: number;         // 전체 회차 수
  recent10Occurrences: number;
  recent30Occurrences: number;
  repeatAfterOne: number;
  repeatAfterTwo: number;
  repeatPercentage: number;      // 출현한 회차 중 직전 회차에도 나왔던 비율 (분모 = 직전 회차를 볼 수 있는 출현 수)
  averageGap: number;
  gapTrend: 'INCREASING' | 'DECREASING' | 'STABLE';
  lastSeenRound: number;
  roundsSinceLastSeen: number;
  /**
   * [삭제] confidenceLevel(HIGH/MEDIUM/LOW)·recommendation. 예전 문구는 "통계적 회귀에 의해 조만간 출현할 확률이 매우 높습니다"처럼
   * 근거 없는 예측이었습니다(오래 쉰 번호가 더 잘 나온다는 근거 없음 — 장기 대기 검증·출현 간격 검정 p=0.66). 이제는 관찰한 값과
   * "균등 추첨이면 이럴 확률"만 서술합니다.
   */
  insight: string;               // 관찰 제목 (가장 드문 관찰, 없으면 "무작위 기대 범위")
  observation: string;           // 측정값 + 균등 추첨 기준 확률
  notable: boolean;              // 균등 추첨에서 5 % 미만으로 드문 관찰이 있는가 (3개 후보 중 최소값 — 우연히도 흔함)
  coOccurrenceExpected: { mean: number; sd: number };   // 동반 출현 횟수의 무작위 기대(평균·표준편차)
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
      targetNumber, windowRounds: 0, totalOccurrences: 0, allTimeOccurrences: 0, allTimeRounds: 0,
      recent10Occurrences: 0, recent30Occurrences: 0,
      repeatAfterOne: 0, repeatAfterTwo: 0, repeatPercentage: 0, averageGap: 0,
      gapTrend: 'STABLE', lastSeenRound: 0, roundsSinceLastSeen: 0,
      insight: '데이터 부족', observation: '데이터 부족', notable: false,
      coOccurrenceExpected: { mean: 0, sd: 0 },
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
  let repeatEligible = 0;     // 직전 회차(더 최근 회차)를 볼 수 있는 출현 수 — 가장 최신 회차의 출현은 직전 회차가 없어 제외
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
      if (i > 0) repeatEligible++;
      if (i > 0 && (results[i-1].numbers.includes(targetNumber) || results[i-1].bonus === targetNumber)) repeatAfterOne++;
      if (i > 1 && (results[i-2].numbers.includes(targetNumber) || results[i-2].bonus === targetNumber)) repeatAfterTwo++;
    }
  }

  // [수정] 분모가 (출현 수 − 1) 고정이라, 최신 회차에 안 나온 번호(대부분)는 분모가 1 작아 비율이 부풀었고 출현 1회면 0/0 = NaN 이었음
  const repeatPercentage = repeatEligible > 0 ? (repeatAfterOne / repeatEligible) * 100 : 0;
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

  // ── 관찰 요약 ───────────────────────────────────────────────────────────────
  // 세 가지 관찰(연속 미출현 · 최근 10회 출현 · 직전 회차 직후 재출현)을 각각 "균등 추첨이면 이럴 확률"로 환산해
  // 가장 드문 것을 서술합니다. 한 회차에 번호 하나가 나올 확률(본번호 6 + 보너스 1 → 이 분석의 '출현' 정의) = 7/45.
  // 확률이 5 % 미만이면 notable. 후보가 3개라 우연히도 자주 나오므로 "근거"가 아니라 "관찰"로만 표시합니다.
  const P7 = 7 / 45;
  const fmtP = (p: number) => (p < 0.001 ? '0.1% 미만' : `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`);
  const binomTailGE = (n: number, k: number, p: number): number => {
    if (k <= 0) return 1;
    if (k > n) return 0;
    let pmf = Math.pow(1 - p, n), sum = 0;
    for (let i = 0; i <= n; i++) {
      if (i >= k) sum += pmf;
      pmf *= ((n - i) / (i + 1)) * (p / (1 - p));
    }
    return Math.min(1, sum);
  };
  const candidates: Array<{ p: number; insight: string; text: string }> = [];
  if (roundsSinceLastSeen >= 1) {
    const p = Math.pow(1 - P7, roundsSinceLastSeen);
    candidates.push({
      p, insight: '긴 미출현',
      text: totalOccurrences === 0
        ? `최근 ${checkRounds}회차 동안 한 번도 나오지 않았습니다. 균등 추첨에서 이럴 확률은 ${fmtP(p)}입니다.`
        : `${roundsSinceLastSeen}회차 연속 미출현 중입니다. 균등 추첨에서 이렇게 오래 안 나올 확률은 ${fmtP(p)}입니다.`,
    });
  }
  if (recent10Occurrences >= 2) {
    const p = binomTailGE(10, recent10Occurrences, P7);
    candidates.push({
      p, insight: '최근 자주 출현',
      text: `최근 10회차 중 ${recent10Occurrences}회 출현했습니다 (균등 기대 ${(10 * P7).toFixed(1)}회). 균등 추첨에서 이 이상일 확률은 ${fmtP(p)}입니다.`,
    });
  }
  if (repeatEligible >= 5 && repeatAfterOne / repeatEligible > P7) {
    const p = binomTailGE(repeatEligible, repeatAfterOne, P7);
    candidates.push({
      p, insight: '이월 출현이 잦음',
      text: `출현한 ${repeatEligible}번 중 ${repeatAfterOne}번은 직전 회차에도 나온 직후였습니다 (${((repeatAfterOne / repeatEligible) * 100).toFixed(1)}%, 균등 기대 ${(P7 * 100).toFixed(1)}%). 균등 추첨에서 이 이상일 확률은 ${fmtP(p)}입니다.`,
    });
  }
  candidates.sort((x, y) => x.p - y.p);
  const top = candidates[0];
  const notable = !!top && top.p < 0.05;
  const insight = notable ? top.insight : '무작위 기대 범위';
  const observation = notable
    ? top.text
    : `최근 ${checkRounds}회차 출현 ${totalOccurrences}회 (균등 기대 ${(checkRounds * P7).toFixed(1)}회) · 평균 출현 간격 ${averageGap.toFixed(1)}회 (균등 기대 ${(1 / P7).toFixed(1)}회). 균등 추첨에서 흔히 나오는 범위이며 눈에 띄게 드문 패턴은 없습니다.`;

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

  // 전체 기간 출현 횟수와 동반 출현의 무작위 기대
  //   대상 번호가 나온 회차(7개 중)에서 다른 번호 하나가 함께 나올 확률 = 6/44 → 기대 N×6/44, 표준편차 √(N·p·(1−p))
  const allTimeOccurrences = allFrequencies[targetNumber];
  const coP = 6 / 44;
  const coOccurrenceExpected = {
    mean: allTimeOccurrences * coP,
    sd: Math.sqrt(allTimeOccurrences * coP * (1 - coP)),
  };

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
    targetNumber, windowRounds: checkRounds, totalOccurrences, allTimeOccurrences, allTimeRounds: results.length,
    recent10Occurrences, recent30Occurrences,
    repeatAfterOne, repeatAfterTwo, repeatPercentage, averageGap, gapTrend,
    lastSeenRound, roundsSinceLastSeen, insight, observation, notable, coOccurrenceExpected,
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
    // [수정] 한 번도 안 나온 번호는 findIndex = −1 → max(0, −1) = 0 으로 "방금 나온 번호"가 되었음.
    const seenAt = results.findIndex(r => r.numbers.includes(num) || r.bonus === num);
    const roundsSinceSeen = seenAt < 0 ? results.length : seenAt;
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
// [실제 가중치 — buildTechnicalWeights 의 DEFAULT_HYBRID_CONFIG 와 동일. 이전 주석(Z 30·BB 25·RSI 20·MA 15·Aroon 10)은
//  현행 코드와 달라 정정함]
//   종합 = 0.25·Z + 0.30·평균회귀(0.5·BB + 0.3·RSI + 0.2·Z) + 0.25·추세 + 0.20·확인
//   · 추세(maSubScore 로 노출)  = 0.75·(50 − 140·MA신호 ± MACD) + 0.25·공백초과(16회 기준)
//   · 확인(aroonSubScore 로 노출) = 0.45·ADX + 0.30·ATR + 0.25·Aroon공백
//   → 표의 "MA"/"Ar" 서브점수는 이름과 달리 각각 "추세 묶음"/"확인 묶음"의 점수입니다.
//
// [정규화 방향 — "과소출현 = 높은 점수"]
//   Z-Score  → (-z + 2.6) / 5.2 × 100       (z 음수 = 저출현 → 높은 점수)
//   볼린저%B → (1 − %B) × 100               (하단밴드 근처 → 높은 점수)
//   RSI      → 100 − rsi                    (낮은 RSI = 과소출현 → 높은 점수; 7/45 출현율이면 RSI≈15 라 구조적으로 높음)
//   추세     → 50 − 140·maSignal …          (빈도 감소 추세 → 높은 점수)
//   확인     → ADX·ATR·Aroon 공백 가중       (장기 공백 → 높은 점수)
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

  // ── 이산 신호 점수 (TechnicalIndicatorScore와 동일 정의) ──
  // +1 회귀(과소출현) / 0 중립 / -1 억제(과다출현).
  // 사이트 표시(패턴·특징·카드 신호)는 원시값 독자 임계값이 아닌 이 값을 사용.
  maScore: number;
  rsiScore: number;
  bbScore: number;
  aroonScore: number;
  // 가중 합산 신호 (MA 20% + RSI 30% + BB 35% + Aroon 15%), 범위 −1.0 ~ +1.0
  signalScore: number;

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
      maScore:         tech.maScore,
      rsiScore:        tech.rsiScore,
      bbScore:         tech.bbScore,
      aroonScore:      tech.aroonScore,
      signalScore:     tech.signalScore,
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
// 4.7. FUSED RANKING + FLOW DETAIL (사이트 표식용)
// ==========================================
//
// Python lotto_technical_indicators.py §5-7 융합과 동일한 정의:
//   flow(n)  = (연결강도 + 대기초과(2.0 상한→0~100) + 추세매핑) / 3
//   fused(n) = (1−w) × composite + w × flow   (기본 w=0.25)
// 티어: 융합순위 1~6 확정 / 7~12 차순 / 40~45 회피 / 나머지 중립,
//       |앙상블순위 − 융합순위| ≥ 10 이면 의견분열(contested).
// 사이트 합의 분모는 5 (FullIndicatorAnalysis가 5종 서브점수만 보유하므로
// Python의 11종 합의와 분모가 다름 — UI 범례에 명시).
// 추세·갭·복귀 판정은 Python과 동일 임계값으로 통일 (기존 사이트 인라인
// 계산과 임계값이 달랐던 부분을 여기로 일원화).
// ==========================================

export const FLOW_WEIGHT_DEFAULT = 0.25;

export const FLOW_TREND_SCORES: Record<string, number> = {
  '급락': 100, '하락': 75, '안정': 50, '상승': 35, '급등': 20, '데이터부족': 50,
};

export function classifyFlowTrend(r5: number, rp5: number): string {
  // Python _flow_trend_all() 과 동일 임계값.
  // (기존 사이트 인라인식은 r5>=0.8→상승, r5<0.4→하락으로 달라 같은 데이터에
  // 다른 라벨을 붙였음 — 여기로 통일.)
  if (r5 < 0.4 && rp5 >= 0.8) return '급락';
  if (r5 > 1.6 && rp5 < 0.5)  return '급등';
  if (r5 > 1.4 && rp5 > 1.0)  return '상승';
  if (r5 < 0.4 && rp5 < 0.5)  return '하락';
  return '안정';
}

export function classifySegmentTrend(rr5: number, rp5: number): string {
  // Python _segment_flow_all() 과 동일 비율 규칙.
  // (기존 사이트는 절대차 |diff|>1 규칙이라 5개짜리 41~45 구간에 불리했음.)
  if (rr5 > rp5 * 1.3) return '상승';
  if (rr5 < rp5 * 0.7) return '하락';
  return '안정';
}

export interface GapDetail {
  curGap: number;
  avgGap: number;
  overdueRatio: number;
  isPeriodic: boolean;
}

export function buildGapInfo(results: LottoResult[], historyCap = 80): Record<number, GapDetail> {
  // Python _gap_analysis_all() 과 동일: 최근 historyCap회 기준 출현 간격 통계.
  // 주기성 기준은 변동계수 < 0.35 (기존 사이트 0.5와 다름 — 여기로 통일).
  const history = Math.min(historyCap, results.length);
  const appearsAt = (idx: number, n: number) => {
    const d = results[idx];
    return d.numbers.includes(n) || d.bonus === n;
  };
  const info = {} as Record<number, GapDetail>;
  for (let n = 1; n <= 45; n++) {
    const idx: number[] = [];
    for (let i = 0; i < history; i++) if (appearsAt(i, n)) idx.push(i);
    const curGap = idx.length > 0 ? idx[0] : history;
    const gaps: number[] = [];
    for (let i = 0; i + 1 < idx.length; i++) gaps.push(idx[i + 1] - idx[i]);
    const avgGap = gaps.length > 0
      ? gaps.reduce((a, b) => a + b, 0) / gaps.length
      : 45 / 7;
    const stdGap = gaps.length >= 2
      ? Math.sqrt(gaps.reduce((s, g) => s + (g - avgGap) ** 2, 0) / gaps.length)
      : avgGap;
    const cv = avgGap > 0 ? stdGap / avgGap : 1;
    info[n] = {
      curGap,
      avgGap: +avgGap.toFixed(1),
      overdueRatio: +(avgGap > 0 ? curGap / avgGap : 0).toFixed(2),
      isPeriodic: cv < 0.35,
    };
  }
  return info;
}

export function buildConnectionScores(results: LottoResult[], window = 60): Record<number, number> {
  // Python _connection_scores_all() 과 동일:
  // 45×45 전이행렬(7개 번호 기준) + 최근 6회차 가중 조회 후 0~100 정규화.
  const w = Math.min(window, results.length);
  const out = {} as Record<number, number>;
  if (w < 10) { for (let n = 1; n <= 45; n++) out[n] = 50; return out; }
  const nums = (d: LottoResult) => [...d.numbers, d.bonus];
  const T: number[][] = Array.from({ length: 46 }, () => new Array<number>(46).fill(0));
  for (let i = 0; i < w - 1; i++) {
    const prev = nums(results[i + 1]);
    const cur = nums(results[i]);
    for (const p of prev) for (const c of cur) T[p][c]++;
  }
  const raw = {} as Record<number, number>;
  for (let n = 1; n <= 45; n++) raw[n] = 0;
  for (let lag = 0; lag < Math.min(6, results.length); lag++) {
    const weight = 2 / (lag + 1);
    for (const p of nums(results[lag])) {
      const row = T[p];
      for (let c = 1; c <= 45; c++) raw[c] += row[c] * weight;
    }
  }
  const vals = Object.values(raw);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo > 0 ? hi - lo : 1;
  for (let n = 1; n <= 45; n++) out[n] = +(((raw[n] - lo) / span) * 100).toFixed(1);
  return out;
}

export interface FlowSignals {
  trends: Record<number, string>;
  gapInfo: Record<number, GapDetail>;
  connectionScores: Record<number, number>;
  flowScores: Record<number, number>;
}

export function buildFlowSignals(results: LottoResult[]): FlowSignals | null {
  // 10회차 미만이면 Python과 동일하게 추세 판단 보류(null).
  if (results.length < 10) return null;
  const exp5 = (5 * 7) / 45;
  const appears = (d: LottoResult, n: number) => d.numbers.includes(n) || d.bonus === n;
  const trends = {} as Record<number, string>;
  for (let n = 1; n <= 45; n++) {
    const f5 = results.slice(0, 5).filter(d => appears(d, n)).length;
    const p5 = results.slice(5, 10).filter(d => appears(d, n)).length;
    trends[n] = classifyFlowTrend(f5 / exp5, p5 / exp5);
  }
  const gapInfo = buildGapInfo(results);
  const connectionScores = buildConnectionScores(results);
  const flowScores = {} as Record<number, number>;
  for (let n = 1; n <= 45; n++) {
    const overdue = Math.min(gapInfo[n].curGap / (gapInfo[n].avgGap || 1), 2) / 2 * 100;
    flowScores[n] = +((connectionScores[n] + overdue + (FLOW_TREND_SCORES[trends[n]] ?? 50)) / 3).toFixed(1);
  }
  return { trends, gapInfo, connectionScores, flowScores };
}

// ==========================================
// 4.8. LONG-ABSENT DETAIL (⏳ 장기 대기 번호 심층 분석)
// ==========================================
//
// 미출 기간·평균·조건부 재출현율을 과거 데이터에서 직접 계산합니다.
// - 미출/재출현 판정은 7개 번호(보너스 포함) 기준 (gapInfo와 동일 정의).
// - 단, "다음 회차 적중" 판정은 본번호 6개 기준 (1등 예측 대상).
// - 모든 율값은 관측 표본 수와 함께 반환하며, 표본 3건 미만이면 null
//   (추정 불가 — 0%나 100%로 표시하지 않음).
// - 집합 확률 nullProbNext는 균등무작위 가정 하의 정확값
//   1 − C(45−m,6)/C(45,6)이며, empiricalNextRate는 walk-forward 실측.
// ==========================================

export interface CoReturnEntry {
  number: number;
  count: number;
}

export interface AbsenceDetail {
  number: number;
  curGap: number;            // 현재 미출 (회차) — 상한 없이 전수 탐색
  curWeeks: number;          // 주 1회 추첨 환산 약 N주
  avgGap: number;            // 전 기간 평균 출현 간격
  avgLongSpell: number | null; // 장기(10회+) 미출 spell 평균 (없으면 null)
  maxSpell: number | null;     // 역대 최장 미출 (장기 spell 기준)
  longSpellCount: number;      // 관측된 장기 spell 수
  overdueRatio: number;        // curGap / avgGap
  cv: number;                  // 간격 변동계수 (낮을수록 주기적)
  isPeriodic: boolean;         // cv < 0.35
  reappear1: number | null;    // 현재 대기 깊이 도달 시 다음 1회 내 재출현율
  reappear3: number | null;    // 다음 3회 내 재출현율
  reappearSamples: number;     // 조건부 관측 표본 수
  encoreRate: number | null;   // 장기 미출 종료 후 2회 내 재출현(앙코르)율
  encoreSamples: number;
  coReturn: CoReturnEntry[];   // 장기 미출 종료 회차의 동반 출현 상위 3
  grade: 'A' | 'B' | 'C';      // 초과율×주기성 결합 서술 등급 (확률 아님)
}

export interface LongAbsentReport {
  details: AbsenceDetail[];   // 초과율 내림차순, 상위 topN
  setSize: number;
  nullProbNext: number;       // 균등가정 시 "표시된 집합(setSize개)"에서 다음 회차에 1개+ 출현할 정확 확률
  empiricalNextRate: number | null; // walk-forward 실측 (표본 부족 시 null)
  empiricalSamples: number;
  /**
   * [수정] 실측과 비교해야 할 균등가정 값. 실측 집합은 시점마다 크기가 다르므로(실측 989회차: 평균 8.3개)
   * 표시 집합 크기(10개)의 균등가정(80.1 %)과 비교하면 "실측이 8.8%p 낮다"는 허위 차이가 생겼습니다.
   * 같은 표본 각각의 집합 크기로 계산한 균등가정 평균(71.2 %)과 비교해야 합니다.
   */
  empiricalNullRate: number | null;
  empiricalAvgSetSize: number | null;
  fullSetSize: number;        // 현재 minGap회 이상 미출현인 번호 전체 수 (표시는 상위 topN개)
}

function comb645(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

export function buildLongAbsentDetails(
  results: LottoResult[],
  minGap: number = 10,
  topN: number = 10,
): LongAbsentReport | null {
  const L = results?.length ?? 0;
  if (!results || L < 30) return null;
  const appears = (idx: number, n: number) => {
    const d = results[idx];
    return d.numbers.includes(n) || d.bonus === n;
  };

  // oldest-first 순서 (rev[t], t=0이 가장 오래됨)
  const at = (t: number, n: number) => appears(L - 1 - t, n);
  const mainsAt = (t: number) => results[L - 1 - t].numbers;

  const details: AbsenceDetail[] = [];

  for (let n = 1; n <= 45; n++) {
    // ── 패스 1: spell 수집 + 현재 미출 ──
    const spells: number[] = [];   // 완결된 미출 spell 길이 (오래된 순)
    const spellEndMain: number[][] = []; // 각 spell 종료 회차의 본번호 6개
    let a = 0;
    for (let t = 0; t < L; t++) {
      if (at(t, n)) {
        if (a > 0) { spells.push(a); spellEndMain.push([...mainsAt(t)]); }
        a = 0;
      } else {
        a++;
      }
    }
    const curGap = a; // trailing 미출 (상한 없음)
    if (curGap < minGap) continue;

    // 전 기간 출현 간격 (연속 출현 인덱스 차이)
    const appIdx: number[] = [];
    for (let t = 0; t < L; t++) if (at(t, n)) appIdx.push(t);
    const gaps: number[] = [];
    for (let i = 0; i + 1 < appIdx.length; i++) gaps.push(appIdx[i + 1] - appIdx[i]);
    const avgGap = gaps.length > 0
      ? gaps.reduce((x, y) => x + y, 0) / gaps.length
      : 45 / 7;
    const stdGap = gaps.length >= 2
      ? Math.sqrt(gaps.reduce((s, g) => s + (g - avgGap) ** 2, 0) / gaps.length)
      : avgGap;
    const cv = avgGap > 0 ? stdGap / avgGap : 1;

    const longIdx = spells
      .map((len, i) => ({ len, i }))
      .filter(s => s.len >= minGap);
    const avgLongSpell = longIdx.length > 0
      ? longIdx.reduce((s, x) => s + x.len, 0) / longIdx.length
      : null;
    const maxSpell = longIdx.length > 0
      ? Math.max(...longIdx.map(x => x.len))
      : null;

    // ── 패스 2: 현재 깊이 G 도달 에피소드의 조건부 재출현율 (겹침 방지 점프) ──
    const G = curGap;
    let hit1 = 0, hit3 = 0, samples = 0;
    {
      let t = 0, run = 0;
      while (t < L) {
        if (at(t, n)) { run = 0; t++; continue; }
        run++;
        if (run === G) {
          // t가 G연속 미출의 마지막 회차. 다음 3회(더 최신, t+1...)까지
          // 전부 관측 가능할 때만 기록 → 1회/3회율이 동일 분모 공유.
          // 기록 여부와 무관하게 spell 끝까지 점프 (미진행 무한루프 방지).
          if (t + 3 < L) {
            samples++;
            if (at(t + 1, n)) { hit1++; hit3++; }
            else if (at(t + 2, n) || at(t + 3, n)) { hit3++; }
          }
          // spell 끝까지 점프 (겹침 방지). 끝이 없으면(현재 진행 중) 종료
          let j = t + 1;
          while (j < L && !at(j, n)) j++;
          if (j >= L) break;
          t = j + 1; run = 0;
          continue;
        }
        t++;
      }
    }

    // ── 앙코르율: 장기 spell 종료 후 2회 내 재출현 ──
    let encHit = 0, encN = 0;
    {
      // spell 종료 위치 재탐색 (오래된 순)
      let t = 0, run = 0;
      while (t < L) {
        if (at(t, n)) {
          if (run >= minGap && t + 2 < L) {
            encN++;
            if (at(t + 1, n) || at(t + 2, n)) encHit++;
          }
          run = 0; t++; continue;
        }
        run++; t++;
      }
    }

    // ── 동반 복귀: 장기 spell 종료 회차의 본번호 공출현 집계 ──
    const coMap = new Map<number, number>();
    longIdx.forEach(({ i }) => {
      for (const m of spellEndMain[i]) {
        if (m === n) continue;
        coMap.set(m, (coMap.get(m) ?? 0) + 1);
      }
    });
    const coReturn = [...coMap.entries()]
      .map(([number, count]) => ({ number, count }))
      .sort((x, y) => y.count - x.count || x.number - y.number)
      .slice(0, 3);

    const overdueRatio = avgGap > 0 ? curGap / avgGap : 0;
    const isPeriodic = cv < 0.35;
    const grade: 'A' | 'B' | 'C' =
      overdueRatio >= 2 && isPeriodic ? 'A'
      : overdueRatio >= 1.2 || isPeriodic ? 'B' : 'C';

    details.push({
      number: n,
      curGap,
      curWeeks: curGap, // 주 1회 추첨 환산
      avgGap: +avgGap.toFixed(1),
      avgLongSpell: avgLongSpell === null ? null : +avgLongSpell.toFixed(1),
      maxSpell,
      longSpellCount: longIdx.length,
      overdueRatio: +overdueRatio.toFixed(2),
      cv: +cv.toFixed(2),
      isPeriodic,
      reappear1: samples >= 3 ? +(hit1 / samples).toFixed(3) : null,
      reappear3: samples >= 3 ? +(hit3 / samples).toFixed(3) : null,
      reappearSamples: samples,
      encoreRate: encN >= 3 ? +(encHit / encN).toFixed(3) : null,
      encoreSamples: encN,
      coReturn,
      grade,
    });
  }

  details.sort((x, y) => y.overdueRatio - x.overdueRatio || x.number - y.number);
  const top = details.slice(0, topN);
  const m = top.length;

  // ── 집합 지표: 균등가정 정확 확률 + walk-forward 실측 ──
  const nullProbNext = m > 0 ? 1 - comb645(45 - m, 6) / comb645(45, 6) : 0;
  let empHit = 0, empN = 0, empNullSum = 0, empSizeSum = 0;
  const denom645 = comb645(45, 6);
  for (let i = 1; i + minGap - 1 < L; i++) {
    // draws[i] 기준 과거 minGap회 전원 미출 집합 (i와 그보다 오래된 회차)
    const set: number[] = [];
    for (let n = 1; n <= 45; n++) {
      let absent = true;
      for (let k = 0; k < minGap; k++) {
        if (appears(i + k, n)) { absent = false; break; }
      }
      if (absent) set.push(n);
    }
    if (set.length === 0) continue;
    empN++;
    empSizeSum += set.length;
    empNullSum += 1 - comb645(45 - set.length, 6) / denom645;   // 이 표본의 집합 크기에 대한 균등가정 정확값
    const nextMains = results[i - 1].numbers; // 다음(최신 방향) 회차 본번호
    if (nextMains.some(x => set.includes(x))) empHit++;
  }

  return {
    details: top,
    setSize: m,
    nullProbNext: +nullProbNext.toFixed(4),
    empiricalNextRate: empN >= 20 ? +(empHit / empN).toFixed(4) : null,
    empiricalSamples: empN,
    empiricalNullRate: empN >= 20 ? +(empNullSum / empN).toFixed(4) : null,
    empiricalAvgSetSize: empN >= 20 ? +(empSizeSum / empN).toFixed(2) : null,
    fullSetSize: details.length,
  };
}

// Python compute_flow_analysis() 와 동일: 최근 3회 내 출현 + 그 이전 5회 이상 공백.
export function classifyRecentlyBack(results: LottoResult[]): number[] {
  const appears = (d: LottoResult, n: number) => d.numbers.includes(n) || d.bonus === n;
  const back: number[] = [];
  for (let n = 1; n <= 45; n++) {
    if (!results.slice(0, 3).some(d => appears(d, n))) continue;
    let absent = 0;
    for (let i = 3; i < Math.min(23, results.length); i++) {
      if (appears(results[i], n)) break;
      absent++;
    }
    if (absent >= 5) back.push(n);
  }
  return back;
}

import { unifiedQuantumEngine645, tieKey } from './formulas/index';
export { tieKey };

export type TierKey = 'pick' | 'next' | 'avoid' | 'mid';

export interface SecondOpinion {
  numbers: number[];         // 통합 엔진 Top6 (오름차순)
  fusedTop6: number[];       // 융합 랭킹 Top6 (오름차순)
  overlap: number;           // 교집합 개수
  shared: number[];          // 공통 번호 (오름차순)
  uniqueToUnified: number[]; // 통합 스택에만 있는 번호
}

/**
 * 세컨드 오피니언 — services/formulas 5엔진 통합 스택을 라이브 예측과 병렬 실행.
 *
 * [도입 이유] formulas/는 라이브와 같은 6/45 예측 스택이었으나 어디에서도
 * 호출되지 않는 데드코드였습니다. 삭제 대신 융합 Top6와의 일치도를 공개합니다.
 * [해석 주의] 두 스택은 모두 "공백·평균회귀" 계열이라 서로 상관이 큽니다. 실측 989회차 모든 검증 시점에서
 * 평균 일치는 2.53개(가능한 모든 시점 689회, 무작위 기대 0.80개)였으므로 "2개 일치"는 평균 이하입니다. 일치 개수는 반드시
 * 이 기준선(evidence.overlapMean)과 함께 읽어야 하며, 어느 쪽도 적중률 우위를 뜻하지 않습니다.
 * 30회차 미만이면 QA 가드가 0점을 반환해 [1..6] 퇴화가 나오므로 null.
 */
export function secondOpinion645(
  results: LottoResult[],
  table?: FullIndicatorAnalysis[] | null,
  flow?: FlowSignals | null,
  flowWeight: number = FLOW_WEIGHT_DEFAULT,
): SecondOpinion | null {
  if (!results || results.length < 30) return null;
  const t = table && table.length > 0
    ? table
    : (results.length >= 10 ? buildFullAnalysisTable(results) : []);
  if (t.length === 0) return null;
  const f = flow ?? buildFlowSignals(results);
  const fusedTop6 = buildFusedTable(t, f, flowWeight, null, results[0]?.round ?? 0)
    .slice(0, 6).map(r => r.number).sort((a, b) => a - b);
  const numbers = unifiedQuantumEngine645.predict(results).numbers;
  const shared = numbers.filter(n => fusedTop6.includes(n)).sort((a, b) => a - b);
  return {
    numbers,
    fusedTop6,
    overlap: shared.length,
    shared,
    uniqueToUnified: numbers.filter(n => !fusedTop6.includes(n)).sort((a, b) => a - b),
  };
}

export interface FusedRow {
  number: number;
  compositeScore: number;
  ensRank: number;
  fusedScore: number;
  fusedRank: number;
  agreement5: number;       // 5종 서브점수 각각에서 상위 12위 이내(AGREEMENT_TOP_N)에 든 개수 (무작위 기대 1.33)
  stability: number | null; // 0~1 재현율, 미측정 시 null
  tier: TierKey;
  contested: boolean;       // |ensRank − fusedRank| ≥ 10
}

/** 합의(agreement5) 기준: 각 서브점수의 횡단면 상위 N위. 12 = 45개의 약 27 % */
export const AGREEMENT_TOP_N = 12;

export function buildFusedTable(
  table: FullIndicatorAnalysis[],
  flow: FlowSignals | null,
  flowWeight: number = FLOW_WEIGHT_DEFAULT,
  stability: Record<number, number> | null = null,
  tieSeed: number = 0,        // 동점 해소 시드(보통 최신 회차 번호) — 같은 입력이면 같은 결과, 번호 크기와는 무관
): FusedRow[] {
  const w = Math.max(0, Math.min(1, flowWeight));
  const tie = (a: number, b: number) => tieKey(tieSeed, a) - tieKey(tieSeed, b);
  const byNum = new Map(table.map(t => [t.number, t]));
  // [수정] 합의 = "서브점수 ≥ 65" 였으나 RSI 서브점수(100−RSI)가 구조적으로 높아
  // (실측 989회차: 최소 58.3 · 중앙 83.3 · 75 %가 ≥65) 합의 수가 RSI 하나로 부풀려졌음.
  // 절대 기준 대신 각 서브점수 안에서의 순위(상위 12위)로 판정해 지표 간 척도 차이를 제거.
  const subKeys = ['zSubScore', 'bbSubScore', 'rsiSubScore', 'maSubScore', 'aroonSubScore'] as const;
  const topSets = subKeys.map(key =>
    new Set([...table].sort((a, b) => b[key] - a[key] || tie(a.number, b.number))
      .slice(0, AGREEMENT_TOP_N).map(t => t.number)),
  );
  const rows: FusedRow[] = [];
  for (let n = 1; n <= 45; n++) {
    const t = byNum.get(n);
    if (!t) continue;
    const fl = flow?.flowScores[n] ?? 50;
    rows.push({
      number: n,
      compositeScore: t.compositeScore,
      ensRank: t.rank,
      fusedScore: +((1 - w) * t.compositeScore + w * fl).toFixed(2),
      fusedRank: 0,
      agreement5: topSets.filter(set => set.has(n)).length,
      stability: stability ? (stability[n] ?? null) : null,
      tier: 'mid',
      contested: false,
    });
  }
  rows.sort((a, b) => b.fusedScore - a.fusedScore || tie(a.number, b.number));
  rows.forEach((r, i) => {
    r.fusedRank = i + 1;
    r.tier = r.fusedRank <= 6 ? 'pick' : r.fusedRank <= 12 ? 'next' : r.fusedRank > 39 ? 'avoid' : 'mid';
    r.contested = Math.abs(r.ensRank - r.fusedRank) >= 10;
  });
  return rows;
}

/**
 * 시드 고정 의사난수 (mulberry32). 기존 구현은 `(s * 1103515245 + 12345) & 0x7fffffff` 였는데,
 * s·1103515245 가 2^53 을 넘어 부동소수 반올림으로 하위 비트가 소실되었습니다
 * (실측: 20,000회 호출에서 서로 다른 상태 12,053개, 짝수 상태 99.6 %) → 서브샘플이 편향됨.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function computeStability(
  results: LottoResult[],
  iters: number = 10,
  flowWeight: number = FLOW_WEIGHT_DEFAULT,
  topk: number = 6,
  seed: number = 917,
): Record<number, number> | null {
  // 순서-preserving 80% 서브샘플(비복원) × 융합 상위 진입율. 30회차 미만이면 null (엔진 최소 윈도우 미달).
  // 안정도 = "입력 회차를 20% 빼도 같은 번호가 Top6 에 남는가" — 선택의 재현성이지 적중률이 아님.
  if (iters <= 0 || results.length < 30) return null;
  const rand = seededRandom(seed);
  const m = Math.max(20, Math.floor(results.length * 0.8));
  const counts = {} as Record<number, number>;
  for (let n = 1; n <= 45; n++) counts[n] = 0;
  for (let k = 0; k < iters; k++) {
    // 부분 Fisher–Yates: 앞쪽 m개가 비복원 표본 (무한 루프·중복 재추첨 없음)
    const order = Array.from({ length: results.length }, (_, i) => i);
    for (let i = 0; i < m; i++) {
      const j = i + Math.floor(rand() * (order.length - i));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const sub = order.slice(0, m).sort((a, b) => a - b).map(i => results[i]);
    if (sub.length < 10) continue;
    const fused = buildFusedTable(buildFullAnalysisTable(sub), buildFlowSignals(sub), flowWeight, null, results[0]?.round ?? 0);
    fused.slice(0, topk).forEach(r => { counts[r.number]++; });
  }
  const out = {} as Record<number, number>;
  for (let n = 1; n <= 45; n++) out[n] = +(counts[n] / iters).toFixed(2);
  return out;
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
export const ADVANCED_SUM_MIN = 85;
export const ADVANCED_SUM_MAX = 189;

const PYTHON_FILTER_FORMULAS = [
  'AC산술복잡도', '합46(Sum46, AC에 포함)', '상/하위 비율', '연속번호 제한',
  `총합(${ADVANCED_SUM_MIN}~${ADVANCED_SUM_MAX})`, '번대별 분산',
];

function buildPredictionResult(numbers: number[], source: PredictionSource, formulasUsed: string[], selectionReason?: SelectionReason): PredictionResult {
  const sum = numbers.reduce((a, b) => a + b, 0);
  let odd = 0, even = 0, high = 0, low = 0;
  numbers.forEach(n => { if (n % 2 !== 0) odd++; else even++; if (n > 22) high++; else low++; });
  return { numbers, source, passesFilters: passesPythonFilters(numbers), formulasUsed: Array.from(new Set(formulasUsed)), selectionReason, stats: { sum, oddEvenRatio: `${odd}:${even}`, highLowRatio: `${high}:${low}` } };
}

/**
 * 명세(reference) 판정 — isValidXxx 함수의 합성. 비정상 입력(6개가 아니거나 중복·범위 밖)과
 * 동등성 검증(audit/verify_filters_ts.mjs)의 기준으로 유지합니다.
 */
function passesPythonFiltersSpec(numbers: number[]): boolean {
  const sum = numbers.reduce((a, b) => a + b, 0);
  return sum >= ADVANCED_SUM_MIN && sum <= ADVANCED_SUM_MAX &&
    isValidAC(numbers) && isValidSum46(numbers) &&
    isValidRatio(numbers) && isValidRangePattern(numbers) && isValidConsecutive(numbers);
}

const AC_SEEN = new Int32Array(46);
let acStamp = 0;

/**
 * 고속 판정 — 오름차순·서로 다른 6개·1~45 입력 전용 (Python generate_lotto_combinations.passes_all_filters 와 동일 로직).
 *  · Sum46 제외: 전수 8,145,060개 실측으로 Sum46 탈락 1,540개의 AC가 전부 0~4 (AC<5) → AC 탈락에 100% 포함.
 *    (증명: 합 46 쌍이 3개면 6개 수는 a,46-a,b,46-b,c,46-c 형태 → 거울대칭으로 15개 차이값이 최대 9종 → AC≤4)
 *  · 정렬·배열 복사·Set 생성 없이 1회 판정, 값싼 필터(총합·비율·번대·연속)를 앞에 두고 AC를 마지막에 둠.
 *  · 비율은 부동소수 나눗셈 대신 정수 교차곱 (hi·10 ≥ lo·13, hi·2 ≤ lo·15) — 판정 동일.
 */
function passesPythonFiltersSorted(s: number[]): boolean {
  return passesSixSorted(s[0], s[1], s[2], s[3], s[4], s[5]);
}

/** AC 차이값 표시: 처음 보는 차이값이면 1, 이미 본 값이면 0 (stamp 방식이라 매 호출 초기화 불필요) */
function acNew(dv: number, stamp: number): number {
  if (AC_SEEN[dv] === stamp) return 0;
  AC_SEEN[dv] = stamp;
  return 1;
}

/** 배열 할당 없는 숫자 6개 버전 — 필터 통과 풀(buildFilteredPool) 전수 열거의 핫패스. 논리는 위 설명과 동일. */
function passesSixSorted(a: number, b: number, c: number, d: number, e: number, f: number): boolean {
  const sum = a + b + c + d + e + f;
  if (sum < ADVANCED_SUM_MIN || sum > ADVANCED_SUM_MAX) return false;

  const lo = a + b + c;
  const hi = sum - lo;
  if (hi * 10 < lo * 13 || hi * 2 > lo * 15) return false;

  // 같은 번대(1~10, 11~20, …, 41~45)에 4개 이상 ⇔ 정렬 상 (a,d)·(b,e)·(c,f) 중 한 쌍이 같은 번대
  if (Math.floor((a - 1) / 10) === Math.floor((d - 1) / 10) ||
      Math.floor((b - 1) / 10) === Math.floor((e - 1) / 10) ||
      Math.floor((c - 1) / 10) === Math.floor((f - 1) / 10)) return false;

  // 연속: 3연속 금지, 2연속 쌍 최대 2개
  let pairs = 0;
  if (b === a + 1) { pairs++; if (c === a + 2) return false; }
  if (c === b + 1) { pairs++; if (d === b + 2) return false; }
  if (d === c + 1) { pairs++; if (e === c + 2) return false; }
  if (e === d + 1) { pairs++; if (f === d + 2) return false; }
  if (f === e + 1) pairs++;
  if (pairs > 2) return false;

  // AC = (서로 다른 차이값 수) − 5, 5 ≤ AC ≤ 10  → 서로 다른 차이값 10~15개
  if (++acStamp >= 0x7fffffff) { AC_SEEN.fill(0); acStamp = 1; }
  const stamp = acStamp;
  const distinct =
    acNew(b - a, stamp) + acNew(c - a, stamp) + acNew(d - a, stamp) + acNew(e - a, stamp) + acNew(f - a, stamp) +
    acNew(c - b, stamp) + acNew(d - b, stamp) + acNew(e - b, stamp) + acNew(f - b, stamp) +
    acNew(d - c, stamp) + acNew(e - c, stamp) + acNew(f - c, stamp) +
    acNew(e - d, stamp) + acNew(f - d, stamp) +
    acNew(f - e, stamp);
  return distinct >= 10 && distinct <= 15;
}

function isStrictlyAscending(arr: number[]): boolean {
  for (let i = 1; i < arr.length; i++) if (!(arr[i] > arr[i - 1])) return false;
  return true;
}

function passesPythonFilters(numbers: number[]): boolean {
  if (numbers.length === 6) {
    const s = isStrictlyAscending(numbers) ? numbers : [...numbers].sort((x, y) => x - y);
    // 정상 입력(서로 다른 6개, 1~45)만 고속 경로. 그 외는 명세 판정(Sum46 포함)으로 처리해 결과를 보존.
    if (s[0] >= 1 && s[5] <= 45 && isStrictlyAscending(s)) return passesPythonFiltersSorted(s);
  }
  return passesPythonFiltersSpec(numbers);
}

function generateFallbackNumbers(): number[] {
  const selected = new Set<number>();
  while (selected.size < 6) selected.add(Math.floor(Math.random() * 45) + 1);
  return Array.from(selected).sort((a, b) => a - b);
}

/**
 * @deprecated 앱은 더 이상 이 함수를 쓰지 않습니다 — buildFilteredPoolAsync() 로 필터 통과 풀을 로컬에서 직접 만듭니다.
 * 저장소의 lotto_combinations.txt 는 전체 유효 공간의 1.9 % 부분집합(번호 1·2·45 없음)이었고, 올바른 전체 파일은
 * 114.3 MiB 라 GitHub 한도(100 MiB)를 넘습니다(audit/FILTER_AUDIT_REPORT.md 참조). 하위 호환을 위해 export 만 유지합니다.
 */
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
// 9.5 FILTERED COMBINATION POOL (경로 A 후보 풀 — 네트워크 파일 대체)
// ==========================================
/**
 * 필터(passesPythonFilters)를 통과하는 모든 조합을 6바이트씩 연속 저장한 압축 풀.
 * rows[6*i .. 6*i+5] = i번째 조합(오름차순). 순서는 사전식(= Python generate_lotto_combinations 출력 순서)과 같습니다.
 * 현행 필터 기준 6,657,176개 × 6B ≈ 40 MB (number[][] 로 만들면 수백 MB).
 */
export interface CombinationPool {
  rows: Uint8Array;
  count: number;
}

const POOL_MAX_ROWS = 8_145_060;   // C(45,6)

/** (a, b) 를 고정하고 c<d<e<f 를 열거하여 필터 통과 조합을 rows 에 덧붙입니다. 반환: 새 행 수. */
function appendPoolRange(rows: Uint8Array, n: number, a: number, b: number): number {
  for (let c = b + 1; c <= 42; c++)
    for (let d = c + 1; d <= 43; d++)
      for (let e = d + 1; e <= 44; e++)
        for (let f = e + 1; f <= 45; f++) {
          if (!passesSixSorted(a, b, c, d, e, f)) continue;
          const o = n * 6;
          rows[o] = a; rows[o + 1] = b; rows[o + 2] = c; rows[o + 3] = d; rows[o + 4] = e; rows[o + 5] = f;
          n++;
        }
  return n;
}

/** 동기 버전 (테스트·워커용). 메인 스레드 UI 에서는 buildFilteredPoolAsync 를 쓰세요. */
export function buildFilteredPool(): CombinationPool {
  const rows = new Uint8Array(POOL_MAX_ROWS * 6);
  let n = 0;
  for (let a = 1; a <= 40; a++)
    for (let b = a + 1; b <= 41; b++) n = appendPoolRange(rows, n, a, b);
  return { rows: rows.subarray(0, n * 6), count: n };
}

/** 비동기 버전: (a,b) 단위로 작업하다 약 25ms 마다 이벤트 루프에 양보해 화면이 멈추지 않게 합니다. */
export async function buildFilteredPoolAsync(onProgress?: (ratio: number) => void): Promise<CombinationPool> {
  const rows = new Uint8Array(POOL_MAX_ROWS * 6);
  let n = 0;
  let last = Date.now();
  for (let a = 1; a <= 40; a++) {
    for (let b = a + 1; b <= 41; b++) {
      n = appendPoolRange(rows, n, a, b);
      if (Date.now() - last > 25) {
        onProgress?.(a / 40);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        last = Date.now();
      }
    }
  }
  onProgress?.(1);
  return { rows: rows.subarray(0, n * 6), count: n };
}

let poolScoreBuffer: Float64Array | null = null;
const POOL_TOP_RATIO = 0.05;
const POOL_HIST_BINS = 65536;

export interface PoolTopInfo {
  /** 점수 버퍼(모듈 공유, 다음 호출 때 덮어씀). 부적격 조합은 -Infinity */
  scores: Float64Array;
  eligible: number;          // 점수 계산 대상(고정 번호 포함 조건 충족) 조합 수
  k: number;                 // 상위 풀 크기 = max(1, floor(eligible × 5%))
  cutScore: number;          // 상위 풀의 마지막(k번째) 조합의 점수
  cutIndex: number;          // 그 조합의 풀 내 인덱스 (동점이면 인덱스가 작은 쪽이 상위 — 기존 stable sort 와 동일)
}

/** 인덱스 i 가 상위 풀 소속인지 판정 (점수 내림차순, 동점은 인덱스 오름차순으로 k개). */
export function isInPoolTop(info: PoolTopInfo, i: number): boolean {
  const s = info.scores[i];
  return s > info.cutScore || (s === info.cutScore && i <= info.cutIndex);
}

/**
 * 풀 전체를 번호 가중치로 점수화하고 상위 5 % 경계를 정확히 구합니다.
 * 기존(number[][] → filter → map → 전체 sort → slice) 과 같은 집합을 O(n) 으로 계산합니다:
 *   score = w[a]+w[b]+…+w[f] (왼쪽부터 더함 → 기존 reduce 와 동일한 부동소수 결과),
 *   히스토그램으로 경계 구간을 찾고 그 구간만 정렬.
 */
export function computePoolTop(pool: CombinationPool, weights: number[], fixedNumbers: number[] = []): PoolTopInfo | null {
  const { rows, count } = pool;
  if (count === 0) return null;
  const W = new Float64Array(46);
  for (let i = 1; i <= 45; i++) W[i] = weights[i - 1] ?? 0;

  const fixedList = Array.from(new Set(fixedNumbers));
  if (fixedList.some(n => !(n >= 1 && n <= 45))) return null;      // 기존: 포함 조합 없음 → 경로 B
  const F = new Uint8Array(46);
  fixedList.forEach(n => { F[n] = 1; });
  const fixedCount = fixedList.length;

  if (!poolScoreBuffer || poolScoreBuffer.length < count) poolScoreBuffer = new Float64Array(count);
  const scores = poolScoreBuffer;

  let eligible = 0, min = Infinity, max = -Infinity;
  for (let i = 0, o = 0; i < count; i++, o += 6) {
    const a = rows[o], b = rows[o + 1], c = rows[o + 2], d = rows[o + 3], e = rows[o + 4], f = rows[o + 5];
    if (fixedCount > 0 && F[a] + F[b] + F[c] + F[d] + F[e] + F[f] !== fixedCount) { scores[i] = -Infinity; continue; }
    const s = W[a] + W[b] + W[c] + W[d] + W[e] + W[f];
    if (!Number.isFinite(s)) { scores[i] = -Infinity; continue; }
    scores[i] = s;
    eligible++;
    if (s < min) min = s;
    if (s > max) max = s;
  }
  if (eligible === 0) return null;

  const k = Math.max(1, Math.floor(eligible * POOL_TOP_RATIO));
  const width = max > min ? (max - min) / POOL_HIST_BINS : 1;
  const binOf = (s: number) => Math.min(POOL_HIST_BINS - 1, Math.floor((s - min) / width));

  const hist = new Int32Array(POOL_HIST_BINS);
  for (let i = 0; i < count; i++) { const s = scores[i]; if (s !== -Infinity) hist[binOf(s)]++; }

  let above = 0, tb = POOL_HIST_BINS - 1;
  for (; tb >= 0; tb--) {
    if (above + hist[tb] >= k) break;
    above += hist[tb];
  }
  const need = k - above;                       // 경계 구간에서 상위로 뽑을 개수 (1 이상)
  const cand = new Int32Array(hist[tb]);
  let m = 0;
  for (let i = 0; i < count; i++) { const s = scores[i]; if (s !== -Infinity && binOf(s) === tb) cand[m++] = i; }
  cand.sort((x, y) => (scores[y] - scores[x]) || (x - y));
  const cutIndex = cand[need - 1];
  return { scores, eligible, k, cutScore: scores[cutIndex], cutIndex };
}

/**
 * 풀의 상위 5 % 중 하나를 균등 무작위로 선택합니다 (기존 경로 A 와 같은 분포).
 * @param rand 테스트용 난수 주입 (기본 Math.random)
 */
export function selectFromPool(
  pool: CombinationPool, weights: number[], fixedNumbers: number[] = [], rand: () => number = Math.random
): { combo: number[]; k: number; eligible: number } | null {
  const info = computePoolTop(pool, weights, fixedNumbers);
  if (!info) return null;
  const target = Math.min(info.k - 1, Math.floor(rand() * info.k));
  let seen = 0;
  for (let i = 0; i < pool.count; i++) {
    if (!isInPoolTop(info, i)) continue;
    if (seen === target) {
      const o = i * 6;
      return { combo: Array.from(pool.rows.subarray(o, o + 6)), k: info.k, eligible: info.eligible };
    }
    seen++;
  }
  return null;
}

// ==========================================
// 10. BACKTESTING ENGINE (최근 1년 전략 비교)
// ==========================================
/**
 * @deprecated 앱 시작 시 자동 실행하던 "최근 52회 최적 설정 선택"입니다. 같은 52회에서 4개 설정 중 최선을 고르고 그 성과를
 * "향상"으로 표기하는 구조라 선택 자체가 잡음입니다(audit/ENGINE_UPGRADE_REPORT.md §8: 선택 구간 3개+ 일치 3.8 % → 다음 52회 3.4 %,
 * 평균 적중 0.793개 · 기대 0.800개, 52회 표준오차 ±2.1%p). 앱은 더 이상 호출하지 않고 검증 스크립트(audit/accuracy_audit.mjs)용으로만 export 합니다.
 *
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
  githubCombinations: number[][] | CombinationPool = [],   // 필터 통과 풀(권장) 또는 기존 number[][] 목록(하위 호환)
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

  // 경로 A-1: 필터 통과 풀(로컬 전수 열거, 6,657,176개) 가중 스코어링
  //   풀은 필터를 이미 통과한 조합만 담고 있으므로 재필터가 필요 없고, 상위 5 % 경계는 O(n) 으로 계산합니다.
  const legacyList: number[][] = Array.isArray(githubCombinations) ? githubCombinations : [];
  if (!Array.isArray(githubCombinations) && githubCombinations.count > 0) {
    const weights = buildCombinedWeights(stats, goldenCandidates, pareto, opts, technicalScores);
    const picked = selectFromPool(githubCombinations, weights, fixedNumbers);
    if (picked) {
      const reason = buildSelectionReason(picked.combo, pareto, goldenCandidates, whitson);
      return buildPredictionResult(picked.combo, 'pool', ['필터 통과 조합 풀 가중 스코어링', ...methodLabels, ...optimizedTag, ...PYTHON_FILTER_FORMULAS], reason);
    }
  }

  // 경로 A-2: (하위 호환) number[][] 조합 목록 가중 스코어링
  if (legacyList.length > 0) {
    const weights = buildCombinedWeights(stats, goldenCandidates, pareto, opts, technicalScores);
    const scored = legacyList
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
      return buildPredictionResult(selected.combo, 'list', ['GitHub 조합 가중 스코어링', ...methodLabels, ...optimizedTag, ...PYTHON_FILTER_FORMULAS], reason);
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
      return buildPredictionResult(candidates, 'direct', [...methodLabels, ...optimizedTag, ...PYTHON_FILTER_FORMULAS], reason);
    }
    if (attempts < 500 && passesPythonFilters(candidates)) {
      const reason = buildSelectionReason(candidates, pareto, goldenCandidates, whitson);
      return buildPredictionResult(candidates, 'relaxed', [...methodLabels, ...optimizedTag, ...PYTHON_FILTER_FORMULAS, 'Whitson 조건 완화'], reason);
    }
    attempts--;
  }

  const fallback = generateFallbackNumbers();
  return buildPredictionResult(fallback, 'fallback', ['기본 랜덤 대체', ...PYTHON_FILTER_FORMULAS], {
    stage1_modelDesign: '6종 통합 모델 (폴백)',
    stage2_calcLogic: '필터 통과 실패 → 기본 랜덤 대체',
    stage3_setReason: `합계 ${fallback.reduce((a, b) => a + b, 0)} | 최적화 실패`,
  });
}

// ==========================================
// 12. QUANTUM PARAMETER OPTIMIZATION ENGINE
// ==========================================
/**
 * @deprecated 앱 시작 시 자동 실행하던 qNoise·σ 그리드 탐색(최근 52회)입니다. 실측 결과가 qNoise=0·σ=0("노이즈 없음")으로 나와 자동 적용되던
 * 잡음 선택이었고, 어떤 값이든 장당 1등 확률(1/8,145,060)은 같습니다. 앱은 더 이상 호출하지 않습니다(기본값 qNoise 0.12 · σ 1).
 *
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
