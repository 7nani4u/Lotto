// verify_pool_ts.mjs — 경로 A 필터 통과 풀(buildFilteredPool/computePoolTop/selectFromPool) 검증
// 사용:  node audit/verify_pool_ts.mjs <python_output.txt> [draws.txt]
//   python_output.txt : generate_lotto_combinations.py 가 만든 lotto_combinations.txt (LF, 18B/행)
//   draws.txt         : (선택) 과거 당첨번호 — generateQuantumFlux 종단 점검용
// 검증 항목
//   1) 풀이 파이썬 출력과 바이트 단위(행·순서·값)로 동일한가 / 개수 6,657,176
//   2) 비동기 빌더가 동기 빌더와 동일한가 (화면 양보 횟수 포함)
//   3) 상위 5 % 경계(k·경계 점수/인덱스·소속 여부)가 "전체 정렬 기준 구현"과 모든 조합에서 일치하는가
//      (무작위 가중치·고정 번호·완전 동점·다수 동점·부적격 입력)
//   4) generateQuantumFlux 종단: 반환 조합이 필터를 통과하고 고정 번호를 포함하는가 + 호출당 시간
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));

const [pyOut, drawsFile] = process.argv.slice(2);
if (!pyOut) { console.error('usage: node audit/verify_pool_ts.mjs <python_output.txt> [draws.txt]'); process.exit(2); }

// 실제 서비스 파일을 그대로 번들 (formulas 등 의존 포함)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lotto-pool-'));
const outfile = path.join(tmp, 'service.mjs');
await esbuild.build({
  entryPoints: [path.join(ROOT, 'services', 'lottoService.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'error',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const S = await import(pathToFileURL(outfile).href);

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

// ── 1) 풀 == 파이썬 출력 ──────────────────────────────────────────────────────
let t0 = performance.now();
const pool = S.buildFilteredPool();
const buildMs = performance.now() - t0;
console.log(`[풀 생성] 동기 ${buildMs.toFixed(0)} ms · ${pool.count.toLocaleString()}개 · ${(pool.rows.byteLength / 1048576).toFixed(1)} MiB`);
check(pool.count === 6657176, `풀 개수 = 6,657,176 (실제 ${pool.count.toLocaleString()})`);

const raw = fs.readFileSync(pyOut);
check(raw.length === pool.count * 18, `파이썬 출력 크기 = 풀 행수 × 18B (${raw.length.toLocaleString()} B)`);
let diff = 0;
for (let i = 0; i < pool.count && diff < 5; i++) {
  const base = i * 18;
  for (let j = 0; j < 6; j++) {
    const v = (raw[base + 3 * j] - 48) * 10 + (raw[base + 3 * j + 1] - 48);
    if (v !== pool.rows[i * 6 + j]) { diff++; console.log('  불일치 행', i, j, v, pool.rows[i * 6 + j]); break; }
  }
}
check(diff === 0, '풀의 모든 행·순서·값이 파이썬 출력과 동일');

// ── 2) 비동기 빌더 ────────────────────────────────────────────────────────────
let yields = 0;
t0 = performance.now();
const poolAsync = await S.buildFilteredPoolAsync(() => { yields++; });
const asyncMs = performance.now() - t0;
let same = poolAsync.count === pool.count;
if (same) for (let i = 0; i < pool.rows.length; i++) if (pool.rows[i] !== poolAsync.rows[i]) { same = false; break; }
console.log(`[풀 생성] 비동기 ${asyncMs.toFixed(0)} ms · 진행 콜백 ${yields}회`);
check(same, '비동기 풀 == 동기 풀');

// ── 3) 상위 5 % 경계 검증 ─────────────────────────────────────────────────────
let seed = 20261121;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

function reference(weights, fixed) {
  // 기존 구현과 같은 방식: 조합별 reduce 합 → (점수 내림차순, 인덱스 오름차순) 정렬 → 상위 max(1, floor(n*0.05))
  const fixedList = [...new Set(fixed)];
  const idx = [];
  const sc = new Float64Array(pool.count);
  for (let i = 0; i < pool.count; i++) {
    const c = Array.from(pool.rows.subarray(i * 6, i * 6 + 6));
    if (fixedList.length && !fixedList.every(n => c.includes(n))) { sc[i] = -Infinity; continue; }
    sc[i] = c.reduce((s, n) => s + (weights[n - 1] ?? 0), 0);
    idx.push(i);
  }
  const order = Int32Array.from(idx);
  order.sort((x, y) => (sc[y] - sc[x]) || (x - y));
  const k = Math.max(1, Math.floor(order.length * 0.05));
  const top = new Uint8Array(pool.count);
  for (let r = 0; r < Math.min(k, order.length); r++) top[order[r]] = 1;
  return { eligible: order.length, k, top, order };
}

function testCase(label, weights, fixed) {
  const t = performance.now();
  const info = S.computePoolTop(pool, weights, fixed);
  const ms = performance.now() - t;
  const ref = reference(weights, fixed);
  if (ref.eligible === 0) { check(info === null, `${label}: 적격 조합 0 → null`); return; }
  let bad = 0;
  for (let i = 0; i < pool.count; i++) if ((S.isInPoolTop(info, i) ? 1 : 0) !== ref.top[i]) { bad++; if (bad > 3) break; }
  check(info.eligible === ref.eligible && info.k === ref.k && bad === 0,
    `${label}: 적격 ${info.eligible.toLocaleString()} · k=${info.k.toLocaleString()} · 소속 불일치 ${bad} · computePoolTop ${ms.toFixed(0)} ms`);
  // 선택 함수: u→0, u→1 이 상위 풀에 속하는지, 중간값도 소속인지
  for (const u of [0, 0.25, 0.5, 0.999999, rnd(), rnd()]) {
    const p = S.selectFromPool(pool, weights, fixed, () => u);
    let ok = !!p && p.combo.length === 6;
    if (ok) {
      // 풀 인덱스 역탐색은 비싸므로 점수로 소속 확인
      const sc = p.combo.reduce((s, n) => s + (weights[n - 1] ?? 0), 0);
      ok = sc > info.cutScore || sc === info.cutScore;                         // 경계 이상
      if (fixed.length) ok = ok && [...new Set(fixed)].every(n => p.combo.includes(n));
    }
    if (!ok) check(false, `${label}: selectFromPool(u=${u}) 결과가 상위 풀 조건 위반`);
  }
}

const randW = () => Array.from({ length: 45 }, () => 0.5 + rnd());
testCase('무작위 가중치', randW(), []);
testCase('무작위 + 고정 [7]', randW(), [7]);
testCase('무작위 + 고정 [1,2,45]', randW(), [1, 2, 45]);
testCase('완전 동점(전부 1)', Array(45).fill(1), []);
testCase('다수 동점(정수 1~3)', Array.from({ length: 45 }, () => 1 + Math.floor(rnd() * 3)), []);
testCase('고정 [0] (범위 밖) → null', randW(), [0]);
testCase('고정 [1,2,3,4,5] (적격 0) → null', randW(), [1, 2, 3, 4, 5]);

// ── 4) generateQuantumFlux 종단 ───────────────────────────────────────────────
if (drawsFile && fs.existsSync(drawsFile)) {
  const lines = fs.readFileSync(drawsFile, 'utf8').split(/\r?\n/).filter(l => l.trim());
  const results = lines.map((l, i) => ({
    round: lines.length - i + 261, date: '', numbers: l.trim().split(/\s+/).map(Number),
    bonus: 1 + Math.floor(rnd() * 45),
  }));
  const spec = (nums) => S.isValidAC(nums) && S.isValidSum46(nums) && S.isValidRatio(nums) &&
    S.isValidRangePattern(nums) && S.isValidConsecutive(nums) &&
    nums.reduce((a, b) => a + b, 0) >= 85 && nums.reduce((a, b) => a + b, 0) <= 189;
  for (const fixed of [[], [7], [1, 45]]) {
    let ok = true, times = [], labels = new Set(), picks = new Set();
    for (let r = 0; r < 12; r++) {
      const t = performance.now();
      const res = S.generateQuantumFlux(results, pool, undefined, fixed);
      times.push(performance.now() - t);
      labels.add(res.formulasUsed[0]);
      picks.add(res.numbers.join('-'));
      const n = res.numbers;
      ok = ok && n.length === 6 && new Set(n).size === 6 && n.every((v, i) => v >= 1 && v <= 45 && (i === 0 || v > n[i - 1])) &&
        spec(n) && fixed.every(f => n.includes(f));
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    check(ok, `generateQuantumFlux(pool, 고정=${JSON.stringify(fixed)}) 12회: 모두 정렬·중복 없음·필터 통과·고정 포함 · 평균 ${avg.toFixed(0)} ms · 서로 다른 결과 ${picks.size} · 경로 라벨 ${[...labels].join(' | ')}`);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n실패 ${failures}건` : '\n모든 검증 통과');
process.exit(failures ? 1 : 0);
