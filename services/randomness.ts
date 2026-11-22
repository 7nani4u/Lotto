import { LottoResult } from '../types';
import { THEORY } from './drawReport';

// ═══════════════════════════════════════════════════════════════════════════════
// 추첨 무작위성 검정 — "어떤 점수도 다음 회차를 13.3% 이상으로 맞힐 수 없다"는 주장의 근거
//
// 번호 점수가 미래를 예측하려면 과거 추첨에 "구조"가 있어야 합니다(번호 편중·직전 회차와의 연관·간격 규칙·합계 쏠림 등).
// 아래 10개 검정은 그 구조를 직접 찾습니다. 모두 "독립·균등 추첨"이라는 가정(H0)에서 정확한 기대값이 정해진 검정이며,
// 하나라도 기각되면(보정 유의수준 α=0.05/10) 그 방향으로 예측 모델을 만들 근거가 생깁니다. 기각이 없으면 정렬 기준을 아무리
// 정교하게 만들어도 번호당 다음 회차 출현 확률은 6/45 = 13.33% 에서 벗어나지 않습니다.
// ═══════════════════════════════════════════════════════════════════════════════

export interface RandomnessTest {
  key: string;
  name: string;          // 검정 이름
  detail: string;        // 무엇을 보는가 (한 줄)
  stat: string;          // 통계량 표기
  p: number;
  rejected: boolean;     // 보정 유의수준에서 H0 기각
}

export interface RandomnessReport {
  draws: number;
  tests: RandomnessTest[];
  alpha: number;         // 0.05 / 검정 수
  rejected: number;
  uncorrectedHits: number; // 보정 없이 p<0.05 인 검정 수 (우연히도 흔함 — 검정이 10개이므로 기대 0.5개)
}

// ── 통계 도구 ─────────────────────────────────────────────────────────────────
function erfc(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : 2 - y;
}
export const normalTwoSided = (z: number) => erfc(Math.abs(z) / Math.SQRT2);

function lgamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, t = x + 5.5;
  t -= (x + 0.5) * Math.log(t);
  let s = 1.000000000190015;
  for (const cj of c) s += cj / ++y;
  return -t + Math.log(2.5066282746310005 * s / x);
}

/** 정규화 상위 불완전 감마 Q(a, x) — χ² 생존함수 계산용 (Numerical Recipes) */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-14) break; }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}

/** χ²(df) 분포의 상위 꼬리 확률 P(X ≥ x) */
export const chiSquareSurvival = (x: number, df: number) => gammaQ(df / 2, x / 2);

/** Wilson 95% 신뢰구간 */
export function wilsonInterval(k: number, n: number): [number, number] {
  if (n <= 0) return [0, 1];
  const p = k / n, z = 1.96, d = 1 + z * z / n, c = p + z * z / (2 * n);
  const w = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - w) / d, (c + w) / d];
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const SD_OVERLAP = Math.sqrt(6 * (6 / 45) * (39 / 45) * (39 / 44));   // 6개 vs 6개 겹침 개수의 표준편차 ≈ 0.784

/** 구간별 관측·기대 개수로 χ² 통계량 (기대 개수가 작은 구간은 호출 측에서 미리 합침) */
function chiFromBins(obs: number[], exp: number[]): number {
  return obs.reduce((s, o, i) => s + (o - exp[i]) ** 2 / exp[i], 0);
}

/**
 * @param results 회차 배열(순서 무관 — 내부에서 오래된 → 최신으로 정렬)
 */
export function runRandomnessBattery(results: LottoResult[]): RandomnessReport | null {
  if (!results || results.length < 100) return null;
  const chrono = [...results].sort((a, b) => a.round - b.round).map(d => ({ ...d, numbers: [...d.numbers].sort((a, b) => a - b) }));
  const T = chrono.length;
  const out: Array<Omit<RandomnessTest, 'rejected'>> = [];

  // 1. 번호 1~45 균등성
  {
    const freq = new Array<number>(46).fill(0);
    chrono.forEach(d => d.numbers.forEach(n => { freq[n]++; }));
    const e = (T * 6) / 45;
    let chi = 0;
    for (let k = 1; k <= 45; k++) chi += (freq[k] - e) ** 2 / e;
    out.push({ key: 'uniform', name: '번호 균등성', detail: '45개 번호의 출현 횟수가 같은 확률로 나왔는가', stat: `χ²(44)=${chi.toFixed(1)}`, p: chiSquareSurvival(chi, 44) });
  }

  // 2. 이월수(직전 회차와 겹치는 개수) 분포
  {
    const obs = new Array<number>(7).fill(0);
    for (let t = 1; t < T; t++) obs[chrono[t].numbers.filter(n => chrono[t - 1].numbers.includes(n)).length]++;
    const N = T - 1;
    const bins = [[0], [1], [2], [3, 4, 5, 6]];
    const o = bins.map(b => b.reduce((s, k) => s + obs[k], 0));
    const e = bins.map(b => N * b.reduce((s, k) => s + THEORY.carry(k), 0));
    const chi = chiFromBins(o, e);
    out.push({ key: 'carry', name: '이월수 분포', detail: '직전 회차 번호가 다시 나오는 개수가 기대 분포와 같은가', stat: `χ²(3)=${chi.toFixed(2)}`, p: chiSquareSurvival(chi, 3) });
  }

  // 3. 1~10회 전 회차와의 겹침 평균
  {
    let worst = { z: 0, k: 1 };
    for (let k = 1; k <= 10; k++) {
      const ov: number[] = [];
      for (let t = k; t < T; t++) ov.push(chrono[t].numbers.filter(n => chrono[t - k].numbers.includes(n)).length);
      const z = (mean(ov) - 0.8) / (SD_OVERLAP / Math.sqrt(ov.length));
      if (Math.abs(z) > Math.abs(worst.z)) worst = { z, k };
    }
    out.push({ key: 'lag', name: '1~10회 전과의 겹침', detail: '몇 회 전이든 번호가 더 자주(덜) 겹치는가 (기대 0.8개)', stat: `최대 |z|=${Math.abs(worst.z).toFixed(2)} (${worst.k}회 전)`, p: Math.min(1, normalTwoSided(worst.z) * 10) });
  }

  // 4·5. 홀짝, 저고 분포
  const dist = (key: string, name: string, detail: string, fn: (d: { numbers: number[] }) => number, th: (k: number) => number) => {
    const obs = new Array<number>(7).fill(0);
    chrono.forEach(d => { obs[fn(d)]++; });
    const bins = [[0, 1], [2], [3], [4], [5, 6]];
    const o = bins.map(b => b.reduce((s, k) => s + obs[k], 0));
    const e = bins.map(b => T * b.reduce((s, k) => s + th(k), 0));
    const chi = chiFromBins(o, e);
    out.push({ key, name, detail, stat: `χ²(4)=${chi.toFixed(2)}`, p: chiSquareSurvival(chi, 4) });
  };
  dist('odd', '홀짝 분포', '홀수 개수가 초기하 분포를 따르는가', d => d.numbers.filter(n => n % 2 === 1).length, THEORY.odd);
  dist('low', '저·고 분포', '저(1~22) 개수가 초기하 분포를 따르는가', d => d.numbers.filter(n => n <= 22).length, THEORY.low);

  // 6. 합계 분포 (정확한 분포의 10분위)
  {
    const sums = chrono.map(d => d.numbers.reduce((a, b) => a + b, 0));
    const edges: number[] = [];
    for (let q = 1; q < 10; q++) { let s = 21; while (THEORY.sumCdf(s) < q / 10) s++; edges.push(s); }
    const prob: number[] = []; let prev = 0;
    edges.forEach(e => { const c = THEORY.sumCdf(e); prob.push(c - prev); prev = c; });
    prob.push(1 - prev);
    const obs = new Array<number>(10).fill(0);
    sums.forEach(s => { let b = edges.findIndex(e => s <= e); if (b < 0) b = 9; obs[b]++; });
    const chi = chiFromBins(obs, prob.map(p => T * p));
    out.push({ key: 'sum', name: '합계 분포', detail: '6개 합계가 정확한 이론 분포(10분위)를 따르는가', stat: `χ²(9)=${chi.toFixed(2)}`, p: chiSquareSurvival(chi, 9) });
  }

  // 7. 연번 쌍 분포
  {
    const obs = new Array<number>(7).fill(0);
    chrono.forEach(d => { let p = 0; for (let i = 0; i < 5; i++) if (d.numbers[i + 1] === d.numbers[i] + 1) p++; obs[p]++; });
    const bins = [[0], [1], [2, 3, 4, 5]];
    const o = bins.map(b => b.reduce((s, k) => s + obs[k], 0));
    const e = bins.map(b => T * b.reduce((s, k) => s + THEORY.adjacent(k), 0));
    const chi = chiFromBins(o, e);
    out.push({ key: 'adjacent', name: '연번 쌍 분포', detail: '이웃한 번호 쌍의 개수가 정확한 이론 분포를 따르는가', stat: `χ²(2)=${chi.toFixed(2)}`, p: chiSquareSurvival(chi, 2) });
  }

  // 8. 합계의 회차 간 자기상관 (1~3회 전)
  {
    const sums = chrono.map(d => d.numbers.reduce((a, b) => a + b, 0));
    const m = mean(sums), v = mean(sums.map(x => (x - m) ** 2));
    let worst = { r: 0, k: 1 };
    for (let k = 1; k <= 3; k++) {
      let c = 0;
      for (let t = k; t < T; t++) c += (sums[t] - m) * (sums[t - k] - m);
      const r = c / (T * v);
      if (Math.abs(r) > Math.abs(worst.r)) worst = { r, k };
    }
    out.push({ key: 'sumAuto', name: '합계 자기상관', detail: '앞 회차의 합계가 큰 날 다음 회차도 큰가 (1~3회 전)', stat: `최대 |r|=${Math.abs(worst.r).toFixed(3)} (${worst.k}회 전)`, p: Math.min(1, normalTwoSided(worst.r * Math.sqrt(T)) * 3) });
  }

  // 9. 번호 쌍 빈도의 산포 (990쌍)
  {
    const pc = new Map<number, number>();
    chrono.forEach(d => {
      const n = d.numbers;
      for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) { const k = n[i] * 46 + n[j]; pc.set(k, (pc.get(k) ?? 0) + 1); }
    });
    const lam = T / 66;
    let x = 0, cnt = 0;
    for (let a = 1; a <= 44; a++) for (let b = a + 1; b <= 45; b++) { x += ((pc.get(a * 46 + b) ?? 0) - lam) ** 2 / lam; cnt++; }
    const z = (x - (cnt - 1)) / Math.sqrt(2 * (cnt - 1));
    out.push({ key: 'pairs', name: '번호 쌍 빈도 산포', detail: '특정 쌍이 유독 자주 함께 나오는가 (990쌍, 정규 근사)', stat: `z=${z.toFixed(2)}`, p: normalTwoSided(z) });
  }

  // 10. 번호별 출현 간격 분포 vs 기하분포
  {
    const gaps: number[] = [];
    for (let n = 1; n <= 45; n++) {
      let last = -1;
      for (let t = 0; t < T; t++) if (chrono[t].numbers.includes(n)) { if (last >= 0) gaps.push(t - last); last = t; }
    }
    const p = 6 / 45, edges = [1, 2, 3, 4, 5, 6, 8, 11, 16, 1e9];
    const o: number[] = [], e: number[] = [];
    for (let b = 0; b < edges.length - 1; b++) {
      const lo = edges[b], hi = edges[b + 1] - 1;
      o.push(gaps.filter(g => g >= lo && g <= hi).length);
      e.push(gaps.length * ((1 - p) ** (lo - 1) - (1 - p) ** Math.min(hi, 400)));
    }
    const chi = chiFromBins(o, e);
    out.push({ key: 'gaps', name: '출현 간격 분포', detail: '번호가 다시 나올 때까지의 간격이 기하분포를 따르는가(오래 쉰 번호가 더 잘 나오는가)', stat: `χ²(8)=${chi.toFixed(2)}`, p: chiSquareSurvival(chi, 8) });
  }

  const alpha = 0.05 / out.length;
  const tests: RandomnessTest[] = out.map(t => ({ ...t, rejected: t.p < alpha }));
  return {
    draws: T, tests, alpha,
    rejected: tests.filter(t => t.rejected).length,
    uncorrectedHits: tests.filter(t => t.p < 0.05).length,
  };
}
