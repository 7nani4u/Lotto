// walkforward_rank_eval.mjs — 번호 순위 점수(종합·흐름·융합·통합스택·하위지표)의 워크포워드 예측력 검증
// 사용: node audit/walkforward_rank_eval.mjs <official_history.csv> [testCount=350] [minTrain=600]
//  · CSV 열: draw,date,n1..n6,bonus (오래된 회차부터). 각 타깃 회차는 "그 이전 회차만"으로 점수를 만들고 본번호 6개와 비교.
//  · H0(독립·균등)에서 기대: Top6 적중 0.800개, 당첨 6개의 평균 순위 23.0 (1=최고점). 표준편차는 해석식으로 계산.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
const [csvPath, testArg, minArg] = process.argv.slice(2);
if (!csvPath) { console.error('usage: node audit/walkforward_rank_eval.mjs <csv> [testCount] [minTrain]'); process.exit(2); }
const TEST = Number(testArg ?? 350), MIN_TRAIN = Number(minArg ?? 600);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lotto-wf-'));
const outfile = path.join(tmp, 'service.mjs');
await esbuild.build({ entryPoints: [path.join(ROOT, 'services', 'lottoService.ts')], bundle: true, platform: 'node',
  format: 'esm', outfile, logLevel: 'error',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
const S = await import(pathToFileURL(outfile).href);
const outfile2 = path.join(tmp, 'formulas.mjs');
await esbuild.build({ entryPoints: [path.join(ROOT, 'services', 'formulas', 'index.ts')], bundle: true, platform: 'node',
  format: 'esm', outfile: outfile2, logLevel: 'error' });
const { unifiedQuantumEngine645 } = await import(pathToFileURL(outfile2).href);

const rows = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).slice(1).filter(Boolean).map(l => {
  const p = l.split(','); return { round: +p[0], date: p[1], numbers: p.slice(2, 8).map(Number).sort((a, b) => a - b), bonus: +p[8] };
});
console.log(`회차 ${rows.length}개 (${rows[0].round}~${rows.at(-1).round}), 검증 ${TEST}회, 최소 학습 ${MIN_TRAIN}회`);

const SD_RANK = Math.sqrt(((45 * 45 - 1) / 12) / 6 * (39 / 44));  // 본번호 6개 평균 순위의 H0 표준편차 ≈ 4.99
const rankOf = (score) => {           // score[1..45] → rank[1..45] (1=최고, 동점은 평균순위)
  const idx = Array.from({ length: 45 }, (_, i) => i + 1).sort((a, b) => score[b] - score[a] || a - b);
  const rank = new Array(46).fill(0);
  let i = 0;
  while (i < 45) { let j = i; while (j + 1 < 45 && score[idx[j + 1]] === score[idx[i]]) j++; const r = (i + j) / 2 + 1; for (let k = i; k <= j; k++) rank[idx[k]] = r; i = j + 1; }
  return rank;
};

const acc = {};   // name → {hits:[], meanRank:[]}
const add = (name, score, actual) => {
  const rank = rankOf(score);
  const top = Array.from({ length: 45 }, (_, i) => i + 1).sort((a, b) => score[b] - score[a] || a - b).slice(0, 6);
  const a = (acc[name] ??= { hits: [], rk: [] });
  a.hits.push(top.filter(n => actual.includes(n)).length);
  a.rk.push(actual.reduce((s, n) => s + rank[n], 0) / 6);
};

const t0 = performance.now();
const start = rows.length - TEST;
for (let t = start; t < rows.length; t++) {
  const train = rows.slice(0, t).reverse();            // 최신이 앞
  const actual = rows[t].numbers;
  const table = S.buildFullAnalysisTable(train);
  const flow = S.buildFlowSignals(train);
  const fused = S.buildFusedTable(table, flow, S.FLOW_WEIGHT_DEFAULT);
  const toVec = (f) => { const v = new Array(46).fill(0); for (let n = 1; n <= 45; n++) v[n] = f(n); return v; };
  const T = (n) => table[n - 1];
  add('종합(composite)', toVec(n => T(n).compositeScore), actual);
  add('흐름(flow)', toVec(n => flow.flowScores[n]), actual);
  const fr = new Map(fused.map(r => [r.number, r.fusedScore]));
  add('융합(fused 75/25)', toVec(n => fr.get(n)), actual);
  for (const [k, f] of [['Z', n => T(n).zSubScore], ['BB', n => T(n).bbSubScore], ['RSI', n => T(n).rsiSubScore], ['MA', n => T(n).maSubScore], ['Aroon', n => T(n).aroonSubScore]])
    add(`서브:${k}`, toVec(f), actual);
  add('흐름:연결강도', toVec(n => flow.connectionScores[n]), actual);
  add('흐름:대기초과', toVec(n => Math.min(flow.gapInfo[n].curGap / (flow.gapInfo[n].avgGap || 1), 2)), actual);
  add('흐름:추세', toVec(n => S.FLOW_TREND_SCORES[flow.trends[n]] ?? 50), actual);
  const uni = unifiedQuantumEngine645.predict(train).scores;
  if (uni) { const v = new Array(46).fill(0); uni.forEach(s => { v[s.number] = s.score; }); add('통합스택(5엔진)', v, actual); }
  // 기준선: 장기 빈도(많이 나온 순) / 반대(적게 나온 순) / 최근 52회 빈도 / 무작위
  const cnt = new Array(46).fill(0), cnt52 = new Array(46).fill(0);
  train.forEach((d, i) => d.numbers.forEach(n => { cnt[n]++; if (i < 52) cnt52[n]++; }));
  add('기준:장기빈도(핫)', cnt, actual);
  add('기준:장기빈도(콜드)', cnt.map(v => -v), actual);
  add('기준:최근52 빈도', cnt52, actual);
  add('기준:무작위', toVec(() => Math.random()), actual);
}
console.log(`소요 ${((performance.now() - t0) / 1000).toFixed(1)}s\n`);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
console.log(`${'점수'.padEnd(20)}${'Top6 적중'.padStart(10)}${'(기대 0.800)'.padStart(12)}${'평균순위'.padStart(10)}${'(기대 23.0)'.padStart(12)}${'z'.padStart(8)}${'p(양측)'.padStart(9)}`);
const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const out = [];
for (const [name, a] of Object.entries(acc)) {
  const n = a.hits.length, mr = mean(a.rk), z = (mr - 23) / (SD_RANK / Math.sqrt(n));
  const p = 1 - erf(Math.abs(z) / Math.SQRT2);
  out.push({ name, hit: mean(a.hits), mr, z, p, n });
}
for (const o of out) console.log(`${o.name.padEnd(20)}${o.hit.toFixed(3).padStart(10)}${''.padStart(12)}${o.mr.toFixed(2).padStart(10)}${''.padStart(12)}${o.z.toFixed(2).padStart(8)}${o.p.toFixed(3).padStart(9)}`);
console.log(`\n표준오차: Top6 적중 ≈ ${(0.784 / Math.sqrt(TEST)).toFixed(3)}, 평균순위 ≈ ${(SD_RANK / Math.sqrt(TEST)).toFixed(2)} (n=${TEST}). 순위가 23.0 보다 작을수록 당첨번호를 더 위에 둔 것.`);
console.log(`다중비교(점수 ${out.length}개) 보정 유의수준 ≈ ${(0.05 / out.length).toFixed(4)}`);
// 겹치지 않는 3구간 안정성 (같은 방향·비슷한 크기가 반복되어야 신호로 간주)
const BLK = 3, bs = Math.floor(TEST / BLK);
console.log(`\n구간별 평균순위 (각 ${bs}회, 표준오차 ≈ ${(SD_RANK / Math.sqrt(bs)).toFixed(2)}):`);
for (const nm of ['종합(composite)', '융합(fused 75/25)', '서브:Aroon', '통합스택(5엔진)', '기준:장기빈도(콜드)', '기준:무작위']) {
  const a = acc[nm].rk; const parts = [];
  for (let b = 0; b < BLK; b++) parts.push(mean(a.slice(b * bs, (b + 1) * bs)).toFixed(2));
  console.log(`  ${nm.padEnd(20)} ${parts.join(' | ')}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
