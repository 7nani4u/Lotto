import React, { useMemo } from 'react';
import { LottoResult } from '../types';
import { Ball } from './Ball';
import { TREND_HINT, TREND_STYLE } from './styles';
import {
  buildDrawReport, HistoryProfile, MetricRow, NumberDetail, Relation, TagLevel,
} from '../services/drawReport';
import { RetroPick } from '../services/evidence';

// ═══════════════════════════════════════════════════════════════════════════════
// 📋 제 N회 당첨 번호 분석 리포트
//   읽는 순서: 눈에 띄는 점 → ① 구조 진단(필터 5종 · 참고 3종) → ② 번호별 상세 → ③ 당시 Top6 회고 → ④ 함께 나온 쌍
//   · 위 "최근 당첨 번호" 행·칩에 이미 있는 정보(공 6개, 합·홀짝 칩 등)를 그대로 되풀이하지 않고,
//     "그 값이 얼마나 흔한가"(균등 이론 vs 역대 실측)와 "번호 하나하나의 사정"을 추가합니다.
// ═══════════════════════════════════════════════════════════════════════════════

const TAG_CLS: Record<TagLevel, string> = {
  common: 'text-emerald-300 bg-emerald-900/30 border-emerald-700/50',
  normal: 'text-gray-300 bg-gray-800 border-gray-700',
  rare: 'text-amber-300 bg-amber-900/30 border-amber-700/50',
};

const REL: Record<Relation, { text: string; cls: string } | null> = {
  carry: { text: '이월', cls: 'text-indigo-300 bg-indigo-900/30 border-indigo-700/50' },
  prevBonus: { text: '직전 보너스', cls: 'text-purple-300 bg-purple-900/30 border-purple-700/50' },
  neighbor: { text: '이웃 (직전 ±1)', cls: 'text-teal-300 bg-teal-900/30 border-teal-700/50' },
  new: { text: '신규', cls: 'text-gray-300 bg-gray-800 border-gray-700' },
  none: null,
};

const TONE_DOT: Record<string, string> = { ok: 'bg-emerald-400', bad: 'bg-red-400', warn: 'bg-amber-400', info: 'bg-indigo-400' };

const DECADE_LABELS = ['1~10', '11~20', '21~30', '31~40', '41~45'];

/** 마지막 두 어절을 붙여 한 단어만 다음 줄에 남는 일을 막음 */
const bindTail = (t: string) => t.replace(/\s(?=\S+$)/, '\u00A0');   // U+00A0 (줄바꿈 금지 공백)
const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
const rankText = (r: number) => (Number.isInteger(r) ? String(r) : r.toFixed(1));

const Section: React.FC<{ step: string; title: string; hint?: string; children: React.ReactNode }> = ({ step, title, hint, children }) => (
  <section className="rounded-xl bg-gray-900/60 border border-gray-700/60 p-3 sm:p-4">
    <h3 className="text-sm font-bold text-gray-200 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-green-400">{step}</span>
      <span>{title}</span>
      {hint && <span className="text-[10px] font-normal text-gray-500">{hint}</span>}
    </h3>
    <div className="mt-3">{children}</div>
  </section>
);

const Metric: React.FC<{ row: MetricRow }> = ({ row }) => (
  <div className="rounded-lg bg-gray-800/70 border border-gray-700/50 p-3 min-w-0">
    <div className="flex items-start justify-between gap-2">
      <span className="text-[11px] font-bold text-gray-400">{row.label}</span>
      {row.filter && (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap flex-shrink-0 ${row.filter.ok
          ? 'text-emerald-300 bg-emerald-900/30 border-emerald-700/50'
          : 'text-red-300 bg-red-900/30 border-red-700/50'}`}>
          {row.filter.ok ? '✓ 통과' : '✗ 탈락'}
        </span>
      )}
    </div>
    <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0">
      <span className="text-xl font-black text-white">{row.value}</span>
      {row.sub && <span className="text-[11px] text-gray-400">{row.sub}</span>}
    </div>

    {row.decades && (
      <div className="mt-2 flex items-end gap-1.5" role="img" aria-label={`번대별 개수 ${row.decades.join(', ')}`}>
        {row.decades.map((c, i) => {
          const max = Math.max(3, ...row.decades!);
          return (
            <div key={i} className="flex-1 min-w-0 flex flex-col items-center gap-0.5">
              <div className="w-full h-7 flex items-end">
                <div className={`w-full rounded-t ${c === 0 ? 'bg-gray-700' : c > 3 ? 'bg-red-500' : c === 3 ? 'bg-amber-500' : 'bg-green-500'}`}
                     style={{ height: c === 0 ? '2px' : `${(c / max) * 100}%` }} />
              </div>
              <span className="text-[10px] font-bold text-gray-200">{c}</span>
              <span className="text-[9px] text-gray-600 whitespace-nowrap">{DECADE_LABELS[i]}</span>
            </div>
          );
        })}
      </div>
    )}

    <div className="mt-2 pt-2 border-t border-gray-700/50 text-[10px] text-gray-500 leading-snug">
      <div>{row.basis}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="whitespace-nowrap">균등 <b className="text-gray-300">{row.theory === null ? '─' : pct(row.theory)}</b></span>
        <span className="whitespace-nowrap">역대 <b className="text-gray-300">{pct(row.hist)}</b>{row.histCount !== null && <span> ({row.histCount}회)</span>}</span>
        <span className={`px-1.5 py-px rounded border whitespace-nowrap ${TAG_CLS[row.tag.level]}`}>{row.tag.text}</span>
      </div>
      {row.filter && <div className="mt-0.5">필터 기준 <span className="text-gray-400 whitespace-nowrap">{row.filter.rule}</span></div>}
    </div>
  </div>
);

const Stat: React.FC<{ label: string; value: string; sub?: string; hot?: boolean }> = ({ label, value, sub, hot }) => (
  <div className="min-w-0">
    <div className="text-[10px] text-gray-500">{label}</div>
    <div className={`text-sm font-black leading-tight whitespace-nowrap ${hot ? 'text-orange-300' : 'text-white'}`}>{value}</div>
    {sub && <div className="text-[10px] text-gray-500 leading-snug whitespace-nowrap">{sub}</div>}
  </div>
);

const NumberCard: React.FC<{ d: NumberDetail; onBallClick: (n: number) => void }> = ({ d, onBallClick }) => {
  const rel = REL[d.relation];
  const diff = d.count - d.expected;
  return (
    <div onClick={() => onBallClick(d.n)}
         className="rounded-lg bg-gray-800/70 border border-gray-700/50 p-3 cursor-pointer hover:bg-gray-700/40 transition-colors min-w-0">
      {/* 위: 공 + 구분 태그 / 아래: 전체 폭을 쓰는 3칸 수치 (공 옆에 두면 모바일에서 칸이 너무 좁아짐) */}
      <div className="flex items-center gap-2.5">
        <span className="flex-shrink-0"><Ball num={d.n} small isBonus={d.isBonus} /></span>
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {d.isBonus && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap text-gray-200 bg-gray-700 border-gray-500">보너스</span>}
          {rel && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${rel.cls}`}>{rel.text}</span>}
          {d.trend && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${TREND_STYLE[d.trend] ?? TREND_STYLE['안정']}`}
                  title={`직전 10회 기준 추세 — ${TREND_HINT[d.trend] ?? ''}`}>추세 {d.trend}</span>
          )}
        </div>
      </div>
      <div className="mt-2.5 pt-2.5 border-t border-gray-700/50 grid grid-cols-3 gap-2">
        <Stat label="직전 대기"
              value={d.waited === null ? '첫 출현' : `${d.waited}회`}
              sub={d.waited === 0 ? '직전 회차 출현' : d.avgGap !== null ? `평균 ${d.avgGap}회` : undefined}
              hot={d.overdue !== null && d.overdue >= 2 && (d.waited ?? 0) >= 10} />
        <Stat label="누적 출현" value={`${d.count}회`}
              sub={`균등 ${d.expected.toFixed(0)}회 (${diff >= 0 ? '+' : ''}${diff.toFixed(0)})`} />
        <Stat label="당시 순위" value={d.fusedRank === null ? '─' : `${rankText(d.fusedRank)}위`}
              sub={d.fusedRank === null ? '계산 중' : '융합 45개 중'} />
      </div>
    </div>
  );
};

const PickRow: React.FC<{ title: string; note: string; picks: number[]; winners: number[]; hits: number; meanRank: number }> = ({ title, note, picks, winners, hits, meanRank }) => (
  <div className="rounded-lg bg-gray-800/70 border border-gray-700/50 p-3">
    <div className="text-[11px] font-bold text-gray-400">
      <span className="whitespace-nowrap">{title}</span>{' '}
      <span className="block sm:inline text-[10px] font-normal text-gray-500">{note}</span>
    </div>
    <div className="mt-2 flex flex-wrap gap-1.5">
      {picks.map(n => (
        <span key={n} className={`flex-shrink-0 rounded-full ${winners.includes(n) ? 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-gray-800' : 'opacity-60'}`}>
          <Ball num={n} small />
        </span>
      ))}
    </div>
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
      <span className="whitespace-nowrap">적중 <b className="text-white">{hits}/6</b> <span className="text-gray-500">(무작위 0.8)</span></span>
      <span className="whitespace-nowrap">당첨 6개 평균 <b className="text-white">{meanRank.toFixed(1)}위</b> <span className="text-gray-500">(무작위 23.0)</span></span>
    </div>
  </div>
);

export interface DrawReportProps {
  results: LottoResult[];            // 최신 회차가 앞인 전체 데이터
  index: number;                     // 리포트 대상 회차의 위치
  profile: HistoryProfile;
  retro?: RetroPick;
  evidenceVerdict?: string | null;   // 백테스트 판정 한 줄 (회고 해석 근거)
  onBallClick: (n: number) => void;
  onClose: () => void;
}

export const DrawReport: React.FC<DrawReportProps> = ({ results, index, profile, retro, evidenceVerdict, onBallClick, onClose }) => {
  const r = useMemo(() => buildDrawReport(results, index, profile, retro), [results, index, profile, retro]);
  const main = r.numberDetails.filter(d => !d.isBonus);
  const bonus = r.numberDetails.find(d => d.isBonus)!;
  const maxAbsZ = Math.max(0, ...r.pairs.map(p => Math.abs(p.z)));

  return (
    <div className="ko-flow bg-gray-800/80 rounded-xl p-3 sm:p-6 shadow-inner border border-green-900/30 mt-2 mb-4 animate-fade-in ml-0 md:ml-4">
      {/* 머리말 */}
      <div className="flex items-start justify-between gap-3 border-b border-gray-700 pb-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-[15px] sm:text-xl font-bold text-green-300 flex items-start gap-2">
            <span>📋</span>
            <span>
              <span className="block sm:inline">제 {r.round}회</span>{' '}
              <span className="block sm:inline">당첨 번호 분석 리포트</span>
            </span>
          </h2>
          <div className="mt-1 text-[11px] text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5">
            <span className="whitespace-nowrap">{r.date} 추첨</span>
            <span className="whitespace-nowrap">역대 {r.draws}회와 비교</span>
            {r.prevRound !== null && <span className="whitespace-nowrap">직전 제 {r.prevRound}회와 대조</span>}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="리포트 닫기"
                className="flex-shrink-0 text-[11px] font-bold text-gray-400 bg-gray-700/60 hover:bg-gray-600 rounded-lg px-2.5 py-1.5 whitespace-nowrap">
          <span className="hidden sm:inline">닫기 </span>✕
        </button>
      </div>

      <div className="space-y-4 text-gray-200">
        {/* 눈에 띄는 점 */}
        <div className="rounded-xl bg-green-950/20 border border-green-800/40 p-3 sm:p-4">
          <div className="text-xs font-bold text-green-300">눈에 띄는 점</div>
          <ul className="mt-2 space-y-1.5">
            {r.highlights.map((h, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] text-gray-300 leading-relaxed">
                <span className={`mt-[7px] w-1.5 h-1.5 rounded-full flex-shrink-0 ${TONE_DOT[h.tone]}`} />
                <span>{bindTail(h.text)}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* ① 구조 진단 */}
        <Section step="①" title="구조 진단" hint="이 회차의 값이 균등 이론·역대 실측에서 얼마나 흔한지">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-2">
            <div className="text-[11px] font-bold text-gray-400">필터 5종 <span className="font-normal text-gray-600">— 후보 풀을 거르는 기준</span></div>
            <div className="text-[10px] text-gray-500 flex flex-wrap gap-x-3">
              <span className="whitespace-nowrap">역대 통과 <b className="text-gray-300">{pct(r.passRateHist)}</b></span>
              <span className="whitespace-nowrap">균등 이론 <b className="text-gray-300">{pct(r.passRateTheory)}</b></span>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {r.filterRows.map(row => <Metric key={row.key} row={row} />)}
          </div>
          <div className="text-[11px] font-bold text-gray-400 mt-4 mb-2">참고 구조 <span className="font-normal text-gray-600">— 필터가 아닌 지표</span></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {r.refRows.map(row => <Metric key={row.key} row={row} />)}
          </div>
          <p className="mt-3 text-[10px] text-gray-600 leading-relaxed">
            균등 = 45개 중 6개를 독립·균등하게 뽑을 때의 정확한 확률(AC·상하위 비율은 전수 계산이 필요해 비움). 역대 = 앱이 가진 {r.draws}회에서 같은 값이 나온 비율.
            "드문 편"은 5% 미만, "흔한 편"은 20% 이상 기준이며 당첨 가능성과는 무관합니다.
          </p>
        </Section>

        {/* ② 번호별 상세 */}
        <Section step="②" title="번호별 상세" hint="번호를 누르면 정밀 분석으로 이동">
          {r.prevRound !== null && (
            <div className="mb-3 text-[11px] text-gray-500 leading-relaxed">
              <span className="whitespace-nowrap">직전 제 {r.prevRound}회</span>
              {' '}
              {r.prevNumbers.map(n => (
                <span key={n} className={`inline-block whitespace-nowrap mr-1.5 font-bold ${r.meta.carry.includes(n) ? 'text-indigo-300' : 'text-gray-400'}`}>{n}</span>
              ))}
              <span className="whitespace-nowrap text-gray-600">+ 보너스 {r.prevBonus}</span>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {main.map(d => <NumberCard key={d.n} d={d} onBallClick={onBallClick} />)}
            <NumberCard d={bonus} onBallClick={onBallClick} />
          </div>
          <p className="mt-3 text-[10px] text-gray-600 leading-relaxed">
            직전 대기·추세·당시 순위는 이 회차 직전 데이터만으로 계산한 값(흐름 분석과 같은 정의, 보너스 포함)이고, 누적 출현은 이 회차까지의 본번호 횟수입니다.
          </p>
        </Section>

        {/* ③ 당시 융합 Top6 회고 */}
        <Section step="③" title="당시 융합 Top6 회고" hint="이 회차 직전까지의 데이터로 만든 순위를 실제 결과와 비교">
          {r.retro ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <PickRow title="융합 Top6" note="화면의 상위 6개와 같은 방식" picks={r.retro.picks} winners={r.numbers}
                         hits={r.retro.hits} meanRank={r.retro.fusedMeanRank} />
                <PickRow title="독립 스택 Top6" note="세컨드 오피니언" picks={r.retro.unified} winners={r.numbers}
                         hits={r.retro.unifiedHits} meanRank={r.retro.unifiedMeanRank} />
              </div>
              <p className="mt-3 text-[10px] text-gray-600 leading-relaxed">
                초록 테두리 = 실제 당첨 번호. 한 회차의 적중 개수는 0~2개가 흔해 우연과 구분되지 않습니다.
                {evidenceVerdict ? <> 최근 검증 판정: <b className="text-gray-400">{evidenceVerdict}</b>.</> : null}
              </p>
            </>
          ) : (
            <p className="text-xs text-gray-500">백테스트 계산이 끝나면 표시됩니다 (최근 10회차만 제공).</p>
          )}
        </Section>

        {/* ④ 함께 나온 쌍 */}
        <Section step="④" title="함께 나온 번호 쌍" hint={`이 회차 번호 15쌍 중 과거에 가장 자주 함께 나온 5쌍 (이 회차 제외 ${r.pairBasis}회)`}>
          <div className="space-y-1.5">
            {r.pairs.map((p, i) => (
              <div key={p.pair.join('-')} className="flex items-center gap-3 rounded-lg bg-gray-800/70 border border-gray-700/50 px-3 py-2">
                <span className={`text-xs font-bold w-4 text-center flex-shrink-0 ${i < 3 ? 'text-yellow-400' : 'text-gray-500'}`}>{i + 1}</span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="flex-shrink-0"><Ball num={p.pair[0]} small onClick={() => onBallClick(p.pair[0])} /></span>
                  <span className="text-gray-500 text-xs mx-0.5">+</span>
                  <span className="flex-shrink-0"><Ball num={p.pair[1]} small onClick={() => onBallClick(p.pair[1])} /></span>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-sm font-bold text-white whitespace-nowrap">{p.count}회</div>
                  <div className="text-[10px] text-gray-500 whitespace-nowrap">기대 {p.expected.toFixed(1)}회 · {p.z >= 0 ? '+' : ''}{p.z.toFixed(1)}σ</div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-gray-600 leading-relaxed">
            한 쌍이 나올 확률은 1/66이라 {r.pairBasis}회에서 평균 {r.pairs[0]?.expected.toFixed(1)}회(±{r.pairSd.toFixed(1)}) 나옵니다.
            {maxAbsZ < 3
              ? ' 이 회차의 쌍은 모두 ±3σ 안이라 우연으로 설명되는 범위입니다.'
              : ' 일부는 ±3σ 밖이지만 전체 990쌍 중 약 3쌍이 ±3σ 밖에 놓이는 것은 우연으로 흔합니다.'}
          </p>
        </Section>

        <div className="text-center text-[11px] text-gray-500 pt-1 leading-relaxed">
          이 리포트는 이미 나온 회차의 구조를 설명하는 통계이며, 다음 회차의 확률을 바꾸지 않습니다(모든 조합 1/8,145,060).
          <br />로또는 예측 불가하며 당첨을 보장하지 않습니다.
        </div>
      </div>
    </div>
  );
};
