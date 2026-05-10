import { LottoResult } from '../../types';
import { Engine645, normalizeScores } from './engine645';

export const quantumFlux645: Engine645 = {
  name: "Quantum Flux (양자 플럭스 - 흐름 및 이월수)",
  scoreNumbers: (results: LottoResult[]) => {
    const scores = Array(46).fill(0);
    if (!results || results.length < 20) return scores;

    // 1. Hot Numbers (최근 20회차 출현 빈도: 기본 베이스)
    const recent20 = results.slice(0, 20);
    recent20.forEach(r => r.numbers.forEach(n => scores[n] += 1));

    // 2. Last Drawn (직전 회차 번호 - 이월수 가중치)
    results[0].numbers.forEach(n => scores[n] += 3);

    // 3. Base Flow (이웃수 - 직전 회차 번호의 +1, -1)
    results[0].numbers.forEach(n => {
      if (n > 1) scores[n - 1] += 1.5;
      if (n < 45) scores[n + 1] += 1.5;
    });

    return normalizeScores(scores);
  }
};
