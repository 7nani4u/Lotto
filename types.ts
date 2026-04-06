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

export interface PredictionResult {
  numbers: number[];
  confidence: number;
  formulasUsed: string[];
  selectionReason?: SelectionReason;
  stats: {
    sum: number;
    oddEvenRatio: string; // e.g., "3:3"
    highLowRatio: string; // e.g., "4:2" (high: 23-45, low: 1-22)
  };
}
