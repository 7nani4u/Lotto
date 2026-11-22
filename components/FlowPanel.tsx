import React from 'react';
import { Ball } from './Ball';
import { LongAbsentReport } from '../services/lottoService';
import { TREND_HINT, TREND_ORDER, TREND_STYLE } from './styles';

// ═══════════════════════════════════════════════════════════════════════════════
// 🔗 번호 흐름 분석 — 최근 10회차 추세 · 구간 흐름 · 대기 현황
//   읽는 순서(제목과 동일):  ① 번호별 추세 → ② 구간 흐름 → ③ 대기 현황(쉬는 중 → 막 복귀)
//   · 융합 Top6 는 별도 카드로 되풀이하지 않고 각 목록 안에서 ★ 로만 표시합니다
//     (추세·대기 값은 위 "출현가능성 상위 6개 번호" 카드에 이미 있음).
// ═══════════════════════════════════════════════════════════════════════════════

export interface SegmentFlow {
  label: string; lo: number; hi: number; recent5: number; prev5: number; trend: string;
}

export interface FlowPanelProps {
  trends: Record<number, string>;
  segmentFlow: SegmentFlow[];
  recentlyBack: number[];
  absence: LongAbsentReport | null;
  top6: number[];                                  // 융합 Top6 번호 — ★ 표시용
  rounds: { from: number; to: number } | null;     // 추세·구간 집계에 쓴 최근 10회의 회차 범위
  onBallClick: (n: number) => void;
}

const SEG_TEXT: Record<string, { text: string; icon: string }> = {
  '상승': { text: 'text-orange-300', icon: '↑' },
  '하락': { text: 'text-cyan-300', icon: '↓' },
  '안정': { text: 'text-gray-400', icon: '→' },
};

const TREND_BAR: Record<string, string> = {
  '급등': 'bg-red-500', '상승': 'bg-orange-500', '안정': 'bg-gray-500', '하락': 'bg-cyan-500', '급락': 'bg-blue-500',
};

const fmtPct = (v: number | null) => (v === null ? '─' : `${(v * 100).toFixed(0)}%`);

/** 공 + (Top6 이면) ★ 배지 */
const MarkedBall: React.FC<{ n: number; top: boolean; onClick: (n: number) => void }> = ({ n, top, onClick }) => (
  <span onClick={() => onClick(n)} className="relative flex-shrink-0 cursor-pointer hover:scale-110 transition-transform inline-block" title={top ? '융합 Top6' : undefined}>
    <Ball num={n} small />
    {top && <span className="absolute -top-1 -right-1 text-[11px] leading-none text-emerald-300 drop-shadow">★</span>}
  </span>
);

const Card: React.FC<{ step: string; title: string; hint?: string; className?: string; children: React.ReactNode }> = ({ step, title, hint, className = '', children }) => (
  <div className={`rounded-xl border border-gray-700/60 bg-gray-900/60 p-3 sm:p-4 min-w-0 ${className}`}>
    <div className="text-xs font-bold text-gray-300 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-3">
      <span className="text-indigo-300">{step}</span>
      <span>{title}</span>
      {hint && <span className="font-normal text-[10px] text-gray-500">{hint}</span>}
    </div>
    {children}
  </div>
);

export const FlowPanel: React.FC<FlowPanelProps> = ({
  trends, segmentFlow, recentlyBack, absence, top6, rounds, onBallClick,
}) => {
  const isTop = (n: number) => top6.includes(n);
  const groups: Record<string, number[]> = { '급등': [], '상승': [], '안정': [], '하락': [], '급락': [] };
  for (let n = 1; n <= 45; n++) groups[trends[n]]?.push(n);
  const segMax = Math.max(1, ...segmentFlow.flatMap(s => [s.recent5, s.prev5]));
  const top6BySeg = segmentFlow
    .map(seg => ({ label: seg.label, nums: top6.filter(n => n >= seg.lo && n <= seg.hi) }))
    .filter(x => x.nums.length > 0);

  // 장기 대기: 실측과 "같은 크기" 기준선의 차이 (표본이 겹치므로 3σ 로 보수 판정)
  let verdict: { diffPp: number; same: boolean } | null = null;
  if (absence && absence.empiricalNextRate !== null && absence.empiricalNullRate !== null) {
    const diff = absence.empiricalNextRate - absence.empiricalNullRate;
    const se = Math.sqrt(absence.empiricalNullRate * (1 - absence.empiricalNullRate) / Math.max(1, absence.empiricalSamples));
    verdict = { diffPp: diff * 100, same: Math.abs(diff) < 3 * se };
  }

  return (
    <div className="ko-flow bg-gray-800 rounded-2xl p-4 sm:p-6 md:p-8 shadow-xl border border-indigo-900/40 mt-8">
      <h2 className="text-lg font-bold text-indigo-300 border-b border-gray-700/60 pb-3 mb-3 flex items-center gap-2 flex-wrap">
        <span>🔗</span> 번호 흐름 분석
        <span className="text-xs font-normal text-gray-500 ml-1">최근 10회차 추세 · 구간 흐름 · 대기 현황</span>
      </h2>
      <div className="mb-5 text-[11px] text-gray-500 leading-relaxed flex flex-wrap gap-x-3 gap-y-0.5">
        {rounds && <span className="whitespace-nowrap">집계 기준 제 {rounds.from}~{rounds.to}회 (본번호+보너스 7개)</span>}
        <span className="whitespace-nowrap"><span className="text-emerald-300">★</span> = 융합 Top6</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4 items-start">
        {/* ① 번호별 추세 */}
        <Card step="①" title="번호별 추세" hint="최근 5회 vs 직전 5회 출현 횟수로 45개 번호 분류" className="lg:col-span-3">
          <div className="flex h-3 rounded-full overflow-hidden mb-3 bg-gray-800">
            {TREND_ORDER.map(t => groups[t].length > 0 && (
              <div key={t} className={TREND_BAR[t]} style={{ width: `${(groups[t].length / 45) * 100}%` }} title={`${t} ${groups[t].length}개`} />
            ))}
          </div>
          <div className="space-y-1.5">
            {TREND_ORDER.map(t => groups[t].length > 0 && (
              <div key={t} className="flex items-start gap-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded flex-shrink-0 w-[58px] text-center whitespace-nowrap ${TREND_STYLE[t]}`}>{t} {groups[t].length}</span>
                <div className="flex gap-1 flex-wrap">
                  {groups[t].map(n => (
                    <span key={n} onClick={() => onBallClick(n)}
                          className={`text-[11px] font-bold px-1.5 py-0.5 rounded cursor-pointer hover:scale-110 transition-transform inline-block whitespace-nowrap ${TREND_STYLE[t]} ${isTop(n) ? 'ring-1 ring-emerald-400' : ''}`}>
                      {n}{isTop(n) ? <span className="text-emerald-300">★</span> : null}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <details className="mt-3 text-[10px] text-gray-500">
            <summary className="cursor-pointer text-gray-400 font-bold">분류 기준 보기</summary>
            <ul className="mt-1.5 space-y-1 leading-relaxed">
              {TREND_ORDER.map(t => (
                <li key={t} className="flex items-baseline gap-1.5">
                  <span className={`flex-shrink-0 text-[9px] font-bold px-1.5 rounded ${TREND_STYLE[t]}`}>{t}</span>
                  <span className="flex flex-wrap gap-x-1.5">
                    {TREND_HINT[t].split(' · ').map(seg => <span key={seg} className="whitespace-nowrap">{seg}</span>)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-1.5 text-gray-600">회수가 0~2개로 작아 구분이 거친 편입니다.</div>
          </details>
        </Card>

        {/* ② 구간 흐름 */}
        <Card step="②" title="구간 흐름" className="lg:col-span-2">
          <div className="text-[10px] text-gray-500 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1 whitespace-nowrap"><i className="inline-block w-2 h-2 rounded-sm bg-gray-600" />이전 5회</span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap"><i className="inline-block w-2 h-2 rounded-sm bg-indigo-400" />최근 5회</span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {segmentFlow.map(seg => {
              const st = SEG_TEXT[seg.trend] ?? SEG_TEXT['안정'];
              return (
                <div key={seg.label} className="flex flex-col items-center gap-1" title={`${seg.label}: 이전 5회 ${seg.prev5}개 → 최근 5회 ${seg.recent5}개 (보너스 포함, 구간 크기 보정 후 ${seg.trend})`}>
                  <div className="flex items-end gap-[3px] h-14">
                    <div className="w-3.5 rounded-t bg-gray-600" style={{ height: `${Math.max(4, (seg.prev5 / segMax) * 100)}%` }} />
                    <div className="w-3.5 rounded-t bg-indigo-400" style={{ height: `${Math.max(4, (seg.recent5 / segMax) * 100)}%` }} />
                  </div>
                  <div className="text-[10px] text-gray-500 whitespace-nowrap">{seg.prev5} → <b className="text-gray-200">{seg.recent5}</b></div>
                  <div className={`text-[11px] font-black whitespace-nowrap ${st.text}`}>{st.icon} {seg.trend}</div>
                  <div className="text-[10px] text-gray-500 whitespace-nowrap">{seg.label}</div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-[10px] text-gray-600 leading-relaxed">구간 크기(10개/5개)에 맞춰 보정한 비율로 상승·하락을 판정합니다.</div>
          {top6BySeg.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-800 text-[10px] text-gray-500 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="text-emerald-300 font-bold whitespace-nowrap">★ Top6 위치</span>
              {top6BySeg.map(x => (
                <span key={x.label} className="whitespace-nowrap">{x.label} <b className="text-gray-300">{x.nums.join(', ')}</b></span>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ③ 대기 현황 */}
      <Card step="③" title="대기 현황" hint="쉬고 있는 번호 → 막 돌아온 번호">
        {absence && absence.details.length > 0 ? (
          <div>
            <div className="text-[11px] font-bold text-gray-400 mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span>⏳ 쉬는 중</span>
              <span className="font-normal text-gray-500">10회 이상 안 나온 번호 {absence.fullSetSize}개{absence.fullSetSize > absence.details.length ? ` 중 평균 간격 대비 긴 순 상위 ${absence.details.length}개` : ''}</span>
            </div>

            {/* 결론 먼저, 근거는 아래 */}
            <div className="rounded-lg border border-gray-700/60 bg-gray-950/40 p-3 mb-3 text-[11px] text-gray-400 leading-relaxed">
              {verdict ? (
                <div>
                  <div className={`font-bold ${verdict.same ? 'text-gray-200' : 'text-emerald-300'}`}>
                    {verdict.same
                      ? '오래 쉰 번호가 더 잘 나온다는 근거는 없음'
                      : `과거 실측이 기준보다 ${verdict.diffPp >= 0 ? '높았음' : '낮았음'} (오차 범위 밖)`}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">실측 − 기준 = <span className="whitespace-nowrap">{verdict.diffPp >= 0 ? '+' : ''}{verdict.diffPp.toFixed(1)}%p</span></div>
                </div>
              ) : (
                <div className="font-bold text-gray-300">과거 표본이 부족해 비교할 수 없음 ({absence.empiricalSamples}건)</div>
              )}
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-baseline">
                {absence.empiricalNextRate !== null && absence.empiricalNullRate !== null && (
                  <>
                    <dt>과거 실측 <span className="text-gray-500">— 10회+ 쉰 번호 중 1개 이상이 다음 회차에 출현 (평균 {absence.empiricalAvgSetSize}개 · {absence.empiricalSamples}건)</span></dt>
                    <dd className="font-bold text-gray-200 text-right whitespace-nowrap">{(absence.empiricalNextRate * 100).toFixed(1)}%</dd>
                    <dt>같은 크기의 무작위 기준 <span className="text-gray-500">— 같은 개수를 아무렇게나 골랐을 때</span></dt>
                    <dd className="font-bold text-gray-200 text-right whitespace-nowrap">{(absence.empiricalNullRate * 100).toFixed(1)}%</dd>
                  </>
                )}
                <dt>지금 표시한 {absence.setSize}개 중 1개 이상 출현 <span className="text-gray-500">— 균등 계산</span></dt>
                <dd className="font-bold text-gray-200 text-right whitespace-nowrap">{(absence.nullProbNext * 100).toFixed(1)}%</dd>
              </dl>
              <div className="text-[10px] text-gray-600 mt-2">연속 시점의 표본이 겹쳐 실제 오차는 표기보다 큽니다.</div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {absence.details.map(d => {
                const pct = Math.min(100, ((d.overdueRatio - 1) / 3) * 100);
                const barCls = d.overdueRatio >= 3 ? 'bg-red-500' : d.overdueRatio >= 2 ? 'bg-orange-500' : 'bg-yellow-500';
                const textCls = d.overdueRatio >= 3 ? 'text-red-300' : d.overdueRatio >= 2 ? 'text-orange-300' : 'text-yellow-300';
                return (
                  <details key={d.number} className="rounded-xl border border-gray-700/60 bg-gray-900/70 group">
                    <summary className="list-none cursor-pointer p-2.5 flex items-center gap-2.5">
                      <span onClick={e => { e.preventDefault(); onBallClick(d.number); }} className="flex-shrink-0">
                        <MarkedBall n={d.number} top={isTop(d.number)} onClick={() => undefined} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[11px] text-gray-300 font-bold whitespace-nowrap">{d.curGap}회 대기 <span className="text-gray-500 font-normal">· 평균 {d.avgGap}회</span></span>
                          <span className={`text-xs font-black whitespace-nowrap ${textCls}`}>{d.overdueRatio.toFixed(1)}×</span>
                        </div>
                        <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden mt-1"><div className={`h-full rounded-full ${barCls}`} style={{ width: `${Math.max(3, pct)}%` }} /></div>
                      </div>
                      <span className="text-gray-600 text-[10px] flex-shrink-0 group-open:rotate-90 transition-transform">▶</span>
                    </summary>
                    <dl className="px-3 pb-3 pt-2 text-[10px] text-gray-500 border-t border-gray-800 grid grid-cols-[3.5rem_1fr] gap-x-2 gap-y-1">
                      <dt className="text-gray-600">미출 기록</dt>
                      <dd className="flex flex-wrap gap-x-3">
                        <span className="whitespace-nowrap">장기(10회+) 평균 {d.avgLongSpell === null ? '─' : `${d.avgLongSpell}회`}</span>
                        <span className="whitespace-nowrap">역대 최장 {d.maxSpell === null ? '─' : `${d.maxSpell}회`} ({d.longSpellCount}건)</span>
                      </dd>
                      <dt className="text-gray-600">출현 주기</dt>
                      <dd>{d.isPeriodic ? '규칙적' : '불규칙'} <span className="whitespace-nowrap">(CV {d.cv})</span></dd>
                      <dt className="text-gray-600">재출현율</dt>
                      <dd className="flex flex-wrap gap-x-3">
                        <span className="whitespace-nowrap">다음 1회 내 {fmtPct(d.reappear1)}</span>
                        <span className="whitespace-nowrap">3회 내 {fmtPct(d.reappear3)}</span>
                        <span className="whitespace-nowrap">(표본 {d.reappearSamples}건{d.reappearSamples < 3 ? ' — 부족' : ''})</span>
                      </dd>
                      <dt className="text-gray-600">복귀 후</dt>
                      <dd className="whitespace-nowrap">2회 내 재출현 {fmtPct(d.encoreRate)} ({d.encoreSamples}건)</dd>
                      {d.coReturn.length > 0 && (
                        <>
                          <dt className="text-gray-600">동반 복귀</dt>
                          <dd className="flex flex-wrap gap-x-2">
                            {d.coReturn.map(c => <span key={c.number} className="whitespace-nowrap">{c.number}번 {c.count}회</span>)}
                          </dd>
                        </>
                      )}
                    </dl>
                  </details>
                );
              })}
            </div>
            <div className="text-[10px] text-gray-600 mt-2">재출현율은 과거에 같은 대기 깊이에 도달한 사례 기준이며, 표본이 3건 미만이면 ─ 로 표시합니다.</div>
          </div>
        ) : (
          <div className="text-[11px] text-gray-500">지금 10회 이상 연속으로 나오지 않은 번호는 없습니다.</div>
        )}

        {/* 막 복귀한 번호 */}
        <div className="mt-4 pt-3 border-t border-gray-800">
          <div className="text-[11px] font-bold text-gray-400 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span>↩ 막 복귀</span>
            <span className="font-normal text-[10px] text-gray-500">최근 3회 안에 나왔고, 그 전 5회 이상 쉬었던 번호</span>
          </div>
          {recentlyBack.length > 0 ? (
            <div className="flex gap-2 flex-wrap mt-2">
              {recentlyBack.map(n => <MarkedBall key={n} n={n} top={isTop(n)} onClick={onBallClick} />)}
            </div>
          ) : (
            <div className="mt-1.5 text-[11px] text-gray-500">해당하는 번호가 없습니다.</div>
          )}
        </div>
      </Card>
    </div>
  );
};
