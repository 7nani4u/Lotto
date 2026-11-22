// 패널 공용 스타일 토큰 — Tailwind 는 정적 문자열만 인식하므로 동적 조합 대신 조회표를 사용합니다.

export const TREND_STYLE: Record<string, string> = {
  '급락': 'text-blue-300 bg-blue-900/50 border border-blue-700/60',
  '급등': 'text-red-300 bg-red-900/50 border border-red-700/60',
  '상승': 'text-orange-300 bg-orange-900/40 border border-orange-700/60',
  '하락': 'text-cyan-300 bg-cyan-900/40 border border-cyan-700/60',
  '안정': 'text-gray-400 bg-gray-700/50 border border-gray-600/50',
};

export const TREND_ORDER = ['급등', '상승', '안정', '하락', '급락'] as const;

export const TREND_HINT: Record<string, string> = {
  '급등': '최근 5회 2회 이상 출현 · 직전 5회 미출현',
  '상승': '최근 5회 2회 이상 · 직전 5회 1회 이상 출현',
  '안정': '뚜렷한 변화 없음',
  '하락': '최근 10회 연속 미출현',
  '급락': '최근 5회 미출현 · 직전 5회에는 출현',
};

/** 융합 순위 → 구분 라벨 (확정/회피 같은 단정 표현 대신 순위 위치만 기술) */
export const TIER_LABEL: Record<string, { label: string; cls: string }> = {
  pick: { label: 'Top6', cls: 'text-emerald-300 bg-emerald-900/50 border border-emerald-700/60' },
  next: { label: '차순', cls: 'text-yellow-300 bg-yellow-900/40 border border-yellow-700/60' },
  avoid: { label: '하위', cls: 'text-blue-300 bg-blue-900/30 border border-blue-800/50' },
  mid: { label: '─', cls: 'text-gray-500 bg-gray-800/40 border border-gray-700/50' },
};

export const INDICATOR_LABELS: Array<{ key: 'zSubScore' | 'bbSubScore' | 'rsiSubScore' | 'maSubScore' | 'aroonSubScore'; short: string; title: string }> = [
  { key: 'zSubScore', short: 'Z', title: 'Z-Score — 전체 회차 출현 빈도 편차(적게 나왔을수록 높음)' },
  { key: 'bbSubScore', short: 'BB', title: '볼린저 — 최근 20회 횡단면 위치(하단일수록 높음)' },
  { key: 'rsiSubScore', short: 'RSI', title: 'RSI — 최근 12회 출현 모멘텀(낮을수록 높음)' },
  { key: 'maSubScore', short: '추세', title: '추세 묶음 — EMA·MACD 추세 + 공백 초과(식을수록 높음)' },
  { key: 'aroonSubScore', short: '확인', title: '확인 묶음 — ADX·ATR + Aroon 공백(공백이 길수록 높음)' },
];
