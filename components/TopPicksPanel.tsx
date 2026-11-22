import React, { useMemo, useState } from 'react';
import { Ball } from './Ball';
import {
  AGREEMENT_TOP_N,
  FullIndicatorAnalysis,
  FusedRow,
  GapDetail,
  SecondOpinion,
} from '../services/lottoService';
import { CalibrationBand, EvidenceReport, StackAccuracy, Verdict } from '../services/evidence';
import { INDICATOR_LABELS, TIER_LABEL, TREND_STYLE, TREND_HINT, heatClass } from './styles';

// ═══════════════════════════════════════════════════════════════════════════════
// 🏆 출현가능성 상위 6개 번호 + 🔀 세컨드 오피니언 + 📋 전체 데이터 테이블
//   읽는 순서: ① 검증 배너(이 점수를 얼마나 믿을 수 있나) → ② Top6 카드 → ③ 1~45 히트맵 → ④ 스택 비교 → ⑤ 전체 표
// ═══════════════════════════════════════════════════════════════════════════════

export interface TopPicksPanelProps {
  fused: FusedRow[];
  table: FullIndicatorAnalysis[];
  trends: Record<number, string> | null;
  gapInfo: Record<number, GapDetail> | null;
  secondOpinion: SecondOpinion | null;
  evidence: EvidenceReport | null;
  evidenceProgress: number;
  dataRounds: number;
  latestRound: number;
  onBallClick: (n: number) => void;
}

const BASE_PROB = (6 / 45) * 100;   // 다음 회차 본번호 6개에 특정 번호가 포함될 기준 확률 13.33 %

// ── 패턴/특징 (표시용 라벨 — 기존 App 로직 그대로) ───────────────────────────────
const patternOf = (item: FullIndicatorAnalysis) => {
  const v = item.signalScore;
  if (v <= -0.5) return { label: '상승', cls: 'text-red-400 bg-red-900/40 border border-red-800/60' };
  if (v >= 0.5) return { label: '하락', cls: 'text-blue-400 bg-blue-900/40 border border-blue-800/60' };
  if (Math.abs(v) <= 0.15) return { label: '유지', cls: 'text-gray-400 bg-gray-700/40 border border-gray-600/50' };
  return { label: '변동', cls: 'text-yellow-400 bg-yellow-900/30 border border-yellow-800/60' };
};

const featureOf = (item: FullIndicatorAnalysis): string => {
  const f: string[] = [];
  if (item.signalScore >= 0.5) f.push('회귀 우세');
  else if (item.signalScore <= -0.5) f.push('과열 우세');
  if (item.zScore < -1.0) f.push('장기 저출현');
  else if (item.zScore > 1.0) f.push('장기 과출현');
  if (item.rsiScore > 0) f.push('RSI 과소');
  else if (item.rsiScore < 0) f.push('RSI 과다');
  if (item.bbScore > 0) f.push('BB 하단');
  else if (item.bbScore < 0) f.push('BB 상단');
  if (item.aroonScore > 0) f.push('장기 공백');
  else if (item.aroonScore < 0) f.push('단기 활성');
  if (item.maScore > 0) f.push('MA 냉각');
  else if (item.maScore < 0) f.push('MA 과열');
  return f.length > 0 ? f.join(' · ') : '평균 범위 내';
};

// ── ① 검증 배너 ──────────────────────────────────────────────────────────────
const VERDICT_STYLE: Record<Verdict, { icon: string; box: string; title: string }> = {
  none: { icon: '⚪', box: 'border-gray-600/60 bg-gray-900/60', title: 'text-gray-200' },
  weak: { icon: '🟡', box: 'border-yellow-700/50 bg-yellow-950/20', title: 'text-yellow-200' },
  edge: { icon: '🟢', box: 'border-emerald-700/50 bg-emerald-950/20', title: 'text-emerald-200' },
  worse: { icon: '🔴', box: 'border-red-700/50 bg-red-950/20', title: 'text-red-200' },
};

const RankGauge: React.FC<{ report: EvidenceReport }> = ({ report }) => {
  // 가로축: 당첨 6개의 평균 순위 (왼쪽 = 당첨번호를 더 위에 둠). 회색 띠 = 무작위일 때 95 % 범위.
  const lo = 21.5, hi = 24.5, W = 300, PAD = 18;
  const x = (v: number) => PAD + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (W - PAD * 2);
  const band = report.seRank * 1.96;
  const p = report.primary;
  const dot = p.z <= -1.96 ? '#34d399' : p.z >= 1.96 ? '#f87171' : '#e5e7eb';
  return (
    <svg viewBox={`0 0 ${W} 54`} className="w-full max-w-[340px] h-auto" role="img"
         aria-label={`당첨 번호 평균 순위 ${p.meanRank.toFixed(2)}위, 무작위 기대 ${report.expectedRank}위`}>
      <rect x={x(report.expectedRank - band)} y={14} width={x(report.expectedRank + band) - x(report.expectedRank - band)} height={14} rx={3} fill="#6b728055" />
      <line x1={x(report.expectedRank)} x2={x(report.expectedRank)} y1={10} y2={32} stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="3 2" />
      <line x1={PAD} x2={W - PAD} y1={21} y2={21} stroke="#4b5563" strokeWidth={1} />
      {p.blocks.map((b, i) => (
        <circle key={i} cx={x(b)} cy={40} r={3} fill="#9ca3af88" stroke="#d1d5db" strokeWidth={0.8}>
          <title>{`시간순 ${i + 1}/3 구간 평균 ${b.toFixed(2)}위`}</title>
        </circle>
      ))}
      <circle cx={x(p.meanRank)} cy={21} r={6} fill={dot} stroke="#111827" strokeWidth={1.5}>
        <title>{`융합 점수: 당첨 번호 평균 ${p.meanRank.toFixed(2)}위`}</title>
      </circle>
      <text x={PAD} y={52} fontSize={8} fill="#9ca3af">← 당첨번호를 위에 둠</text>
      <text x={W - PAD} y={52} fontSize={8} fill="#9ca3af" textAnchor="end">아래에 둠 →</text>
      <text x={x(report.expectedRank)} y={8} fontSize={8} fill="#d1d5db" textAnchor="middle">무작위 {report.expectedRank.toFixed(1)}위</text>
    </svg>
  );
};

const EvidenceBanner: React.FC<{ report: EvidenceReport | null; progress: number }> = ({ report, progress }) => {
  const [open, setOpen] = useState(false);
  if (!report) {
    return (
      <div className="mb-5 rounded-xl border border-gray-700/60 bg-gray-900/60 p-3 text-xs text-gray-400 flex items-center gap-2">
        <span className="inline-block w-3 h-3 rounded-full border-2 border-teal-400 border-t-transparent animate-spin" />
        백테스트 검증 계산 중… {Math.round(progress * 100)}% — 이 점수가 과거에 얼마나 맞았는지 확인하는 중입니다.
      </div>
    );
  }
  const st = VERDICT_STYLE[report.verdict];
  const sigCount = report.scorers.filter(s => s.p < report.alphaBonferroni).length;
  return (
    <div className={`mb-5 rounded-xl border p-3 sm:p-4 ${st.box}`}>
      <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-5">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold text-gray-400 flex items-center gap-1.5"><span>{st.icon}</span> 백테스트 검증</div>
          <div className={`text-sm sm:text-base font-black leading-snug ${st.title}`}>{report.verdictLabel}</div>
          <ul className="mt-1.5 space-y-1 text-[11px] text-gray-300 leading-relaxed">
            <li>당첨 6개 평균 순위 <b className="text-white whitespace-nowrap">{report.primary.meanRank.toFixed(1)}위</b>
              <span className="text-gray-500 whitespace-nowrap"> (무작위 {report.expectedRank.toFixed(1)}위 ±{report.seRank.toFixed(2)})</span></li>
            <li>Top6 평균 적중 <b className="text-white whitespace-nowrap">{report.primary.meanHits.toFixed(2)}개</b>
              <span className="text-gray-500 whitespace-nowrap"> (무작위 {report.expectedHits.toFixed(2)}개 ±{report.seHits.toFixed(2)})</span></li>
          </ul>
          <div className="text-[10px] text-gray-500 mt-1.5 leading-relaxed">
            {report.tests}회({report.firstTestRound}~{report.lastTestRound}회, 학습 {report.minTrain}회 이후 가능한 모든 시점) 워크포워드 — 각 회차를 그 이전 데이터만으로 점수화해 비교 ·
            z {report.primary.z.toFixed(2)} · p {report.primary.p.toFixed(3)} · 점수 {report.scorers.length}개 다중검정 보정(α={report.alphaBonferroni.toFixed(4)}) 후 유의 {sigCount}개
          </div>
          <div className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
            {report.verdict === 'edge'
              ? '과거 구간에서 일관된 우위가 관측되었지만 미래 당첨 확률 상승으로 해석할 수 없고, 6개 전부 맞힐 확률 자체는 여전히 극히 낮습니다.'
              : `아래 순위는 ‘정렬 기준’입니다. 점수 차이는 표본 잡음 범위이며, 모든 번호의 다음 회차 본번호 포함 확률은 동일하게 ${BASE_PROB.toFixed(1)}%(6/45)입니다.`}
          </div>
        </div>
        <div className="flex-shrink-0 flex justify-center"><RankGauge report={report} /></div>
      </div>
      <button onClick={() => setOpen(v => !v)}
              className="mt-2 text-[10px] font-bold text-teal-300 hover:text-teal-200">
        {open ? '▲ 점수별 비교 접기' : `▼ ${report.scorers.length}개 점수·기준선 비교 보기`}
      </button>
      {open && (
        <div className="mt-2">
          {/* 모바일: 점수·적중·순위·z 4열만 (폭 맞춤). sm 이상: p 와 구간별 평균 순위까지 */}
          <table className="w-full text-[11px] table-fixed sm:table-auto">
            <thead>
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="py-1 px-1.5 text-left font-bold w-[46%] sm:w-auto">점수</th>
                <th className="py-1 px-1 font-bold" title="상위 6개 평균 적중 (무작위 0.80)">적중</th>
                <th className="py-1 px-1 font-bold" title="당첨 6개의 평균 순위 (무작위 23.0, 낮을수록 좋음)">순위</th>
                <th className="py-1 px-1 font-bold">z</th>
                <th className="py-1 px-1 font-bold hidden sm:table-cell">p</th>
                <th className="py-1 px-1 font-bold hidden sm:table-cell" title="시간순 3등분 구간별 평균 순위 — 같은 방향이 반복되어야 신호">구간 1·2·3</th>
              </tr>
            </thead>
            <tbody>
              {report.scorers.map(s => (
                <tr key={s.key} className={`border-b border-gray-800/60 ${s.key === 'fused' ? 'bg-teal-950/20 font-bold text-gray-100' : s.kind === 'baseline' ? 'text-gray-500' : 'text-gray-300'}`}>
                  <td className="py-1 px-1.5 text-left leading-tight">{s.label}</td>
                  <td className="py-1 px-1 text-center whitespace-nowrap">{s.meanHits.toFixed(2)}</td>
                  <td className="py-1 px-1 text-center whitespace-nowrap">{s.meanRank.toFixed(2)}</td>
                  <td className={`py-1 px-1 text-center whitespace-nowrap ${s.z <= -1.96 ? 'text-emerald-400' : s.z >= 1.96 ? 'text-red-400' : ''}`}>{s.z.toFixed(2)}</td>
                  <td className="py-1 px-1 text-center whitespace-nowrap hidden sm:table-cell">{s.p.toFixed(3)}</td>
                  <td className="py-1 px-1 text-center whitespace-nowrap hidden sm:table-cell">{s.blocks.map(b => b.toFixed(2)).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[10px] text-gray-500 mt-1.5 leading-relaxed">
            기준선(장기 빈도·무작위)이 같은 표에서 비슷한 값을 내는지 보세요 — 무작위 기준선도 ±{(report.seRank * 1.96).toFixed(2)}위 범위에서 흔들립니다.
            번호 1~45 균등성 χ²(44)={report.uniformity.chi2.toFixed(1)} (p={report.uniformity.p.toFixed(2)}, {report.uniformity.draws}회): 특정 번호가 더 잘 나온다는 근거는 없습니다. 자세한 검증은 아래 ‘세컨드 오피니언’의 정확도 검토를 보세요.
          </div>
        </div>
      )}
    </div>
  );
};

// ── ④-2 예측 정확도 검토 (두 스택 각각) ──────────────────────────────────────────
const VERDICT_CHIP: Record<Verdict, string> = {
  none: 'text-gray-200 bg-gray-800 border-gray-600',
  weak: 'text-yellow-200 bg-yellow-900/30 border-yellow-700/50',
  edge: 'text-emerald-200 bg-emerald-900/30 border-emerald-700/50',
  worse: 'text-red-200 bg-red-900/30 border-red-700/50',
};

const pct1 = (p: number) => `${(p * 100).toFixed(1)}%`;

/** 적중 개수 분포: 관측(막대) vs 무작위 기대(점선) */
const HitBars: React.FC<{ st: StackAccuracy; tests: number; expected: number[] }> = ({ st, tests, expected }) => {
  const bins: Array<{ label: string; obs: number; exp: number }> = [
    { label: '0개', obs: st.hist[0] / tests, exp: expected[0] },
    { label: '1개', obs: st.hist[1] / tests, exp: expected[1] },
    { label: '2개', obs: st.hist[2] / tests, exp: expected[2] },
    { label: '3개+', obs: st.hist.slice(3).reduce((a, b) => a + b, 0) / tests, exp: expected.slice(3).reduce((a, b) => a + b, 0) },
  ];
  const max = Math.max(...bins.flatMap(b => [b.obs, b.exp]), 0.01);
  return (
    <div role="img" aria-label={`적중 개수 분포: ${bins.map(b => `${b.label} ${pct1(b.obs)}(기대 ${pct1(b.exp)})`).join(', ')}`}>
      <div className="grid grid-cols-4 gap-2">
        {bins.map(b => (
          <div key={b.label} className="min-w-0">
            <div className="relative h-12 border-b border-gray-700">
              <div className="absolute bottom-0 inset-x-1 rounded-t bg-indigo-400/80" style={{ height: `${Math.max(2, (b.obs / max) * 100)}%` }} />
              <div className="absolute inset-x-0 border-t-2 border-dashed border-gray-300" style={{ bottom: `${(b.exp / max) * 100}%` }} />
            </div>
            <div className="mt-1 text-center leading-tight">
              <div className="text-[10px] text-gray-300 whitespace-nowrap">{b.label}</div>
              <div className="text-[11px] font-bold text-white whitespace-nowrap">{pct1(b.obs)}</div>
              <div className="text-[9px] text-gray-500 whitespace-nowrap">기대 {pct1(b.exp)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** 순위 구간별 실제 출현율(95% 구간) vs 기준 13.33% */
const CalibRow: React.FC<{ b: CalibrationBand }> = ({ b }) => {
  const x = (v: number) => `${Math.min(100, Math.max(0, (v / 0.2) * 100))}%`;
  const covers = b.lo <= 6 / 45 && 6 / 45 <= b.hi;
  return (
    <div className="grid grid-cols-[3.6rem_1fr] gap-x-2 items-center">
      <span className="text-[10px] text-gray-400 whitespace-nowrap">{b.label}</span>
      <div className="min-w-0">
        <div className="text-[10px] whitespace-nowrap">
          <b className="text-white">{pct1(b.rate)}</b>
          <span className="text-gray-500"> [{(b.lo * 100).toFixed(1)}~{(b.hi * 100).toFixed(1)}]</span>
          <span className={covers ? 'text-gray-500' : 'text-amber-300'}> {covers ? '· 13.3% 포함' : '· 13.3% 밖'}</span>
        </div>
        <div className="relative h-2.5 mt-0.5">
          <div className="absolute inset-x-0 top-1/2 border-t border-gray-700" />
          <div className="absolute top-0 bottom-0 border-l border-dashed border-gray-400" style={{ left: x(6 / 45) }} />
          <div className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded bg-indigo-400/70" style={{ left: x(b.lo), width: `calc(${x(b.hi)} - ${x(b.lo)})` }} />
          <div className="absolute top-1/2 w-2 h-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-100" style={{ left: x(b.rate) }} />
        </div>
      </div>
    </div>
  );
};

const AccuracyReview: React.FC<{ ev: EvidenceReport }> = ({ ev }) => {
  const [fu, un] = ev.stacks;
  const exp3 = ev.hitsExpected.slice(3).reduce((a, b) => a + b, 0);
  const exp4 = ev.hitsExpected.slice(4).reduce((a, b) => a + b, 0);
  const deltas = ev.stacks.map(st => st.scorer.meanHits - ev.expectedHits);
  const maxDelta = Math.max(...deltas.map(Math.abs));
  const rnd = ev.randomness;
  return (
    <div className="mt-4 pt-4 border-t border-indigo-800/40">
      <div className="text-[11px] sm:text-xs font-bold text-indigo-300">🎯 예측 정확도 검토</div>
      <div className="text-[10px] text-indigo-200/70 mt-0.5 leading-relaxed">
        <span className="whitespace-nowrap">매 회차를 그 이전 데이터만으로 예측해 실제 결과와 비교</span>{' '}
        <span className="whitespace-nowrap">· {ev.tests}회 (제 {ev.firstTestRound}~{ev.lastTestRound}회)</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        {ev.stacks.map(st => (
          <div key={st.key} className="rounded-lg border border-indigo-800/40 bg-indigo-950/40 p-3 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <span className="text-[11px] font-bold text-gray-200 whitespace-nowrap">{st.label}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${VERDICT_CHIP[st.verdict]}`}>{st.verdictLabel}</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div className="min-w-0">
                <div className="text-[10px] text-gray-500">평균 적중</div>
                <div className="text-sm font-black text-white whitespace-nowrap">{st.scorer.meanHits.toFixed(2)}개</div>
                <div className="text-[10px] text-gray-500 whitespace-nowrap">무작위 {ev.expectedHits.toFixed(2)}</div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] text-gray-500">3개 이상</div>
                <div className="text-sm font-black text-white whitespace-nowrap">{pct1(st.hit3Rate)}</div>
                <div className="text-[10px] text-gray-500 whitespace-nowrap">무작위 {pct1(exp3)}</div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] text-gray-500">당첨 평균 순위</div>
                <div className="text-sm font-black text-white whitespace-nowrap">{st.scorer.meanRank.toFixed(1)}위</div>
                <div className="text-[10px] text-gray-500 whitespace-nowrap">무작위 {ev.expectedRank.toFixed(1)}</div>
              </div>
            </div>
            <div className="mt-3">
              <div className="text-[10px] text-gray-400 mb-1.5">
                <span className="whitespace-nowrap">Top6 적중 개수 분포</span>{' '}
                <span className="text-gray-600 whitespace-nowrap">(점선 = 무작위 기대)</span>
              </div>
              <HitBars st={st} tests={ev.tests} expected={ev.hitsExpected} />
            </div>
            <div className="mt-2 text-[10px] text-gray-500 leading-relaxed">
              z <span className="whitespace-nowrap">{st.scorer.z.toFixed(2)}</span> · 순위 검정 p <span className="whitespace-nowrap">{st.scorer.p.toFixed(2)}</span> · 분포 일치 p <span className="whitespace-nowrap">{st.histP.toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>

      <ul className="mt-3 space-y-1.5 text-[11px] text-gray-300 leading-relaxed">
        <li className="flex gap-2"><span className="text-indigo-300 flex-shrink-0">•</span>
          <span><b className="text-white">어떤 6개를 골라도 같은 분포</b>입니다: 0개 {pct1(ev.hitsExpected[0])} · 1개 {pct1(ev.hitsExpected[1])} · 2개 {pct1(ev.hitsExpected[2])} · 3개 {pct1(ev.hitsExpected[3])} · 4개 이상 {pct1(exp4)}. 두 스택의 관측 분포는 이 기대와 구분되지 않습니다.</span></li>
        <li className="flex gap-2"><span className="text-indigo-300 flex-shrink-0">•</span>
          <span>이 표본({ev.tests}회)으로 가려낼 수 있는 최소 우위는 <b className="text-white whitespace-nowrap">적중 +{ev.mde.hits.toFixed(2)}개 (+{ev.mde.hitsPct.toFixed(0)}%)</b>입니다.
            관측된 차이(최대 {maxDelta.toFixed(2)}개)는 이보다 {maxDelta < ev.mde.hits ? '작아 우연과 구분되지 않고' : '크지만 보정 검정을 함께 보세요'}, +5%를 가려내려면 약 {ev.mde.testsFor5pct.toLocaleString()}회가 필요해 지금 데이터로는 불가능합니다.</span></li>
        {rnd && (
          <li className="flex gap-2"><span className="text-indigo-300 flex-shrink-0">•</span>
            <span>추첨이 독립·균등인지 <b className="text-white whitespace-nowrap">{rnd.tests.length}개 검정 중 기각 {rnd.rejected}개</b> (보정 α={rnd.alpha.toFixed(3)}) — 점수가 맞힐 수 있는 ‘구조’가 {rnd.draws}회 데이터에서 발견되지 않았습니다.</span></li>
        )}
      </ul>

      <details className="mt-3 text-[10px] text-gray-500">
        <summary className="cursor-pointer text-indigo-300 font-bold">구간별 실제 출현율(보정)과 무작위성 검정 자세히</summary>
        <div className="mt-2 text-gray-400 leading-relaxed">
          순위 구간에 속한 번호가 다음 회차 본번호에 실제로 포함된 비율입니다. 점수가 쓸모 있다면 ‘상위 6’이 기준선(점선, 6/45=13.3%)보다 높고 ‘25~45위’가 낮아야 합니다.
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
          {[fu, un].map(st => (
            <div key={st.key} className="rounded-lg border border-gray-700/60 bg-gray-900/40 p-3 space-y-2">
              <div className="text-[10px] font-bold text-gray-300">{st.label}</div>
              {st.calibration.map(b => <CalibRow key={b.label} b={b} />)}
            </div>
          ))}
        </div>
        {rnd && (
          <div className="mt-3 rounded-lg border border-gray-700/60 bg-gray-900/40 p-3">
            <div className="text-[10px] font-bold text-gray-300 mb-1.5">추첨 무작위성 검정 {rnd.tests.length}개 <span className="font-normal text-gray-500">(기각 기준 p&lt;{rnd.alpha.toFixed(3)}, 보정 없이 p&lt;0.05: {rnd.uncorrectedHits}개 — 검정이 10개면 우연히 0.5개는 기대)</span></div>
            <ul className="space-y-1">
              {rnd.tests.map(t => (
                <li key={t.key} className="py-1 border-b border-gray-800/70 last:border-b-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0">
                    <span className="text-gray-200 font-bold whitespace-nowrap">{t.name}</span>
                    <span className="whitespace-nowrap"><span className="text-gray-500">{t.stat} · </span><b className={t.rejected ? 'text-amber-300' : 'text-gray-200'}>p {t.p.toFixed(2)}</b></span>
                  </div>
                  <div className="text-gray-500 leading-snug">{t.detail.replace(/\s(?=\S+$)/, '\u00A0')}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>
    </div>
  );
};

// ── ④ 세컨드 오피니언 ────────────────────────────────────────────────────────
const StackCompare: React.FC<{
  so: SecondOpinion; evidence: EvidenceReport | null; onBallClick: (n: number) => void;
}> = ({ so, evidence, onBallClick }) => {
  const ov = evidence?.overlap;
  const mean = ov?.mean ?? null;
  const rel = mean === null ? null : so.overlap > mean + 0.5 ? '평균보다 높음' : so.overlap < mean - 0.5 ? '평균보다 낮음' : '평균 수준';
  const total = ov ? ov.distribution.reduce((a, b) => a + b, 0) : 0;
  const maxCount = ov ? Math.max(...ov.distribution, 1) : 1;
  return (
    <div className="mb-6 rounded-xl border border-indigo-800/50 bg-indigo-950/30 p-3 sm:p-4">
      <div className="mb-3">
        <div className="text-[11px] sm:text-xs font-bold text-indigo-300 leading-snug">
          <span className="block sm:inline">🔀 세컨드 오피니언</span>
          <span className="hidden sm:inline"> — </span>
          <span className="block sm:inline">독립 스택 Top6 · 융합 Top6와 <span className="whitespace-nowrap">{so.overlap}개 일치</span></span>
        </div>
        {rel && <div className="text-[10px] text-indigo-200/80 mt-0.5">과거 평균({ov?.mean.toFixed(1)}개) 대비 {rel}</div>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4">
        <div className="space-y-2">
          {([
            ['융합 Top6', so.fusedTop6, '화면 Top6 (종합 75% + 흐름 25%)'],
            ['독립 스택', so.numbers, '본번호만 쓰는 5엔진 통합(흐름·모멘텀·공백·번대·마르코프)'],
          ] as Array<[string, number[], string]>).map(([label, nums, tip]) => (
            <div key={label} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2" title={tip}>
              <span className="sm:w-[62px] flex-shrink-0 text-[10px] font-bold text-gray-400">{label}</span>
              <div className="flex gap-1 flex-nowrap">
                {nums.map(n => {
                  const shared = so.shared.includes(n);
                  return (
                    <span key={n} onClick={() => onBallClick(n)}
                          className={`cursor-pointer hover:scale-110 transition-transform inline-block rounded-full ${shared ? 'ring-2 ring-indigo-300' : 'opacity-70'}`}
                          title={shared ? '두 스택 공통' : label + ' 고유'}>
                      <Ball num={n} small />
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="text-[10px] text-gray-500 sm:pl-[70px] flex flex-wrap gap-x-2">
            <span className="whitespace-nowrap">공통 {so.shared.length > 0 ? so.shared.join(', ') : '없음'}</span>
            <span className="whitespace-nowrap">독립 스택에만 {so.uniqueToUnified.length > 0 ? so.uniqueToUnified.join(', ') : '없음'}</span>
          </div>
        </div>
        {ov && total > 0 && (
          <div className="md:w-[220px]" title="최근 검증 구간 각 시점에서 두 스택 Top6가 겹친 개수의 분포">
            <div className="text-[10px] text-gray-400 mb-1">
              과거 {ov.tests}시점 일치 분포 — 평균 <b className="text-indigo-200">{ov.mean.toFixed(2)}개</b> <span className="text-gray-500">(무작위 {ov.random.toFixed(1)})</span>
            </div>
            <div className="flex items-end gap-[3px] h-12">
              {ov.distribution.map((c, k) => (
                <div key={k} className="flex-1 flex flex-col items-center justify-end h-full">
                  <div className={`w-full rounded-t ${k === so.overlap ? 'bg-indigo-400' : 'bg-gray-600'}`}
                       style={{ height: `${Math.max(2, (c / maxCount) * 100)}%` }} title={`${k}개 일치: ${c}회 (${((c / total) * 100).toFixed(0)}%)`} />
                  <span className={`text-[9px] ${k === so.overlap ? 'text-indigo-200 font-bold' : 'text-gray-500'}`}>{k}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="text-[10px] text-gray-500 mt-2 leading-relaxed break-keep">
        두 스택은 코드는 별개지만 같은 과거 데이터를 보고 비슷한 ‘공백·평균회귀’ 철학을 따라 평균 {ov ? ov.mean.toFixed(1) : '2~3'}개가 겹칩니다(무작위 0.8개) — 두 스택이 일치해도 독립적인 확인이 아니며, 적중률 우위를 의미하지 않습니다.
      </div>
      {evidence && <AccuracyReview ev={evidence} />}
    </div>
  );
};

// ── 메인 패널 ────────────────────────────────────────────────────────────────
type SortKey = 'fused' | 'composite' | 'number' | 'gap';

export const TopPicksPanel: React.FC<TopPicksPanelProps> = ({
  fused, table, trends, gapInfo, secondOpinion, evidence, evidenceProgress, dataRounds, latestRound, onBallClick,
}) => {
  const [showTable, setShowTable] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('fused');

  const byNum = useMemo(() => new Map(table.map(t => [t.number, t] as [number, FullIndicatorAnalysis])), [table]);
  // 지표별 상위 N 집합 — 점 5개로 "어느 지표가 이 번호를 밀어올렸나"를 한눈에 표시
  const topSets = useMemo(() => INDICATOR_LABELS.map(ind =>
    new Set([...table].sort((a, b) => b[ind.key] - a[ind.key] || a.number - b.number).slice(0, AGREEMENT_TOP_N).map(t => t.number))), [table]);
  const top6 = fused.slice(0, 6);
  const scoreMax = fused.length ? Math.max(...fused.map(r => r.fusedScore)) : 100;
  const scoreMin = fused.length ? Math.min(...fused.map(r => r.fusedScore)) : 0;
  const rel = (v: number) => Math.round(((v - scoreMin) / Math.max(1e-9, scoreMax - scoreMin)) * 100);
  const cutoffGap = fused.length >= 7 ? +(fused[5].fusedScore - fused[6].fusedScore).toFixed(2) : NaN;

  const rows = useMemo(() => {
    const base = [...fused];
    if (sortKey === 'composite') base.sort((a, b) => b.compositeScore - a.compositeScore || a.number - b.number);
    else if (sortKey === 'number') base.sort((a, b) => a.number - b.number);
    else if (sortKey === 'gap') base.sort((a, b) => (gapInfo?.[b.number].curGap ?? 0) - (gapInfo?.[a.number].curGap ?? 0) || a.number - b.number);
    return base;
  }, [fused, sortKey, gapInfo]);

  const dots = (n: number) => (
    <span className="inline-flex gap-[3px] items-center" aria-label="지표별 상위권 여부">
      {INDICATOR_LABELS.map((ind, i) => (
        <span key={ind.key} title={`${ind.title}${topSets[i].has(n) ? ' — 상위 ' + AGREEMENT_TOP_N + '위 이내' : ''}`}
              className={`inline-block w-[7px] h-[7px] rounded-[2px] ${topSets[i].has(n) ? 'bg-emerald-400' : 'bg-gray-700'}`} />
      ))}
    </span>
  );

  return (
    <div className="ko-flow bg-gray-800 rounded-2xl p-4 sm:p-6 md:p-8 shadow-xl border border-teal-900/40 mt-8">
      <h2 className="text-lg font-bold text-teal-300 border-b border-gray-700/60 pb-3 mb-4 flex items-center gap-2 flex-wrap">
        <span>🏆</span> 출현가능성 상위 6개 번호
        <span className="text-xs font-normal text-gray-500 ml-1">융합 순위 (종합 75% + 흐름 25%)</span>
        <span className="text-[10px] font-normal text-gray-500 ml-auto">{latestRound}회차까지 {dataRounds}회 분석</span>
      </h2>

      <EvidenceBanner report={evidence} progress={evidenceProgress} />

      {/* ② Top 6 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 mb-3">
        {top6.map((row, idx) => {
          const item = byNum.get(row.number);
          if (!item) return null;
          const trend = trends?.[row.number] ?? '안정';
          const gap = gapInfo?.[row.number];
          const overdue = gap && gap.overdueRatio >= 1.2;
          return (
            <div key={row.number}
                 onClick={() => onBallClick(row.number)}
                 className="relative flex flex-col items-center gap-1.5 rounded-xl border border-emerald-700/50 bg-emerald-950/30 p-3 cursor-pointer hover:bg-emerald-950/50 hover:-translate-y-0.5 transition-all"
                 title={`융합 ${row.fusedRank}위 · 종합 ${row.ensRank}위 · 상위지표 ${row.agreement5}/5${row.contested ? ' · 종합 순위와 10위 이상 엇갈림' : ''}`}>
              <div className="absolute top-1.5 left-2 text-[10px] font-black text-emerald-300/80">#{idx + 1}</div>
              {row.contested && <div className="absolute top-1.5 right-2 text-[9px] font-bold text-red-300" title="종합 순위와 10위 이상 엇갈림">※분열</div>}
              <div className="mt-3"><Ball num={row.number} /></div>
              <div className="w-full">
                <div className="flex items-baseline justify-between">
                  <span className="text-[9px] text-gray-500">융합</span>
                  <span className="text-lg font-black text-white leading-none">{row.fusedScore.toFixed(1)}</span>
                </div>
                <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden mt-1" title={`전체 45개 중 상대 위치 ${rel(row.fusedScore)}%`}>
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${rel(row.fusedScore)}%` }} />
                </div>
              </div>
              <div className="flex items-center gap-1 flex-wrap justify-center">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${TREND_STYLE[trend] ?? TREND_STYLE['안정']}`} title={TREND_HINT[trend]}>{trend}</span>
                {gap && (
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${overdue ? 'text-orange-300 bg-orange-900/30 border-orange-700/50' : 'text-gray-400 bg-gray-800 border-gray-700'}`}
                        title={`평균 ${gap.avgGap}회마다 출현 · 현재 ${gap.curGap}회 대기 (${gap.overdueRatio.toFixed(1)}×)`}>
                    {gap.curGap}회 대기
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between w-full gap-x-2 gap-y-0.5 text-[9px] text-gray-500">
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                  {dots(row.number)}
                  <span title={`5개 지표 중 ${row.agreement5}개에서 상위 ${AGREEMENT_TOP_N}위 (무작위 기대 1.3개)`}>{row.agreement5}/5</span>
                </span>
                <span className="whitespace-nowrap" title="입력 회차를 20% 빼고 반복했을 때 Top6에 남은 비율 — 재현성이지 적중률이 아님">
                  안정 {row.stability === null ? '─' : `${Math.round(row.stability * 100)}%`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-gray-500 mb-5">
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {INDICATOR_LABELS.map(ind => (<span key={ind.key} className="inline-flex items-center gap-[3px] whitespace-nowrap"><span className="inline-block w-[7px] h-[7px] rounded-[2px] bg-emerald-400" />{ind.short}</span>))}
          <span className="w-full sm:w-auto">= 해당 지표 상위 {AGREEMENT_TOP_N}위</span>
        </span>
        <span>안정 = 입력 20% 제외 반복 시 Top6 잔류율(재현성)</span>
        {!Number.isNaN(cutoffGap) && (
          <span className={cutoffGap < 0.5 ? 'text-yellow-300 font-bold' : ''}>
            6위–7위 격차 {cutoffGap.toFixed(2)}점{cutoffGap < 0.5 ? ' — 사실상 동점, 7~8위가 언제든 뒤집힐 수 있음' : cutoffGap < 1.5 ? ' (근소)' : ''}
          </span>
        )}
      </div>

      {/* ③ 1~45 히트맵 — 전체 순위를 한 화면에 */}
      <div className="mb-6">
        <div className="text-[11px] font-bold text-gray-400 mb-2 flex items-center gap-2 flex-wrap">
          <span>🗺️</span> 1~45 융합 순위 지도
          <span className="font-normal text-gray-600">셀의 작은 숫자 = 융합 순위 · 클릭 → 정밀 분석</span>
        </div>
        <div className="grid grid-cols-9 gap-1">
          {Array.from({ length: 45 }, (_, i) => i + 1).map(n => {
            const row = fused.find(r => r.number === n);
            const rank = row?.fusedRank ?? 45;
            return (
              <button key={n} onClick={() => onBallClick(n)}
                      className={`rounded-md py-1 flex flex-col items-center leading-none hover:scale-105 transition-transform ${heatClass(rank)}`}
                      title={`${n}번 · 융합 ${rank}위 · ${row?.fusedScore.toFixed(1)}점 · 종합 ${row?.ensRank}위`}>
                <span className="text-xs sm:text-sm font-black">{n}</span>
                <span className="text-[8px] opacity-80 mt-0.5">{rank}위</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] text-gray-500">
          <span className="inline-flex items-center gap-1 whitespace-nowrap"><i className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-600" />1~6위</span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap"><i className="inline-block w-2.5 h-2.5 rounded-sm bg-yellow-700/70" />7~12위</span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap"><i className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-600" />13~24위</span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap"><i className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-700" />25~36위</span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap"><i className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-800 border border-gray-700" />37~45위</span>
        </div>
      </div>

      {/* ④ 세컨드 오피니언 */}
      {secondOpinion && <StackCompare so={secondOpinion} evidence={evidence} onBallClick={onBallClick} />}

      {/* ⑤ 전체 데이터 테이블 */}
      <div className="border border-gray-700 rounded-xl overflow-hidden">
        <button onClick={() => setShowTable(v => !v)}
                className="w-full flex items-center justify-between px-3 sm:px-4 py-3 bg-gray-900 hover:bg-gray-700/50 transition-colors gap-2">
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-left">
            <span className="text-sm font-bold text-gray-300 flex items-center gap-1.5 whitespace-nowrap"><span>📋</span> 전체 데이터 테이블</span>
            <span className="text-[10px] sm:text-xs text-gray-500 font-normal break-keep">
              — 1~45번 출현가능성 점수 전체 <span className="whitespace-nowrap">(융합 순위순 = Top6 선정 순서)</span>
            </span>
          </div>
          <span className="text-xs text-gray-500 font-bold flex-shrink-0 whitespace-nowrap">{showTable ? '▲ 접기' : '▼ 펼치기'}</span>
        </button>
        {showTable && (
          <div className="border-t border-gray-700">
            <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-900/70 text-[10px] text-gray-500 flex-wrap">
              정렬
              {([['fused', '융합'], ['composite', '종합'], ['gap', '대기 긴 순'], ['number', '번호']] as Array<[SortKey, string]>).map(([k, label]) => (
                <button key={k} onClick={() => setSortKey(k)}
                        className={`px-2 py-0.5 rounded font-bold ${sortKey === k ? 'bg-teal-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>{label}</button>
              ))}
            </div>
            {/* 모바일(<640px): 11열 표 대신 한 번호당 카드형 목록 — 가로 스크롤 없이 읽히도록 */}
            <div className="sm:hidden divide-y divide-gray-800/70">
              {rows.map(row => {
                const item = byNum.get(row.number);
                if (!item) return null;
                const tier = TIER_LABEL[row.tier];
                const trend = trends?.[row.number] ?? '안정';
                const gap = gapInfo?.[row.number];
                const pat = patternOf(item);
                return (
                  <div key={row.number} onClick={() => onBallClick(row.number)}
                       className={`flex items-start gap-2.5 px-3 py-2.5 cursor-pointer ${row.tier === 'pick' ? 'bg-teal-950/20' : row.tier === 'next' ? 'bg-yellow-950/10' : ''}`}>
                    <div className="w-7 text-center flex-shrink-0 pt-0.5">
                      <div className={`font-black text-sm ${row.fusedRank <= 3 ? 'text-yellow-400' : row.fusedRank <= 6 ? 'text-teal-400' : 'text-gray-500'}`}>{row.fusedRank}</div>
                      <div className="text-[9px] text-gray-600 whitespace-nowrap">종합 {row.ensRank}</div>
                    </div>
                    <div className="flex-shrink-0"><Ball num={row.number} small /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${tier.cls}`}>{tier.label}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${TREND_STYLE[trend] ?? TREND_STYLE['안정']}`} title={TREND_HINT[trend]}>추세 {trend}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${pat.cls}`}>패턴 {pat.label}</span>
                        {row.contested && <span className="text-[10px] font-bold text-red-300 whitespace-nowrap">※분열</span>}
                        <span className="ml-auto text-sm font-black text-gray-100 whitespace-nowrap">{row.fusedScore.toFixed(1)}</span>
                      </div>
                      <div className="w-full h-1 bg-gray-700 rounded-full mt-1.5 overflow-hidden">
                        <div className={`h-full rounded-full ${row.tier === 'pick' ? 'bg-emerald-500' : row.tier === 'next' ? 'bg-yellow-500' : 'bg-gray-500'}`} style={{ width: `${rel(row.fusedScore)}%` }} />
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-gray-400">
                        <span className="whitespace-nowrap">종합 {row.compositeScore.toFixed(1)}</span>
                        <span className="inline-flex items-center gap-1 whitespace-nowrap">{dots(row.number)} {row.agreement5}/5</span>
                        <span className="whitespace-nowrap">안정 {row.stability === null ? '─' : `${Math.round(row.stability * 100)}%`}</span>
                        {gap && <span className={`whitespace-nowrap ${gap.overdueRatio >= 1.5 ? 'text-orange-300 font-bold' : ''}`}>{gap.curGap}회 대기</span>}
                      </div>
                      <div className="mt-0.5 text-[10px] text-gray-500 leading-snug">{featureOf(item)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="hidden sm:block overflow-x-auto custom-scrollbar">
              <table className="w-full text-xs min-w-[760px] break-normal">
                <thead>
                  <tr className="bg-gray-900 border-b border-gray-700">
                    <th className="py-2 px-2 text-gray-500 font-bold text-center whitespace-nowrap" title="융합 순위">순위</th>
                    <th className="py-2 px-2 text-gray-500 font-bold text-center">번호</th>
                    <th className="py-2 px-2 text-gray-500 font-bold text-center">구분</th>
                    <th className="py-2 px-3 text-teal-400 font-bold text-center whitespace-nowrap">융합 <span className="text-gray-600 font-normal text-[10px]">(0~100)</span></th>
                    <th className="py-2 px-2 text-gray-500 font-bold text-center" title="순수 앙상블 종합 점수">종합</th>
                    <th className="py-2 px-2 text-gray-500 font-bold text-center" title={`5개 지표 각각의 상위 ${AGREEMENT_TOP_N}위 여부(Z·BB·RSI·추세·확인)`}>지표 상위권</th>
                    <th className="py-2 px-2 text-gray-500 font-bold text-center" title="입력 20% 제외 반복 시 Top6 잔류율">안정</th>
                    <th className="py-2 px-2 text-gray-500 font-bold text-center">추세</th>
                    <th className="py-2 px-2 text-gray-500 font-bold text-center">대기</th>
                    <th className="py-2 px-2 text-gray-500 font-bold text-center">패턴</th>
                    <th className="py-2 px-3 text-gray-500 font-bold text-left">특징 요약</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const item = byNum.get(row.number);
                    if (!item) return null;
                    const pat = patternOf(item);
                    const tier = TIER_LABEL[row.tier];
                    const trend = trends?.[row.number] ?? '안정';
                    const gap = gapInfo?.[row.number];
                    const rowCls = row.tier === 'pick' ? 'bg-teal-950/20' : row.tier === 'next' ? 'bg-yellow-950/10' : '';
                    return (
                      <tr key={row.number} className={`border-b border-gray-800/60 hover:bg-gray-700/20 transition-colors ${rowCls}`}>
                        <td className="py-1.5 px-2 text-center">
                          <span className={`font-black ${row.fusedRank <= 3 ? 'text-yellow-400' : row.fusedRank <= 6 ? 'text-teal-400' : 'text-gray-600'}`}>{row.fusedRank}</span>
                          <div className="text-[9px] text-gray-600">종합 {row.ensRank}위</div>
                        </td>
                        <td className="py-1.5 px-2"><div className="flex justify-center cursor-pointer" onClick={() => onBallClick(row.number)}><Ball num={row.number} small /></div></td>
                        <td className="py-1.5 px-2 text-center whitespace-nowrap">
                          <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${tier.cls}`}>{tier.label}</span>
                          {row.contested && <div className="text-[9px] font-bold text-red-300 mt-0.5" title="종합 순위와 10위 이상 엇갈림">※분열</div>}
                        </td>
                        <td className="py-1.5 px-3 text-center whitespace-nowrap">
                          <div className="font-black text-sm text-gray-100">{row.fusedScore.toFixed(1)}</div>
                          <div className="w-full h-1 bg-gray-700 rounded-full mt-0.5 overflow-hidden">
                            <div className={`h-full rounded-full ${row.tier === 'pick' ? 'bg-emerald-500' : row.tier === 'next' ? 'bg-yellow-500' : 'bg-gray-500'}`} style={{ width: `${rel(row.fusedScore)}%` }} />
                          </div>
                        </td>
                        <td className="py-1.5 px-2 text-center text-gray-400 text-[11px]">{row.compositeScore.toFixed(1)}</td>
                        <td className="py-1.5 px-2 text-center whitespace-nowrap">
                          {dots(row.number)} <span className={`ml-1 text-[10px] font-bold ${row.agreement5 >= 3 ? 'text-emerald-400' : 'text-gray-500'}`}>{row.agreement5}/5</span>
                        </td>
                        <td className="py-1.5 px-2 text-center text-gray-400 text-[11px]">{row.stability === null ? '─' : `${Math.round(row.stability * 100)}%`}</td>
                        <td className="py-1.5 px-2 text-center whitespace-nowrap">
                          <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${TREND_STYLE[trend] ?? TREND_STYLE['안정']}`} title={TREND_HINT[trend]}>{trend}</span>
                        </td>
                        <td className="py-1.5 px-2 text-center whitespace-nowrap text-[11px]">
                          {gap ? <span className={gap.overdueRatio >= 1.5 ? 'text-orange-300 font-bold' : 'text-gray-400'} title={`평균 ${gap.avgGap}회 · ${gap.overdueRatio.toFixed(1)}×`}>{gap.curGap}회</span> : '─'}
                        </td>
                        <td className="py-1.5 px-2 text-center whitespace-nowrap">
                          <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${pat.cls}`}>{pat.label}</span>
                        </td>
                        <td className="py-1.5 px-3 whitespace-nowrap"><span className="text-gray-400 text-[11px]">{featureOf(item)}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-3 sm:px-4 py-2 bg-gray-900 text-[10px] text-gray-500 border-t border-gray-700 leading-relaxed break-keep">
              Top6 = 융합 1~6위 · 차순 = 7~12위(교체 후보) · 하위 = 40~45위 · ※분열 = 종합 순위와 10위 이상 엇갈림 ·
              지표 상위권 = Z·BB·RSI·추세·확인 각각에서 상위 {AGREEMENT_TOP_N}위(무작위 기대 1.3/5) · 안정 = 재현성(적중률 아님) ·
              ‘추세’·‘확인’ 열은 EMA·MACD·ADX·ATR·Aroon 묶음 점수입니다.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
