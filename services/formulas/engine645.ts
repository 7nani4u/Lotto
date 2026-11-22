import { LottoResult } from '../../types';

export interface Engine645 {
  name: string;
  // 1~45번까지의 점수를 담은 배열 반환 (길이 46, 인덱스 1~45 사용)
  scoreNumbers: (results: LottoResult[]) => number[];
}

/**
 * 한 회차의 추첨 번호 목록 (기본: 보너스 제외 본번호 6개).
 *
 * [한국 6/45 규약] 1등 당첨 = 본번호 6개 적중. 보너스볼은 본번호를 제외한
 * 39개 중 1개를 뽑는 별도 조건부 추첨이라 본번호 예측에는 다른 메커니즘의
 * 잡음입니다. 따라서 5개 6/45 엔진은 본번호 6개만 집계합니다.
 * 라이브 스택(lottoService.ts·Python 지표)은 7개 기준을 유지하므로,
 * 두 스택의 점수는 정의상 1:1로 비교되지 않습니다 (세컨드 오피니언은
 * 순위 일치도로만 비교).
 */
export function iterNums645(draw: LottoResult, includeBonus: boolean = false): number[] {
  return includeBonus ? [...draw.numbers, draw.bonus] : [...draw.numbers];
}

/**
 * 동점 해소용 결정적 의사난수 키(0~1).
 *
 * [수정] 점수가 같을 때 "번호가 작은 쪽 우선"으로 가르면 동점이 Top6 경계에 걸릴 때마다 작은 번호가 체계적으로 선택됩니다
 * (실측: 융합 점수 경계 동점 1.2 % 시점에서 선택 번호가 동점 군 평균보다 5.9 작음). 같은 입력 → 같은 결과(재현성)는 유지하면서
 * 번호 크기와 무관하게 가르도록, 시드(최신 회차 번호)와 번호로 만든 해시 키를 사용합니다.
 */
export function tieKey(seed: number, n: number): number {
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(n | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function normalizeScores(scores: number[]): number[] {
  const validScores = scores.slice(1);
  const max = Math.max(...validScores);
  const min = Math.min(...validScores);
  const range = max - min || 1; // 0으로 나누기 방지
  
  return scores.map((s, i) => i === 0 ? 0 : ((s - min) / range) * 100);
}
