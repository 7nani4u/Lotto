// verify_report_ts.mjs — "당첨 번호 분석 리포트"(services/drawReport.ts) 검증
//   ① 균등 이론 분포(홀짝·저고·연번·이월·번대 최대·합계)를 8,145,060개 조합 전수 열거와 정확히 대조
//   ② 실제 회차 데이터로 리포트 항목(필터 판정·대기·누적·쌍 횟수·이월)을 독립 계산과 대조
//   ③ 백테스트 회고(순위 배열)와 연결
// 사용: node audit/verify_report_ts.mjs <official_history.csv>   (CSV: draw,date,n1..n6,bonus — 오래된 회차부터)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
const csv = process.argv[2];
if (!csv) { console.error('usage: node audit/verify_report_ts.mjs <csv>'); process.exit(2); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lotto-rep-'));
const banner = { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" };
const build = async (entry, out) => esbuild.build({ entryPoints: [path.join(ROOT, entry)], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, out), logLevel: 'error', banner });
await build('services/drawReport.ts', 'r.mjs');
await build('services/drawMeta.ts', 'm.mjs');
await build('services/evidence.ts', 'e.mjs');
const R = await import(pathToFileURL(path.join(tmp, 'r.mjs')).href);
const M = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);
const E = await import(pathToFileURL(path.join(tmp, 'e.mjs')).href);

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };
const TOTAL = 8145060;

// ── ① 전수 열거 ──
{
  const odd = new Array(7).fill(0), low = new Array(7).fill(0), adj = new Array(7).fill(0), dec = new Array(7).fill(0);
  const sums = new Array(256).fill(0);
  let total = 0;
  const dc = new Int8Array(5);
  for (let a = 1; a <= 40; a++) for (let b = a + 1; b <= 41; b++) for (let c = b + 1; c <= 42; c++)
    for (let d = c + 1; d <= 43; d++) for (let e = d + 1; e <= 44; e++) for (let f = e + 1; f <= 45; f++) {
      total++;
      odd[(a & 1) + (b & 1) + (c & 1) + (d & 1) + (e & 1) + (f & 1)]++;
      low[(a <= 22) + (b <= 22) + (c <= 22) + (d <= 22) + (e <= 22) + (f <= 22)]++;
      adj[(b === a + 1) + (c === b + 1) + (d === c + 1) + (e === d + 1) + (f === e + 1)]++;
      dc.fill(0);
      dc[Math.min(4, (a - 1) / 10 | 0)]++; dc[Math.min(4, (b - 1) / 10 | 0)]++; dc[Math.min(4, (c - 1) / 10 | 0)]++;
      dc[Math.min(4, (d - 1) / 10 | 0)]++; dc[Math.min(4, (e - 1) / 10 | 0)]++; dc[Math.min(4, (f - 1) / 10 | 0)]++;
      dec[Math.max(dc[0], dc[1], dc[2], dc[3], dc[4])]++;
      sums[a + b + c + d + e + f]++;
    }
  check(total === TOTAL, `열거 조합 수 ${total} = C(45,6)`);
  const near = (x, y) => Math.abs(x - y) < 1e-12;
  const eq = (arr, fn, n) => arr.slice(0, n).every((c, k) => near(c / TOTAL, fn(k)));
  check(eq(odd, R.THEORY.odd, 7), '홀짝 이론 분포 = 전수 열거 (k=0..6)');
  check(eq(low, R.THEORY.low, 7), '저·고 이론 분포 = 전수 열거 (k=0..6)');
  check(eq(adj, R.THEORY.adjacent, 6), `연번 이론 분포(연속 덩어리 공식) = 전수 열거: ${adj.slice(0, 6).map(c => (100 * c / TOTAL).toFixed(1)).join('/')}%`);
  check(eq(dec, R.THEORY.maxDecade, 7), `번대 최대 개수 이론 분포 = 전수 열거: ${dec.slice(1, 7).map(c => (100 * c / TOTAL).toFixed(2)).join('/')}%`);
  let cdf = 0, ok = true;
  for (let s = 0; s < 256; s++) { cdf += sums[s]; if (!near(cdf / TOTAL, R.THEORY.sumCdf(s))) ok = false; }
  check(ok, '합계 누적분포 = 전수 열거 (s=0..255)');
  const within = Math.round(R.THEORY.sumBetween(85, 189) * TOTAL);
  check(within === 7496423, `합계 85~189 통과 조합 = ${within} (감사 보고서 7,496,423)`);
  const dec3 = Math.round((R.THEORY.maxDecade(1) + R.THEORY.maxDecade(2) + R.THEORY.maxDecade(3)) * TOTAL);
  check(dec3 === 7605200, `번대별 ≤3 통과 조합 = ${dec3} (감사 보고서 7,605,200)`);
  const carrySum = [0, 1, 2, 3, 4, 5, 6].reduce((s, c) => s + R.THEORY.carry(c), 0);
  check(near(carrySum, 1), `이월수 확률 합 = 1 (${carrySum})`);
  check(near(R.THEORY.carry(1), 6 * 575757 / TOTAL), `이월 1개 확률 = 6·C(39,5)/C(45,6) = ${(100 * R.THEORY.carry(1)).toFixed(2)}%`);
}

// ── ② 실제 데이터 ──
const rows = fs.readFileSync(csv, 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1).filter(Boolean).map(l => {
  const p = l.split(','); return { round: +p[0], date: p[1], numbers: p.slice(2, 8).map(Number).sort((a, b) => a - b), bonus: +p[8] };
});
const results = rows.slice().reverse();     // 최신이 앞
const profile = R.buildHistoryProfile(results);
check(profile.draws === results.length && profile.carryDraws === results.length - 1, `프로필 회차 수 ${profile.draws}, 이월 집계 ${profile.carryDraws}`);
const sumOf = a => a.reduce((x, y) => x + y, 0);
check(sumOf(profile.count.odd) === profile.draws && sumOf(profile.count.low) === profile.draws && sumOf(profile.count.maxDecade) === profile.draws && sumOf(profile.count.ac) === profile.draws,
  '프로필 분포 합 = 회차 수');
check(sumOf(profile.count.carry) === profile.carryDraws, '이월 분포 합 = 회차 수 − 1');
console.log(`      역대 필터 통과 ${profile.passed}/${profile.draws} = ${(100 * profile.passed / profile.draws).toFixed(2)}% (이론 ${(100 * M.FILTER_SPACE_PASS).toFixed(2)}%)`);

// 증거(회고) 준비 — 검증 시간 단축을 위해 최근 400회
const evidence = await E.buildEvidenceReport(results, { testRounds: 400, minTrain: 300, yieldEvery: 1000 });
check(evidence && evidence.recent.length === 10, '백테스트 회고 10건');
const retroBy = new Map(evidence.recent.map(r => [r.round, r]));
check(evidence.recent.every(r => r.fusedRanks.length === 46 && r.unifiedRanks.length === 46), 'RetroPick 순위 배열 길이 46');
check(evidence.recent.every(r => {
  const top = [...Array(45)].map((_, i) => i + 1).filter(n => r.fusedRanks[n] <= 6.5);
  return r.picks.every(n => r.fusedRanks[n] <= 6.5) && top.length >= 6;
}), 'RetroPick: Top6 번호의 융합 순위가 모두 ≤6');

let reportsOk = true;
for (let idx = 0; idx < 10; idx++) {
  const draw = results[idx], prev = results[idx + 1];
  const rep = R.buildDrawReport(results, idx, profile, retroBy.get(draw.round));
  const meta = M.summarizeDraw(draw, prev);
  const problems = [];

  // 필터 판정 일치 (독립 재계산)
  const n = [...draw.numbers].sort((a, b) => a - b);
  const okSum = meta.sum >= 85 && meta.sum <= 189;
  const ratio = (n[3] + n[4] + n[5]) / (n[0] + n[1] + n[2]);
  const okRatio = ratio >= 1.3 && ratio <= 7.5;
  const dcs = [0, 0, 0, 0, 0]; n.forEach(x => dcs[Math.min(4, (x - 1) / 10 | 0)]++);
  const okRange = dcs.every(c => c <= 3);
  let pairs = 0, tri = false; for (let i = 0; i < 5; i++) if (n[i] + 1 === n[i + 1]) { pairs++; if (i < 4 && n[i] + 2 === n[i + 2]) tri = true; }
  const okCons = pairs <= 2 && !tri;
  const diffs = new Set(); for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) diffs.add(n[j] - n[i]);
  const ac = diffs.size - 5, okAc = ac >= 5 && ac <= 10;
  const fr = k => rep.filterRows.find(r => r.key === k);
  if (fr('sum').filter.ok !== okSum) problems.push('합계 판정');
  if (fr('ratio').filter.ok !== okRatio || fr('ratio').value !== ratio.toFixed(2)) problems.push('비율 판정/값');
  if (fr('range').filter.ok !== okRange) problems.push('번대 판정');
  if (fr('cons').filter.ok !== okCons || fr('cons').value !== `${pairs}쌍`) problems.push('연번 판정/값');
  if (fr('ac').filter.ok !== okAc || fr('ac').value !== String(ac)) problems.push('AC 판정/값');
  if (rep.passAll !== (okSum && okRatio && okRange && okCons && okAc)) problems.push('통과 종합');

  // 비율(0~1) 범위와 필수 필드
  for (const row of [...rep.filterRows, ...rep.refRows]) {
    if (!(row.hist >= 0 && row.hist <= 1)) problems.push(`${row.key} hist 범위`);
    if (row.theory !== null && !(row.theory > 0 && row.theory <= 1)) problems.push(`${row.key} theory 범위`);
    if (!row.tag || !row.basis) problems.push(`${row.key} 태그/설명`);
  }
  if (prev && !rep.refRows.some(r => r.key === 'carry')) problems.push('이월 행 누락');
  const carryRow = rep.refRows.find(r => r.key === 'carry');
  if (carryRow && carryRow.value !== `${draw.numbers.filter(x => prev.numbers.includes(x)).length}개`) problems.push('이월 개수');

  // 번호별 상세: 대기·누적 (독립 계산)
  for (const d of rep.numberDetails) {
    let waited = null;
    for (let j = idx + 1; j < results.length; j++) if (results[j].numbers.includes(d.n) || results[j].bonus === d.n) { waited = j - idx - 1; break; }
    if (d.waited !== waited) problems.push(`${d.n} 대기 ${d.waited}≠${waited}`);
    let cnt = 0; for (let j = idx; j < results.length; j++) if (results[j].numbers.includes(d.n)) cnt++;
    if (d.count !== cnt) problems.push(`${d.n} 누적`);
    if (!d.isBonus && d.relation === 'carry' && d.waited !== 0) problems.push(`${d.n} 이월인데 대기≠0`);
    if (d.fusedRank === null) problems.push(`${d.n} 융합순위 없음`);
  }
  if (rep.numberDetails.length !== 7 || !rep.numberDetails[6].isBonus || rep.numberDetails[6].n !== draw.bonus) problems.push('보너스 카드');

  // 쌍: 이 회차 제외 횟수 (독립 계산)
  for (const p of rep.pairs) {
    let c = 0; for (let j = 0; j < results.length; j++) { if (j === idx) continue; const r = results[j].numbers; if (r.includes(p.pair[0]) && r.includes(p.pair[1])) c++; }
    if (c !== p.count) problems.push(`쌍 ${p.pair} ${p.count}≠${c}`);
  }
  if (rep.pairs.length !== 5 || rep.pairs.some((p, i) => i > 0 && p.count > rep.pairs[i - 1].count)) problems.push('쌍 정렬/개수');

  // 회고
  const rt = rep.retro;
  if (!rt) problems.push('회고 없음');
  else {
    const mr = n.reduce((s, x) => s + retroBy.get(draw.round).fusedRanks[x], 0) / 6;
    if (Math.abs(rt.fusedMeanRank - mr) > 1e-9) problems.push('회고 평균순위');
    if (rt.hits !== rt.picks.filter(x => draw.numbers.includes(x)).length) problems.push('회고 적중');
  }
  if (rep.highlights.length < 1 || rep.highlights.length > 5 || rep.highlights.some(h => !h.text || !['ok','bad','warn','info'].includes(h.tone))) problems.push('눈에 띄는 점 개수/형식');
  if (rep.passAll ? rep.highlights[0].tone !== 'ok' : rep.highlights[0].tone !== 'bad') problems.push('첫 항목 톤');

  if (problems.length) { reportsOk = false; console.log(`      제 ${draw.round}회 문제: ${problems.join(', ')}`); }
}
check(reportsOk, '최근 10회 리포트: 필터 판정·값·이월·대기·누적·쌍·회고가 독립 계산과 일치');

// 최신 회차 출력 예시
{
  const rep = R.buildDrawReport(results, 0, profile, retroBy.get(results[0].round));
  console.log(`\n── 제 ${rep.round}회 (${rep.date}) ${rep.numbers.join(' ')} + ${rep.bonus} ──`);
  for (const r of [...rep.filterRows, ...rep.refRows]) {
    console.log(`  ${r.label.padEnd(16)} ${r.value.padEnd(10)} ${r.filter ? (r.filter.ok ? '✓' : '✗') : ' '} 균등 ${r.theory === null ? '─' : (100 * r.theory).toFixed(1) + '%'} · 역대 ${(100 * r.hist).toFixed(1)}%  [${r.tag.text}]`);
  }
  console.log('  눈에 띄는 점:'); rep.highlights.forEach(h => console.log(`   - [${h.tone}] ${h.text}`));
  console.log('  번호별:'); rep.numberDetails.forEach(d => console.log(`   ${String(d.n).padStart(2)}${d.isBonus ? '(B)' : '   '} ${d.relation.padEnd(9)} 대기 ${d.waited === null ? '첫' : d.waited}회/평균 ${d.avgGap} 추세 ${d.trend} 누적 ${d.count}(균등 ${d.expected.toFixed(0)}) 융합 ${d.fusedRank}위`));
  console.log('  쌍 Top:', rep.pairs.map(p => `${p.pair.join('+')}:${p.count}(기대 ${p.expected.toFixed(1)}, z ${p.z.toFixed(1)})`).join('  '));
  if (rep.retro) console.log(`  회고: 융합 ${rep.retro.picks.join(',')} 적중 ${rep.retro.hits} 평균 ${rep.retro.fusedMeanRank.toFixed(1)}위 / 독립 ${rep.retro.unifiedHits} 평균 ${rep.retro.unifiedMeanRank.toFixed(1)}위`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? '\n모든 검증 통과' : `\n실패 ${failures}건`);
process.exit(failures === 0 ? 0 : 1);
