import { LottoResult } from '../../types';
import { Engine645, iterNums645, normalizeScores } from './engine645';

export const neuralPattern645: Engine645 = {
  name: "Neural Pattern (신경 패턴 - 모멘텀 및 주기)",
  scoreNumbers: (results: LottoResult[]) => {
    const scores = Array(46).fill(0);
    if (!results || results.length < 15) return scores;

    // Factor 1: Momentum (최근 5회차 빈도 vs 이전 5회차 빈도, 본번호 6개)
    const recent5 = Array(46).fill(0);
    const prev5 = Array(46).fill(0);

    results.slice(0, 5).forEach(r => iterNums645(r).forEach(n => recent5[n]++));
    results.slice(5, 10).forEach(r => iterNums645(r).forEach(n => prev5[n]++));

    for (let i = 1; i <= 45; i++) {
      const momentum = recent5[i] - prev5[i];
      scores[i] += momentum * 2.5;
    }

    // Factor 2: Cycle Detection (7회차 전 출현 번호 - 주간 패턴)
    if (results.length > 7) {
      iterNums645(results[7]).forEach(n => scores[n] += 3.0);
    }

    // [수정] 역전: 출현 감소 추세(Delta 음수) = 평균 회귀 기대 → 높은 점수.
    // 기존에는 증가 추세에 높은 점수를 주어 QA 등 회귀 엔진과 정면 충돌했고,
    // Python calc_neural_pattern()과도 부호가 달랐음. 방향을 통일함.
    const inverted = scores.map(s => -s);
    return normalizeScores(inverted);
  }
};
