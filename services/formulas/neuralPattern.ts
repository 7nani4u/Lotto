import { LottoResult } from '../../types';
import { Engine645, normalizeScores } from './engine645';

export const neuralPattern645: Engine645 = {
  name: "Neural Pattern (신경 패턴 - 모멘텀 및 주기)",
  scoreNumbers: (results: LottoResult[]) => {
    const scores = Array(46).fill(0);
    if (!results || results.length < 15) return scores;

    // Factor 1: Momentum (최근 5회차 빈도 vs 이전 5회차 빈도)
    const recent5 = Array(46).fill(0);
    const prev5 = Array(46).fill(0);
    
    results.slice(0, 5).forEach(r => r.numbers.forEach(n => recent5[n]++));
    results.slice(5, 10).forEach(r => r.numbers.forEach(n => prev5[n]++));

    for (let i = 1; i <= 45; i++) {
      const momentum = recent5[i] - prev5[i];
      // 상승 모멘텀(최근에 더 많이 나옴)에 가중치
      scores[i] += momentum * 2.5; 
    }

    // Factor 2: Cycle Detection (7회차 전 출현 번호 - 주간 패턴)
    if (results.length > 7) {
      results[7].numbers.forEach(n => scores[n] += 3.0);
    }

    return normalizeScores(scores);
  }
};
