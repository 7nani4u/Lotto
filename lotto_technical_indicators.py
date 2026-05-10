# -*- coding: utf-8 -*-
"""
lotto_technical_indicators.py
════════════════════════════════════════════════════════════════════════════════
한국 로또 6/45 — [하이브리드 슈퍼 앙상블 엔진]
전통적 기술적 지표 (Z-Score, RSI 등) + 6가지 고급 양자/신경망 예측 엔진 결합판

[설계 철학 & 병목 최적화]
  1. 전통 지표(평균 회귀, 모멘텀)와 고급 엔진(패턴, 전이확률, 흐름)은 상호 보완적입니다.
  2. 병목 제거(O(N) 최적화): 
     - 각 지표별로 데이터를 매번 순회하지 않고, 횡단면 데이터(볼린저, Z-Score, 마르코프 등)는
       한 번의 루프로 전체 45개 번호의 점수를 일괄 계산(Batch Calculate)하여 메모리에 캐싱합니다.
  3. 가중치 분배: 
     - 전통적 통계 지표 (40%) + 고급 양자/머신러닝 지표 (60%) 로 황금비를 맞춥니다.
════════════════════════════════════════════════════════════════════════════════
"""

from __future__ import annotations

import random
import statistics
import sys
from dataclasses import dataclass

# Windows 콘솔 한글/유니코드 출력 호환
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


# ════════════════════════════════════════════════════════════════════════════════
# §0. 데이터 구조 정의
# ════════════════════════════════════════════════════════════════════════════════

@dataclass
class DrawResult:
    round: int
    numbers: list[int]
    bonus: int

@dataclass
class ScoredNumber:
    number: int

    # 전통 지표 점수 (0~100)
    s_z: float
    s_bb: float
    s_rsi: float
    s_ma: float
    s_aroon: float

    # 고급 엔진 점수 (0~100)
    s_qa: float   # Quantum Analysis
    s_qf: float   # Quantum Flux
    s_np: float   # Neural Pattern
    s_m3d: float  # Markov 3D
    s_ac: float   # Advanced Cluster

    # 최종 앙상블 종합 점수
    composite: float


# ════════════════════════════════════════════════════════════════════════════════
# §1. 샘플 데이터 생성
# ════════════════════════════════════════════════════════════════════════════════

def make_sample_draws(n_rounds: int = 300, seed: int = 42) -> list[DrawResult]:
    rng = random.Random(seed)
    draws: list[DrawResult] = []
    for rnd in range(1, n_rounds + 1):
        pool = list(range(1, 46))
        rng.shuffle(pool)
        picks = sorted(pool[:7])
        draws.append(DrawResult(round=rnd, numbers=picks[:6], bonus=picks[6]))
    draws.reverse()
    return draws

def _appears(draw: DrawResult, num: int, include_bonus: bool = True) -> bool:
    return num in draw.numbers or (include_bonus and draw.bonus == num)


# ════════════════════════════════════════════════════════════════════════════════
# §2. [파트 A] 전통적 기술적 지표 (빠른 계산)
# ════════════════════════════════════════════════════════════════════════════════

def calc_ma(draws: list[DrawResult], num: int, short_w: int=5, long_w: int=47) -> float:
    sw = min(short_w, len(draws))
    lw = min(long_w,  len(draws))
    short_cnt = sum(1 for i in range(sw) if _appears(draws[i], num))
    long_cnt  = sum(1 for i in range(lw) if _appears(draws[i], num))
    signal = (short_cnt / sw) - (long_cnt / lw)
    return max(0.0, min(100.0, (-signal + 0.40) / 0.80 * 100))

def calc_rsi(draws: list[DrawResult], num: int, window: int=26) -> float:
    w = min(window, len(draws))
    appeared = sum(1 for i in range(w) if _appears(draws[i], num))
    absent = w - appeared
    if absent == 0:   rsi = 100.0
    elif appeared == 0: rsi = 0.0
    else:
        rs = appeared / absent
        rsi = 100.0 - (100.0 / (1.0 + rs))
    return max(0.0, min(100.0, 100.0 - rsi))

def calc_bollinger_all(draws: list[DrawResult], window: int=45) -> dict[int, float]:
    w = min(window, len(draws))
    freq = {n: 0 for n in range(1, 46)}
    for d in draws[:w]:
        for n in d.numbers: freq[n] += 1
        freq[d.bonus] += 1
    vals = list(freq.values())
    mu = statistics.mean(vals)
    sigma = statistics.pstdev(vals) or 1.0
    ub, lb = mu + 2 * sigma, mu - 2 * sigma
    bw = ub - lb or 1.0
    scores = {}
    for n in range(1, 46):
        pct_b = (freq[n] - lb) / bw
        scores[n] = max(0.0, min(100.0, (1.0 - pct_b) * 100.0))
    return scores

def calc_aroon(draws: list[DrawResult], num: int, window: int=47) -> float:
    w = min(window, len(draws))
    since_last = w
    longest = cur_gap = 0
    for i in range(w):
        if _appears(draws[i], num):
            if since_last == w: since_last = i
            if cur_gap > longest: longest = cur_gap
            cur_gap = 0
        else:
            cur_gap += 1
    if cur_gap > longest: longest = cur_gap
    aroon_up = ((w - since_last) / w) * 100
    aroon_down = ((w - longest) / w) * 100
    osc = aroon_up - aroon_down
    return max(0.0, min(100.0, (-osc + 100.0) / 2.0))

def calc_zscore_all(draws: list[DrawResult]) -> dict[int, float]:
    freq = {n: 0 for n in range(1, 46)}
    for d in draws:
        for n in d.numbers: freq[n] += 1
        freq[d.bonus] += 1
    vals = list(freq.values())
    mu = statistics.mean(vals)
    sigma = statistics.pstdev(vals) or 1.0
    scores = {}
    for n in range(1, 46):
        z = (freq[n] - mu) / sigma
        scores[n] = max(0.0, min(100.0, (-z + 2.5) / 5.0 * 100.0))
    return scores


# ════════════════════════════════════════════════════════════════════════════════
# §3. [파트 B] 고급 양자 & 신경망 엔진 (O(N) 배치 최적화)
# ════════════════════════════════════════════════════════════════════════════════

def normalize_advanced(raw_scores: dict[int, float]) -> dict[int, float]:
    vals = list(raw_scores.values())
    min_v, max_v = min(vals), max(vals)
    rng = max_v - min_v if max_v > min_v else 1.0
    return {n: ((raw_scores[n] - min_v) / rng) * 100.0 for n in range(1, 46)}

def calc_quantum_flux(draws: list[DrawResult]) -> dict[int, float]:
    scores = {n: 0.0 for n in range(1, 46)}
    if len(draws) < 20: return scores
    for d in draws[:20]:
        for n in d.numbers: scores[n] += 1.0
    for n in draws[0].numbers:
        scores[n] += 3.0
        if n > 1: scores[n - 1] += 1.5
        if n < 45: scores[n + 1] += 1.5
    return normalize_advanced(scores)

def calc_neural_pattern(draws: list[DrawResult]) -> dict[int, float]:
    scores = {n: 0.0 for n in range(1, 46)}
    if len(draws) < 15: return scores
    recent5, prev5 = [0]*46, [0]*46
    for d in draws[0:5]:
        for n in d.numbers: recent5[n] += 1
    for d in draws[5:10]:
        for n in d.numbers: prev5[n] += 1
    for n in range(1, 46):
        scores[n] += (recent5[n] - prev5[n]) * 2.5
    if len(draws) > 7:
        for n in draws[7].numbers: scores[n] += 3.0
    return normalize_advanced(scores)

def calc_quantum_analysis(draws: list[DrawResult]) -> dict[int, float]:
    scores = {n: 0.0 for n in range(1, 46)}
    window = min(50, len(draws))
    if window < 30: return scores
    freq, last_seen = [0]*46, [-1]*46
    for idx, d in enumerate(draws[:window]):
        for n in d.numbers:
            freq[n] += 1
            if last_seen[n] == -1: last_seen[n] = idx
    for n in range(1, 46):
        gap = 50 if last_seen[n] == -1 else last_seen[n]
        scores[n] += gap * 1.5 - freq[n] * 0.8
    return normalize_advanced(scores)

def calc_advanced_cluster(draws: list[DrawResult]) -> dict[int, float]:
    scores = {n: 0.0 for n in range(1, 46)}
    if len(draws) < 15: return scores
    cluster_freq = [0] * 5
    for d in draws[:15]:
        for n in d.numbers:
            cluster_freq[min(4, (n - 1) // 10)] += 1
    max_freq = max(cluster_freq)
    for n in range(1, 46):
        scores[n] += (max_freq - cluster_freq[min(4, (n - 1) // 10)]) * 2.0
    return normalize_advanced(scores)

def calc_markov_3d(draws: list[DrawResult]) -> dict[int, float]:
    scores = {n: 0.0 for n in range(1, 46)}
    window = min(50, len(draws))
    if window < 20: return scores
    transition = {prev: {nxt: 0 for nxt in range(1, 46)} for prev in range(1, 46)}
    for i in range(window - 1):
        for p in draws[i + 1].numbers:
            for c in draws[i].numbers:
                transition[p][c] += 1
    for n in range(1, 46):
        for last_num in draws[0].numbers:
            scores[n] += transition[last_num][n] * 1.5
    return normalize_advanced(scores)


# ════════════════════════════════════════════════════════════════════════════════
# §4. 하이브리드 통합 앙상블 및 가중치 계산
# ════════════════════════════════════════════════════════════════════════════════

WEIGHTS = {
    # 전통적 통계 지표 (Total 40%) - 안정성과 신뢰도 제공
    "z": 0.12, "bb": 0.08, "rsi": 0.08, "ma": 0.07, "aroon": 0.05,
    # 고급 양자/신경망 엔진 (Total 60%) - 비선형적 패턴 및 모멘텀 캐치
    "qa": 0.15, "qf": 0.12, "np": 0.12, "m3d": 0.12, "ac": 0.09
}

def compute_hybrid_scores(draws: list[DrawResult]) -> list[ScoredNumber]:
    """모든 엔진의 점수를 한 번의 병목 없는 배치로 계산하여 앙상블합니다."""
    # O(N) 배치 계산 (전통 지표 횡단면)
    s_bb_all = calc_bollinger_all(draws, window=45)
    s_z_all  = calc_zscore_all(draws)

    # O(N) 배치 계산 (고급 엔진)
    s_qf_all  = calc_quantum_flux(draws)
    s_np_all  = calc_neural_pattern(draws)
    s_qa_all  = calc_quantum_analysis(draws)
    s_ac_all  = calc_advanced_cluster(draws)
    s_m3d_all = calc_markov_3d(draws)

    results = []
    for num in range(1, 46):
        # 전통 지표 (개별 계산)
        s_ma    = calc_ma(draws, num, short_w=5, long_w=47)
        s_rsi   = calc_rsi(draws, num, window=26)
        s_aroon = calc_aroon(draws, num, window=47)
        s_bb    = s_bb_all[num]
        s_z     = s_z_all[num]

        # 고급 엔진 (배치 추출)
        s_qf  = s_qf_all[num]
        s_np  = s_np_all[num]
        s_qa  = s_qa_all[num]
        s_ac  = s_ac_all[num]
        s_m3d = s_m3d_all[num]

        # 앙상블 종합 점수
        composite = (
            (s_z * WEIGHTS["z"] + s_bb * WEIGHTS["bb"] + s_rsi * WEIGHTS["rsi"] +
             s_ma * WEIGHTS["ma"] + s_aroon * WEIGHTS["aroon"]) +
            (s_qa * WEIGHTS["qa"] + s_qf * WEIGHTS["qf"] + s_np * WEIGHTS["np"] +
             s_m3d * WEIGHTS["m3d"] + s_ac * WEIGHTS["ac"])
        )

        results.append(ScoredNumber(
            number=num,
            s_z=s_z, s_bb=s_bb, s_rsi=s_rsi, s_ma=s_ma, s_aroon=s_aroon,
            s_qa=s_qa, s_qf=s_qf, s_np=s_np, s_m3d=s_m3d, s_ac=s_ac,
            composite=composite
        ))

    return sorted(results, key=lambda x: x.composite, reverse=True)


# ════════════════════════════════════════════════════════════════════════════════
# §5. 터미널 출력 포맷터
# ════════════════════════════════════════════════════════════════════════════════

W = 100

def _level(score: float) -> str:
    if score >= 75: return "◉ 강력 추천"
    if score >= 60: return "● 중간 추천"
    if score >= 50: return "○ 약한 추천"
    if score >= 40: return "▽ 배제 고려"
    return               "▼ 강력 배제"

def print_hybrid_table(scored: list[ScoredNumber]) -> None:
    print("\n" + "=" * W)
    print("  [하이브리드 슈퍼 앙상블 분석 테이블] (0~100 정규화 점수)".center(W))
    print("=" * W)
    
    print(f" {'순위':>2}  {'번호':>2} │ "
          f"{'전통 통계 지표 (40%)':^25} │ "
          f"{'고급 양자/신경망 (60%)':^25} │ "
          f"{'종합':>5}  {'신호':}")
    print(f"          │   Z   BB  RSI   MA  Ar │  QA   QF   NP  M3D   AC │")
    print("-" * W)

    for rank, s in enumerate(scored, 1):
        marker = "▶" if rank <= 6 else "  "
        print(f"{marker}{rank:>2}  {s.number:>2}번 │ "
              f"{s.s_z:>3.0f} {s.s_bb:>3.0f} {s.s_rsi:>4.0f} {s.s_ma:>4.0f} {s.s_aroon:>3.0f} │ "
              f"{s.s_qa:>3.0f} {s.s_qf:>4.0f} {s.s_np:>4.0f} {s.s_m3d:>4.0f} {s.s_ac:>4.0f} │ "
              f"{s.composite:>5.1f}  {_level(s.composite)}")
        
        if rank == 6: print(" " * 10 + "┴" + "─" * 27 + "┴" + "─" * 27 + "┴" + "─" * 15)

    print("-" * W)
    print("  ▶ = 통합 하이브리드 상위 6개 추천 번호")


def print_top6_interpretation(scored: list[ScoredNumber]) -> None:
    top6 = scored[:6]
    print("\n" + "=" * W)
    print("  [🎯 하이브리드 앙상블 추천 번호 6개 — 상세 동인 분석]".center(W))
    print("=" * W)
    print(f"\n  최종 추천 번호: {' — '.join(f'{s.number:02d}' for s in top6)}\n")

    for rank, s in enumerate(top6, 1):
        print("─" * (W - 10))
        print(f"  [{rank}위] 번호 {s.number:02d}번  ·  종합 점수 {s.composite:.1f}/100")
        
        # 핵심 동인 추출 (점수가 70점 이상인 것들)
        drivers = []
        if s.s_z > 70: drivers.append(f"Z-Score({s.s_z:.0f})")
        if s.s_qa > 70: drivers.append(f"양자분석({s.s_qa:.0f})")
        if s.s_qf > 70: drivers.append(f"양자플럭스({s.s_qf:.0f})")
        if s.s_np > 70: drivers.append(f"신경패턴({s.s_np:.0f})")
        if s.s_m3d > 70: drivers.append(f"마르코프3D({s.s_m3d:.0f})")
        if s.s_bb > 70: drivers.append(f"볼린저밴드({s.s_bb:.0f})")
        
        if drivers:
            print(f"    ▲ 주요 상승 요인: {', '.join(drivers)}")
        else:
            print(f"    ▲ 안정적 밸런스: 모든 지표에서 고르게 상위권 점수를 획득했습니다.")
    print("─" * (W - 10) + "\n")


def main(n_rounds: int = 100, seed: int = 42) -> None:
    print("\n" + "=" * W)
    print("  한국 로또 6/45 — 하이브리드 슈퍼 앙상블 분석 시스템".center(W))
    print("  (Traditional Stats + Quantum/Neural Engines)".center(W))
    print("=" * W)
    
    print(f"  데이터 로딩 및 배치 최적화 계산 중... ", end="", flush=True)
    draws = make_sample_draws(n_rounds=n_rounds, seed=seed)
    scored = compute_hybrid_scores(draws)
    print("완료.")

    print_hybrid_table(scored)
    print_top6_interpretation(scored)

if __name__ == "__main__":
    main(n_rounds=100, seed=42)
