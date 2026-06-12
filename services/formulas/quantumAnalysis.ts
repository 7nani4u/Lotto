import { LottoResult } from '../../types';
import { Engine645, normalizeScores } from './engine645';

export const quantumAnalysis645: Engine645 = {
  name: "Quantum Analysis (양자 분석 - 평균 회귀 및 공백)",
  scoreNumbers: (results: LottoResult[]) => {
    const scores = Array(46).fill(0);
    if (!results || results.length < 30) return scores;

    const window = Math.min(50, results.length);
    const recentData = results.slice(0, window);

    const freq = Array(46).fill(0);
    const lastSeen = Array(46).fill(-1);

    recentData.forEach((r, idx) => {
      r.numbers.forEach(n => {
        freq[n]++;
        // idx 0이 가장 최신이므로, 처음 만나는 idx가 가장 최근 출현 경과 회차
        if (lastSeen[n] === -1) lastSeen[n] = idx;
      });
    });

    for (let i = 1; i <= 45; i++) {
      // Gap Score: 오랫동안 안 나온 번호(최대 50)에 높은 점수 부여 (평균 회귀)
      const gap = lastSeen[i] === -1 ? 50 : lastSeen[i];
      scores[i] += gap * 1.5;

      // Recency Penalty: 50회차 동안 너무 자주 나온 번호 억제
      scores[i] -= freq[i] * 0.8;
    }

    return normalizeScores(scores);
  }
};
