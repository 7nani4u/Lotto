import { LottoResult } from '../types';
import {
  buildFullAnalysisTable,
  buildFlowSignals,
  buildFusedTable,
  FLOW_WEIGHT_DEFAULT,
  FLOW_TREND_SCORES,
  seededRandom,
} from './lottoService';
import { unifiedQuantumEngine645 } from './formulas/index';

// ==========================================
// EVIDENCE — 번호 순위 점수의 "워크포워드" 검증 (화면에 근거 없는 확신을 표시하지 않기 위한 기준선)
// ==========================================
//
// 각 시점 t 에서 "t 이전 회차만" 으로 점수를 만들고, 실제 t 회차 본번호 6개와 비교합니다.
// 무작위(독립·균등)라면 기대값은 정해져 있습니다:
//   · 상위 6개 적중 기대 6×6/45 = 0.800개
//   · 당첨 6개의 평균 순위 기대 23.0 (1=최고점) — 표준편차는 해석식 √((45²−1)/12/6 × 39/44) ≈ 4.99
// 평균 순위는 상위 6개 적중보다 정보량이 커서 같은 표본에서 훨씬 작은 차이를 구분합니다.
// 결과 해석: 유의한 우위가 없으면 점수는 "순위 지표"일 뿐 출현 확률이 아닙니다.
// ==========================================

export type ScorerKind = 'system' | 'sub' | 'flow' | 'baseline';

export interface ScorerEvidence {
  key: string;
  label: string;
  kind: ScorerKind;
  meanHits: number;      // 상위 6개 평균 적중 (기대 0.800)
  meanRank: number;      // 당첨 6개 평균 순위 (기대 23.0, 낮을수록 좋음)
  z: number;             // (meanRank − 23) / SE  — 음수일수록 당첨번호를 위에 둠
  p: number;             // 양측 p-value (정규 근사)
  blocks: number[];      // 시간순 3등분 구간별 평균 순위 (같은 방향이 반복되는지 확인)
}

export interface RetroPick {
  round: number;
  date: string;
  picks: number[];       // 그 회차 직전까지의 데이터로 만든 융합 Top6 (오름차순)
  hits: number;
  hitNumbers: number[];
  unified: number[];     // 같은 시점의 독립 스택 Top6
  unifiedHits: number;
  fusedRanks: number[];  // [번호 1~45] 그 시점 융합 순위 (1=최상위, 동점은 평균 순위, 인덱스 0 은 미사용)
  unifiedRanks: number[];// [번호 1~45] 그 시점 독립 스택 순위
}

export type Verdict = 'none' | 'weak' | 'edge' | 'worse';

export interface EvidenceReport {
  tests: number;
  minTrain: number;
  firstTestRound: number;
  lastTestRound: number;
  expectedHits: number;
  expectedRank: number;
  seHits: number;
  seRank: number;
  scorers: ScorerEvidence[];
  primary: ScorerEvidence;       // 융합(fused) — 화면의 Top6 선정 기준
  verdict: Verdict;
  verdictLabel: string;          // 한 줄 판정
  effectText: string;            // 효과 크기를 풀어쓴 문장
  alphaBonferroni: number;       // 점수 개수로 보정한 유의수준
  overlap: { mean: number; random: number; distribution: number[]; tests: number };
  recent: RetroPick[];           // 최신 → 과거, 최대 10회
  uniformity: { chi2: number; df: number; p: number; draws: number };
}

const HITS_RANDOM = 0.8;
const RANK_RANDOM = 23;
const SD_RANK = Math.sqrt(((45 * 45 - 1) / 12) / 6 * (39 / 44));   // ≈ 4.99
const SD_HITS = Math.sqrt(6 * (6 / 45) * (39 / 45) * (39 / 44));   // ≈ 0.784 (초기하분포)

function erfc(x: number): number {
  // Abramowitz–Stegun 7.1.26 (최대 오차 1.5e-7)
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : 2 - y;
}
const normalTwoSided = (z: number) => erfc(Math.abs(z) / Math.SQRT2);

function chiSquareSurvival(chi2: number, df: number): number {
  // Wilson–Hilferty 근사: df 가 크면(44) 충분히 정확
  const c = Math.cbrt(chi2 / df);
  const mu = 1 - 2 / (9 * df);
  const sd = Math.sqrt(2 / (9 * df));
  return 0.5 * erfc(((c - mu) / sd) / Math.SQRT2);
}

function topSix(score: number[]): number[] {
  return Array.from({ length: 45 }, (_, i) => i + 1)
    .sort((a, b) => score[b] - score[a] || a - b)
    .slice(0, 6);
}

function ranksOf(score: number[]): number[] {
  const idx = Array.from({ length: 45 }, (_, i) => i + 1).sort((a, b) => score[b] - score[a] || a - b);
  const rank = new Array<number>(46).fill(0);
  let i = 0;
  while (i < 45) {
    let j = i;
    while (j + 1 < 45 && score[idx[j + 1]] === score[idx[i]]) j++;     // 동점은 평균 순위
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) rank[idx[k]] = r;
    i = j + 1;
  }
  return rank;
}

const SCORER_META: Array<{ key: string; label: string; kind: ScorerKind }> = [
  { key: 'fused', label: '융합 (Top6 기준)', kind: 'system' },
  { key: 'composite', label: '종합 점수', kind: 'system' },
  { key: 'flow', label: '흐름 점수', kind: 'system' },
  { key: 'unified', label: '독립 스택', kind: 'system' },
  { key: 'z', label: '하위: Z-Score', kind: 'sub' },
  { key: 'bb', label: '하위: 볼린저', kind: 'sub' },
  { key: 'rsi', label: '하위: RSI', kind: 'sub' },
  { key: 'trend', label: '하위: 추세 묶음', kind: 'sub' },
  { key: 'confirm', label: '하위: 확인 묶음', kind: 'sub' },
  { key: 'connection', label: '흐름: 연결강도', kind: 'flow' },
  { key: 'overdue', label: '흐름: 대기 초과', kind: 'flow' },
  { key: 'trendflow', label: '흐름: 추세 분류', kind: 'flow' },
  { key: 'hot', label: '기준선: 빈도순', kind: 'baseline' },
  { key: 'cold', label: '기준선: 빈도 역순', kind: 'baseline' },
  { key: 'recent52', label: '기준선: 최근 빈도', kind: 'baseline' },
  { key: 'random', label: '기준선: 무작위', kind: 'baseline' },
];

export interface EvidenceOptions {
  testRounds?: number;    // 기본 400
  minTrain?: number;      // 기본 300
  onProgress?: (ratio: number) => void;
  isCancelled?: () => boolean;   // true 를 돌려주면 즉시 중단(null 반환) — 데이터가 바뀌어 결과가 무의미할 때
  yieldEvery?: number;    // 이 횟수마다 이벤트 루프에 양보 (기본 12)
}

/**
 * @param results 최신 회차가 앞(index 0)인 배열 (앱의 allData 와 동일)
 */
export async function buildEvidenceReport(
  results: LottoResult[],
  opts: EvidenceOptions = {},
): Promise<EvidenceReport | null> {
  const minTrain = opts.minTrain ?? 300;
  const chrono = [...results].sort((a, b) => a.round - b.round);   // 오래된 → 최신
  const tests = Math.min(opts.testRounds ?? 400, chrono.length - minTrain);
  if (tests < 60) return null;
  const start = chrono.length - tests;
  const yieldEvery = opts.yieldEvery ?? 12;
  const rand = seededRandom(20261122);

  const acc: Record<string, { hits: number[]; ranks: number[] }> = {};
  SCORER_META.forEach(m => { acc[m.key] = { hits: [], ranks: [] }; });
  const overlapDist = new Array<number>(7).fill(0);
  const recent: RetroPick[] = [];

  const toVec = (f: (n: number) => number): number[] => {
    const v = new Array<number>(46).fill(0);
    for (let n = 1; n <= 45; n++) v[n] = f(n);
    return v;
  };

  for (let t = start; t < chrono.length; t++) {
    const train = chrono.slice(0, t).reverse();           // 최신이 앞
    const target = chrono[t];
    const actual = target.numbers;
    const table = buildFullAnalysisTable(train);
    const flow = buildFlowSignals(train);
    if (table.length === 0 || !flow) continue;
    const fused = buildFusedTable(table, flow, FLOW_WEIGHT_DEFAULT);
    const fusedMap = new Map(fused.map(r => [r.number, r.fusedScore]));
    const uni = unifiedQuantumEngine645.predict(train).scores;
    const uniVec = new Array<number>(46).fill(0);
    uni.forEach(s => { uniVec[s.number] = s.score; });

    const cnt = new Array<number>(46).fill(0);
    const cnt52 = new Array<number>(46).fill(0);
    train.forEach((d, i) => d.numbers.forEach(n => { cnt[n]++; if (i < 52) cnt52[n]++; }));

    const T = (n: number) => table[n - 1];
    const vectors: Record<string, number[]> = {
      fused: toVec(n => fusedMap.get(n) ?? 0),
      composite: toVec(n => T(n).compositeScore),
      flow: toVec(n => flow.flowScores[n]),
      unified: uniVec,
      z: toVec(n => T(n).zSubScore),
      bb: toVec(n => T(n).bbSubScore),
      rsi: toVec(n => T(n).rsiSubScore),
      trend: toVec(n => T(n).maSubScore),
      confirm: toVec(n => T(n).aroonSubScore),
      connection: toVec(n => flow.connectionScores[n]),
      overdue: toVec(n => Math.min(flow.gapInfo[n].curGap / (flow.gapInfo[n].avgGap || 1), 2)),
      trendflow: toVec(n => FLOW_TREND_SCORES[flow.trends[n]] ?? 50),
      hot: cnt,
      cold: cnt.map(v => -v),
      recent52: cnt52,
      random: toVec(() => rand()),
    };

    for (const m of SCORER_META) {
      const v = vectors[m.key];
      const rk = ranksOf(v);
      const top = topSix(v);
      acc[m.key].hits.push(top.filter(n => actual.includes(n)).length);
      acc[m.key].ranks.push(actual.reduce((s, n) => s + rk[n], 0) / 6);
    }

    const fusedTop = fused.slice(0, 6).map(r => r.number);
    const uniTop = topSix(uniVec);
    overlapDist[fusedTop.filter(n => uniTop.includes(n)).length]++;

    if (t >= chrono.length - 10) {
      const hitNumbers = fusedTop.filter(n => actual.includes(n)).sort((a, b) => a - b);
      recent.push({
        round: target.round, date: target.date,
        picks: [...fusedTop].sort((a, b) => a - b),
        hits: hitNumbers.length, hitNumbers,
        unified: [...uniTop].sort((a, b) => a - b),
        unifiedHits: uniTop.filter(n => actual.includes(n)).length,
        fusedRanks: ranksOf(vectors.fused),
        unifiedRanks: ranksOf(vectors.unified),
      });
    }

    const done = t - start + 1;
    if (opts.onProgress && done % 8 === 0) opts.onProgress(done / tests);
    if (done % yieldEvery === 0) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (opts.isCancelled?.()) return null;
    }
  }

  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const n = acc.fused.ranks.length;
  if (n < 60) return null;
  const seRank = SD_RANK / Math.sqrt(n);
  const seHits = SD_HITS / Math.sqrt(n);
  const blockSize = Math.floor(n / 3);

  const scorers: ScorerEvidence[] = SCORER_META.map(m => {
    const a = acc[m.key];
    const meanRank = mean(a.ranks);
    const z = (meanRank - RANK_RANDOM) / seRank;
    return {
      key: m.key, label: m.label, kind: m.kind,
      meanHits: mean(a.hits), meanRank, z, p: normalTwoSided(z),
      blocks: [0, 1, 2].map(b => mean(a.ranks.slice(b * blockSize, (b + 1) * blockSize))),
    };
  });
  const primary = scorers.find(s => s.key === 'fused')!;
  const alphaBonferroni = 0.05 / scorers.length;

  let verdict: Verdict = 'none';
  if (primary.z <= -3) verdict = 'edge';
  else if (primary.z <= -1.96) verdict = 'weak';
  else if (primary.z >= 1.96) verdict = 'worse';
  const verdictLabel = {
    none: '무작위와 구분되지 않음',
    weak: '약한 신호 (우위로 단정 불가)',
    edge: '무작위보다 유의하게 우수',
    worse: '무작위보다 오히려 불리',
  }[verdict];
  const effectText =
    `당첨 번호 6개를 평균 ${primary.meanRank.toFixed(1)}위에 배치 (무작위 기대 ${RANK_RANDOM.toFixed(1)}위, ±${seRank.toFixed(2)}) · ` +
    `Top6 평균 적중 ${primary.meanHits.toFixed(2)}개 (무작위 ${HITS_RANDOM.toFixed(2)}개, ±${seHits.toFixed(2)})`;

  // 번호 균등성 (H0 가정 점검): 본번호 출현 횟수의 χ² 적합도
  const freq = new Array<number>(46).fill(0);
  chrono.forEach(d => d.numbers.forEach(x => { freq[x]++; }));
  const expected = (chrono.length * 6) / 45;
  let chi2 = 0;
  for (let k = 1; k <= 45; k++) chi2 += (freq[k] - expected) ** 2 / expected;

  const overlapTotal = overlapDist.reduce((a, b) => a + b, 0);
  const overlapMean = overlapTotal > 0
    ? overlapDist.reduce((s, c, k) => s + c * k, 0) / overlapTotal
    : 0;

  return {
    tests: n, minTrain,
    firstTestRound: chrono[start].round, lastTestRound: chrono[chrono.length - 1].round,
    expectedHits: HITS_RANDOM, expectedRank: RANK_RANDOM, seHits, seRank,
    scorers, primary, verdict, verdictLabel, effectText, alphaBonferroni,
    overlap: { mean: overlapMean, random: 0.8, distribution: overlapDist, tests: overlapTotal },
    recent: recent.reverse(),
    uniformity: { chi2, df: 44, p: chiSquareSurvival(chi2, 44), draws: chrono.length },
  };
}
