import { LottoResult } from '../../types';
import { Engine645, normalizeScores } from './engine645';

export const advancedCluster645: Engine645 = {
  name: "Advanced Cluster (고급 클러스터 융합 - 번대 불균형)",
  scoreNumbers: (results: LottoResult[]) => {
    const scores = Array(46).fill(0);
    if (!results || results.length < 15) return scores;

    // 클러스터: 10단위 번대 (0: 1-10, 1: 11-20, 2: 21-30, 3: 31-40, 4: 41-45)
    const clusterFreq = Array(5).fill(0);
    
    // 최근 15회차의 번대별 출현 빈도 조사
    results.slice(0, 15).forEach(r => {
      r.numbers.forEach(n => {
        const clusterIdx = Math.min(4, Math.floor((n - 1) / 10));
        clusterFreq[clusterIdx]++;
      });
    });

    const maxFreq = Math.max(...clusterFreq);
    
    // 덜 나온 번대(클러스터)의 숫자들에게 가중치 부여 (균형 회귀)
    for (let i = 1; i <= 45; i++) {
      const clusterIdx = Math.min(4, Math.floor((i - 1) / 10));
      const deficit = maxFreq - clusterFreq[clusterIdx];
      scores[i] += deficit * 2.0;
    }

    return normalizeScores(scores);
  }
};
