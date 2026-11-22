import { LottoResult } from '../types';
import {
  ADVANCED_SUM_MAX,
  ADVANCED_SUM_MIN,
  buildFlowSignals,
  buildGapInfo,
} from './lottoService';
import { DrawMeta, FILTER_SPACE_PASS, summarizeDraw, THEORETICAL_SUM_MEAN } from './drawMeta';
import type { RetroPick } from './evidence';

// ═══════════════════════════════════════════════════════════════════════════════
// 회차 분석 리포트 — "최근 당첨 번호" 행을 눌렀을 때 펼쳐지는 리포트의 계산 모듈
//
// 원칙
//  · 모든 비교 기준은 두 가지만 씁니다.  ① 균등 이론: 45개 중 6개를 독립·균등하게 뽑을 때의 정확한 확률(조합론)
//                                         ② 역대 실측: 앱이 가진 전체 회차에서 같은 값이 나온 비율
//  · 이론 값을 구할 수 없는 항목(AC, 상·하위 비율)은 억지로 만들지 않고 이론 열을 비웁니다(null).
//  · 이 리포트는 "이미 나온 회차의 구조 설명"입니다. 다음 회차 확률(모든 조합 1/8,145,060)을 바꾸지 않습니다.
// ═══════════════════════════════════════════════════════════════════════════════

const TOTAL = 8145060;   // C(45,6)

export function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

// ── 균등 이론 분포 (정확값) ────────────────────────────────────────────────────

/** 번대 상한(≤limit개) 조합 수: Π(Σ_{k≤limit} C(cap,k)·x^k) 의 x^6 계수 */
function decadeCountAtMost(limit: number): number {
  if (limit <= 0) return 0;
  const caps = [10, 10, 10, 10, 5];
  let poly: number[] = [1];
  for (const cap of caps) {
    const top = Math.min(cap, limit);
    const next = new Array<number>(poly.length + top).fill(0);
    for (let i = 0; i < poly.length; i++) for (let k = 0; k <= top; k++) next[i + k] += poly[i] * comb(cap, k);
    poly = next;
  }
  return poly[6] ?? 0;
}

let SUM_COUNTS: Float64Array | null = null;
/** 6개 합계별 조합 수 (0~255) — 부분집합 DP */
function sumCounts(): Float64Array {
  if (SUM_COUNTS) return SUM_COUNTS;
  const dp = Array.from({ length: 7 }, () => new Float64Array(256));
  dp[0][0] = 1;
  for (let n = 1; n <= 45; n++) {
    for (let k = 6; k >= 1; k--) {
      for (let s = 255; s >= n; s--) dp[k][s] += dp[k - 1][s - n];
    }
  }
  SUM_COUNTS = dp[6];
  return SUM_COUNTS;
}

export const THEORY = {
  /** 홀수가 k개일 확률 (홀수 23개 · 짝수 22개) */
  odd: (k: number) => comb(23, k) * comb(22, 6 - k) / TOTAL,
  /** 저(1~22)가 k개일 확률 (저 22개 · 고 23개) */
  low: (k: number) => comb(22, k) * comb(23, 6 - k) / TOTAL,
  /** 이웃한 쌍(n, n+1)이 정확히 j쌍일 확률 — 연속 덩어리 m = 6−j 개: C(5,m−1)·C(40,m) */
  adjacent: (pairs: number) => {
    const m = 6 - pairs;
    return m >= 1 && m <= 6 ? comb(5, m - 1) * comb(40, m) / TOTAL : 0;
  },
  /** 직전 회차 본번호 6개 중 정확히 c개가 다시 나올 확률 */
  carry: (c: number) => comb(6, c) * comb(39, 6 - c) / TOTAL,
  /** 한 번대에 몰린 최대 개수가 정확히 m일 확률 */
  maxDecade: (m: number) => (decadeCountAtMost(m) - decadeCountAtMost(m - 1)) / TOTAL,
  /** 합계가 s 이하일 확률 */
  sumCdf: (s: number) => {
    const d = sumCounts();
    let c = 0;
    for (let i = 0; i <= Math.min(255, Math.floor(s)); i++) c += d[i];
    return c / TOTAL;
  },
  /** 합계가 [lo, hi] 안에 있을 확률 */
  sumBetween: (lo: number, hi: number) => THEORY.sumCdf(hi) - THEORY.sumCdf(lo - 1),
};

// ── 역대 실측 프로필 (전체 회차 한 번 집계) ──────────────────────────────────────

export interface HistoryProfile {
  draws: number;
  carryDraws: number;          // 이월수를 셀 수 있는 회차 수 (가장 오래된 회차는 직전 회차가 없음)
  sums: number[];              // 오름차순
  ratios: number[];            // 오름차순
  sumMean: number;
  count: {
    odd: number[]; low: number[]; adjacent: number[]; carry: number[]; maxDecade: number[]; ac: number[];
  };
  passed: number;              // 필터 5종 전체 통과 회차 수
}

/** @param results 최신 회차가 앞(index 0) */
export function buildHistoryProfile(results: LottoResult[]): HistoryProfile {
  const count = {
    odd: new Array<number>(7).fill(0),
    low: new Array<number>(7).fill(0),
    adjacent: new Array<number>(7).fill(0),
    carry: new Array<number>(7).fill(0),
    maxDecade: new Array<number>(7).fill(0),
    ac: new Array<number>(11).fill(0),
  };
  const sums: number[] = [];
  const ratios: number[] = [];
  let passed = 0;
  for (let i = 0; i < results.length; i++) {
    const prev = results[i + 1];
    const m = summarizeDraw(results[i], prev);
    sums.push(m.sum);
    ratios.push(m.ratio);
    count.odd[m.odd]++;
    count.low[m.low]++;
    count.adjacent[m.adjacentPairs]++;
    count.maxDecade[m.maxDecade]++;
    count.ac[Math.min(10, Math.max(0, m.ac))]++;
    if (prev) count.carry[m.carry.length]++;
    if (m.passAll) passed++;
  }
  sums.sort((a, b) => a - b);
  ratios.sort((a, b) => a - b);
  const n = results.length;
  return {
    draws: n,
    carryDraws: Math.max(0, n - 1),
    sums, ratios,
    sumMean: n > 0 ? sums.reduce((a, b) => a + b, 0) / n : THEORETICAL_SUM_MEAN,
    count,
    passed,
  };
}

const shareAtMost = (sorted: number[], v: number) => {
  if (sorted.length === 0) return 0;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= v + 1e-9) lo = mid + 1; else hi = mid; }
  return lo / sorted.length;
};

// ── 리포트 데이터 ──────────────────────────────────────────────────────────────

export type TagLevel = 'common' | 'normal' | 'rare';
export type Relation = 'carry' | 'prevBonus' | 'neighbor' | 'new' | 'none';
export interface Highlight { text: string; tone: 'ok' | 'bad' | 'warn' | 'info' }

export interface MetricRow {
  key: string;
  label: string;
  value: string;
  sub?: string;
  filter?: { rule: string; ok: boolean };
  basis: string;                         // 아래 두 비율이 "무엇의 비율"인지 (예: "같은 홀짝 비율")
  mode: 'share' | 'cumulative';          // share: 같은 값의 비율 / cumulative: 이 값 이하의 누적 비율
  theory: number | null;                 // 균등 이론 (0~1) — 구할 수 없으면 null
  hist: number;                          // 역대 실측 (0~1)
  histCount: number | null;              // share 모드의 역대 해당 회차 수
  tag: { text: string; level: TagLevel };
  decades?: number[];                    // 번대 분포 미니 막대
  carried?: number[];                    // 이월 번호
}

export interface NumberDetail {
  n: number;
  isBonus: boolean;
  relation: Relation;                    // 직전 회차와의 관계
  waited: number | null;                 // 이 회차 직전까지 연속 미출현 횟수 (null = 데이터 안에서 첫 출현)
  avgGap: number | null;                 // 평균 출현 간격 (최근 80회, 흐름 분석과 동일 정의)
  overdue: number | null;                // waited ÷ avgGap
  trend: string | null;                  // 그 시점의 추세 분류 (직전 10회 기준)
  count: number;                         // 이 회차까지 본번호 출현 횟수
  expected: number;                      // 같은 기간 균등 기대 횟수
  fusedRank: number | null;              // 그 시점 융합 순위 (검증 계산이 끝난 경우)
}

export interface PairStat {
  pair: [number, number];
  count: number;
  expected: number;
  z: number;
}

export interface RetroSummary {
  picks: number[];
  hits: number;
  hitNumbers: number[];
  unified: number[];
  unifiedHits: number;
  fusedMeanRank: number;
  unifiedMeanRank: number;
}

export interface DrawReportData {
  round: number;
  date: string;
  numbers: number[];
  bonus: number;
  prevRound: number | null;
  prevNumbers: number[];
  prevBonus: number | null;
  draws: number;
  meta: DrawMeta;
  filterRows: MetricRow[];
  refRows: MetricRow[];
  passAll: boolean;
  passRateHist: number;
  passRateTheory: number;
  highlights: Highlight[];
  numberDetails: NumberDetail[];
  pairs: PairStat[];
  pairBasis: number;                     // 쌍 집계에 쓴 회차 수 (이 회차 제외)
  pairSd: number;                        // 한 쌍의 무작위 기대 횟수의 표준편차
  retro: RetroSummary | null;
}

const levelOfShare = (p: number): TagLevel => (p >= 0.2 ? 'common' : p >= 0.05 ? 'normal' : 'rare');
const TAG_TEXT: Record<TagLevel, string> = { common: '흔한 편', normal: '보통', rare: '드문 편' };
const pct1 = (p: number) => `${(p * 100).toFixed(1)}%`;

function shareRow(args: {
  key: string; label: string; value: string; sub?: string; filter?: MetricRow['filter'];
  basis: string; theory: number | null; histCount: number; histDen: number;
  decades?: number[]; carried?: number[];
}): MetricRow {
  const hist = args.histDen > 0 ? args.histCount / args.histDen : 0;
  const level = levelOfShare(args.theory ?? hist);
  return {
    key: args.key, label: args.label, value: args.value, sub: args.sub, filter: args.filter,
    basis: args.basis, mode: 'share', theory: args.theory, hist, histCount: args.histCount,
    tag: { text: TAG_TEXT[level], level }, decades: args.decades, carried: args.carried,
  };
}

/** 누적(이 값 이하) 비율 행 — 합계·상하위 비율 */
function cumulativeRow(args: {
  key: string; label: string; value: string; sub?: string; filter?: MetricRow['filter'];
  basis: string; theory: number | null; hist: number;
}): MetricRow {
  const c = args.theory ?? args.hist;
  let level: TagLevel; let text: string;
  if (c < 0.05 || c > 0.95) { level = 'rare'; text = c < 0.05 ? '매우 낮음' : '매우 높음'; }
  else if (c < 0.25) { level = 'normal'; text = '낮은 편'; }
  else if (c > 0.75) { level = 'normal'; text = '높은 편'; }
  else { level = 'common'; text = '중앙권'; }
  return {
    key: args.key, label: args.label, value: args.value, sub: args.sub, filter: args.filter,
    basis: args.basis, mode: 'cumulative', theory: args.theory, hist: args.hist, histCount: null,
    tag: { text, level },
  };
}

/**
 * @param results 최신 회차가 앞(index 0)인 전체 데이터
 * @param idx     리포트 대상 회차의 index
 */
export function buildDrawReport(
  results: LottoResult[],
  idx: number,
  profile: HistoryProfile,
  retro?: RetroPick,
): DrawReportData {
  const draw = results[idx];
  const prev = results[idx + 1];
  const older = results.slice(idx + 1);             // 이 회차보다 오래된 회차 (최신이 앞)
  const nums = [...draw.numbers].sort((a, b) => a - b);
  const meta = summarizeDraw(draw, prev);
  const N = profile.draws;

  // ── ① 필터 5종 ──
  const f = (key: string) => meta.filters.find(x => x.key === key)!.ok;
  const triple = (() => {
    for (let i = 0; i + 2 < nums.length; i++) if (nums[i] + 1 === nums[i + 1] && nums[i] + 2 === nums[i + 2]) return true;
    return false;
  })();
  const sumDev = meta.sum - THEORETICAL_SUM_MEAN;
  const filterRows: MetricRow[] = [
    cumulativeRow({
      key: 'sum', label: '합계', value: String(meta.sum),
      sub: `평균 ${THEORETICAL_SUM_MEAN} 대비 ${sumDev >= 0 ? '+' : ''}${sumDev}`,
      filter: { rule: `${ADVANCED_SUM_MIN}~${ADVANCED_SUM_MAX}`, ok: f('sum') },
      basis: '이 합계 이하가 나올 비율', theory: THEORY.sumCdf(meta.sum), hist: shareAtMost(profile.sums, meta.sum),
    }),
    cumulativeRow({
      key: 'ratio', label: '상·하위 비율', value: meta.ratio.toFixed(2),
      sub: '상위 3개 합 ÷ 하위 3개 합',
      filter: { rule: '1.3~7.5', ok: f('ratio') },
      basis: '이 비율 이하가 나온 비율', theory: null, hist: shareAtMost(profile.ratios, meta.ratio),
    }),
    shareRow({
      key: 'range', label: '번대 분포', value: meta.decades.join('-'),
      sub: `한 번대 최대 ${meta.maxDecade}개`,
      filter: { rule: '한 번대 ≤3개', ok: f('range') },
      basis: `한 번대 최대 ${meta.maxDecade}개인 비율`,
      theory: THEORY.maxDecade(meta.maxDecade), histCount: profile.count.maxDecade[meta.maxDecade], histDen: N,
      decades: meta.decades,
    }),
    shareRow({
      key: 'cons', label: '연번 (이웃한 번호)', value: `${meta.adjacentPairs}쌍`,
      sub: triple ? '3연속 포함' : undefined,
      filter: { rule: '2쌍 이하 · 3연속 불가', ok: f('cons') },
      basis: `연번 ${meta.adjacentPairs}쌍인 비율`,
      theory: THEORY.adjacent(meta.adjacentPairs), histCount: profile.count.adjacent[meta.adjacentPairs], histDen: N,
    }),
    shareRow({
      key: 'ac', label: 'AC (산술 복잡도)', value: String(meta.ac),
      sub: '서로 다른 번호 간격 수 − 5',
      filter: { rule: '5~10', ok: f('ac') },
      basis: `AC ${meta.ac}인 비율`,
      theory: null, histCount: profile.count.ac[Math.min(10, Math.max(0, meta.ac))], histDen: N,
    }),
  ];

  // ── ② 참고 구조 (필터 아님) ──
  const refRows: MetricRow[] = [
    shareRow({
      key: 'odd', label: '홀짝 (홀:짝)', value: `${meta.odd}:${meta.even}`,
      basis: `홀수 ${meta.odd}개인 비율`,
      theory: THEORY.odd(meta.odd), histCount: profile.count.odd[meta.odd], histDen: N,
    }),
    shareRow({
      key: 'low', label: '저·고 (1~22 : 23~45)', value: `${meta.low}:${meta.high}`,
      basis: `저 ${meta.low}개인 비율`,
      theory: THEORY.low(meta.low), histCount: profile.count.low[meta.low], histDen: N,
    }),
  ];
  if (prev) {
    refRows.push(shareRow({
      key: 'carry', label: '이월수 (직전 회차와 겹침)', value: `${meta.carry.length}개`,
      sub: meta.carry.length > 0 ? meta.carry.join(', ') : undefined,
      basis: `이월 ${meta.carry.length}개인 비율`,
      theory: THEORY.carry(meta.carry.length), histCount: profile.count.carry[meta.carry.length], histDen: profile.carryDraws,
      carried: meta.carry,
    }));
  }

  // ── ③ 번호별 상세 (본번호 6개 + 보너스) ──
  const prevMain = prev ? prev.numbers : [];
  const prevBonus = prev ? prev.bonus : null;
  const flow = older.length >= 10 ? buildFlowSignals(older) : null;
  const gapInfo = older.length >= 10 ? buildGapInfo(older) : null;
  const relationOf = (n: number): Relation => {
    if (!prev) return 'none';
    if (prevMain.includes(n)) return 'carry';
    if (prevBonus === n) return 'prevBonus';
    if (prevMain.includes(n - 1) || prevMain.includes(n + 1)) return 'neighbor';
    return 'new';
  };
  const mainCount = (n: number) => {
    let c = 0;
    for (let i = idx; i < results.length; i++) if (results[i].numbers.includes(n)) c++;
    return c;
  };
  const expected = ((results.length - idx) * 6) / 45;
  const detailOf = (n: number, isBonus: boolean): NumberDetail => {
    let waited: number | null = null;
    for (let j = 0; j < older.length; j++) {
      if (older[j].numbers.includes(n) || older[j].bonus === n) { waited = j; break; }
    }
    const avg = gapInfo ? gapInfo[n].avgGap : null;
    return {
      n, isBonus, relation: relationOf(n),
      waited,
      avgGap: avg,
      overdue: waited !== null && avg ? waited / avg : null,
      trend: flow ? flow.trends[n] : null,
      count: mainCount(n),
      expected,
      fusedRank: retro ? retro.fusedRanks[n] : null,
    };
  };
  const numberDetails = [...nums.map(n => detailOf(n, false)), detailOf(draw.bonus, true)];

  // ── ④ 당시 Top6 회고 ──
  let retroSummary: RetroSummary | null = null;
  if (retro) {
    const mean = (ranks: number[]) => nums.reduce((s, n) => s + ranks[n], 0) / 6;
    retroSummary = {
      picks: retro.picks, hits: retro.hits, hitNumbers: retro.hitNumbers,
      unified: retro.unified, unifiedHits: retro.unifiedHits,
      fusedMeanRank: mean(retro.fusedRanks), unifiedMeanRank: mean(retro.unifiedRanks),
    };
  }

  // ── ⑤ 함께 나온 쌍 (이 회차는 제외하고 센다 — 자기 자신을 세면 항상 1 이상으로 부풀려짐) ──
  const pairBasis = results.length - 1;
  const pairP = 1 / 66;                                   // 6·5 / (45·44)
  const pairExpected = pairBasis * pairP;
  const pairSd = Math.sqrt(pairBasis * pairP * (1 - pairP));
  const pairs: PairStat[] = [];
  for (let i = 0; i < nums.length; i++) {
    for (let j = i + 1; j < nums.length; j++) {
      let c = 0;
      for (let k = 0; k < results.length; k++) {
        if (k === idx) continue;
        const r = results[k].numbers;
        if (r.includes(nums[i]) && r.includes(nums[j])) c++;
      }
      pairs.push({ pair: [nums[i], nums[j]], count: c, expected: pairExpected, z: pairSd > 0 ? (c - pairExpected) / pairSd : 0 });
    }
  }
  pairs.sort((a, b) => b.count - a.count || a.pair[0] - b.pair[0] || a.pair[1] - b.pair[1]);

  // ── 눈에 띄는 점 (사실만 서술 — 해석·예측 문구 없음) ──
  const highlights: Highlight[] = [];
  if (!meta.passAll) {
    highlights.push({ tone: 'bad', text: `필터 탈락: ${meta.failed.join(' · ')} — 이 구조는 필터 후보 풀에 들어가지 않습니다.` });
  } else {
    highlights.push({ tone: 'ok', text: `필터 5종 모두 통과 — 전체 조합의 ${pct1(FILTER_SPACE_PASS)}가 속한 후보 풀에 포함되는 구조입니다.` });
  }
  if (![...filterRows, ...refRows].some(r => r.tag.level === 'rare')) {
    highlights.push({ tone: 'ok', text: '드문 구조 없음 — 필터 5종·참고 지표 모두 균등 추첨에서 5% 이상 나오는 범위입니다.' });
  }
  [...filterRows, ...refRows].forEach(r => {
    if (r.tag.level === 'rare') {
      const src = r.theory !== null ? '균등 추첨 기준' : '역대';
      const pv = r.theory !== null ? r.theory : r.hist;
      const t = r.mode === 'cumulative' ? `${src} ${pv <= 0.5 ? '하위' : '상위'} ${pct1(Math.min(pv, 1 - pv))}` : `${src} ${pct1(pv)}`;
      highlights.push({ tone: 'warn', text: `${r.label} ${r.value}${r.sub && r.key !== 'ratio' && r.key !== 'ac' ? ` (${r.sub})` : ''} — ${t}로 드문 구조` });
    }
  });
  numberDetails.forEach(d => {
    if (!d.isBonus && d.waited !== null && d.overdue !== null && d.waited >= 10 && d.overdue >= 2) {
      highlights.push({ tone: 'info', text: `${d.n}번: ${d.waited}회 쉬고 출현 (평균 간격 ${d.avgGap}회의 ${d.overdue.toFixed(1)}배)` });
    }
    if (!d.isBonus && d.waited === null) highlights.push({ tone: 'info', text: `${d.n}번: 이 데이터에서 처음 나온 번호` });
  });

  return {
    round: draw.round, date: draw.date, numbers: nums, bonus: draw.bonus,
    prevRound: prev ? prev.round : null, prevNumbers: prevMain, prevBonus,
    draws: N, meta, filterRows, refRows, passAll: meta.passAll,
    passRateHist: N > 0 ? profile.passed / N : 0, passRateTheory: FILTER_SPACE_PASS,
    highlights: highlights.slice(0, 5),
    numberDetails, pairs: pairs.slice(0, 5), pairBasis, pairSd, retro: retroSummary,
  };
}
