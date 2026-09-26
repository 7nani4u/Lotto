import { LottoResult } from '../../types';
import { Engine645, iterNums645, normalizeScores } from './engine645';

export const quantumFlux645: Engine645 = {
  name: "Quantum Flux (양자 플럭스 - 흐름 및 이월수)",
  scoreNumbers: (results: LottoResult[]) => {
    const scores = Array(46).fill(0);
    if (!results || results.length < 20) return scores;

    // 1. Hot Numbers (최근 20회차 출현 빈도: 기본 베이스) — 본번호 6개 (보너스 제외)
    const recent20 = results.slice(0, 20);
    recent20.forEach(r => iterNums645(r).forEach(n => scores[n] += 1));

    // 2. Last Drawn (직전 회차 번호 - 이월수 가중치, 본번호 기준)
    iterNums645(results[0]).forEach(n => scores[n] += 3);

    // 3. Base Flow (이웃수 - 직전 회차 번호의 +1, -1)
    iterNums645(results[0]).forEach(n => {
      if (n > 1) scores[n - 1] += 1.5;
      if (n < 45) scores[n + 1] += 1.5;
    });

    // [수정] 역전: 에너지가 낮은 번호(흐름 소외) = 출현 기대 높음.
    // 기존에는 에너지가 높은 번호에 높은 점수를 주어 평균 회귀 철학과
    // 반대 방향이었고, Python calc_quantum_flux()와도 부호가 달랐음.
    // 앙상블 내 방향 통일(회귀 주도 + M3D만 모멘텀 다변화)을 위해 역전함.
    const inverted = scores.map(s => -s);
    return normalizeScores(inverted);
  }
};
