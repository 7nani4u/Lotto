import { LottoResult } from '../../types';
import { Engine645, iterNums645, normalizeScores } from './engine645';

export const multiDimensionalMarkov645: Engine645 = {
  name: "Multi-Dimensional Markov (다차원 마르코프 엔진 - 전이 행렬)",
  scoreNumbers: (results: LottoResult[]) => {
    const scores = Array(46).fill(0);
    if (!results || results.length < 20) return scores;

    // Transition Matrix [prevNumber][nextNumber] — 본번호 6개 기준.
    // 이전 회차에 A가 나왔을 때, 다음 회차에 B가 나올 확률
    const transition = Array(46).fill(0).map(() => Array(46).fill(0));

    // 최근 50회차 기준 마르코프 체인 학습
    const window = Math.min(50, results.length);
    for (let i = 0; i < window - 1; i++) {
      const currentDraw = iterNums645(results[i]);      // 현재(다음) 회차
      const prevDraw = iterNums645(results[i + 1]);     // 이전 회차

      prevDraw.forEach(prevNum => {
        currentDraw.forEach(currNum => {
          transition[prevNum][currNum]++;
        });
      });
    }

    // 직전 회차 번호들이 역사적으로 주로 어떤 번호로 전이(Transition)되었는지 합산
    // [참고] 모멘텀 방향 신호라 회귀 앙상블과 역상관 경향 — 다변화 의도로 유지.
    const lastDraw = iterNums645(results[0]);
    for (let i = 1; i <= 45; i++) {
      lastDraw.forEach(lastNum => {
        scores[i] += transition[lastNum][i] * 1.5;
      });
    }

    return normalizeScores(scores);
  }
};
