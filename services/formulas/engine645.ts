import { LottoResult } from '../../types';

export interface Engine645 {
  name: string;
  // 1~45번까지의 점수를 담은 배열 반환 (길이 46, 인덱스 1~45 사용)
  scoreNumbers: (results: LottoResult[]) => number[];
}

export function normalizeScores(scores: number[]): number[] {
  const validScores = scores.slice(1);
  const max = Math.max(...validScores);
  const min = Math.min(...validScores);
  const range = max - min || 1; // 0으로 나누기 방지
  
  return scores.map((s, i) => i === 0 ? 0 : ((s - min) / range) * 100);
}
