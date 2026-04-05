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

export interface PredictionResult {
  numbers: number[];
  confidence: number;
  formulasUsed: string[];
  stats: {
    sum: number;
    oddEvenRatio: string; // e.g., "3:3"
    highLowRatio: string; // e.g., "4:2" (high: 23-45, low: 1-22)
  };
}
