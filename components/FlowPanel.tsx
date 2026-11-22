import React from 'react';
import { Ball } from './Ball';
import { FusedRow, GapDetail, LongAbsentReport } from '../services/lottoService';
import { TREND_HINT, TREND_ORDER, TREND_STYLE } from './styles';

// ═══════════════════════════════════════════════════════════════════════════════
// 🔗 번호 흐름 분석 — 최근 10회차 추세 · 구간 흐름 · 대기 현황
//   읽는 순서: ① 구간 막대 · 추세 분포(한눈 요약) → ② 장기 대기 번호 → ③ Top6 흐름 근거
// ═══════════════════════════════════════════════════════════════════════════════

export interface SegmentFlow {
  label: string; lo: number; hi: number; recent5: number; prev5: number; trend: string;
}

export interface FlowPanelProps {
  trends: Record<number, string>;
  gapInfo: Record<number, GapDetail>;
  segmentFlow: SegmentFlow[];
  recentlyBack: number[];
  connectionScores: Record<number, number>;
  absence: LongAbsentReport | null;
  fusedTop6: FusedRow[];
  onBallClick: (n: number) => void;
}

const SEG_TEXT: Record<string, { text: string; icon: string; bar: string }> = {
  '상승': { text: 'text-orange-300', icon: '↑', bar: 'bg-orange-500' },
  '하락': { text: 'text-cyan-300', icon: '↓', bar: 'bg-cyan-500' },
  '안정': { text: 'text-gray-400', icon: '→', bar: 'bg-gray-500' },
};

const TREND_BAR: Record<string, string> = {
  '급등': 'bg-red-500', '상승': 'bg-orange-500', '안정': 'bg-gray-500', '하락': 'bg-cyan-500', '급락': 'bg-blue-500',
};

const GRADE_BADGE: Record<string, string> = {
  A: 'text-red-300 bg-red-900/50 border border-red-700/60',
  B: 'text-yellow-300 bg-yellow-900/40 border border-yellow-700/60',
  C: 'text-gray-400 bg-gray-700/50 border border-gray-600/50',
};

const fmtPct = (v: number | null) => (v === null ? '─' : `${(v * 100).toFixed(0)}%`);

export const FlowPanel: React.FC<FlowPanelProps> = ({
  trends, gapInfo, segmentFlow, recentlyBack, connectionScores, absence, fusedTop6, onBallClick,
}) => {
  const groups: Record<string, number[]> = { '급등': [], '상승': [], '안정': [], '하락': [], '급락': [] };
  for (let n = 1; n <= 45; n++) groups[trends[n]]?.push(n);
  const segMax = Math.max(1, ...segmentFlow.flatMap(s => [s.recent5, s.prev5]));
  const segOf = (n: number) => segmentFlow.find(s => n >= s.lo && n <= s.hi);

  // 장기 대기: 실측과 "같은 크기" 기준선의 차이 (표본이 겹치므로 오차는 보수적으로 크게 본다)
  let absenceVerdict: { diffPp: number; same: boolean } | null = null;
  if (absence && absence.empiricalNextRate !== null && absence.empiricalNullRate !== null) {
    const diff = absence.empiricalNextRate - absence.empiricalNullRate;
    const se = Math.sqrt(absence.empiricalNullRate * (1 - absence.empiricalNullRate) / Math.max(1, absence.empiricalSamples));
    absenceVerdict = { diffPp: diff * 100, same: Math.abs(diff) < 3 * se };   // 연속 표본이 겹치므로 3σ로 보수 판정
  }

  return (
    <div className="ko-flow bg-gray-800 rounded-2xl p-4 sm:p-6 md:p-8 shadow-xl border border-indigo-900/40 mt-8">
      <h2 className="text-lg font-bold text-indigo-300 border-b border-gray-700/60 pb-3 mb-5 flex items-center gap-2 flex-wrap">
        <span>🔗</span> 번호 흐름 분석
        <span className="text-xs font-normal text-gray-500 ml-1">최근 10회차 추세 · 구간 흐름 · 대기 현황</span>
      </h2>

      {/* ① 한눈 요약 */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
        {/* 구간 막대 */}
        <div className="lg:col-span-2 rounded-xl border border-gray-700/60 bg-gray-900/60 p-3">
          <div className="text-xs font-bold text-gray-400 mb-2 flex items-center gap-1.5 flex-wrap">
            <span>📊</span> 구간별 흐름
            <span className="font-normal text-gray-600 inline-flex items-center gap-x-2">
              <span className="inline-flex items-center gap-1 whitespace-nowrap"><i className="inline-block w-2 h-2 rounded-sm bg-indigo-400" />최근 5회</span>
              <span className="inline-flex items-center gap-1 whitespace-nowrap"><i className="inline-block w-2 h-2 rounded-sm bg-gray-600" />이전 5회</span>
            </span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {segmentFlow.map(seg => {
              const st = SEG_TEXT[seg.trend] ?? SEG_TEXT['안정'];
              return (
                <div key={seg.label} className="flex flex-col items-center gap-1" title={`${seg.label}: 최근 5회 ${seg.recent5}개 · 이전 5회 ${seg.prev5}개 (보너스 포함, 구간 크기 보정 후 ${seg.trend})`}>
                  <div className="flex items-end gap-[3px] h-14">
                    <div className="w-3.5 rounded-t bg-gray-600" style={{ height: `${Math.max(4, (seg.prev5 / segMax) * 100)}%` }} />
                    <div className="w-3.5 rounded-t bg-indigo-400" style={{ height: `${Math.max(4, (seg.recent5 / segMax) * 100)}%` }} />
                  </div>
                  <div className="text-[10px] text-gray-500">{seg.prev5} → <b className="text-gray-200">{seg.recent5}</b></div>
                  <div className={`text-[11px] font-black ${st.text}`}>{st.icon} {seg.trend}</div>
                  <div className="text-[10px] text-gray-500">{seg.label}</div>
                </div>
              );
            })}
          </div>
          {recentlyBack.length > 0 && (
            <div className="mt-3 pt-2 border-t border-gray-800">
              <div className="text-[10px] text-gray-500 leading-snug">
                <span className="font-bold text-gray-400">최근 복귀</span> · 최근 3회 출현 · 직전 5회+ 공백
              </div>
              <div className="flex gap-1.5 flex-wrap mt-1.5">
                {recentlyBack.map(n => (
                  <span key={n} onClick={() => onBallClick(n)} className="cursor-pointer hover:scale-110 transition-transform inline-block"><Ball num={n} small /></span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 추세 분포 */}
        <div className="lg:col-span-3 rounded-xl border border-gray-700/60 bg-gray-900/60 p-3">
          <div className="text-xs font-bold text-gray-400 mb-2 flex items-center gap-1.5"><span>📈</span> 최근 추세 분류 <span className="font-normal text-gray-600">45개 번호의 분포</span></div>
          <div className="flex h-3 rounded-full overflow-hidden mb-3 bg-gray-800">
            {TREND_ORDER.map(t => groups[t].length > 0 && (
              <div key={t} className={TREND_BAR[t]} style={{ width: `${(groups[t].length / 45) * 100}%` }} title={`${t} ${groups[t].length}개`} />
            ))}
          </div>
          <div className="space-y-1.5">
            {TREND_ORDER.map(t => groups[t].length > 0 && (
              <div key={t} className="flex items-start gap-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded flex-shrink-0 w-[58px] text-center ${TREND_STYLE[t]}`} title={TREND_HINT[t]}>{t} {groups[t].length}</span>
                <div className="flex gap-1 flex-wrap">
                  {groups[t].map(n => (
                    <span key={n} onClick={() => onBallClick(n)}
                          className={`text-[11px] font-bold px-1.5 py-0.5 rounded cursor-pointer hover:scale-110 transition-transform inline-block ${TREND_STYLE[t]}`}>{n}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <details className="mt-2 text-[10px] text-gray-500">
            <summary className="cursor-pointer text-gray-400 font-bold">분류 기준 보기 (최근 5회·직전 5회 출현 횟수 조합)</summary>
            <ul className="mt-1 space-y-0.5 leading-relaxed">
              {TREND_ORDER.map(t => (
                <li key={t} className="flex items-baseline gap-1.5">
                  <span className={`flex-shrink-0 text-[9px] font-bold px-1.5 rounded ${TREND_STYLE[t]}`}>{t}</span>
                  <span className="flex flex-wrap gap-x-1.5">
                    {TREND_HINT[t].split(' · ').map(seg => <span key={seg} className="whitespace-nowrap">{seg}</span>)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-1 text-gray-600">횟수가 0~2개로 작아 구분이 거친 편입니다.</div>
          </details>
        </div>
      </div>

      {/* ② 장기 대기 번호 */}
      {absence && absence.details.length > 0 && (
        <div className="mb-6">
          <div className="text-xs font-bold text-gray-400 mb-1.5 flex items-center gap-1.5 flex-wrap">
            <span>⏳</span> 장기 대기 번호 — 10회차 이상 미출현 <span className="whitespace-nowrap">(초과율 높은 순)</span>
            <span className="font-normal text-gray-600">전체 {absence.fullSetSize}개 중 상위 {absence.details.length}개 표시</span>
          </div>
          <div className="rounded-xl border border-gray-700/60 bg-gray-900/60 p-3 mb-3 text-[11px] text-gray-400 leading-relaxed">
            <div className="text-gray-300 font-bold mb-1.5">다음 회차에 이 번호들 중 1개 이상 출현할 확률</div>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 items-baseline">
              <dt>균등가정 (표시한 {absence.setSize}개)</dt>
              <dd className="font-bold text-gray-200 text-right">{(absence.nullProbNext * 100).toFixed(1)}%</dd>
              {absence.empiricalNextRate !== null && absence.empiricalNullRate !== null ? (
                <>
                  <dt>과거 실측 <span className="text-gray-500">(당시 평균 {absence.empiricalAvgSetSize}개 집합 · {absence.empiricalSamples}건)</span></dt>
                  <dd className="font-bold text-gray-200 text-right">{(absence.empiricalNextRate * 100).toFixed(1)}%</dd>
                  <dt>같은 크기의 균등가정 <span className="text-gray-500 whitespace-nowrap">(공정한 비교 기준)</span></dt>
                  <dd className="font-bold text-gray-200 text-right">{(absence.empiricalNullRate * 100).toFixed(1)}%</dd>
                </>
              ) : (
                <>
                  <dt>과거 실측</dt>
                  <dd className="text-gray-500 text-right">표본 부족 ({absence.empiricalSamples}건)</dd>
                </>
              )}
            </dl>
            {absenceVerdict && (
              <div className="mt-2 pt-2 border-t border-gray-800">
                실측 − 기준 = <b className={absenceVerdict.same ? 'text-gray-200' : 'text-emerald-300'}>{absenceVerdict.diffPp >= 0 ? '+' : ''}{absenceVerdict.diffPp.toFixed(1)}%p</b>
                {' '}— {absenceVerdict.same ? '오차 범위 (오래 안 나왔다고 더 잘 나오지는 않음)' : '오차 범위 밖'}
              </div>
            )}
            <div className="text-[10px] text-gray-600 mt-1.5">※ 실측 집합은 시점마다 크기가 달라 같은 크기의 균등가정과 비교해야 공정합니다. 연속 시점 표본이 겹쳐 실제 오차는 표기보다 큽니다.</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {absence.details.map(d => {
              const pct = Math.min(100, ((d.overdueRatio - 1) / 3) * 100);
              const barCls = d.overdueRatio >= 3 ? 'bg-red-500' : d.overdueRatio >= 2 ? 'bg-orange-500' : 'bg-yellow-500';
              const textCls = d.overdueRatio >= 3 ? 'text-red-300' : d.overdueRatio >= 2 ? 'text-orange-300' : 'text-yellow-300';
              return (
                <details key={d.number} className="rounded-xl border border-gray-700/60 bg-gray-900/70 group">
                  <summary className="list-none cursor-pointer p-2.5 flex items-center gap-2.5">
                    <span onClick={e => { e.preventDefault(); onBallClick(d.number); }} className="flex-shrink-0 hover:scale-110 transition-transform"><Ball num={d.number} small /></span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${GRADE_BADGE[d.grade]}`}
                          title={d.grade === 'A' ? '초과 2배+ · 주기적' : d.grade === 'B' ? '초과 또는 주기적' : '그 외'}>{d.grade}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-gray-300 font-bold">{d.curGap}회 대기 <span className="text-gray-500 font-normal">(약 {d.curWeeks}주) · 평균 {d.avgGap}회</span></span>
                        <span className={`text-xs font-black ${textCls}`}>{d.overdueRatio.toFixed(1)}×</span>
                      </div>
                      <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden mt-1"><div className={`h-full rounded-full ${barCls}`} style={{ width: `${Math.max(3, pct)}%` }} /></div>
                    </div>
                    <span className="text-gray-600 text-[10px] flex-shrink-0 group-open:rotate-90 transition-transform">▶</span>
                  </summary>
                  <div className="px-3 pb-3 pt-1 text-[10px] text-gray-500 space-y-0.5 border-t border-gray-800">
                    {/* 항목 단위로 줄바꿈 — "불규칙(CV 0.88)" 같은 항목이 중간에서 쪼개지지 않게 */}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                      <span className="whitespace-nowrap">장기 미출 평균 {d.avgLongSpell === null ? '─' : `${d.avgLongSpell}회`}</span>
                      <span className="whitespace-nowrap">역대 최장 {d.maxSpell === null ? '─' : `${d.maxSpell}회`} ({d.longSpellCount}건)</span>
                      <span className="whitespace-nowrap">주기 {d.isPeriodic ? `규칙적 (CV ${d.cv})` : `불규칙 (CV ${d.cv})`}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                      <span className="whitespace-nowrap">재출현율 1회 {fmtPct(d.reappear1)} · 3회 {fmtPct(d.reappear3)}</span>
                      <span className="whitespace-nowrap">(표본 {d.reappearSamples}건{d.reappearSamples < 3 ? ' — 부족' : ''})</span>
                      <span className="whitespace-nowrap">앙코르 {fmtPct(d.encoreRate)} ({d.encoreSamples}건)</span>
                    </div>
                    {d.coReturn.length > 0 && (
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                        <span className="whitespace-nowrap">동반 복귀</span>
                        {d.coReturn.map(c => <span key={c.number} className="whitespace-nowrap">{c.number}번 {c.count}회</span>)}
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
          <div className="text-[10px] text-gray-600 mt-1.5">율값은 과거 동일 대기 깊이 도달 사례 기준이며 표본 3건 미만은 ─ 표시. 등급(A/B/C)은 서술용이며 확률이 아닙니다.</div>
        </div>
      )}

      {/* ③ Top6 흐름 근거 */}
      <div>
        <div className="text-xs font-bold text-gray-400 mb-3 flex items-center gap-1.5 flex-wrap">
          <span>🏆</span> 상위 6개 번호 흐름 근거
          <span className="font-normal text-gray-600">— 융합 순위 공유 · 추세/대기/연결/구간</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {fusedTop6.map((row, idx) => {
            const trend = trends[row.number] ?? '안정';
            const gap = gapInfo[row.number];
            const conn = connectionScores?.[row.number];
            const seg = segOf(row.number);
            const isBack = recentlyBack.includes(row.number);
            const chips: Array<{ text: string; cls: string }> = [];
            if (gap) chips.push({
              text: `${gap.curGap}회 대기 · 평균 ${gap.avgGap}회 (${gap.overdueRatio.toFixed(1)}×)`,
              cls: gap.overdueRatio >= 1.2 ? 'text-orange-300 bg-orange-900/30 border-orange-700/50' : 'text-gray-400 bg-gray-800 border-gray-700',
            });
            if (conn !== undefined) chips.push({ text: `연결 ${conn.toFixed(0)}/100`, cls: conn >= 70 ? 'text-indigo-300 bg-indigo-900/30 border-indigo-700/50' : 'text-gray-400 bg-gray-800 border-gray-700' });
            if (seg) chips.push({ text: `구간 ${seg.label} ${seg.trend}`, cls: 'text-gray-400 bg-gray-800 border-gray-700' });
            if (isBack) chips.push({ text: '장기 공백 후 복귀', cls: 'text-teal-300 bg-teal-900/30 border-teal-700/50' });
            if (gap?.isPeriodic) chips.push({ text: '주기적 출현', cls: 'text-teal-300 bg-teal-900/30 border-teal-700/50' });
            const note = trend === '급락' ? '급락 후 반등 기대' : trend === '급등' ? '상승 모멘텀 유지' : trend === '상승' ? '안정적 상승세' : trend === '하락' ? '저활성 → 회귀 가능' : null;
            return (
              <div key={row.number} onClick={() => onBallClick(row.number)}
                   className="bg-gray-900/80 rounded-xl border border-gray-700/60 p-3 flex items-start gap-3 cursor-pointer hover:bg-gray-700/30 transition-colors"
                   title={`융합 ${row.fusedScore.toFixed(1)}점 · 상위지표 ${row.agreement5}/5 · 안정 ${row.stability === null ? '─' : `${Math.round(row.stability * 100)}%`}${row.contested ? ' · 의견 분열' : ''}`}>
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <div className="text-[9px] text-gray-600 font-bold">#{idx + 1}</div>
                  <Ball num={row.number} small />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${TREND_STYLE[trend] ?? TREND_STYLE['안정']}`} title={TREND_HINT[trend]}>{trend}</span>
                    {note && <span className="text-[10px] text-gray-400">{note}</span>}
                    {row.contested && <span className="text-[10px] font-bold text-red-300">※분열</span>}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {chips.map(c => <span key={c.text} className={`text-[9px] px-1.5 py-0.5 rounded border ${c.cls}`}>{c.text}</span>)}
                  </div>
                  <div className="text-[10px] text-gray-600 mt-1">융합 {row.fusedScore.toFixed(1)} · 상위지표 {row.agreement5}/5 · 안정 {row.stability === null ? '─' : `${Math.round(row.stability * 100)}%`}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
