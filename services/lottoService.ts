import { LottoResult, PredictionResult } from '../types';

// ==========================================
// 1. DATA FETCHING (Korean 6/45 Lotto API)
// ==========================================
const START_ROUND = 262; // 262회차부터 분석 시작
const STORAGE_KEY = 'korean_lotto_history';

// 동행복권 API 응답 타입 정의
interface DhlotteryResponse {
  resultCode: string | null;
  resultMessage: string | null;
  data: {
    list?: Array<{
      ltEpsd: number;
      tm1WnNo: number;
      tm2WnNo: number;
      tm3WnNo: number;
      tm4WnNo: number;
      tm5WnNo: number;
      tm6WnNo: number;
      bnsWnNo: number;
      ltRflYmd: string; // YYYYMMDD
    }>;
  } | null;
}

// 특정 회차 번호 조회
async function fetchDrawNumber(round: number): Promise<LottoResult | null> {
  try {
    const response = await fetch(`https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=${round}`);
    if (!response.ok) return null;
    
    const data: DhlotteryResponse = await response.json();
    if (!data?.data?.list || data.data.list.length === 0) {
      return null;
    }

    const result = data.data.list[0];
    
    // YYYYMMDD -> YYYY-MM-DD
    const dateStr = result.ltRflYmd;
    const formattedDate = dateStr ? `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}` : 'Unknown';

    return {
      round: result.ltEpsd,
      date: formattedDate,
      numbers: [
        result.tm1WnNo,
        result.tm2WnNo,
        result.tm3WnNo,
        result.tm4WnNo,
        result.tm5WnNo,
        result.tm6WnNo
      ],
      bonus: result.bnsWnNo
    };
  } catch (error) {
    console.error(`Failed to fetch round ${round}:`, error);
    return null;
  }
}

// 최신 회차 번호 조회
export async function fetchLatestDrawRound(): Promise<number> {
  try {
    const response = await fetch(`https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do`);
    if (!response.ok) throw new Error('Network response was not ok');
    
    const data: DhlotteryResponse = await response.json();
    if (data?.data?.list && data.data.list.length > 0) {
      return data.data.list[0].ltEpsd;
    }
  } catch (error) {
    console.error("Failed to fetch latest draw:", error);
  }
  return 1218; // Fallback if API fails
}

// 전체 데이터 동기화 함수
// 진행 상황을 UI에 업데이트하기 위해 onProgress 콜백을 받습니다.
export const fetchLottoData = async (onProgress?: (progress: number, currentRound: number) => void): Promise<LottoResult[]> => {
  // 1. 로컬 스토리지에서 기존 캐시 데이터 불러오기
  let cachedData: LottoResult[] = [];
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      cachedData = JSON.parse(saved);
      // 내림차순 정렬 확인
      cachedData.sort((a, b) => b.round - a.round); 
    }
  } catch (e) {
    console.error("Failed to parse cached data:", e);
  }

  // 2. 최신 회차 확인
  const latestRound = await fetchLatestDrawRound();
  
  // 3. 누락된 데이터 확인
  const existingRounds = new Set(cachedData.map(r => r.round));
  const missingRounds: number[] = [];
  
  for (let r = START_ROUND; r <= latestRound; r++) {
    if (!existingRounds.has(r)) {
      missingRounds.push(r);
    }
  }

  // 4. 누락된 데이터 병렬/배치 다운로드 (CORS 이슈 방지를 위해 적당한 크기로 쪼개서 요청)
  if (missingRounds.length > 0) {
    const newResults: LottoResult[] = [];
    const batchSize = 10; // 너무 한 번에 많이 요청하면 API 서버에서 차단될 수 있음

    for (let i = 0; i < missingRounds.length; i += batchSize) {
      const batch = missingRounds.slice(i, i + batchSize);
      const promises = batch.map(round => fetchDrawNumber(round));
      
      const results = await Promise.all(promises);
      results.forEach(res => {
        if (res) newResults.push(res);
      });

      // 진행 상황 콜백 호출
      if (onProgress) {
        const completed = i + batch.length;
        const progress = Math.min(100, Math.round((completed / missingRounds.length) * 100));
        onProgress(progress, batch[batch.length - 1]);
      }
    }

    // 데이터 합치기 및 정렬 (내림차순: 최신이 가장 앞에 오도록)
    cachedData = [...cachedData, ...newResults].sort((a, b) => b.round - a.round);
    
    // 로컬 스토리지에 다시 저장
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedData));
    } catch (e) {
      console.warn("localStorage quota exceeded or access denied", e);
    }
  } else {
    // 업데이트할 항목이 없으면 100% 진행 상황 전송
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
  recentNumbers: Set<number>; // drawn in the last 5 rounds
  averageSum: number;
  oddEvenAverage: string;
}

// ==========================================
// 2.5 REPEAT ANALYSIS (반복 분석 고도화)
// ==========================================
export interface RepeatAnalysis {
  targetNumber: number;
  totalOccurrences: number;           // 전체 당첨 횟수
  recent10Occurrences: number;        // 최근 10회차 내 당첨 횟수 (집중도 파악)
  recent30Occurrences: number;        // 최근 30회차 내 당첨 횟수
  repeatAfterOne: number;              // 1회차 후 연속 당첨 횟수
  repeatAfterTwo: number;              // 2회차 후 당첨 횟수
  repeatPercentage: number;            // 연속 당첨 확률
  averageGap: number;                  // 평균 출현 간격
  gapTrend: 'INCREASING' | 'DECREASING' | 'STABLE'; // 간격 추세 (주기성)
  lastSeenRound: number;               // 마지막 출현 회차
  roundsSinceLastSeen: number;         // 미출현 기간 (현재 회차 기준)
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW';  // 신뢰도
  insight: string;                     // 짧은 인사이트 코멘트 (예: "최근 급증", "장기 미출현")
  recommendation: string;              // 상세 추천 텍스트
}

/**
 * 특정 번호의 이월/연속 출현 확률 및 상세 패턴을 분석합니다.
 */
export function analyzeRepeatProbability(
  results: LottoResult[],
  targetNumber: number,
  lookbackRounds: number = 100
): RepeatAnalysis {
  if (!results || results.length === 0) {
    return {
      targetNumber, totalOccurrences: 0, recent10Occurrences: 0, recent30Occurrences: 0,
      repeatAfterOne: 0, repeatAfterTwo: 0, repeatPercentage: 0, averageGap: 0,
      gapTrend: 'STABLE', lastSeenRound: 0, roundsSinceLastSeen: 0,
      confidenceLevel: 'LOW', insight: '데이터 부족', recommendation: '데이터 부족'
    };
  }

  const checkRounds = Math.min(lookbackRounds, results.length);
  const latestRound = results[0].round;
  
  let totalOccurrences = 0;
  let recent10Occurrences = 0;
  let recent30Occurrences = 0;
  let repeatAfterOne = 0;
  let repeatAfterTwo = 0;
  const gaps: number[] = [];
  let lastSeenIdx = -1;

  for (let i = 0; i < checkRounds; i++) {
    const isDrawn = results[i].numbers.includes(targetNumber) || results[i].bonus === targetNumber;
    
    if (isDrawn) {
      totalOccurrences++;
      if (i < 10) recent10Occurrences++;
      if (i < 30) recent30Occurrences++;
      
      if (lastSeenIdx !== -1) {
        gaps.push(i - lastSeenIdx); // 과거로 갈수록 index가 커지므로 i - lastSeenIdx
      }
      lastSeenIdx = i;

      // 연속 출현 확인 (i-1 은 i보다 더 최근 회차)
      if (i > 0 && (results[i - 1].numbers.includes(targetNumber) || results[i - 1].bonus === targetNumber)) {
        repeatAfterOne++;
      }
      if (i > 1 && (results[i - 2].numbers.includes(targetNumber) || results[i - 2].bonus === targetNumber)) {
        repeatAfterTwo++;
      }
    }
  }

  const repeatPercentage = totalOccurrences > 0 
    ? (repeatAfterOne / (totalOccurrences - 1)) * 100 
    : 0;

  const averageGap = gaps.length > 0 
    ? gaps.reduce((a, b) => a + b, 0) / gaps.length 
    : 0;

  // 출현 간격 추세 (최근 3개 간격 평균 vs 전체 간격 평균)
  let gapTrend: 'INCREASING' | 'DECREASING' | 'STABLE' = 'STABLE';
  if (gaps.length >= 3) {
    const recentGaps = gaps.slice(0, 3);
    const recentAvg = recentGaps.reduce((a, b) => a + b, 0) / recentGaps.length;
    if (recentAvg < averageGap * 0.7) gapTrend = 'DECREASING'; // 출현 간격 짧아짐 (자주 나옴)
    else if (recentAvg > averageGap * 1.3) gapTrend = 'INCREASING'; // 출현 간격 길어짐
  }

  const lastSeenRoundMatch = results.find(r => r.numbers.includes(targetNumber) || r.bonus === targetNumber);
  const lastSeenRound = lastSeenRoundMatch ? lastSeenRoundMatch.round : 0;
  const roundsSinceLastSeen = lastSeenRoundMatch ? latestRound - lastSeenRound : checkRounds;

  let confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
  let insight = '';
  let recommendation = '';

  // 인사이트 도출 로직
  if (roundsSinceLastSeen > 15) {
    insight = '장기 미출현 번호';
    confidenceLevel = 'HIGH'; // 반등 가능성
    recommendation = `현재 ${roundsSinceLastSeen}회차 연속 미출현 상태로, 통계적 회귀에 의해 조만간 출현할 확률이 매우 높습니다.`;
  } else if (recent10Occurrences >= 3) {
    insight = '최근 급증 번호';
    confidenceLevel = 'HIGH';
    recommendation = `최근 10회차 동안 ${recent10Occurrences}회나 집중적으로 출현하는 강한 상승세를 보이고 있습니다.`;
  } else if (repeatPercentage > 15) {
    insight = '강한 연속성 보유';
    confidenceLevel = 'MEDIUM';
    recommendation = `이월(연속) 출현 확률이 ${repeatPercentage.toFixed(1)}%로 높은 편입니다. 직전 회차에 나왔다면 이월을 노려볼 만합니다.`;
  } else if (gapTrend === 'DECREASING') {
    insight = '출현 주기 단축 중';
    confidenceLevel = 'MEDIUM';
    recommendation = `평균 출현 간격(${averageGap.toFixed(1)}회)보다 최근 출현 주기가 짧아지며 상승 곡선을 타고 있습니다.`;
  } else {
    insight = '평범한 출현 흐름';
    confidenceLevel = 'LOW';
    recommendation = `특이한 쏠림이나 급증 패턴 없이 평균적인 흐름(${averageGap.toFixed(1)}회 간격)을 유지하고 있습니다.`;
  }

  if (totalOccurrences === 0) {
    insight = '완전 미출현';
    recommendation = `최근 ${checkRounds}회차 동안 단 한 번도 출현하지 않은 극단적 콜드 번호입니다.`;
  }

  return {
    targetNumber, totalOccurrences, recent10Occurrences, recent30Occurrences,
    repeatAfterOne, repeatAfterTwo, repeatPercentage, averageGap, gapTrend,
    lastSeenRound, roundsSinceLastSeen, confidenceLevel, insight, recommendation
  };
}

// ==========================================
// 2.6 QUANTUM FLUX ENGINE (양자 분석 엔진)
// ==========================================
// Moved to the bottom to incorporate advanced Python filters.


export function analyzeLotto(results: LottoResult[]): LottoStats {
  const frequencies: Record<number, number> = {};
  for (let i = 1; i <= 45; i++) frequencies[i] = 0;

  let totalSum = 0;
  let totalOdd = 0;
  let totalEven = 0;

  const recentNumbers = new Set<number>();

  results.forEach((r, idx) => {
    let sum = 0;
    r.numbers.forEach(n => {
      frequencies[n]++;
      sum += n;
      if (n % 2 !== 0) totalOdd++;
      else totalEven++;

      if (idx < 5) recentNumbers.add(n);
    });
    totalSum += sum;
  });

  const avgSum = Math.round(totalSum / results.length);
  
  // Sort by frequency
  const sortedByFreq = Object.entries(frequencies)
    .sort((a, b) => b[1] - a[1])
    .map(([num, _]) => parseInt(num, 10));

  const hotNumbers = sortedByFreq.slice(0, 10);
  const coldNumbers = sortedByFreq.slice(-10);

  // Normalize odd/even per draw (approx)
  const avgOdd = Math.round(totalOdd / results.length);
  const avgEven = Math.round(totalEven / results.length);

  return {
    frequencies,
    hotNumbers,
    coldNumbers,
    recentNumbers,
    averageSum: avgSum,
    oddEvenAverage: `${avgOdd}:${avgEven}`
  };
}

// ==========================================
// 3. ADVANCED FILTERING (Ported from Auto_Lotto_filter_v4_FINAL.py)
// ==========================================

// [1] AC Value Filter (산술복잡도 필터)
// 6개 번호의 모든 쌍의 차이를 구하고 고유한 값의 개수를 계산 (D - 5)
// 7 이상이어야 유효한 조합으로 간주
export function isValidAC(numbers: number[]): boolean {
  const differences = new Set<number>();
  for (let i = 0; i < numbers.length; i++) {
    for (let j = i + 1; j < numbers.length; j++) {
      differences.add(Math.abs(numbers[i] - numbers[j]));
    }
  }
  const acValue = differences.size - 5;
  return acValue >= 7;
}

// [2] Sum46 Filter (합46 필터 - mode_sum46)
// 조합 내에서 두 수의 합이 46이 되는 쌍의 개수 확인 (통계적으로 0~2개가 일반적)
export function isValidSum46(numbers: number[]): boolean {
  let pairsSummingTo46 = 0;
  for (let i = 0; i < numbers.length; i++) {
    for (let j = i + 1; j < numbers.length; j++) {
      if (numbers[i] + numbers[j] === 46) {
        pairsSummingTo46++;
      }
    }
  }
  return pairsSummingTo46 >= 0 && pairsSummingTo46 <= 2;
}

// [3] Ratio Filter (분할 비율 필터 - mode_ratio_filter)
// 상위 3개 번호의 합 / 하위 3개 번호의 합 (보통 1.5 ~ 4.5 사이)
export function isValidRatio(numbers: number[]): boolean {
  const sorted = [...numbers].sort((a, b) => a - b);
  const sumSmall = sorted[0] + sorted[1] + sorted[2];
  const sumLarge = sorted[3] + sorted[4] + sorted[5];
  if (sumSmall === 0) return false;
  const ratio = sumLarge / sumSmall;
  return ratio >= 1.5 && ratio <= 4.5;
}

// [4] Range Pattern Filter (번대별 출현 패턴 필터)
// 특정 번대(단번대, 10번대, 20번대 등)에 너무 많은 번호가 몰리지 않도록 제한 (최대 3개)
export function isValidRangePattern(numbers: number[]): boolean {
  const counts = [0, 0, 0, 0, 0];
  numbers.forEach(n => {
    const idx = Math.min(Math.floor((n - 1) / 10), 4);
    counts[idx]++;
  });
  // 어떤 번대도 4개 이상의 번호를 가지지 않도록 필터링
  return counts.every(count => count <= 3);
}

// [5] Consecutive Filter (연속 번호 필터)
// 3연속 번호 제외, 최대 2쌍의 연속 번호만 허용
export function isValidConsecutive(numbers: number[]): boolean {
  const sorted = [...numbers].sort((a, b) => a - b);
  let consecutivePairs = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i] + 1 === sorted[i + 1]) {
      consecutivePairs++;
      // 3연속 확인
      if (i < sorted.length - 2 && sorted[i] + 2 === sorted[i + 2]) {
        return false;
      }
    }
  }
  return consecutivePairs <= 2;
}

// ==========================================
// 4. PREDICTION ENGINE (AI Master)
// ==========================================
const ADVANCED_SUM_MIN = 85;
const ADVANCED_SUM_MAX = 189;

const PYTHON_FILTER_FORMULAS = [
  'AC산술복잡도',
  '합46(Sum46)',
  '상/하위 비율',
  '연속번호 제한',
  `총합(${ADVANCED_SUM_MIN}~${ADVANCED_SUM_MAX})`,
  '번대별 분산',
];

function buildPredictionResult(numbers: number[], confidence: number, formulasUsed: string[]): PredictionResult {
  const sum = numbers.reduce((a, b) => a + b, 0);
  let odd = 0;
  let even = 0;
  let high = 0;
  let low = 0;

  numbers.forEach((n) => {
    if (n % 2 !== 0) odd++;
    else even++;
    if (n > 22) high++;
    else low++;
  });

  return {
    numbers,
    confidence,
    formulasUsed: Array.from(new Set(formulasUsed)),
    stats: {
      sum,
      oddEvenRatio: `${odd}:${even}`,
      highLowRatio: `${high}:${low}`,
    },
  };
}

function generateUniqueNumbersFromCandidates(candidates: number[], targetCount: number = 6): number[] {
  const selected = new Set<number>();

  for (const candidate of candidates) {
    if (candidate >= 1 && candidate <= 45) {
      selected.add(candidate);
    }
    if (selected.size === targetCount) break;
  }

  while (selected.size < targetCount) {
    selected.add(Math.floor(Math.random() * 45) + 1);
  }

  return Array.from(selected).sort((a, b) => a - b);
}

function passesPythonFilters(numbers: number[]): boolean {
  const sum = numbers.reduce((a, b) => a + b, 0);

  return (
    sum >= ADVANCED_SUM_MIN &&
    sum <= ADVANCED_SUM_MAX &&
    isValidAC(numbers) &&
    isValidSum46(numbers) &&
    isValidRatio(numbers) &&
    isValidRangePattern(numbers) &&
    isValidConsecutive(numbers)
  );
}

function generateFallbackNumbers(): number[] {
  const selected = new Set<number>();
  while (selected.size < 6) {
    selected.add(Math.floor(Math.random() * 45) + 1);
  }
  return Array.from(selected).sort((a, b) => a - b);
}



export function generateQuantumFlux(results: LottoResult[]): PredictionResult {
  const stats = analyzeLotto(results);
  const prevResult = results[0];
  const oldResult = results[1];
  let maxAttempts = 1500;

  while (maxAttempts > 0) {
    const seededCandidates: number[] = [];

    for (let i = 0; i < 6; i++) {
      const p1 = prevResult?.numbers[i] ?? Math.floor(Math.random() * 45) + 1;
      const p2 = oldResult?.numbers[i] ?? Math.floor(Math.random() * 45) + 1;
      const flux = Math.floor(Math.random() * 7);
      seededCandidates.push(((p1 + p2 + flux) % 45) + 1);
    }

    const weightedPool = [
      ...seededCandidates,
      ...stats.hotNumbers.slice(0, 6),
      ...stats.coldNumbers.slice(0, 6),
      ...Array.from({ length: 45 }, (_, i) => i + 1).sort(() => Math.random() - 0.5),
    ];

    const numbers = generateUniqueNumbersFromCandidates(weightedPool);

    if (passesPythonFilters(numbers)) {
      return buildPredictionResult(numbers, 93, [
        '양자 요동 공식',
        '최근 2회차 가중치 연산',
        ...PYTHON_FILTER_FORMULAS,
      ]);
    }

    maxAttempts--;
  }

  const fallback = generateFallbackNumbers();
  return buildPredictionResult(fallback, 50, [
    '양자 요동 공식',
    ...PYTHON_FILTER_FORMULAS,
    '기본 무작위 대체',
  ]);
}

export function calculateBallColor(num: number): string {
  if (num <= 10) return 'bg-yellow-400 text-yellow-900';
  if (num <= 20) return 'bg-blue-500 text-white';
  if (num <= 30) return 'bg-red-500 text-white';
  if (num <= 40) return 'bg-gray-500 text-white';
  return 'bg-green-500 text-white';
}
