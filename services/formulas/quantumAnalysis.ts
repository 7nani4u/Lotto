import { LottoResult } from '../../types';
import { Engine645, iterNums645, normalizeScores } from './engine645';

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
      // [한국 6/45] 본번호 6개 집계. 보너스는 1등 예측 대상이 아니므로 제외.
      // (50회 윈도우의 본번호 이론 기대 출현 ≈ 50×6/45 ≈ 6.7회)
      // idx 0이 가장 최신이므로, 처음 만나는 idx가 가장 최근 출현 경과 회차
      iterNums645(r).forEach(n => {
        freq[n]++;
        if (lastSeen[n] === -1) lastSeen[n] = idx;
      });
    });

    for (let i = 1; i <= 45; i++) {
      // Gap Score: 오랫동안 안 나온 번호에 높은 점수 부여 (평균 회귀)
      // [수정] 미출현 갭 하드코딩 50 → 실제 window. 데이터가 50회 미만이면
      // 관측 가능한 최대 갭(window)을 사용해야 편향이 없음.
      const gap = lastSeen[i] === -1 ? window : lastSeen[i];
      scores[i] += gap * 1.5;

      // Recency Penalty: 윈도우 동안 너무 자주 나온 번호 억제
      scores[i] -= freq[i] * 0.8;
    }

    return normalizeScores(scores);
  }
};
