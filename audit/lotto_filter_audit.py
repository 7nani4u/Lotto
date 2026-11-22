# -*- coding: utf-8 -*-
"""
lotto_filter_audit.py — 한국 로또 6/45 필터 전수 감사 도구
════════════════════════════════════════════════════════════════════════════════
C(45,6)=8,145,060 개 조합 전부를 한 번씩 평가하여, 현재 필터(총합·비율·번대별·
연속·AC·Sum46)의 제거량·중복·포함관계·임계값 민감도·실행 비용을 "추정이 아니라
전수 실측"으로 산출합니다. 어떤 수치도 표본 추정이나 가정에서 가져오지 않습니다.

[실행]
  python audit/lotto_filter_audit.py                       # 전수 감사
  python audit/lotto_filter_audit.py --draws C:/Temp/winning_numbers_262.txt
  python audit/lotto_filter_audit.py --combos lotto_combinations.txt
  python audit/lotto_filter_audit.py --json audit/audit_result.json

[의존성] numpy (필수), numba (권장 — 없으면 순수 파이썬 루프로 폴백, 매우 느림), scipy (선택: p-value)

[전제 구분]
  · 전수 실측(exact): 조합 공간에 대한 모든 수치 — 가정 없음.
  · H0(귀무가설): "추첨은 독립이며 모든 조합이 동일 확률" — 과거 회차 백테스트의
    기준선으로만 사용. 이 도구는 H0가 참인지 거짓인지를 증명하지 않으며, 과거 적중이
    미래 당첨 확률 상승을 뜻한다고 해석하지 않습니다.
════════════════════════════════════════════════════════════════════════════════
"""
from __future__ import annotations

import argparse
import itertools
import json
import math
import os
import random
import sys
import time

import numpy as np

try:  # numba 는 선택 의존성
    from numba import njit
    HAVE_NUMBA = True
except Exception:  # pragma: no cover
    HAVE_NUMBA = False

    def njit(*_a, **_k):
        def deco(fn):
            return fn
        return deco if not (len(_a) == 1 and callable(_a[0])) else _a[0]

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

N_TOTAL = 8_145_060
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# ── 현재 임계값 (generate_lotto_combinations.py / lottoService.ts 와 동일) ─────────
SUM_MIN, SUM_MAX = 85, 189
RATIO_MIN_X10, RATIO_MAX_X10 = 13, 75      # 1.3 , 7.5  (정수 교차곱으로 비교: 부동소수 오차 제거)
RANGE_CAP = 3
CONS_PAIR_CAP = 2
AC_MIN, AC_MAX = 5, 10


# ════════════════════════════════════════════════════════════════════════════════
# §1. 전수 특징 추출 (조합 1개당 7개 정수 특징; 인덱스 = itertools.combinations 순서)
# ════════════════════════════════════════════════════════════════════════════════
@njit(cache=True)
def _enumerate_features(s, lo, dec, pairs, trip, dist, s46, odd):
    idx = 0
    for a in range(1, 41):
        for b in range(a + 1, 42):
            for c in range(b + 1, 43):
                for d in range(c + 1, 44):
                    for e in range(d + 1, 45):
                        for f in range(e + 1, 46):
                            s[idx] = a + b + c + d + e + f
                            lo[idx] = a + b + c
                            # 번대별 최대 개수
                            cnt0 = 0; cnt1 = 0; cnt2 = 0; cnt3 = 0; cnt4 = 0
                            o = 0
                            for v in (a, b, c, d, e, f):
                                k = (v - 1) // 10
                                if k > 4:
                                    k = 4
                                if k == 0: cnt0 += 1
                                elif k == 1: cnt1 += 1
                                elif k == 2: cnt2 += 1
                                elif k == 3: cnt3 += 1
                                else: cnt4 += 1
                                o += v & 1
                            m = cnt0
                            if cnt1 > m: m = cnt1
                            if cnt2 > m: m = cnt2
                            if cnt3 > m: m = cnt3
                            if cnt4 > m: m = cnt4
                            dec[idx] = m
                            odd[idx] = o
                            # 연속 쌍 / 3연속
                            p = 0
                            t = 0
                            if b == a + 1:
                                p += 1
                                if c == a + 2: t = 1
                            if c == b + 1:
                                p += 1
                                if d == b + 2: t = 1
                            if d == c + 1:
                                p += 1
                                if e == c + 2: t = 1
                            if e == d + 1:
                                p += 1
                                if f == d + 2: t = 1
                            if f == e + 1:
                                p += 1
                            pairs[idx] = p
                            trip[idx] = t
                            # 서로 다른 차이값 개수 (비트마스크, 차이 1..44)
                            m64 = np.uint64(0)
                            m64 |= np.uint64(1) << np.uint64(b - a)
                            m64 |= np.uint64(1) << np.uint64(c - a)
                            m64 |= np.uint64(1) << np.uint64(d - a)
                            m64 |= np.uint64(1) << np.uint64(e - a)
                            m64 |= np.uint64(1) << np.uint64(f - a)
                            m64 |= np.uint64(1) << np.uint64(c - b)
                            m64 |= np.uint64(1) << np.uint64(d - b)
                            m64 |= np.uint64(1) << np.uint64(e - b)
                            m64 |= np.uint64(1) << np.uint64(f - b)
                            m64 |= np.uint64(1) << np.uint64(d - c)
                            m64 |= np.uint64(1) << np.uint64(e - c)
                            m64 |= np.uint64(1) << np.uint64(f - c)
                            m64 |= np.uint64(1) << np.uint64(e - d)
                            m64 |= np.uint64(1) << np.uint64(f - d)
                            m64 |= np.uint64(1) << np.uint64(f - e)
                            cnt = 0
                            while m64:
                                m64 &= m64 - np.uint64(1)
                                cnt += 1
                            dist[idx] = cnt
                            # 합 46 쌍
                            q = 0
                            vals = (a, b, c, d, e, f)
                            for i in range(6):
                                for j in range(i + 1, 6):
                                    if vals[i] + vals[j] == 46:
                                        q += 1
                            s46[idx] = q
                            idx += 1
    return idx


class Space:
    """전수 특징 + 필터 원자 조건(실패=True) 보관."""

    def __init__(self) -> None:
        n = N_TOTAL
        self.s = np.empty(n, np.uint8)
        self.lo = np.empty(n, np.uint8)
        self.dec = np.empty(n, np.uint8)
        self.pairs = np.empty(n, np.uint8)
        self.trip = np.empty(n, np.uint8)
        self.dist = np.empty(n, np.uint8)
        self.s46 = np.empty(n, np.uint8)
        self.odd = np.empty(n, np.uint8)
        t0 = time.perf_counter()
        got = _enumerate_features(self.s, self.lo, self.dec, self.pairs, self.trip,
                                  self.dist, self.s46, self.odd)
        assert got == N_TOTAL, got
        self.enum_sec = time.perf_counter() - t0
        self.hi = (self.s.astype(np.int16) - self.lo.astype(np.int16))   # 상위3 합 (int16)

    # ── 원자 조건 (True = 그 조건으로 "탈락") ────────────────────────────────────
    def atoms(self, sum_min=SUM_MIN, sum_max=SUM_MAX, r_lo=RATIO_MIN_X10, r_hi=RATIO_MAX_X10,
              range_cap=RANGE_CAP, pair_cap=CONS_PAIR_CAP, trip_ban=True,
              ac_min=AC_MIN, ac_max=AC_MAX, s46_cap=2) -> dict[str, np.ndarray]:
        lo = self.lo.astype(np.int32)
        hi = self.hi.astype(np.int32)
        a = {
            "SUM<min":    self.s < sum_min,
            "SUM>max":    self.s > sum_max,
            "RATIO<min":  hi * 10 < r_lo * lo,
            "RATIO>max":  hi * 10 > r_hi * lo,
            "RANGE":      self.dec > range_cap,
            "CONS_TRIPLE": (self.trip == 1) if trip_ban else np.zeros(N_TOTAL, bool),
            "CONS_PAIRS": self.pairs > pair_cap,
            "AC<min":     (self.dist.astype(np.int16) - 5) < ac_min,
            "AC>max":     (self.dist.astype(np.int16) - 5) > ac_max,
            "S46":        self.s46 > s46_cap,
        }
        return a

    GROUPS = {
        "SUM": ("SUM<min", "SUM>max"),
        "RATIO": ("RATIO<min", "RATIO>max"),
        "RANGE": ("RANGE",),
        "CONS": ("CONS_TRIPLE", "CONS_PAIRS"),
        "AC": ("AC<min", "AC>max"),
        "S46": ("S46",),
    }

    def fails(self, **kw) -> dict[str, np.ndarray]:
        at = self.atoms(**kw)
        out = {}
        for g, names in self.GROUPS.items():
            m = at[names[0]].copy()
            for nm in names[1:]:
                m |= at[nm]
            out[g] = m
        return out


# ════════════════════════════════════════════════════════════════════════════════
# §2. 분석 루틴
# ════════════════════════════════════════════════════════════════════════════════
def pct(x: float, d: int = 2) -> str:
    return f"{x * 100:.{d}f}%"


def sequential(fails: dict[str, np.ndarray], order: list[str]) -> list[dict]:
    alive = np.ones(N_TOTAL, bool)
    rows = []
    prev = N_TOTAL
    for g in order:
        alive &= ~fails[g]
        n = int(alive.sum())
        rows.append({"filter": g, "remaining": n, "removed_step": prev - n,
                     "removed_step_rate_of_prev": (prev - n) / prev if prev else 0.0,
                     "cum_removed": N_TOTAL - n, "cum_removal_rate": (N_TOTAL - n) / N_TOTAL})
        prev = n
    return rows


def print_sequential(title: str, rows: list[dict]) -> None:
    print(f"\n  ▶ {title}")
    print(f"    {'필터':<7}{'잔존':>12}{'단계 제거':>12}{'직전 대비':>10}{'누적 제거':>12}{'누적 제거율':>10}")
    for r in rows:
        print(f"    {r['filter']:<7}{r['remaining']:>12,}{r['removed_step']:>12,}"
              f"{pct(r['removed_step_rate_of_prev']):>10}{r['cum_removed']:>12,}{pct(r['cum_removal_rate']):>10}")


def measure_unit_costs(sample: int = 200_000, seed: int = 20260925) -> dict[str, float]:
    """프로젝트의 실제 순수 파이썬 필터 함수(generate_lotto_combinations)를 호출해
    "통과 조합 기준" 호출당 비용(µs)을 실측합니다 (단락 평가 없는 단독 호출)."""
    sys.path.insert(0, ROOT)
    import generate_lotto_combinations as g  # noqa: E402
    rng = random.Random(seed)
    combos = [tuple(sorted(rng.sample(range(1, 46), 6))) for _ in range(sample)]
    fns = {
        "SUM": lambda c: 85 <= c[0] + c[1] + c[2] + c[3] + c[4] + c[5] <= 189,
        "RATIO": g.is_valid_ratio, "RANGE": g.is_valid_range_pattern,
        "CONS": g.is_valid_consecutive, "AC": g.is_valid_ac, "S46": g.is_valid_sum46,
    }
    out = {}
    for name, fn in fns.items():
        best = 1e9
        for _ in range(3):
            t0 = time.perf_counter()
            for c in combos:
                fn(c)
            best = min(best, time.perf_counter() - t0)
        out[name] = best / sample * 1e6
    return out


def order_costs(fails: dict[str, np.ndarray], costs: dict[str, float],
                names: list[str]) -> list[tuple[float, tuple[str, ...]]]:
    """모든 순열의 기대 비용(µs/조합) — 정확한 생존 수로 계산 (독립 가정 없음)."""
    surv: dict[frozenset, int] = {}
    ok = {g: ~fails[g] for g in names}
    for r in range(len(names) + 1):
        for sub in itertools.combinations(names, r):
            m = np.ones(N_TOTAL, bool)
            for g in sub:
                m &= ok[g]
            surv[frozenset(sub)] = int(m.sum())
    res = []
    for perm in itertools.permutations(names):
        c = 0.0
        for k, g in enumerate(perm):
            c += costs[g] * surv[frozenset(perm[:k])] / N_TOTAL
        res.append((c, perm))
    res.sort()
    return res


def overlap_table(fails: dict[str, np.ndarray], names: list[str]) -> list[dict]:
    rows = []
    for i, x in enumerate(names):
        for y in names[i + 1:]:
            rx, ry = fails[x], fails[y]
            inter = int((rx & ry).sum())
            nx, ny = int(rx.sum()), int(ry.sum())
            union = nx + ny - inter
            exp_ind = nx * ny / N_TOTAL
            rows.append({
                "a": x, "b": y, "removed_a": nx, "removed_b": ny, "intersection": inter,
                "jaccard": inter / union if union else 0.0,
                "cond_b_given_a": inter / nx if nx else 0.0,
                "cond_a_given_b": inter / ny if ny else 0.0,
                "expected_if_independent": exp_ind,
                "lift": inter / exp_ind if exp_ind else float("nan"),
                "a_subset_of_b": inter == nx and nx > 0,
                "b_subset_of_a": inter == ny and ny > 0,
            })
    return rows


def sensitivity(sp: Space, base_pass: int) -> list[dict]:
    """한 번에 한 파라미터만 바꿔 최종 통과 수를 재계산 (나머지는 현행 유지)."""
    grid = []

    def run(label: str, **kw) -> int:
        f = sp.fails(**kw)
        alive = np.ones(N_TOTAL, bool)
        for g in ("SUM", "RATIO", "RANGE", "CONS", "AC"):   # S46 은 AC 에 포함되므로 제외(아래에서 별도 증명)
            alive &= ~f[g]
        n = int(alive.sum())
        grid.append({"param": label, "pass": n, "delta_vs_base": n - base_pass,
                     "delta_rate_of_space": (n - base_pass) / N_TOTAL})
        return n

    for v in (70, 75, 80, 85, 90, 95, 100, 105, 110):
        run(f"SUM_MIN={v}", sum_min=v)
    for v in (160, 170, 175, 180, 189, 195, 200, 210):
        run(f"SUM_MAX={v}", sum_max=v)
    for v in (11, 12, 13, 14, 15, 16, 18, 20):
        run(f"RATIO_MIN={v/10:.1f}", r_lo=v)
    for v in (50, 60, 70, 75, 80, 90, 100, 150, 250):
        run(f"RATIO_MAX={v/10:.1f}", r_hi=v)
    for v in (2, 3, 4, 5):
        run(f"RANGE_CAP={v}", range_cap=v)
    for v in (0, 1, 2, 3):
        run(f"CONS_PAIR_CAP={v}", pair_cap=v)
    run("CONS_TRIPLE 허용(쌍 캡 유지)", trip_ban=False)
    for v in (3, 4, 5, 6, 7, 8, 9):
        run(f"AC_MIN={v}", ac_min=v)
    return grid


def atom_report(sp: Space) -> list[dict]:
    at = sp.atoms()
    names = list(at.keys())
    anyfail = np.zeros(N_TOTAL, np.int8)
    for nm in names:
        anyfail += at[nm].astype(np.int8)
    rows = []
    for nm in names:
        r = at[nm]
        n = int(r.sum())
        uniq = int((r & (anyfail == 1)).sum())
        rows.append({"atom": nm, "removed_alone": n, "rate": n / N_TOTAL,
                     "unique": uniq, "unique_rate": uniq / N_TOTAL})
    return rows


# ── 조합 → 사전식 순위(rank) ───────────────────────────────────────────────────
_BINOM = [[math.comb(n, k) for k in range(8)] for n in range(47)]


def combo_rank(arr: np.ndarray) -> np.ndarray:
    """arr: (M,6) int, 오름차순. itertools.combinations(range(1,46),6) 에서의 0-based 인덱스."""
    arr = arr.astype(np.int64)
    rank = np.zeros(arr.shape[0], np.int64)
    prev = np.zeros(arr.shape[0], np.int64)
    B = np.array(_BINOM, dtype=np.int64)
    for i in range(1, 7):
        ci = arr[:, i - 1]
        k = 7 - i
        rank += B[45 - prev, k] - B[46 - ci, k]
        prev = ci
    return rank


def load_rows(path: str) -> np.ndarray:
    rows = []
    bad = 0
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            p = line.split()
            if not p:
                continue
            try:
                v = [int(x) for x in p]
            except ValueError:
                bad += 1
                continue
            if len(v) != 6:
                bad += 1
                continue
            rows.append(v)
    arr = np.array(rows, dtype=np.int64)
    arr.sort(axis=1)
    return arr, bad


def binom_two_sided(k: int, n: int, p: float) -> float:
    """정확 이항 양측 p-value (작은 확률 합산 방식)."""
    try:
        from scipy.stats import binomtest
        return float(binomtest(k, n, p).pvalue)
    except Exception:
        mu = n * p
        sd = math.sqrt(n * p * (1 - p))
        z = (abs(k - mu) - 0.5) / sd
        return math.erfc(max(z, 0) / math.sqrt(2))


# ════════════════════════════════════════════════════════════════════════════════
# §3. 메인
# ════════════════════════════════════════════════════════════════════════════════
def main() -> int:
    ap = argparse.ArgumentParser(description="로또 필터 전수 감사")
    ap.add_argument("--draws", help="과거 당첨번호 txt (한 줄에 6개 번호). 백테스트용")
    ap.add_argument("--combos", help="점검할 조합 파일 (기본: 프로젝트 lotto_combinations.txt)")
    ap.add_argument("--json", help="결과 JSON 저장 경로")
    ap.add_argument("--no-cost", action="store_true", help="순수 파이썬 단가 실측 생략")
    args = ap.parse_args()

    W = 78
    print("=" * W)
    print(" 로또 6/45 필터 전수 감사 (C(45,6)=8,145,060 전부 평가) ".center(W, "="))
    print("=" * W)
    print(f"  numba: {'사용' if HAVE_NUMBA else '없음(순수 파이썬 폴백 — 매우 느림)'}")
    sp = Space()
    print(f"  전수 특징 추출: {sp.enum_sec:.1f}s")
    result: dict = {"N": N_TOTAL}

    fails = sp.fails()
    names6 = list(Space.GROUPS.keys())

    # ── (1) 단독 효과 ───────────────────────────────────────────────────────────
    print("\n[1] 필터 단독 효과 (다른 필터 없이 이 필터만 적용)")
    print(f"    {'필터':<7}{'통과':>12}{'통과율':>9}{'단독 제거':>12}{'제거율':>9}")
    solo = {}
    for g in names6:
        rem = int(fails[g].sum())
        solo[g] = rem
        print(f"    {g:<7}{N_TOTAL-rem:>12,}{pct((N_TOTAL-rem)/N_TOTAL):>9}{rem:>12,}{pct(rem/N_TOTAL):>9}")
    result["solo_removed"] = solo

    # ── (2) 순차 누적 (3가지 순서) ───────────────────────────────────────────────
    print("\n[2] 순차 적용 누적 효과")
    orders = {
        "HEAD 원본 순서  (총합→AC→Sum46→비율→번대별→연속)": ["SUM", "AC", "S46", "RATIO", "RANGE", "CONS"],
        "감사 전 현행   (총합→비율→번대별→연속→AC; Sum46 제외)": ["SUM", "RATIO", "RANGE", "CONS", "AC"],
    }
    result["sequential"] = {}
    for title, od in orders.items():
        rows = sequential(fails, od)
        print_sequential(title, rows)
        result["sequential"][title] = rows
    final_a = sequential(fails, orders["HEAD 원본 순서  (총합→AC→Sum46→비율→번대별→연속)"])[-1]["remaining"]
    final_b = sequential(fails, orders["감사 전 현행   (총합→비율→번대별→연속→AC; Sum46 제외)"])[-1]["remaining"]
    print(f"\n    최종 잔존 일치 여부: HEAD={final_a:,}  현행={final_b:,}  → {'동일' if final_a == final_b else '불일치!'}")
    result["final_pass"] = final_b
    base_alive = np.ones(N_TOTAL, bool)
    for g in ("SUM", "RATIO", "RANGE", "CONS", "AC"):
        base_alive &= ~fails[g]
    base_pass = int(base_alive.sum())
    assert base_pass == final_b

    # ── (3) 마지막 단계 추가 기여 = 고유 제거량 ──────────────────────────────────
    print("\n[3] 고유(독점) 제거량 — 다른 모든 필터가 이미 적용된 뒤에도 이 필터만이 제거하는 조합 수")
    print("    (= 이 필터를 삭제했을 때 복원되는 조합 수)")
    uniq = {}
    for g in names6:
        m = np.ones(N_TOTAL, bool)
        for h in names6:
            if h != g:
                m &= ~fails[h]
        u = int((m & fails[g]).sum())
        uniq[g] = u
        print(f"    {g:<7}{u:>12,}  ({pct(u/N_TOTAL, 3)} of 전체 · 잔존 {pct(u/base_pass, 3)} 에 해당)")
    result["unique_removed"] = uniq

    # ── (4) 원자 조건 단위 ──────────────────────────────────────────────────────
    print("\n[4] 원자 조건(상·하한 분리) 단위 효과")
    print(f"    {'조건':<14}{'단독 제거':>12}{'제거율':>9}{'고유 제거':>12}")
    ar = atom_report(sp)
    for r in ar:
        print(f"    {r['atom']:<14}{r['removed_alone']:>12,}{pct(r['rate']):>9}{r['unique']:>12,}")
    result["atoms"] = ar

    # ── (5) 쌍별 중복·포함 ──────────────────────────────────────────────────────
    print("\n[5] 필터 쌍별 중복(제거 집합 교집합) — lift=1 이면 독립, >1 이면 같은 조합을 반복 제거")
    ov = overlap_table(fails, names6)
    print(f"    {'쌍':<14}{'교집합':>10}{'Jaccard':>9}{'P(b|a)':>9}{'P(a|b)':>9}{'lift':>7}  포함관계")
    for r in ov:
        rel = ""
        if r["a_subset_of_b"]:
            rel = f"{r['a']} ⊆ {r['b']}"
        if r["b_subset_of_a"]:
            rel = f"{r['b']} ⊆ {r['a']}"
        print(f"    {r['a']+'∩'+r['b']:<14}{r['intersection']:>10,}{r['jaccard']:>9.3f}"
              f"{r['cond_b_given_a']:>9.3f}{r['cond_a_given_b']:>9.3f}{r['lift']:>7.2f}  {rel}")
    result["overlap"] = ov

    # ── (6) Sum46 ⊆ AC 증명 보조: 탈락 집합의 AC 분포 ───────────────────────────
    s46f = fails["S46"]
    acs = sp.dist[s46f].astype(int) - 5
    dist = {int(k): int(v) for k, v in zip(*np.unique(acs, return_counts=True))}
    print(f"\n[6] Sum46 탈락 {int(s46f.sum()):,}개 (= C(22,3)={math.comb(22,3):,}) 의 AC 값 분포: {dist}  "
          f"max AC={max(dist) if dist else None}")
    print(f"    전체 공간 AC 분포: "
          f"{ {int(k)-5: int(v) for k, v in zip(*np.unique(sp.dist, return_counts=True))} }")
    result["s46_ac_dist"] = dist

    # ── (7) 임계값 민감도 ───────────────────────────────────────────────────────
    print(f"\n[7] 임계값 민감도 — 한 번에 하나만 변경 (현행 최종 통과 {base_pass:,})")
    grid = sensitivity(sp, base_pass)
    for r in grid:
        mark = "◀ 현행" if r["delta_vs_base"] == 0 else ""
        print(f"    {r['param']:<28}{r['pass']:>12,}{r['delta_vs_base']:>+13,}  ({r['delta_rate_of_space']*100:+6.2f}%p 전체 대비) {mark}")
    result["sensitivity"] = grid

    # ── (8) 실행 순서 비용 ──────────────────────────────────────────────────────
    if not args.no_cost:
        print("\n[8] 실행 순서 비용 — 프로젝트 순수 파이썬 함수 실측 단가 × 정확 생존 수")
        costs = measure_unit_costs()
        for k, v in costs.items():
            print(f"    단가 {k:<6}: {v:6.3f} µs/호출")
        five = ["SUM", "RATIO", "RANGE", "CONS", "AC"]
        res = order_costs(fails, costs, five)
        cur = [c for c, p in res if p == tuple(five)][0]
        best_c, best_p = res[0]
        worst_c, worst_p = res[-1]
        print(f"    현행 순서 {'→'.join(five)}: {cur:.3f} µs/조합")
        print(f"    최적 순서 {'→'.join(best_p)}: {best_c:.3f} µs/조합")
        print(f"    최악 순서 {'→'.join(worst_p)}: {worst_c:.3f} µs/조합")
        leg = ["SUM", "AC", "S46", "RATIO", "RANGE", "CONS"]
        resl = order_costs(fails, costs, leg)
        legc = [c for c, p in resl if p == tuple(leg)][0]
        print(f"    HEAD 원본 순서(Sum46 포함): {legc:.3f} µs/조합")
        print("    상위 5개 순서:")
        for c, p in res[:5]:
            print(f"      {c:.3f} µs  {'→'.join(p)}")
        result["costs_us"] = costs
        result["order"] = {"current": cur, "best": best_c, "best_perm": list(best_p),
                           "worst": worst_c, "head_legacy": legc, "top5": [[c, list(p)] for c, p in res[:5]]}

    # ── (9) Whitson(경로 B) 추가 필터의 강도 (평균합·홀수 목표에 따른 통과 비율) ─────────
    print("\n[9] 경로 B의 Whitson 조건 강도 (현행 필터 통과 집합 내 비율)  |홀수−목표|≤1 AND 합∈[max(85,c−28), min(189,c+28)]")
    wh = {}
    s_i = sp.s.astype(np.int32)
    for tgt in (2, 3, 4):
        for c in (110, 125, 138, 150, 165):
            lo_s, hi_s = max(85, c - 28), min(189, c + 28)
            m = base_alive & (np.abs(sp.odd.astype(np.int16) - tgt) <= 1) & (s_i >= lo_s) & (s_i <= hi_s)
            n = int(m.sum())
            wh[f"odd={tgt},c={c}"] = n
            print(f"    목표홀수={tgt} 평균합={c:>3} → 합[{lo_s},{hi_s}]  통과 {n:>9,} ({pct(n/base_pass)} of 현행 통과)")
    result["whitson"] = wh

    # ── (10) 저장된 조합 파일 무결성 ─────────────────────────────────────────────
    cpath = args.combos or os.path.join(ROOT, "lotto_combinations.txt")
    if os.path.exists(cpath):
        print(f"\n[10] 조합 파일 무결성: {cpath}")
        arr, bad = load_rows(cpath)
        rk = combo_rank(arr)
        # 자기검증: 임의 인덱스 100개에 대해 rank 공식 확인
        rr = random.Random(1)
        samp = rr.sample(range(N_TOTAL), 50)
        ok_rank = True
        for ix in samp:
            c = next(itertools.islice(itertools.combinations(range(1, 46), 6), ix, ix + 1))
            if int(combo_rank(np.array([c]))[0]) != ix:
                ok_rank = False
                break
        n_rows = len(arr)
        uniq_rows = len(np.unique(rk))
        in_valid = base_alive[rk]
        n_valid = int(in_valid.sum())
        print(f"    행 수 {n_rows:,} (파싱 불가 {bad}) · 중복 제거 {uniq_rows:,} · rank 공식 자기검증 {'OK' if ok_rank else 'FAIL'}")
        print(f"    현행 필터 통과 {n_valid:,} ({pct(n_valid/n_rows)}) · 위반 {n_rows-n_valid:,} ({pct((n_rows-n_valid)/n_rows)})")
        print(f"    현행 유효 공간 {base_pass:,} 대비 포함률 {pct(n_valid/base_pass, 3)} · 누락 {base_pass-n_valid:,}")
        first = tuple(arr[0]); last = tuple(arr[-1])
        print(f"    첫 행 {first} · 마지막 행 {last}  (사전식 rank {int(rk[0]):,} ~ {int(rk[-1]):,} / {N_TOTAL:,})")
        monotone = bool(np.all(np.diff(rk) > 0))
        lo_r, hi_r = int(rk.min()), int(rk.max())
        in_range_valid = int(base_alive[lo_r:hi_r + 1].sum())
        print(f"    정렬(사전식 오름차순) 여부: {monotone}")
        print(f"    같은 rank 구간 [{lo_r:,}, {hi_r:,}] 안의 현행 유효 조합 {in_range_valid:,} → 파일이 그 구간을 채운 비율 {pct(n_valid/in_range_valid)}")
        print(f"    첫 번호 최소 {arr[:,0].min()} / 최대 {arr[:,0].max()}; 마지막 번호 최소 {arr[:,5].min()} / 최대 {arr[:,5].max()}")
        # 번호별 출현 비율 비교: 파일 vs 유효 공간
        file_freq = np.bincount(arr.ravel(), minlength=46)[1:] / (n_rows * 6)
        result["combos_file"] = {"path": cpath, "rows": n_rows, "valid": n_valid, "violations": n_rows - n_valid,
                                 "coverage_of_valid_space": n_valid / base_pass, "monotone": monotone,
                                 "first": [int(x) for x in first], "last": [int(x) for x in last],
                                 "num_freq_file": [round(float(x), 4) for x in file_freq]}
        size_full = base_pass * 18
        print(f"    참고: 현행 유효 {base_pass:,}행을 'NN NN NN NN NN NN\\n'(18바이트)로 전부 저장하면 "
              f"{size_full:,} B = {size_full/1024/1024:.1f} MiB (GitHub 일반 푸시 한도 100 MiB)")
        result["full_file_bytes"] = size_full

    # ── (11) 과거 회차 백테스트 ──────────────────────────────────────────────────
    if args.draws and os.path.exists(args.draws):
        print(f"\n[11] 과거 회차 백테스트: {args.draws}")
        d, bad = load_rows(args.draws)
        n = len(d)
        drk = combo_rank(d)
        print(f"    회차 수 {n} (파싱 불가 {bad}) · 중복 회차 {n-len(np.unique(drk))} · 회차번호/날짜/보너스 정보 없음 → 시간 순서 방향 측정 불가")
        hist_alive = base_alive[drk]
        print(f"    {'필터':<7}{'공간 통과율(H0 기대)':>20}{'과거 통과':>10}{'과거 통과율':>11}{'차이(%p)':>10}{'p-value':>10}")
        bt = {}
        for g in names6:
            p_sp = 1 - fails[g].mean()
            k = int((~fails[g][drk]).sum())
            pv = binom_two_sided(k, n, float(p_sp))
            bt[g] = {"space_pass_rate": float(p_sp), "hist_pass": k, "hist_rate": k / n, "p_value": pv}
            print(f"    {g:<7}{pct(p_sp, 3):>20}{k:>10}{pct(k/n):>11}{(k/n-p_sp)*100:>+10.2f}{pv:>10.3f}")
        k_all = int(hist_alive.sum())
        p_all = base_pass / N_TOTAL
        pv_all = binom_two_sided(k_all, n, p_all)
        sd = math.sqrt(p_all * (1 - p_all) / n)
        print(f"    {'전체':<7}{pct(p_all, 3):>20}{k_all:>10}{pct(k_all/n):>11}{(k_all/n-p_all)*100:>+10.2f}{pv_all:>10.3f}")
        print(f"    → H0 하에서 표본 {n}회의 통과율 표준오차 ±{sd*100:.2f}%p (95% 구간 ±{1.96*sd*100:.2f}%p)")
        bt["ALL"] = {"space_pass_rate": p_all, "hist_pass": k_all, "hist_rate": k_all / n, "p_value": pv_all,
                     "se_pp": sd * 100}
        # 파일 순서 기준 4등분 안정성 (순서 방향은 알 수 없으므로 '앞/뒤'라고만 부름)
        blocks = np.array_split(np.arange(n), 4)
        print("    파일 순서 4등분 통과율: " + " · ".join(
            f"{pct(float(hist_alive[b].mean()))}({len(b)})" for b in blocks))
        bt["blocks"] = [float(hist_alive[b].mean()) for b in blocks]
        # 임계값 변형 시 과거 보존률 vs 공간 보존률 (농축도)
        print("\n    임계값 변형별: 공간 보존률 vs 과거 당첨 보존률 (같으면 필터에 정보량이 없음 = 중립)")
        print(f"    {'변형':<26}{'공간 보존률':>11}{'과거 보존률':>11}{'과거 보존 수':>11}{'p-value':>9}")
        variants = [
            ("현행", {}),
            ("SUM 100~175", dict(sum_min=100, sum_max=175)),
            ("SUM 110~170", dict(sum_min=110, sum_max=170)),
            ("RANGE_CAP=2", dict(range_cap=2)),
            ("CONS_PAIR_CAP=1", dict(pair_cap=1)),
            ("AC_MIN=7", dict(ac_min=7)),
            ("AC_MIN=8", dict(ac_min=8)),
            ("RATIO 1.5~6.0", dict(r_lo=15, r_hi=60)),
            ("SUM46 캡=1 (추가)", dict(s46_cap=1)),
        ]
        bt["variants"] = []
        for label, kw in variants:
            f = sp.fails(**kw)
            al = np.ones(N_TOTAL, bool)
            use = ["SUM", "RATIO", "RANGE", "CONS", "AC"] + (["S46"] if "s46_cap" in kw else [])
            for g in use:
                al &= ~f[g]
            ps = float(al.mean())
            kk = int(al[drk].sum())
            pv = binom_two_sided(kk, n, ps)
            bt["variants"].append({"label": label, "space_keep": ps, "hist_keep": kk / n, "hist_kept": kk, "p_value": pv})
            print(f"    {label:<26}{pct(ps):>11}{pct(kk/n):>11}{kk:>11}{pv:>9.3f}")
        print(f"    ※ 변형 {len(variants)-1}개를 동시에 검정했으므로 다중비교 보정 시 유의수준 ≈ {0.05/(len(variants)-1):.4f} 로 봐야 합니다.")
        # 번호 균등성 점검 (H0 가정 확인용)
        freq = np.bincount(d.ravel(), minlength=46)[1:]
        exp = n * 6 / 45
        chi2 = float(((freq - exp) ** 2 / exp).sum())
        try:
            from scipy.stats import chi2 as _c
            pchi = float(_c.sf(chi2, 44))
        except Exception:
            pchi = float("nan")
        print(f"\n    번호 1~45 출현 균등성 χ²(df=44)={chi2:.1f}, p={pchi:.3f}  (기대 {exp:.1f}회/번호) — 균등성 기각 근거 여부 확인용")
        bt["chi2"] = {"stat": chi2, "p": pchi}
        result["backtest"] = bt
    elif args.draws:
        print(f"\n[11] 과거 회차 파일 없음: {args.draws} → 백테스트 측정 불가")

    # ── (12) 구현 비교: HEAD 원본 순서 / 감사 전 / 수정 후 ───────────────────────────
    if not args.no_cost:
        print("\n[12] 구현 비교 (순수 파이썬, 무작위 30만 조합 · 3회 중 최소값) — 판정 일치 여부 포함")
        import importlib.util
        sys.path.insert(0, ROOT)
        import generate_lotto_combinations as new_mod  # noqa: E402
        base_path = os.path.join(HERE, "baseline_generate_lotto_combinations.py")
        impls = [("HEAD 원본 순서(Sum46 포함)", new_mod.passes_all_filters_legacy)]
        if os.path.exists(base_path):
            spec = importlib.util.spec_from_file_location("baseline_gen", base_path)
            bm = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(bm)
            impls.append(("감사 전 현행(순서 최적화)", bm.passes_all_filters))
        impls.append(("수정 후(인라인)", new_mod.passes_all_filters))
        rng = random.Random(20261121)
        sample = [tuple(sorted(rng.sample(range(1, 46), 6))) for _ in range(300_000)]
        ref = [new_mod.passes_all_filters_legacy(c) for c in sample]
        impl_rows = []
        for label, fn in impls:
            best = 1e9
            for _ in range(3):
                t0 = time.perf_counter()
                out = [fn(c) for c in sample]
                best = min(best, time.perf_counter() - t0)
            mism = sum(1 for x, y in zip(out, ref) if x != y)
            us = best / len(sample) * 1e6
            impl_rows.append({"impl": label, "us_per_combo": us, "est_8145060_sec": us * N_TOTAL / 1e6, "mismatch_vs_head": mism})
            print(f"    {label:<24}{us:7.3f} µs/조합 → 전수 환산 {us*N_TOTAL/1e6:5.1f}s · HEAD 대비 판정 불일치 {mism}")
        result["impl_compare"] = impl_rows

    # ── 확률 기초값 (가정 명시) ──────────────────────────────────────────────────
    print("\n[기준] H0(독립·균등) 하에서 1등 확률: 티켓 1장당 1/8,145,060 = "
          f"{1/N_TOTAL:.3e}. 필터 통과 조합 중 임의의 k장을 사면 k/8,145,060 — "
          "어떤 필터를 쓰든 장당 확률은 동일합니다.")
    print(f"       필터 통과 집합 전체를 사더라도 포함 확률은 {pct(base_pass/N_TOTAL, 2)} (<100%) 입니다.")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(result, fh, ensure_ascii=False, indent=1, default=lambda o: o if not isinstance(o, np.generic) else o.item())
        print(f"\n  JSON 저장: {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
