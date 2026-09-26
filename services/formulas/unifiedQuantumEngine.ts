import { LottoResult } from '../../types';
import { Engine645 } from './engine645';
import { quantumFlux645 } from './quantumFlux';
import { neuralPattern645 } from './neuralPattern';
import { quantumAnalysis645 } from './quantumAnalysis';
import { advancedCluster645 } from './advancedCluster';
import { multiDimensionalMarkov645 } from './deepLearning3D';

export const unifiedQuantumEngine645 = {
  name: "Unified Quantum Analysis Engine (통합 양자 앙상블 엔진)",

  // 방향 규약: 5개 엔진 모두 "높을수록 회귀 기대(과소출현)" 방향으로 정규화됨.
  // QF/NP는 역전 후 정규화, M3D만 모멘텀 방향(다변화 의도). 가중합 시 상쇄가
  // 아닌 보완이 되도록 유지할 것.
  // 집계 규약: 한국 6/45 본번호 6개 (보너스 제외). 라이브 스택(7개)과 정의가
  // 다르므로 점수 직접 비교 금지, 순위 일치도로만 비교할 것.
  predict: (results: LottoResult[]): { numbers: number[], scores: { number: number, score: number }[] } => {
    const engines: Engine645[] = [
      quantumFlux645,              // 흐름, 이월수, 이웃수
      neuralPattern645,            // 모멘텀, 주기
      quantumAnalysis645,          // 공백, 평균 회귀
      advancedCluster645,          // 번대별 불균형
      multiDimensionalMarkov645    // 마르코프 전이 확률
    ];

    // 각 엔진별 반영 가중치 (총합 1.0)
    const weights = [0.20, 0.20, 0.25, 0.15, 0.20];
    
    const finalScores = Array(46).fill(0);

    // 5개의 엔진이 각각 1~45번을 평가하고 점수를 0~100으로 정규화
    engines.forEach((engine, idx) => {
      const engineScores = engine.scoreNumbers(results);
      for (let i = 1; i <= 45; i++) {
        finalScores[i] += engineScores[i] * weights[idx];
      }
    });

    const scoredNumbers = [];
    for (let i = 1; i <= 45; i++) {
      scoredNumbers.push({ number: i, score: finalScores[i] });
    }

    // 종합 점수 내림차순 정렬
    scoredNumbers.sort((a, b) => b.score - a.score);

    // 상위 6개 번호 추출 후 오름차순 정렬
    const top6 = scoredNumbers.slice(0, 6).map(s => s.number).sort((a, b) => a - b);

    return {
      numbers: top6,
      scores: scoredNumbers
    };
  }
};
