import { LottoResult } from '../types';
import {
  ADVANCED_SUM_MIN,
  ADVANCED_SUM_MAX,
  isValidAC,
  isValidRatio,
  isValidRangePattern,
  isValidConsecutive,
} from './lottoService';

// 한 회차의 구조 요약 — "최근 당첨 번호" 행 아래에 한 줄로 표시 (합·홀짝·고저·연속·AC·필터 통과·이월)
export interface DrawMeta {
  sum: number;
  odd: number;
  even: number;
  low: number;                 // 1~22
  high: number;                // 23~45
  adjacentPairs: number;       // 이웃한 번호 쌍(n, n+1) 개수
  ac: number;                  // 산술 복잡도 = 서로 다른 차이값 수 − 5
  decades: number[];           // 1~10 / 11~20 / 21~30 / 31~40 / 41~45
  carry: number[];             // 직전 회차 본번호 중 다시 나온 번호(이월수)
  neighbors: number[];         // 직전 회차 번호의 ±1 로 나온 번호(이웃수)
  filters: Array<{ key: string; label: string; ok: boolean }>;
  passAll: boolean;
  failed: string[];
}

export const THEORETICAL_SUM_MEAN = 138;   // 6 × 46 / 2

export function summarizeDraw(draw: LottoResult, prev?: LottoResult): DrawMeta {
  const nums = [...draw.numbers].sort((a, b) => a - b);
  const sum = nums.reduce((a, b) => a + b, 0);
  const odd = nums.filter(n => n % 2 === 1).length;
  const low = nums.filter(n => n <= 22).length;
  let adjacentPairs = 0;
  for (let i = 0; i + 1 < nums.length; i++) if (nums[i + 1] === nums[i] + 1) adjacentPairs++;
  const diffs = new Set<number>();
  for (let i = 0; i < nums.length; i++) for (let j = i + 1; j < nums.length; j++) diffs.add(nums[j] - nums[i]);
  const decades = [0, 0, 0, 0, 0];
  nums.forEach(n => { decades[Math.min(4, Math.floor((n - 1) / 10))]++; });

  const prevNums = prev ? [...prev.numbers] : [];
  const carry = nums.filter(n => prevNums.includes(n));
  const neighbors = nums.filter(n => !prevNums.includes(n) && (prevNums.includes(n - 1) || prevNums.includes(n + 1)));

  const filters = [
    { key: 'sum', label: `합계 ${ADVANCED_SUM_MIN}~${ADVANCED_SUM_MAX}`, ok: sum >= ADVANCED_SUM_MIN && sum <= ADVANCED_SUM_MAX },
    { key: 'ratio', label: '상/하위 비율', ok: isValidRatio(nums) },
    { key: 'range', label: '번대별 ≤3', ok: isValidRangePattern(nums) },
    { key: 'cons', label: '연속번호', ok: isValidConsecutive(nums) },
    { key: 'ac', label: 'AC 5~10', ok: isValidAC(nums) },
  ];
  const failed = filters.filter(f => !f.ok).map(f => f.label);
  return {
    sum, odd, even: 6 - odd, low, high: 6 - low, adjacentPairs, ac: diffs.size - 5, decades,
    carry, neighbors, filters, passAll: failed.length === 0, failed,
  };
}
