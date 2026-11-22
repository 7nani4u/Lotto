// verify_engine_ts.mjs — 분석 엔진 수정 사항 검증 (안정도 난수·합의 기준·장기대기 기준선·최신회차 추정·워크포워드 증거)
// 사용: node audit/verify_engine_ts.mjs <official_history.csv>   (CSV: draw,date,n1..n6,bonus — 오래된 회차부터)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
const csv = process.argv[2];
if (!csv) { console.error('usage: node audit/verify_engine_ts.mjs <csv>'); process.exit(2); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lotto-eng-'));
const banner = { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" };
const build = async (entry, out) => esbuild.build({ entryPoints: [path.join(ROOT, entry)], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, out), logLevel: 'error', banner });
await build('services/lottoService.ts', 's.mjs');
await build('services/evidence.ts', 'e.mjs');
const S = await import(pathToFileURL(path.join(tmp, 's.mjs')).href);
const E = await import(pathToFileURL(path.join(tmp, 'e.mjs')).href);

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

const rows = fs.readFileSync(csv, 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1).filter(Boolean).map(l => {
  const p = l.split(','); return { round: +p[0], date: p[1], numbers: p.slice(2, 8).map(Number).sort((a, b) => a - b), bonus: +p[8] };
});
const results = rows.slice().reverse();     // 최신이 앞

// 1) 난수: 상태 재사용 없이 균등한가
{
  const r = S.seededRandom(917);
  const N = 20000, bins = new Array(10).fill(0); const seen = new Set(); let sum = 0;
  for (let i = 0; i < N; i++) { const v = r(); seen.add(v); sum += v; bins[Math.min(9, Math.floor(v * 10))]++; }
  const chi = bins.reduce((s, c) => s + (c - N / 10) ** 2 / (N / 10), 0);
  check(seen.size === N, `seededRandom ${N}회 모두 서로 다른 값 (기존 LCG: 12,053개)`);
  check(Math.abs(sum / N - 0.5) < 0.01 && chi < 21.67, `seededRandom 균등성: 평균 ${(sum / N).toFixed(4)}, χ²(9)=${chi.toFixed(1)} (<21.67)`);
}

// 2) 안정도: 결정적 + 값 분해능(iters=40)
{
  const a = S.computeStability(results, 40), b = S.computeStability(results, 40);
  const same = JSON.stringify(a) === JSON.stringify(b);
  const distinct = new Set(Object.values(a)).size;
  const top6mass = Object.values(a).reduce((x, y) => x + y, 0);
  check(same, '안정도는 같은 입력에서 항상 같은 값 (결정적)');
  check(Math.abs(top6mass - 6) < 0.15, `안정도 합 ≈ 6 (매 반복 Top6 6개): ${top6mass.toFixed(2)}`);
  console.log(`      안정도 값 종류 ${distinct}개 (iters=40, 값 간격 0.025)`);
}

// 3) 합의: 5개 서브점수 × 상위 12 → 합계 정확히 60, 무작위 기대 1.33
{
  const table = S.buildFullAnalysisTable(results), flow = S.buildFlowSignals(results);
  const fused = S.buildFusedTable(table, flow);
  const sum = fused.reduce((s, r) => s + r.agreement5, 0);
  const dist = [0, 1, 2, 3, 4, 5].map(k => fused.filter(r => r.agreement5 === k).length);
  check(sum === 60, `합의 합계 = 5×12 = 60 (실제 ${sum}), 분포 0~5: ${dist.join('/')}`);
  const oldStyle = [0, 1, 2, 3, 4, 5].map(k => table.filter(t => [t.zSubScore, t.bbSubScore, t.rsiSubScore, t.maSubScore, t.aroonSubScore].filter(v => v >= 65).length === k).length);
  console.log(`      (참고) 기존 '≥65점' 방식 분포 0~5: ${oldStyle.join('/')} — RSI 서브점수 중앙값 ${[...table.map(t => t.rsiSubScore)].sort((x, y) => x - y)[22]}`);
}

// 4) 장기 대기: 같은 크기 기준선과 실측이 일치하는 방향인지 (독립 재계산과 비교)
{
  const rep = S.buildLongAbsentDetails(results, 10, 10);
  const L = results.length; const comb = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; };
  let nullSum = 0, n = 0, sizeSum = 0, hit = 0;
  for (let i = 1; i + 9 < L; i++) {
    const set = [];
    for (let x = 1; x <= 45; x++) { let ab = true; for (let k = 0; k < 10; k++) { const d = results[i + k]; if (d.numbers.includes(x) || d.bonus === x) { ab = false; break; } } if (ab) set.push(x); }
    if (!set.length) continue;
    n++; sizeSum += set.length; nullSum += 1 - comb(45 - set.length, 6) / comb(45, 6);
    if (results[i - 1].numbers.some(x => set.includes(x))) hit++;
  }
  check(Math.abs(rep.empiricalNullRate - nullSum / n) < 1e-3 && Math.abs(rep.empiricalNextRate - hit / n) < 1e-3,
    `장기대기 실측 ${rep.empiricalNextRate} vs 같은 표본 균등가정 ${rep.empiricalNullRate} (독립 재계산 ${(hit / n).toFixed(4)} / ${(nullSum / n).toFixed(4)}), 평균 집합 ${rep.empiricalAvgSetSize}개 · 표시 집합 균등가정 ${rep.nullProbNext} (허위 차이 원인)`);
}

// 5) 한 번도 안 나온 번호의 공백 점수
{
  const syn = Array.from({ length: 40 }, (_, i) => ({ round: 1000 - i, date: '', numbers: [1 + (i % 7), 9 + (i % 5), 17 + (i % 6), 25 + (i % 4), 31 + (i % 3), 38 + (i % 5)].sort((a, b) => a - b), bonus: 2 + (i % 8) }));
  const t = S.buildTechnicalWeights(syn).find(x => x.number === 45);
  check(!syn.some(d => d.numbers.includes(45) || d.bonus === 45) && t.trendScore >= 25, `미출현 번호(45)의 추세 점수 ${t.trendScore} ≥ 25 (공백 가점 25 반영)`);
}

// 6) 최신 회차 추정
{
  const at = (y, m, d, h = 12) => S.estimateLatestRound(Date.UTC(y, m - 1, d, h, 0));
  // 기준: 공식 이력 CSV — 262회 = 2007-12-08, 263회 = 2007-12-15, 1250회 = 2026-11-14 (모두 추첨일 정오 UTC 기준으로 판정)
  check(at(2007, 12, 8) === 262 && at(2007, 12, 15) === 263 && at(2026, 11, 14) === 1250 && at(2026, 11, 21) === 1251 && at(2026, 11, 22) === 1251
      && S.estimateLatestRound(Date.UTC(2002, 11, 7, 12, 0)) === 262 /* START_ROUND 하한 */,
    `estimateLatestRound: 2007-12-08→${at(2007, 12, 8)}, 2007-12-15→${at(2007, 12, 15)}, 2026-11-14→${at(2026, 11, 14)}, 2026-11-21→${at(2026, 11, 21)}, 2026-11-22→${at(2026, 11, 22)}`);
}

// 7) 워크포워드 증거 보고서
{
  const t0 = Date.now();
  const rep = await E.buildEvidenceReport(results, { testRounds: 400, minTrain: 300 });
  const ms = Date.now() - t0;
  check(rep && rep.tests === 400 && rep.scorers.length === 16 && rep.primary.key === 'fused', `증거 보고서 생성 ${ms}ms · 검증 ${rep?.tests}회 · 점수 ${rep?.scorers.length}개`);
  const rnd = rep.scorers.find(s => s.key === 'random');
  console.log(`      ${rep.effectText}`);
  console.log(`      판정: ${rep.verdictLabel} (z=${rep.primary.z.toFixed(2)}, p=${rep.primary.p.toFixed(3)}; 다중검정 보정 α=${rep.alphaBonferroni.toFixed(4)})`);
  console.log(`      구간별 평균순위(융합): ${rep.primary.blocks.map(b => b.toFixed(2)).join(' | ')} · 무작위 기준선 ${rnd.meanRank.toFixed(2)} (z=${rnd.z.toFixed(2)})`);
  console.log(`      세컨드 오피니언 일치 평균 ${rep.overlap.mean.toFixed(2)}개 (무작위 ${rep.overlap.random}) 분포 ${rep.overlap.distribution.join('/')}`);
  console.log(`      균등성 χ²(44)=${rep.uniformity.chi2.toFixed(1)}, p=${rep.uniformity.p.toFixed(3)} (${rep.uniformity.draws}회)`);
  console.log('      최근 10회 회고 적중(융합 Top6):', rep.recent.map(r => `${r.round}:${r.hits}`).join(' '));
  const sig = rep.scorers.filter(s => s.p < rep.alphaBonferroni);
  check(sig.length === 0 || sig.every(s => s.z < 0), `다중검정 보정(α=${rep.alphaBonferroni.toFixed(4)}) 후 유의한 점수: ${sig.length === 0 ? '없음' : sig.map(s => s.label).join(', ')}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n실패 ${failures}건` : '\n모든 검증 통과');
process.exit(failures ? 1 : 0);
