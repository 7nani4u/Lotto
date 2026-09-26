/**
 * laoTypes.ts — 라오스 복권(Lao Lottery, 4자리) 시절의 레거시 타입 정의.
 *
 * [상태: 미사용/격리] index.ts에서 export하지 않으며, 앱 어디에서도 import하지
 * 않습니다. types.ts의 6/45용 LottoResult/PredictionResult와 이름이 같지만
 * 구조가 완전히 다르므로(4자리/3자리/2자리상), 혼동을 막기 위해 import하지
 * 마십시오. 삭제 대신 보관하는 이유: 과거 백테스트 스키마 참조용.
 *
 * @deprecated 신규 코드는 types.ts를 사용하십시오.
 */
export interface LottoResult {
  date: string;
  r4: string; // Last 4 digits
  r3: string; // 3-digit prize
  r2: string; // 2-digit prize
  year: string;
}

export interface PredictionResult {
  primary: string;
  mirror: string;
  rhythm: string;
  triple: string; // Added for 3-digit prediction
  confidence: number;
  formulaName: string;
}

export interface Pattern {
  name: string;
  calc: (p: number, l: number, l4: string, results?: LottoResult[]) => number;
  getMirrorPair?: (result: number) => number;
  getTriple?: (results: LottoResult[]) => string;
}

export interface BacktestResult {
  totalRounds: number;
  directHits: number;
  runningHits: number;
  directAccuracy: number;
  runningAccuracy: number;
  maxConsecutiveHits: number; // Maximum consecutive correct predictions
  hits: Array<{ date: string; predicted: number; actual: number; isDirect: boolean; isRunning: boolean }>;
}

export interface PatternPerformance {
  pattern: Pattern;
  stats: BacktestResult;
  isQualified: boolean; // 연속 적중 기준 통과 여부
}

export interface HybridPatternInfo {
  pattern: Pattern;
  historicalStats: BacktestResult; // 전체 과거 평균 (30회차)
  currentStats: BacktestResult;    // 최근 값 (10회차)
  isQualified: boolean;            // 아직 기준을 통과하는지 여부
  stabilityScore: number;          // 안정성 점수 0-100
  isActiveMaster: boolean;         // 현재 Active Master 여부
}

export interface RepeatAnalysis {
  totalOccurrences: number;           // 총 출현 횟수
  repeatAfterOne: number;              // 다음 회차에 재출현
  repeatAfterTwo: number;              // 2회차 내 재출현
  repeatAfterThree: number;            // 3회차 내 재출현
  repeatPercentage: number;            // 다음 회차 재출현율 %
  averageGap: number;                  // 출현 간격 평균
  lastSeenDate: string;                // 최근 출현 일자
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW';  // 신뢰도 수준
  recommendation: string;              // 권장 사항
}

export interface PredictionConfidence {
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';
  confidenceScore: number;  // 0-100
  frequencyScore: number;   // 0-100
  trendAlignment: number;   // 0-100
  patternStrength: number;  // 0-100
  warning: string | null;
  recommendation: string;
}

export interface AccuracyTrend {
  recentAccuracy: number;      // 최근 10회차 적중률
  olderAccuracy: number;       // 이전 10회차 적중률
  trend: 'IMPROVING' | 'STABLE' | 'DECLINING';
  trendPercentage: number;     // 변동률 %
  recommendation: string;
}

export interface RunningDigitLog {
  date: string;
  predicted: number[];
  actual: string;
  isCorrect: boolean;
  matchedDigits: number;
  status: 'WIN' | 'LOSS' | 'PENDING';
}
