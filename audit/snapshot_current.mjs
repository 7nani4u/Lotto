// snapshot_current.mjs — 실제 데이터로 화면 5개 섹션이 보여주는 값을 그대로 재현해 이상 징후를 점검
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createRequire } from 'node:module'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lotto-snap-'));
const o1 = path.join(tmp, 's.mjs'), o2 = path.join(tmp, 'f.mjs');
const banner = { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" };
await esbuild.build({ entryPoints: [path.join(ROOT, 'services', 'lottoService.ts')], bundle: true, platform: 'node', format: 'esm', outfile: o1, logLevel: 'error', banner });
await esbuild.build({ entryPoints: [path.join(ROOT, 'services', 'formulas', 'index.ts')], bundle: true, platform: 'node', format: 'esm', outfile: o2, logLevel: 'error' });
const S = await import(pathToFileURL(o1).href); const { unifiedQuantumEngine645: U } = await import(pathToFileURL(o2).href);
const rows = fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).slice(1).filter(Boolean).map(l => { const p = l.split(','); return { round: +p[0], date: p[1], numbers: p.slice(2, 8).map(Number).sort((a, b) => a - b), bonus: +p[8] }; });
const results = rows.slice().reverse();        // 최신이 앞
const t0 = Date.now();
const table = S.buildFullAnalysisTable(results); const flow = S.buildFlowSignals(results);
const stab = S.computeStability(results, 10, S.FLOW_WEIGHT_DEFAULT);
const fused = S.buildFusedTable(table, flow, S.FLOW_WEIGHT_DEFAULT, stab);
const so = S.secondOpinion645(results, table, flow);
console.log(`계산 ${Date.now() - t0}ms`);
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) * p)]; };
const stat = (name, a) => console.log(`${name.padEnd(10)} min ${Math.min(...a).toFixed(1)}  p25 ${q(a, .25).toFixed(1)}  med ${q(a, .5).toFixed(1)}  p75 ${q(a, .75).toFixed(1)}  max ${Math.max(...a).toFixed(1)}`);
console.log('── 점수 분포 (UI 색 기준: 융합 ≥65 초록, ≥50 노랑, ≥35 회색, 그 외 파랑 / 서브바 ≥65 초록)');
stat('종합', table.map(t => t.compositeScore)); stat('융합', fused.map(r => r.fusedScore));
for (const k of ['zSubScore', 'bbSubScore', 'rsiSubScore', 'maSubScore', 'aroonSubScore']) stat(k.replace('SubScore', ''), table.map(t => t[k]));
console.log('합의(≥65) 분포:', [0, 1, 2, 3, 4, 5].map(k => `${k}:${fused.filter(r => r.agreement5 === k).length}`).join(' '));
console.log('융합 ≥65 개수:', fused.filter(r => r.fusedScore >= 65).length, ' ≥50 개수:', fused.filter(r => r.fusedScore >= 50).length);
console.log('── 융합 Top8'); fused.slice(0, 8).forEach(r => console.log(`  #${r.fusedRank} ${String(r.number).padStart(2)}번 융합 ${r.fusedScore} 종합 ${r.compositeScore}(${r.ensRank}위) 합의 ${r.agreement5}/5 안정 ${r.stability} ${r.tier}${r.contested ? ' 분열' : ''}`));
console.log('6위-7위 격차:', (fused[5].fusedScore - fused[6].fusedScore).toFixed(2));
console.log('── 세컨드 오피니언:', JSON.stringify(so));
const stabVals = Object.values(stab); console.log('안정도 값 분포:', [...new Set(stabVals)].sort().join(','));
console.log('── 추세 분포:', ['급등', '상승', '안정', '하락', '급락'].map(t => `${t}:${Object.values(flow.trends).filter(x => x === t).length}`).join(' '));
const rep = S.buildLongAbsentDetails(results, 10, 10);
console.log('── 장기대기: 집합 크기', rep.setSize, '균등가정', rep.nullProbNext, '실측', rep.empiricalNextRate, '표본', rep.empiricalSamples);
// 실측 집합 크기 분포 (비교가 같은 크기로 이뤄지는지)
const L = results.length; const sizes = [];
for (let i = 1; i + 9 < L; i++) { let c = 0; for (let n = 1; n <= 45; n++) { let ab = true; for (let k = 0; k < 10; k++) { const d = results[i + k]; if (d.numbers.includes(n) || d.bonus === n) { ab = false; break; } } if (ab) c++; } sizes.push(c); }
const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
const comb = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; };
const nullMean = sizes.filter(s => s > 0).reduce((a, s) => a + (1 - comb(45 - s, 6) / comb(45, 6)), 0) / sizes.filter(s => s > 0).length;
console.log(`  과거 집합 평균 크기 ${avgSize.toFixed(2)} (현재 표시 집합 ${rep.setSize}) → 같은 표본의 균등가정 평균 ${nullMean.toFixed(4)} vs 화면의 균등가정 ${rep.nullProbNext}`);
console.log('  현재 세부:', rep.details.map(d => `${d.number}번 ${d.curGap}회 ${d.overdueRatio}x ${d.grade}`).join(' | '));
// 세컨드 오피니언 일치도의 과거 분포 (무작위 기대 0.8)
const ov = [];
for (let t = rows.length - 200; t < rows.length; t++) { const tr = rows.slice(0, t).reverse(); const tb = S.buildFullAnalysisTable(tr), fl = S.buildFlowSignals(tr); const s = S.secondOpinion645(tr, tb, fl); if (s) ov.push(s.overlap); }
console.log('── 세컨드 오피니언 일치 개수 분포(최근 200시점):', [0, 1, 2, 3, 4, 5, 6].map(k => `${k}:${ov.filter(x => x === k).length}`).join(' '), ' 평균', (ov.reduce((a, b) => a + b, 0) / ov.length).toFixed(2), '(무작위 기대 0.80)');
fs.rmSync(tmp, { recursive: true, force: true });
