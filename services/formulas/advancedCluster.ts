import { LottoResult } from '../../types';
import { Engine645, iterNums645, normalizeScores } from './engine645';

export const advancedCluster645: Engine645 = {
  name: "Advanced Cluster (고급 클러스터 융합 - 번대 불균형)",
  scoreNumbers: (results: LottoResult[]) => {
    const scores = Array(46).fill(0);
    if (!results || results.length < 15) return scores;

    // 클러스터: 10단위 번대 (0: 1-10, 1: 11-20, 2: 21-30, 3: 31-40, 4: 41-45)
    // [한국 6/45 수정] 마지막 번대는 5개(41-45)라 원시 출현 횟수를 직접
    // 비교하면 41-45가 항상 최대 deficit이 되어 데이터와 무관하게 41-45가
    // 상위 고정되는 구조적 편향이 있었음 (합성 데이터에서 AC Top6 =
    // [41,42,43,44,45,31]로 실측). 번대 크기(10/10/10/10/5)로 나눈 출현율로
    // 비교하도록 수정. 스케일은 정규화 단계에서 흡수되므로 상대순위만 유효.
    const SIZES = [10, 10, 10, 10, 5];
    const clusterFreq = Array(5).fill(0);

    // 최근 15회차의 번대별 출현 빈도 조사 (본번호 6개, 보너스 제외)
    results.slice(0, 15).forEach(r => {
      iterNums645(r).forEach(n => {
        const clusterIdx = Math.min(4, Math.floor((n - 1) / 10));
        clusterFreq[clusterIdx]++;
      });
    });

    const rates = clusterFreq.map((f, i) => f / SIZES[i]);
    const maxRate = Math.max(...rates);

    // 덜 나온 번대(출현율 기준)의 숫자들에게 가중치 부여 (균형 회귀)
    for (let i = 1; i <= 45; i++) {
      const clusterIdx = Math.min(4, Math.floor((i - 1) / 10));
      const deficit = maxRate - rates[clusterIdx];
      scores[i] += deficit * 2.0;
    }

    return normalizeScores(scores);
  }
};
