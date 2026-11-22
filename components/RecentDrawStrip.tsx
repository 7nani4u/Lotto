import React from 'react';
import { LottoResult } from '../types';
import { DrawMeta, THEORETICAL_SUM_MEAN } from '../services/drawMeta';
import { RetroPick } from '../services/evidence';

// ═══════════════════════════════════════════════════════════════════════════════
// 보조 분석 — 최근 당첨 번호: 회차 행 아래 요약 칩 + 목록 위 10회 요약
//   모바일(<640px): 칩 9개를 3열 격자 3행으로 정렬 (칩 하나가 혼자 다음 줄로 밀리지 않도록)
//   sm 이상: 한 줄 흐름(flex-wrap)
// ═══════════════════════════════════════════════════════════════════════════════

type Tone = 'ok' | 'bad' | 'info' | 'plain';

const TONE: Record<Tone, string> = {
  ok: 'text-emerald-300 bg-emerald-900/30 border-emerald-700/50',
  bad: 'text-red-300 bg-red-900/30 border-red-700/50',
  info: 'text-indigo-300 bg-indigo-900/30 border-indigo-700/50',
  plain: 'text-gray-300 bg-gray-800 border-gray-700',
};

// 칩 안쪽은 flex 가 아닌 인라인 흐름 — flex 면 글자·숫자·단위가 각각 아이템이 되어 "1 /6"처럼 벌어짐
const Chip: React.FC<{ tone?: Tone; title?: string; className?: string; children: React.ReactNode }> = ({ tone = 'plain', title, className = '', children }) => (
  <span title={title}
        className={`block sm:inline-block text-center sm:text-left text-[10px] leading-4 px-1.5 py-[3px] rounded border whitespace-nowrap ${TONE[tone]} ${className}`}>
    {children}
  </span>
);

export const RecentDrawStrip: React.FC<{ meta: DrawMeta; retro?: RetroPick }> = ({ meta, retro }) => {
  const dev = meta.sum - THEORETICAL_SUM_MEAN;
  return (
    <div className="flex flex-col sm:flex-row sm:flex-wrap gap-1.5 px-1 sm:px-2 pb-1">
      <div className="grid grid-cols-3 gap-1.5 sm:contents">
        <Chip title={`번호 합계 (이론 평균 ${THEORETICAL_SUM_MEAN})`}>
          합 <b>{meta.sum}</b> <span className={dev < 0 ? 'text-blue-300' : 'text-red-300'}>{dev > 0 ? '+' : ''}{dev}</span>
        </Chip>
        <Chip title="홀수:짝수">홀짝 <b>{meta.odd}:{meta.even}</b></Chip>
        <Chip title="저(1~22):고(23~45)">저고 <b>{meta.low}:{meta.high}</b></Chip>
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:contents">
        <Chip title="번대 분포 (1~10 / 11~20 / 21~30 / 31~40 / 41~45)">번대 <b>{meta.decades.join('-')}</b></Chip>
        <Chip title="이웃한 번호 쌍(n, n+1)">연번 <b>{meta.adjacentPairs}</b>쌍</Chip>
        <Chip title="산술 복잡도 AC = 서로 다른 차이값 수 − 5">AC <b>{meta.ac}</b></Chip>
      </div>
      <div className="flex flex-wrap gap-1.5 sm:contents">
        <Chip tone={meta.carry.length > 0 ? 'info' : 'plain'} title="직전 회차 본번호가 다시 나온 번호(이월수)">
          이월 {meta.carry.length > 0 ? <b>{meta.carry.join(',')}</b> : '없음'}
        </Chip>
        <Chip tone={meta.passAll ? 'ok' : 'bad'} title={meta.passAll ? '합계·비율·번대별·연속·AC 필터를 모두 통과' : `탈락: ${meta.failed.join(', ')}`}>
          {meta.passAll ? '✓ 필터 통과' : `✗ ${meta.failed.join('·')}`}
        </Chip>
        {retro && (
          <Chip tone={retro.hits >= 3 ? 'ok' : 'plain'}
                title={`그 회차 직전까지의 데이터로 만든 융합 Top6: ${retro.picks.join(' ')} → 적중 ${retro.hits}개${retro.hitNumbers.length ? ` (${retro.hitNumbers.join(', ')})` : ''}`}>
            회고 Top6 적중 <b>{retro.hits}/6</b>
          </Chip>
        )}
      </div>
    </div>
  );
};

export const RecentDrawsSummary: React.FC<{
  draws: LottoResult[]; metas: DrawMeta[]; retro: RetroPick[] | null;
}> = ({ draws, metas, retro }) => {
  if (draws.length === 0) return null;
  const n = metas.length;
  const pass = metas.filter(m => m.passAll).length;
  const avgSum = metas.reduce((s, m) => s + m.sum, 0) / n;
  const avgOdd = metas.reduce((s, m) => s + m.odd, 0) / n;
  const avgCarry = metas.reduce((s, m) => s + m.carry.length, 0) / n;
  const retroN = retro?.length ?? 0;
  const retroMean = retroN > 0 ? retro!.reduce((s, r) => s + r.hits, 0) / retroN : null;
  // 보조문은 한 줄에 들어가는 짧은 문구만 사용 (모바일 2열 카드 폭 ≈ 150px)
  const cell = (label: string, value: React.ReactNode, sub: string, className = '') => (
    <div className={`rounded-lg bg-gray-900 border border-gray-700/60 px-3 py-2 min-w-0 ${className}`}>
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className="text-base font-black text-white leading-tight">{value}</div>
      <div className="text-[10px] text-gray-500 leading-snug">{sub}</div>
    </div>
  );
  const dev = avgSum - THEORETICAL_SUM_MEAN;
  return (
    <div className="ko-flow grid grid-cols-2 md:grid-cols-5 gap-2 mb-5">
      {cell('평균 합계', avgSum.toFixed(0), `이론 ${THEORETICAL_SUM_MEAN} (${dev >= 0 ? '+' : ''}${dev.toFixed(0)})`)}
      {cell('평균 홀수', `${avgOdd.toFixed(1)}개`, '이론 3.0개')}
      {cell('필터 통과', `${pass}/${n}회`, `기대 ${(0.8173 * n).toFixed(1)}회 (81.7%)`)}
      {cell('평균 이월수', `${avgCarry.toFixed(1)}개`, '무작위 기대 0.8개')}
      {cell('회고 Top6 적중', retroMean === null ? '─' : `${retroMean.toFixed(1)}개`,
        `무작위 0.8개${retroN ? ` · ${retroN}회` : ''}`, 'col-span-2 md:col-span-1')}
    </div>
  );
};
