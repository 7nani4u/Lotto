export interface LottoResult {
  round: number;
  date: string;
  numbers: number[]; // 6 numbers
  bonus: number;
}

export interface PatternPerformance {
  patternName: string;
  description: string;
  weight: number; // 0-100 weight for this pattern in the algorithm
}

export interface SelectionReason {
  stage1_modelDesign: string;  // 1단계: 모델 설계 설명
  stage2_calcLogic: string;    // 2단계: 계산 로직 요약
  stage3_setReason: string;    // 3단계: 세트별 선택 이유
}

/** 조합이 만들어진 경로 — pool: 필터 통과 풀의 상위 5 % 중 무작위 · direct: 가중 무작위 생성 · relaxed: Whitson 조건 완화 · fallback: 순수 무작위 대체 */
export type PredictionSource = 'pool' | 'list' | 'direct' | 'relaxed' | 'fallback';

export interface PredictionResult {
  numbers: number[];
  /**
   * [삭제] 예전에는 `confidence`(AI 신뢰도 96 % 등)가 있었지만 경로별 고정 상수(96/92/88/82/78/55)였고 어떤 계산과도 무관했습니다.
   * 모든 조합의 1등 확률은 1/8,145,060 으로 같으므로(필터·점수와 무관) 확률처럼 보이는 값은 두지 않고,
   * 실제로 계산되는 사실만 남깁니다.
   */
  source: PredictionSource;
  passesFilters: boolean;     // 5개 필터(합계·상하위 비율·번대별·연속·AC)를 실제로 통과하는가 (계산값)
  formulasUsed: string[];
  selectionReason?: SelectionReason;
  stats: {
    sum: number;
    oddEvenRatio: string; // e.g., "3:3"
    highLowRatio: string; // e.g., "4:2" (high: 23-45, low: 1-22)
  };
}
