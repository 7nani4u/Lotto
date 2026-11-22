// verify_filters_ts.mjs — TypeScript passesPythonFilters 수정 전·후 전수 동등성 + 속도 검증
// 사용:  node audit/verify_filters_ts.mjs <before.ts> <after.ts>
//   예)  node audit/verify_filters_ts.mjs services/lottoService.before_audit_20261121.ts services/lottoService.ts
// 동작: 두 TS 파일에서 필터 영역(isValid* · ADVANCED_SUM_* · passesPythonFilters*)만 추출 → typescript 로 트랜스파일 →
//       C(45,6)=8,145,060 전체 조합과 비정상 입력(비정렬·중복·범위 밖·길이 불일치)에서 두 구현의 판정을 비교.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const ts = require(path.join(ROOT, 'node_modules', 'typescript'));

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a0 = src.indexOf('// 3. ADVANCED FILTERING');
  const a1 = src.indexOf('// 4. MATH ENGINE');
  const b0 = src.indexOf('const ADVANCED_SUM_MIN');
  const b1 = src.indexOf('function generateFallbackNumbers');
  if ([a0, a1, b0, b1].some(i => i < 0)) throw new Error(`${file}: 필터 영역 마커를 찾지 못했습니다`);
  // 3. 섹션은 'export function' 이므로 export 를 유지한 채 트랜스파일, passesPythonFilters 는 별도 export
  const body = src.slice(a0, a1) + '\n' + src.slice(b0, b1) +
    '\nexport { passesPythonFilters };\n';
  const js = ts.transpileModule(body, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('exports', js)(exports);
  return exports;
}

const [beforeFile, afterFile] = process.argv.slice(2);
if (!beforeFile || !afterFile) {
  console.error('usage: node audit/verify_filters_ts.mjs <before.ts> <after.ts>');
  process.exit(2);
}
const B = load(path.resolve(beforeFile));
const A = load(path.resolve(afterFile));

function timeAll(fn) {
  let pass = 0, n = 0;
  const t0 = performance.now();
  for (let a = 1; a <= 40; a++)
    for (let b = a + 1; b <= 41; b++)
      for (let c = b + 1; c <= 42; c++)
        for (let d = c + 1; d <= 43; d++)
          for (let e = d + 1; e <= 44; e++)
            for (let f = e + 1; f <= 45; f++) {
              n++;
              if (fn([a, b, c, d, e, f])) pass++;
            }
  return { n, pass, ms: performance.now() - t0 };
}

// 1) 속도 (배열 생성 비용은 양쪽 동일)
const tb = timeAll(B.passesPythonFilters);
const ta = timeAll(A.passesPythonFilters);
console.log(`[속도]  before: pass=${tb.pass.toLocaleString()} / ${tb.n.toLocaleString()}  ${(tb.ms / 1000).toFixed(1)}s  (${(tb.ms * 1000 / tb.n).toFixed(3)} µs/조합)`);
console.log(`[속도]  after : pass=${ta.pass.toLocaleString()} / ${ta.n.toLocaleString()}  ${(ta.ms / 1000).toFixed(1)}s  (${(ta.ms * 1000 / ta.n).toFixed(3)} µs/조합)  → ${(tb.ms / ta.ms).toFixed(2)}배`);

// 2) 전수 판정 비교 + 필터별 통과 수(명세 함수)
let mismatch = 0, n = 0, firstBad = null;
const per = { AC: 0, S46: 0, RATIO: 0, RANGE: 0, CONS: 0 };
for (let a = 1; a <= 40; a++)
  for (let b = a + 1; b <= 41; b++)
    for (let c = b + 1; c <= 42; c++)
      for (let d = c + 1; d <= 43; d++)
        for (let e = d + 1; e <= 44; e++)
          for (let f = e + 1; f <= 45; f++) {
            const x = [a, b, c, d, e, f];
            n++;
            if (B.passesPythonFilters(x) !== A.passesPythonFilters(x)) {
              mismatch++;
              if (!firstBad) firstBad = x.slice();
            }
            if (B.isValidAC(x)) per.AC++;
            if (B.isValidSum46(x)) per.S46++;
            if (B.isValidRatio(x)) per.RATIO++;
            if (B.isValidRangePattern(x)) per.RANGE++;
            if (B.isValidConsecutive(x)) per.CONS++;
          }
console.log(`[전수 동등성] 검사 ${n.toLocaleString()}개 · 불일치 ${mismatch}개 ${firstBad ? '예: ' + JSON.stringify(firstBad) : ''}`);
console.log(`[TS 단독 통과 수] AC=${per.AC.toLocaleString()} Sum46=${per.S46.toLocaleString()} 비율=${per.RATIO.toLocaleString()} 번대별=${per.RANGE.toLocaleString()} 연속=${per.CONS.toLocaleString()}`);

// 3) 비정상 입력 비교 (결정적 의사난수): 비정렬·중복·범위 밖·길이 불일치
let s = 123456789;
const rnd = (m) => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s % m; };
let weird = 0, weirdBad = 0;
const kinds = { unsorted: 0, dup: 0, out_of_range: 0, len5: 0, len7: 0 };
for (let i = 0; i < 400000; i++) {
  const kind = i % 5;
  let x;
  if (kind === 0) { const set = new Set(); while (set.size < 6) set.add(1 + rnd(45)); x = [...set]; for (let k = 5; k > 0; k--) { const j = rnd(k + 1); [x[k], x[j]] = [x[j], x[k]]; } kinds.unsorted++; }
  else if (kind === 1) { x = Array.from({ length: 6 }, () => 1 + rnd(12)); kinds.dup++; }          // 중복 다수
  else if (kind === 2) { x = Array.from({ length: 6 }, () => rnd(60) - 5); kinds.out_of_range++; }   // 범위 밖 포함
  else if (kind === 3) { const set = new Set(); while (set.size < 5) set.add(1 + rnd(45)); x = [...set].sort((p, q) => p - q); kinds.len5++; }
  else { const set = new Set(); while (set.size < 7) set.add(1 + rnd(45)); x = [...set].sort((p, q) => p - q); kinds.len7++; }
  weird++;
  if (B.passesPythonFilters(x) !== A.passesPythonFilters(x)) {
    weirdBad++;
    if (weirdBad <= 3) console.log('  비정상 입력 불일치 예:', JSON.stringify(x));
  }
}
console.log(`[비정상 입력] ${weird.toLocaleString()}건 (${JSON.stringify(kinds)}) · 불일치 ${weirdBad}건`);
process.exit(mismatch || weirdBad ? 1 : 0);
