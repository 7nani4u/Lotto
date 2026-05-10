# -*- coding: utf-8 -*-
"""
lotto_technical_indicators.py
════════════════════════════════════════════════════════════════════════════════
한국 로또 6/45 — 하이브리드 슈퍼 앙상블 엔진
전통적 기술 지표 (Z-Score, RSI 등) + 6가지 고급 예측 엔진 결합

[설계 철학]
  1. 전통 지표(평균 회귀·모멘텀)와 고급 엔진(패턴·전이확률·흐름)은 상호 보완적입니다.
  2. 병목 제거(O(N) 최적화):
       횡단면 데이터(볼린저·Z-Score·마르코프 등)는 한 번의 루프로
       전체 45개 번호의 점수를 일괄 계산(Batch Calculate)하여 캐싱합니다.
  3. 가중치 분배:
       전통적 통계 지표 40% + 고급 예측 엔진 6종 60%

[가중치 구성]
  전통 지표 (40%)
    Z-Score 12% · 볼린저밴드 8% · RSI 8% · MA 7% · Aroon 5%
  고급 엔진 6종 (60%)
    양자분석(QA) 12% · 양자플럭스(QF) 10% · 신경패턴(NP) 10%
    마르코프3D(M3D) 10% · 통합양자(IQ) 10% · 고급클러스터(AC) 8%
════════════════════════════════════════════════════════════════════════════════
"""

from __future__ import annotations

import random
import statistics
import sys
from dataclasses import dataclass

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


# ════════════════════════════════════════════════════════════════════════════════
# §0. 데이터 구조
# ════════════════════════════════════════════════════════════════════════════════

@dataclass
class DrawResult:
    round:   int
    numbers: list[int]
    bonus:   int

@dataclass
class ScoredNumber:
    number: int

    # 전통 지표 점수 (0~100, 높을수록 평균 회귀 가능성 높음)
    s_z:     float   # Z-Score 통계 보정
    s_bb:    float   # 볼린저밴드 횡단면 편차
    s_rsi:   float   # RSI 빈도 모멘텀
    s_ma:    float   # MA 빈도 추세
    s_aroon: float   # Aroon 갭 재귀

    # 고급 엔진 점수 (0~100)
    s_qa:  float     # Engine-1: 양자 분석
    s_qf:  float     # Engine-2: 양자 플럭스
    s_np:  float     # Engine-3: 신경 패턴
    s_m3d: float     # Engine-4: 통합 3D 엔진(마르코프)
    s_iq:  float     # Engine-5: 통합 양자 분석 엔진
    s_ac:  float     # Engine-6: 고급 클러스터 융합

    composite: float  # 앙상블 종합 점수


# ════════════════════════════════════════════════════════════════════════════════
# §1. 샘플 데이터 생성기
# ════════════════════════════════════════════════════════════════════════════════

def make_sample_draws(n_rounds: int = 100, seed: int = 42) -> list[DrawResult]:
    rng = random.Random(seed)
    draws: list[DrawResult] = []
    for rnd in range(1, n_rounds + 1):
        pool = list(range(1, 46))
        rng.shuffle(pool)
        picks = sorted(pool[:7])
        draws.append(DrawResult(round=rnd, numbers=picks[:6], bonus=picks[6]))
    draws.reverse()
    return draws

def _appears(draw: DrawResult, num: int) -> bool:
    return num in draw.numbers or draw.bonus == num


# ════════════════════════════════════════════════════════════════════════════════
# §2. 파트 A — 전통적 기술 지표 (평균 회귀 관점, 1년치 최적화 파라미터)
# ════════════════════════════════════════════════════════════════════════════════

def calc_ma(draws: list[DrawResult], num: int,
            short_w: int = 5, long_w: int = 47) -> float:
    """MA 크로스오버 → 점수 (음수 신호 = 최근 빈도 감소 = 높은 점수)"""
    sw = min(short_w, len(draws))
    lw = min(long_w,  len(draws))
    short_cnt = sum(1 for i in range(sw) if _appears(draws[i], num))
    long_cnt  = sum(1 for i in range(lw) if _appears(draws[i], num))
    signal = (short_cnt / sw) - (long_cnt / lw)
    return max(0.0, min(100.0, (-signal + 0.40) / 0.80 * 100.0))

def calc_rsi(draws: list[DrawResult], num: int, window: int = 26) -> float:
    """RSI → 점수 (RSI 낮을수록 과소출현, 높은 점수)"""
    w = min(window, len(draws))
    appeared = sum(1 for i in range(w) if _appears(draws[i], num))
    absent   = w - appeared
    if absent   == 0: rsi = 100.0
    elif appeared == 0: rsi = 0.0
    else: rsi = 100.0 - (100.0 / (1.0 + appeared / absent))
    return max(0.0, min(100.0, 100.0 - rsi))

def calc_bollinger_all(draws: list[DrawResult], window: int = 45) -> dict[int, float]:
    """볼린저밴드 %B → 점수 (하단밴드 하회 = 높은 점수) — 전체 45번호 일괄 계산"""
    w = min(window, len(draws))
    freq = {n: 0 for n in range(1, 46)}
    for d in draws[:w]:
        for n in d.numbers: freq[n] += 1
        freq[d.bonus] += 1
    vals  = list(freq.values())
    mu    = statistics.mean(vals)
    sigma = statistics.pstdev(vals) or 1.0
    ub, lb = mu + 2 * sigma, mu - 2 * sigma
    bw = ub - lb or 1.0
    return {n: max(0.0, min(100.0, (1.0 - (freq[n] - lb) / bw) * 100.0))
            for n in range(1, 46)}

def calc_aroon(draws: list[DrawResult], num: int, window: int = 47) -> float:
    """Aroon 오실레이터 → 점수 (음수 오실레이터 = 장기 공백 = 높은 점수)"""
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
    aroon_up   = ((w - since_last) / w) * 100
    aroon_down = ((w - longest)    / w) * 100
    osc = aroon_up - aroon_down
    return max(0.0, min(100.0, (-osc + 100.0) / 2.0))

def calc_zscore_all(draws: list[DrawResult]) -> dict[int, float]:
    """Z-Score → 점수 (음수 Z = 과소출현 = 높은 점수) — 전체 회차 일괄 계산"""
    freq = {n: 0 for n in range(1, 46)}
    for d in draws:
        for n in d.numbers: freq[n] += 1
        freq[d.bonus] += 1
    vals  = list(freq.values())
    mu    = statistics.mean(vals)
    sigma = statistics.pstdev(vals) or 1.0
    return {n: max(0.0, min(100.0, (-(freq[n] - mu) / sigma + 2.5) / 5.0 * 100.0))
            for n in range(1, 46)}


# ════════════════════════════════════════════════════════════════════════════════
# §3. 파트 B — 고급 예측 엔진 6종 (O(N) 배치 최적화)
# ════════════════════════════════════════════════════════════════════════════════

def _normalize(raw: dict[int, float]) -> dict[int, float]:
    """원시 점수 딕셔너리를 0~100 범위로 정규화합니다."""
    vals = list(raw.values())
    lo, hi = min(vals), max(vals)
    span = hi - lo if hi > lo else 1.0
    return {n: (raw[n] - lo) / span * 100.0 for n in range(1, 46)}


# ── Engine-1: 양자 분석 (QA) ──────────────────────────────────────────────────
def calc_quantum_analysis(draws: list[DrawResult]) -> dict[int, float]:
    """
    [양자 분석 — Quantum Analysis]
    최근 50회차의 출현 빈도와 마지막 출현 이후 경과 회차(갭)를 통합합니다.
      Score(n) = gap(n) × 1.5 − freq(n) × 0.8
    오랫동안 나오지 않고(갭 크고) 빈도가 낮은 번호에 높은 점수 부여.
    """
    scores = {n: 0.0 for n in range(1, 46)}
    window = min(50, len(draws))
    if window < 30:
        return scores
    freq, last_seen = [0] * 46, [-1] * 46
    for idx, d in enumerate(draws[:window]):
        for n in d.numbers:
            freq[n] += 1
            if last_seen[n] == -1: last_seen[n] = idx
        if last_seen[d.bonus] == -1: last_seen[d.bonus] = idx
    for n in range(1, 46):
        gap = 50 if last_seen[n] == -1 else last_seen[n]
        scores[n] = gap * 1.5 - freq[n] * 0.8
    return _normalize(scores)


# ── Engine-2: 양자 플럭스 (QF) ───────────────────────────────────────────────
def calc_quantum_flux(draws: list[DrawResult]) -> dict[int, float]:
    """
    [양자 플럭스 — Quantum Flux (흐름 공식)]
    최근 20회차 출현 빈도를 에너지 기반으로 집계한 뒤,
    가장 최근 회차 번호의 인접 번호(±1)로 에너지를 전파합니다.
      - 최근 출현 번호: +1.0 에너지 누적
      - 최근 회차 번호: +3.0 추가 (흐름의 핵심)
      - 인접 번호 (±1): +1.5 전파
    에너지가 낮은 번호 = 흐름에서 소외된 번호 → 높은 점수.
    """
    scores = {n: 0.0 for n in range(1, 46)}
    if len(draws) < 20:
        return scores
    for d in draws[:20]:
        for n in d.numbers: scores[n] += 1.0
    for n in draws[0].numbers:
        scores[n] += 3.0
        if n > 1:  scores[n - 1] += 1.5
        if n < 45: scores[n + 1] += 1.5
    # 역전: 에너지 낮을수록 출현 기대 높음
    raw_inv = {n: -scores[n] for n in range(1, 46)}
    return _normalize(raw_inv)


# ── Engine-3: 신경 패턴 (NP) ─────────────────────────────────────────────────
def calc_neural_pattern(draws: list[DrawResult]) -> dict[int, float]:
    """
    [신경 패턴 — Neural Pattern]
    최근 5회차와 그 이전 5회차의 번호 출현 패턴 변화를 분석합니다.
      Delta(n) = recent5(n) − prev5(n)
    Delta가 음수(최근 출현 감소 추세)인 번호는 평균 회귀 기대.
    추가로 7회차 전 출현 번호는 일정 주기 패턴 가산점.
    """
    scores = {n: 0.0 for n in range(1, 46)}
    if len(draws) < 15:
        return scores
    recent5, prev5 = [0] * 46, [0] * 46
    for d in draws[0:5]:
        for n in d.numbers: recent5[n] += 1
    for d in draws[5:10]:
        for n in d.numbers: prev5[n] += 1
    for n in range(1, 46):
        scores[n] += (recent5[n] - prev5[n]) * 2.5
    if len(draws) > 7:
        for n in draws[7].numbers: scores[n] += 3.0
    # 역전: 감소 추세 번호(Delta 낮음)에 높은 점수
    raw_inv = {n: -scores[n] for n in range(1, 46)}
    return _normalize(raw_inv)


# ── Engine-4: 통합 3D 엔진 / 마르코프 3D (M3D) ───────────────────────────────
def calc_markov_3d(draws: list[DrawResult]) -> dict[int, float]:
    """
    [통합 3D 엔진 — Markov 3D]
    3가지 차원(번호 × 시간 × 전이 확률)을 결합한 통합 예측 시스템.
    전이 확률 행렬: T[p][c] = 번호 p 이후 회차에 번호 c가 출현한 횟수.
    최근 회차 번호들로부터 다음 회차에 출현할 번호를 전이 확률로 예측.
      Score(n) = Σ T[last_num][n] × 1.5  (최근 회차 번호 기준)
    """
    scores = {n: 0.0 for n in range(1, 46)}
    window = min(50, len(draws))
    if window < 20:
        return scores
    transition = {p: {c: 0 for c in range(1, 46)} for p in range(1, 46)}
    for i in range(window - 1):
        for p in draws[i + 1].numbers:
            for c in draws[i].numbers:
                transition[p][c] += 1
    for n in range(1, 46):
        for last_num in draws[0].numbers:
            scores[n] += transition[last_num][n] * 1.5
    return _normalize(scores)


# ── Engine-5: 통합 양자 분석 엔진 (IQ) ──────────────────────────────────────
def calc_integrated_quantum(draws: list[DrawResult]) -> dict[int, float]:
    """
    [통합 양자 분석 엔진 — Integrated Quantum (포괄적 예측 공식)]
    6종 엔진 중 가장 포괄적인 공식으로, 두 가지 분석을 결합합니다.

    ① 다중 시간 지평 빈도 편차:
         단기(5회차) × 0.50 + 중기(15회차) × 0.30 + 장기(30회차) × 0.20
         각 지평에서 이론 기대값(window × 7/45)과의 편차 계산
         → 과소출현 번호 = 양수 점수 = 회귀 기대 높음

    ② 갭 주기성 분석:
         현재 공백(마지막 출현 이후 경과 회차)과
         역사적 평균 갭을 비교하여 초과 공백에 가산점 부여
         → 평균보다 오래 쉰 번호에 추가 점수 × 0.4
    """
    scores = {n: 0.0 for n in range(1, 46)}
    if len(draws) < 10:
        return scores

    # ① 다중 시간 지평 빈도 편차
    for window, weight in [(5, 0.50), (15, 0.30), (30, 0.20)]:
        w = min(window, len(draws))
        expected = w * 7.0 / 45.0   # 이론 기대 출현 횟수 (보너스 포함)
        freq = {n: 0 for n in range(1, 46)}
        for d in draws[:w]:
            for n in d.numbers: freq[n] += 1
            freq[d.bonus] += 1
        for n in range(1, 46):
            scores[n] += (expected - freq[n]) * weight  # 과소출현 = 양수

    # ② 갭 주기성 분석
    history = min(80, len(draws))
    for n in range(1, 46):
        # 현재 공백: 마지막 출현 이후 경과 회차
        current_gap = history
        for i in range(history):
            if _appears(draws[i], n):
                current_gap = i
                break
        # 역사적 평균 갭 계산
        gaps, last_idx = [], -1
        for i in range(history):
            if _appears(draws[i], n):
                if last_idx >= 0:
                    gaps.append(i - last_idx)
                last_idx = i
        avg_gap = (sum(gaps) / len(gaps)) if gaps else 6.4  # 이론값 45/7
        # 현재 공백 > 평균 공백 → 출현 기대 상승
        scores[n] += max(0.0, current_gap - avg_gap) * 0.4

    return _normalize(scores)


# ── Engine-6: 고급 클러스터 융합 (AC) ────────────────────────────────────────
def calc_advanced_cluster(draws: list[DrawResult]) -> dict[int, float]:
    """
    [고급 클러스터 융합 — Advanced Cluster Fusion]
    고차수 분석(번호를 5개 클러스터로 분류) + 클러스터 기반 융합 시스템.
    클러스터: 1~10 / 11~20 / 21~30 / 31~40 / 41~45 (5구간)
    최근 15회차에서 각 클러스터의 출현 빈도를 분석하여,
    가장 덜 출현한 클러스터에 속한 번호에 높은 점수를 부여합니다.
      Score(n) = (max_cluster_freq - cluster_freq[n]) × 2.0
    클러스터 내 균형이 무너진 구간을 포착하는 것이 핵심입니다.
    """
    scores = {n: 0.0 for n in range(1, 46)}
    if len(draws) < 15:
        return scores
    cluster_freq = [0] * 5
    for d in draws[:15]:
        for n in d.numbers:
            cluster_freq[min(4, (n - 1) // 10)] += 1
    max_freq = max(cluster_freq)
    for n in range(1, 46):
        scores[n] = (max_freq - cluster_freq[min(4, (n - 1) // 10)]) * 2.0
    return _normalize(scores)


# ════════════════════════════════════════════════════════════════════════════════
# §4. 앙상블 엔진 — 가중치 & 통합 계산
# ════════════════════════════════════════════════════════════════════════════════

WEIGHTS = {
    # ── 전통 통계 지표 (합 40%) ──────────────────────────────
    "z":     0.12,   # Z-Score          : 1년 누적 기반, 가장 안정적
    "bb":    0.08,   # 볼린저밴드 %B     : 최근 편차, Z 단기 보완
    "rsi":   0.08,   # RSI               : 반년 모멘텀, 직관적
    "ma":    0.07,   # MA 크로스오버     : 5vs47 추세 방향
    "aroon": 0.05,   # Aroon             : 갭 재귀성, 보조
    # ── 고급 예측 엔진 6종 (합 60%) ──────────────────────────
    "qa":    0.12,   # Engine-1 양자분석 : 빈도+갭 통합, 최고 가중
    "qf":    0.10,   # Engine-2 양자플럭스: 에너지 흐름 전파
    "np":    0.10,   # Engine-3 신경패턴  : 단기 출현 패턴 변화
    "m3d":   0.10,   # Engine-4 통합3D   : 마르코프 전이 확률
    "iq":    0.10,   # Engine-5 통합양자  : 다중 지평 + 갭 주기
    "ac":    0.08,   # Engine-6 클러스터  : 구간별 밀도 불균형
}
# 검증: sum(WEIGHTS.values()) == 1.00

def compute_hybrid_scores(draws: list[DrawResult]) -> list[ScoredNumber]:
    """
    모든 엔진 점수를 O(N) 배치로 계산하고 앙상블 종합 점수를 반환합니다.
    횡단면 데이터(볼린저·Z-Score·6종 고급 엔진)는 한 번 계산 후 전체 공유.
    """
    # ── 배치 계산 (전통 지표) ─────────────────────────────────────────────────
    bb_all = calc_bollinger_all(draws, window=45)
    z_all  = calc_zscore_all(draws)

    # ── 배치 계산 (고급 엔진 6종) ─────────────────────────────────────────────
    qa_all  = calc_quantum_analysis(draws)
    qf_all  = calc_quantum_flux(draws)
    np_all  = calc_neural_pattern(draws)
    m3d_all = calc_markov_3d(draws)
    iq_all  = calc_integrated_quantum(draws)
    ac_all  = calc_advanced_cluster(draws)

    results: list[ScoredNumber] = []
    for num in range(1, 46):
        # 전통 지표 (번호별 개별 계산)
        s_ma    = calc_ma(draws, num)
        s_rsi   = calc_rsi(draws, num)
        s_aroon = calc_aroon(draws, num)
        s_bb    = bb_all[num]
        s_z     = z_all[num]

        # 고급 엔진 (배치 추출)
        s_qa  = qa_all[num]
        s_qf  = qf_all[num]
        s_np  = np_all[num]
        s_m3d = m3d_all[num]
        s_iq  = iq_all[num]
        s_ac  = ac_all[num]

        composite = (
            s_z     * WEIGHTS["z"]     +
            s_bb    * WEIGHTS["bb"]    +
            s_rsi   * WEIGHTS["rsi"]   +
            s_ma    * WEIGHTS["ma"]    +
            s_aroon * WEIGHTS["aroon"] +
            s_qa    * WEIGHTS["qa"]    +
            s_qf    * WEIGHTS["qf"]    +
            s_np    * WEIGHTS["np"]    +
            s_m3d   * WEIGHTS["m3d"]   +
            s_iq    * WEIGHTS["iq"]    +
            s_ac    * WEIGHTS["ac"]
        )

        results.append(ScoredNumber(
            number=num,
            s_z=s_z, s_bb=s_bb, s_rsi=s_rsi, s_ma=s_ma, s_aroon=s_aroon,
            s_qa=s_qa, s_qf=s_qf, s_np=s_np, s_m3d=s_m3d, s_iq=s_iq, s_ac=s_ac,
            composite=composite,
        ))

    return sorted(results, key=lambda x: x.composite, reverse=True)


# ════════════════════════════════════════════════════════════════════════════════
# §5. 출력 포맷터
# ════════════════════════════════════════════════════════════════════════════════

W = 118   # 출력 전체 너비 (컬럼 수 증가에 맞춰 확장)

def _bar(score: float, width: int = 8) -> str:
    filled = round(score / 100 * width)
    return "█" * filled + "░" * (width - filled)

def _level(score: float) -> str:
    if score >= 75: return "◉ 강력 추천"
    if score >= 60: return "● 중간 추천"
    if score >= 50: return "○ 약한 추천"
    if score >= 40: return "▽ 배제 고려"
    return               "▼ 강력 배제"


# ── §5-1. 전체 데이터 테이블 ──────────────────────────────────────────────────

def print_full_table(scored: list[ScoredNumber]) -> None:
    """
    📋 전체 데이터 테이블 — 1~45번 출현가능성 점수 전체
    전통 지표 5종 + 고급 엔진 6종 + 앙상블 종합 점수를 한눈에 표시.
    """
    print("\n" + "=" * W)
    print("  📋 전체 데이터 테이블 — 1~45번 출현가능성 점수 전체 (종합 점수 내림차순)".center(W))
    print("=" * W)

    hdr1 = (
        f"{'':>5}  {'':>2}  "
        f"{'── 전통 통계 지표 (40%) ──────────────':^38}  "
        f"{'── 고급 예측 엔진 6종 (60%) ─────────────────────────────────':^62}  "
        f"{'앙상블':>7}"
    )
    hdr2 = (
        f"{'순위':>4}  {'번':>2}  "
        f"{'Z-Sc':>5} {'BB':>5} {'RSI':>5} {'MA':>5} {'Aroon':>5}  "
        f"{'QA':>5} {'QF':>5} {'NP':>5} {'M3D':>5} {'IQ':>5} {'AC':>5}  "
        f"{'종합':>7}  {'신호'}"
    )
    print(hdr1)
    print(hdr2)
    print("-" * W)

    for rank, s in enumerate(scored, 1):
        marker = "▶" if rank <= 6 else " "
        print(
            f"{marker}{rank:>3}  {s.number:>2}번  "
            f"{s.s_z:>5.1f} {s.s_bb:>5.1f} {s.s_rsi:>5.1f} "
            f"{s.s_ma:>5.1f} {s.s_aroon:>5.1f}  "
            f"{s.s_qa:>5.1f} {s.s_qf:>5.1f} {s.s_np:>5.1f} "
            f"{s.s_m3d:>5.1f} {s.s_iq:>5.1f} {s.s_ac:>5.1f}  "
            f"{s.composite:>7.2f}  {_level(s.composite)}"
        )
        if rank == 6:
            print("  " + "┄" * (W - 4))

    print("-" * W)
    print(
        "  ▶ = 앙상블 상위 6개 추천 번호\n"
        "  컬럼: Z=Z-Score  BB=볼린저밴드  RSI  MA  Aroon  "
        "QA=양자분석  QF=양자플럭스  NP=신경패턴  M3D=통합3D  IQ=통합양자  AC=클러스터"
    )


# ── §5-2. 기술 지표 분석 패널 ────────────────────────────────────────────────

def print_technical_panel(scored: list[ScoredNumber]) -> None:
    """
    📈 기술 지표 분석 (MA · RSI · 볼린저밴드 · Aroon — 평균 회귀 관점)
    5가지 전통 지표 각각의 독립 예측 결과 + 다중 신호 컨센서스 출력.
    """
    print("\n" + "=" * W)
    print("  📈 기술 지표 분석 — MA · RSI · 볼린저밴드 · Aroon (평균 회귀 관점)".center(W))
    print("  각 지표가 독립적으로 포착한 과소출현 번호를 확인합니다.".center(W))
    print("=" * W)

    indicators = [
        {
            "code":     "Z-Score",
            "name":     "Z-Score 통계 보정",
            "subtitle": "전체 기간 누적 출현 빈도의 횡단면 표준편차 분석",
            "desc": (
                "전체 분석 회차에서 각 번호의 출현 빈도를 집계하고,\n"
                "  45개 번호 평균 대비 각 번호의 표준 편차(σ)를 계산합니다.\n"
                "  공식: Z(n) = −(freq(n) − μ) / σ   → 과소출현 번호 = 음수 Z = 높은 점수\n"
                "  범위: ±2.5σ 내 정규화 (52회차 데이터에 최적화, 가중치 12%)"
            ),
            "key": "s_z",
        },
        {
            "code":     "BB",
            "name":     "볼린저밴드 횡단면 편차 (%B)",
            "subtitle": "최근 45회 롤링 윈도우 기반 밴드 이탈 분석",
            "desc": (
                "최근 45회차 출현 빈도 기준, 볼린저밴드(μ ± 2σ)의 하단 이탈 번호를 포착합니다.\n"
                "  공식: %B(n) = (freq(n) − LB) / (UB − LB)   → 0에 가까울수록 과소출현\n"
                "  점수 = (1 − %B) × 100  →  하단 이탈 번호일수록 높은 점수\n"
                "  Z-Score의 단기(45회) 보완 지표 (가중치 8%)"
            ),
            "key": "s_bb",
        },
        {
            "code":     "RSI",
            "name":     "RSI 빈도 모멘텀",
            "subtitle": "최근 26회 반년 구간 출현 모멘텀 분석",
            "desc": (
                "주가 RSI를 번호 출현/미출현 이진 데이터에 적용합니다.\n"
                "  공식: RSI = 100 − 100 / (1 + 출현횟수 / 미출현횟수)  (26회 윈도우)\n"
                "  점수 = 100 − RSI   → RSI가 낮을수록(과소출현) 높은 점수\n"
                "  RSI < 30 ≈ 점수 > 70 : 극단적 과소출현 신호 (가중치 8%)"
            ),
            "key": "s_rsi",
        },
        {
            "code":     "MA",
            "name":     "MA 크로스오버 빈도 추세",
            "subtitle": "단기(5회) vs 장기(47회) 출현율 크로스오버",
            "desc": (
                "단기 출현율(최근 5회)과 장기 출현율(최근 47회)의 차이를 비교합니다.\n"
                "  공식: Signal = 단기출현율 − 장기출현율\n"
                "  Signal < 0 : 최근 빈도 감소 추세 → 평균 회귀 기대 → 높은 점수\n"
                "  범위: ±0.40 정규화 (1년치 5/47 윈도우 최적화, 가중치 7%)"
            ),
            "key": "s_ma",
        },
        {
            "code":     "Aroon",
            "name":     "Aroon 오실레이터 갭 재귀",
            "subtitle": "최근 47회 구간 내 출현 주기성 및 공백 기간 분석",
            "desc": (
                "Aroon Up/Down 지표를 번호 출현 패턴에 적용합니다.\n"
                "  Aroon Up   = (window − 마지막출현위치) / window × 100\n"
                "  Aroon Down = (window − 최장공백기간)  / window × 100\n"
                "  오실레이터 = Up − Down  → 음수(장기 미출현) = 높은 점수 (가중치 5%)"
            ),
            "key": "s_aroon",
        },
    ]

    for ind in indicators:
        key = ind["key"]
        by_ind = sorted(scored, key=lambda s, k=key: getattr(s, k), reverse=True)
        top5 = [f"{s.number:02d}({getattr(s, key):.0f})" for s in by_ind[:5]]
        bot5 = [f"{s.number:02d}({getattr(s, key):.0f})" for s in by_ind[-5:]]

        top_score = getattr(by_ind[0], key)
        if top_score >= 80:
            signal_str = "🔴 강한 회귀 신호"
        elif top_score >= 65:
            signal_str = "🟡 중간 회귀 신호"
        else:
            signal_str = "⚪ 약한 신호"

        sep = "─" * max(2, W - len(ind["code"]) - len(ind["name"]) - 13)
        print()
        print(f"  ┌─ [{ind['code']}]  {ind['name']}  {sep}")
        print(f"  │  ▸ {ind['subtitle']}")
        for line in ind["desc"].splitlines():
            print(f"  │  {line}")
        print(f"  │  신호 강도 : {signal_str}   (최고점수 {top_score:.1f}점)")
        print(f"  │")
        print(f"  │  출현 기대↑ 상위 5개 : {' › '.join(top5)}")
        print(f"  │  출현 기대↓ 하위 5개 : {' › '.join(bot5)}")
        print(f"  └{'─' * (W - 4)}")

    # ── 다중 신호 컨센서스 ────────────────────────────────────────────────────────
    print()
    print("─" * W)
    print("  📡 다중 신호 컨센서스 — 전통 지표 3개 이상 동시 회귀 신호 번호".center(W))
    print("─" * W)
    print("  기준 : 5개 전통 지표 중 점수 ≥ 65점인 지표가 3개 이상인 번호")
    print("  해석 : 복수 지표가 동시에 '과소출현(평균 회귀 기대)' 신호를 발생시킨 번호")
    print()

    THRESHOLD = 65.0
    consensus = []
    for s in scored:
        trad = [s.s_z, s.s_bb, s.s_rsi, s.s_ma, s.s_aroon]
        cnt = sum(1 for v in trad if v >= THRESHOLD)
        if cnt >= 3:
            consensus.append((s.number, cnt, s.composite, trad))

    if consensus:
        consensus.sort(key=lambda x: (-x[1], -x[2]))
        ind_labels = ["Z", "BB", "RSI", "MA", "Aroon"]
        for num, cnt, comp, tscores in consensus:
            active = [lbl for lbl, v in zip(ind_labels, tscores) if v >= THRESHOLD]
            filled = "█" * cnt + "░" * (5 - cnt)
            print(f"  {num:02d}번  [{filled}] {cnt}/5 신호  종합:{comp:>5.1f}점  "
                  f"활성 지표: {' + '.join(active)}")
    else:
        print("  ※ 전통 지표 3개 이상 동시 회귀 신호 번호가 없습니다.")
        print("     → 현재 데이터에서 전통 지표들의 의견이 분산되어 있습니다.")
        print("     → 임계값(65점)을 낮추면 더 많은 번호가 포함됩니다.")

    print()


# ── §5-3. 고급 예측 엔진 6종 패널 ────────────────────────────────────────────

def print_engine_panel(scored: list[ScoredNumber]) -> None:
    """
    🔬 고급 예측 엔진 6종 상세 분석 패널
    각 엔진의 원리, 현재 상위 5개 / 하위 5개 번호를 독립적으로 출력합니다.
    """
    print("\n" + "=" * W)
    print("  🔬 고급 예측 엔진 6종 — 상세 분석 패널".center(W))
    print("  각 엔진이 독립적으로 예측한 출현 가능성 순위를 확인합니다.".center(W))
    print("=" * W)

    engines = [
        {
            "code":    "Engine-1  QA",
            "name":    "양자 분석 (Quantum Analysis)",
            "subtitle":"출현 빈도 + 마지막 출현 갭 통합 분석",
            "desc": (
                "최근 50회차의 출현 빈도와 마지막 출현 이후 경과 회차(갭)를 통합합니다.\n"
                "  공식: Score = gap × 1.5 − freq × 0.8\n"
                "  오랫동안 미출현(갭 크고)하고 빈도가 낮은 번호에 높은 점수를 부여합니다.\n"
                "  평균 회귀 이론의 가장 직관적인 구현체입니다."
            ),
            "key": "s_qa",
        },
        {
            "code":    "Engine-2  QF",
            "name":    "양자 플럭스 (Quantum Flux · 흐름 공식)",
            "subtitle":"에너지 흐름 전파 기반 예측",
            "desc": (
                "최근 20회차 출현 빈도를 에너지로 해석하고, 가장 최근 회차 번호에서\n"
                "  인접 번호(±1)로 에너지가 전파되는 '흐름 공식'을 적용합니다.\n"
                "  에너지가 낮은 번호(흐름에서 소외된 번호) = 출현 기대 높음.\n"
                "  최근 회차 번호의 전후 번호에 1.5배 에너지 전파."
            ),
            "key": "s_qf",
        },
        {
            "code":    "Engine-3  NP",
            "name":    "신경 패턴 (Neural Pattern)",
            "subtitle":"단기 출현 패턴 변화 감지",
            "desc": (
                "최근 5회차 출현 빈도와 직전 5회차 출현 빈도의 '델타'를 분석합니다.\n"
                "  공식: Delta = recent5 − prev5   (감소 추세 번호 → 높은 점수)\n"
                "  출현 빈도가 감소 중인 번호는 평균 회귀 기대 상승.\n"
                "  추가: 7회차 전 출현 번호에 주기 패턴 가산점 부여."
            ),
            "key": "s_np",
        },
        {
            "code":    "Engine-4  M3D",
            "name":    "통합 3D 엔진 (Markov 3D)",
            "subtitle":"3차원 전이 확률 기반 예측 시스템",
            "desc": (
                "번호 × 시간 × 전이 확률의 3차원을 결합한 통합 예측 시스템.\n"
                "  전이 행렬 T[p][c]: 번호 p 다음 회차에 번호 c가 출현한 누적 횟수.\n"
                "  예측: 최근 회차 번호에서 전이 확률이 높은 다음 번호 추출.\n"
                "  Score(n) = Σ T[last_num][n] × 1.5  (최근 회차 기준)"
            ),
            "key": "s_m3d",
        },
        {
            "code":    "Engine-5  IQ",
            "name":    "통합 양자 분석 엔진 (Integrated Quantum)",
            "subtitle":"포괄적 예측 공식 — 다중 지평 + 갭 주기성",
            "desc": (
                "6종 엔진 중 가장 포괄적인 공식. 두 분석을 결합합니다:\n"
                "  ① 다중 시간 지평: 단기(5회)×50% + 중기(15회)×30% + 장기(30회)×20%\n"
                "     각 지평에서 이론 기대값(window × 7/45)과의 편차를 가중 합산.\n"
                "  ② 갭 주기성: 현재 공백 기간 vs 역사적 평균 갭 비교\n"
                "     초과 공백 = max(0, current_gap − avg_gap) × 0.4 가산."
            ),
            "key": "s_iq",
        },
        {
            "code":    "Engine-6  AC",
            "name":    "고급 클러스터 융합 (Advanced Cluster Fusion)",
            "subtitle":"고차수 구간 분석 + 클러스터 기반 융합 시스템",
            "desc": (
                "번호를 5개 클러스터(1~10, 11~20, 21~30, 31~40, 41~45)로 분류.\n"
                "  최근 15회차에서 각 클러스터의 출현 빈도를 고차수 분석.\n"
                "  공식: Score(n) = (max_cluster_freq − cluster_freq[n]) × 2.0\n"
                "  가장 덜 출현한 클러스터 구간의 번호에 높은 점수 부여."
            ),
            "key": "s_ac",
        },
    ]

    for eng in engines:
        key = eng["key"]
        # 해당 엔진 점수 기준 정렬
        by_engine = sorted(scored, key=lambda s: getattr(s, key), reverse=True)
        top5_nums = [f"{s.number:02d}({getattr(s, key):.0f})" for s in by_engine[:5]]
        bot5_nums = [f"{s.number:02d}({getattr(s, key):.0f})" for s in by_engine[-5:]]

        print()
        print(f"  ┌─ {eng['code']} : {eng['name']} {'─'*(W-len(eng['code'])-len(eng['name'])-14)}")
        print(f"  │  ▸ {eng['subtitle']}")
        for line in eng["desc"].splitlines():
            print(f"  │  {line}")
        print(f"  │")
        print(f"  │  상위 5개 (출현 기대↑): {' › '.join(top5_nums)}")
        print(f"  │  하위 5개 (출현 기대↓): {' › '.join(bot5_nums)}")
        print(f"  └{'─'*(W-4)}")

    print()


# ── §5-3. 앙상블 가중치 요약 ──────────────────────────────────────────────────

def print_weight_summary() -> None:
    print("─" * W)
    print("  ⚖️  앙상블 가중치 배분 (합계 100%)".center(W))
    print("─" * W)
    rows = [
        ("전통 통계 지표", [
            ("Z-Score",        WEIGHTS["z"],     "1년 누적 데이터 기반, 가장 안정적인 횡단면 편차"),
            ("볼린저밴드",     WEIGHTS["bb"],    "최근 45회 롤링 횡단면, Z의 단기 보완"),
            ("RSI",            WEIGHTS["rsi"],   "26회 반년 모멘텀, 과소출현 신호"),
            ("MA 크로스오버", WEIGHTS["ma"],    "5vs47 단/장기 대비, 추세 방향"),
            ("Aroon",          WEIGHTS["aroon"], "47회 갭 재귀성, 보조 참고"),
        ]),
        ("고급 예측 엔진", [
            ("양자 분석 (QA)",       WEIGHTS["qa"],  "빈도+갭 통합, 가장 직접적 회귀 신호"),
            ("양자 플럭스 (QF)",     WEIGHTS["qf"],  "에너지 흐름 전파, 비선형 패턴"),
            ("신경 패턴 (NP)",       WEIGHTS["np"],  "단기 추세 변화 감지"),
            ("통합 3D (M3D)",        WEIGHTS["m3d"], "전이 확률 행렬, 번호 간 상관 포착"),
            ("통합 양자 분석 (IQ)",  WEIGHTS["iq"],  "다중 지평+갭 주기, 최포괄 공식"),
            ("고급 클러스터 (AC)",   WEIGHTS["ac"],  "구간별 밀도 불균형, 클러스터 융합"),
        ]),
    ]
    for group_name, items in rows:
        sub_total = sum(w for _, w, _ in items)
        print(f"\n  【{group_name}】  소계: {sub_total*100:.0f}%")
        for name, weight, reason in items:
            bar = _bar(weight * 100 / 15, width=6)  # 15%를 만점으로 시각화
            print(f"    {bar} {weight*100:>4.0f}%  {name:<22} {reason}")
    print()


# ── §5-4. 상위 6개 상세 해석 ─────────────────────────────────────────────────

def print_top6_interpretation(scored: list[ScoredNumber]) -> None:
    top6 = scored[:6]
    print("=" * W)
    print("  🎯 출현가능성 상위 6개 번호 — 앙상블 상세 동인 분석".center(W))
    print("=" * W)
    print(f"\n  최종 추천 번호:  {' — '.join(f'{s.number:02d}번' for s in top6)}\n")

    indicator_meta = [
        ("Z-Score",          "s_z",     "전통",
         "전체 누적 출현 빈도 편차",
         {(80, 101): "강한 과소출현 — 통계적으로 유의미한 미출현 번호",
          (65,  80): "과소출현 신호 — 평균보다 적게 나온 번호",
          (50,  65): "소폭 과소출현 — 미미한 회귀 기대",
          (35,  50): "소폭 과다출현 — 출현이 약간 많은 상태",
          ( 0,  35): "강한 과다출현 — 출현 빈도가 현저히 높음"}),
        ("볼린저밴드",        "s_bb",    "전통",
         "최근 45회 롤링 밴드 이탈",
         {(80, 101): "하단밴드 이탈 — 최근 출현 극히 적음, 강한 회귀 신호",
          (65,  80): "하단밴드 근접 — 과소출현 구간 진입 중",
          (50,  65): "밴드 중앙 이하 — 출현 약간 부족",
          (35,  50): "밴드 중앙 이상 — 출현 약간 과잉",
          ( 0,  35): "상단밴드 근접 — 최근 출현 과다"}),
        ("RSI",              "s_rsi",   "전통",
         "최근 26회 출현 모멘텀",
         {(80, 101): "RSI < 20 수준 — 극단적 과소출현(매우 강한 회귀 신호)",
          (65,  80): "RSI 20~35 수준 — 과소출현 모멘텀 확인",
          (50,  65): "RSI 35~50 수준 — 소폭 과소출현",
          (35,  50): "RSI 50~65 수준 — 균형 또는 약한 과다출현",
          ( 0,  35): "RSI > 65 수준 — 과다출현 경고"}),
        ("MA",               "s_ma",    "전통",
         "단기(5회) vs 장기(47회) 출현율 크로스",
         {(80, 101): "강한 데드크로스 — 최근 출현 급감, 강한 회귀 기대",
          (65,  80): "데드크로스 — 단기 출현율이 장기보다 낮음",
          (50,  65): "약한 데드크로스 — 미미한 감소 추세",
          (35,  50): "골든크로스 방향 — 최근 출현 증가 중",
          ( 0,  35): "강한 골든크로스 — 최근 출현 급증, 회귀 기대 낮음"}),
        ("Aroon",            "s_aroon", "전통",
         "최근 47회 갭 재귀성 분석",
         {(80, 101): "오실레이터 강한 음수 — 매우 긴 공백 기간, 회귀 임박 신호",
          (65,  80): "오실레이터 음수 — 공백 기간이 평균보다 길어짐",
          (50,  65): "오실레이터 소폭 음수 — 약한 공백 신호",
          (35,  50): "오실레이터 소폭 양수 — 최근 출현 확인",
          ( 0,  35): "오실레이터 양수 — 최근 자주 출현"}),
        ("양자분석(QA)",      "s_qa",    "고급",
         "빈도 + 갭 통합 (50회 기준)",
         {(80, 101): "갭 크고 빈도 낮음 — 가장 강한 회귀 기대 신호",
          (65,  80): "갭 또는 빈도 부족 — 회귀 기대 확인",
          (50,  65): "보통 수준 갭/빈도", (35, 50): "빈도 양호 — 약한 회귀 기대",
          ( 0,  35): "빈도 과다 또는 최근 출현 — 회귀 기대 낮음"}),
        ("양자플럭스(QF)",    "s_qf",    "고급",
         "에너지 흐름 전파 (20회 기준)",
         {(80, 101): "에너지 소외 번호 — 흐름 이탈, 강한 회귀 신호",
          (65,  80): "에너지 저조 — 흐름에서 멀어진 번호",
          (50,  65): "에너지 중간 수준", (35, 50): "에너지 보통",
          ( 0,  35): "에너지 과집중 — 최근 흐름 핵심 번호"}),
        ("신경패턴(NP)",      "s_np",    "고급",
         "최근 5회 vs 직전 5회 델타",
         {(80, 101): "강한 감소 델타 — 최근 출현 급감, 패턴 회귀 신호",
          (65,  80): "감소 델타 확인 — 출현 빈도 감소 추세",
          (50,  65): "소폭 감소 델타", (35, 50): "소폭 증가 델타",
          ( 0,  35): "강한 증가 델타 — 최근 출현 급증"}),
        ("통합3D(M3D)",       "s_m3d",   "고급",
         "마르코프 전이 확률 행렬",
         {(80, 101): "높은 전이 확률 — 이전 회차 번호와 강한 연관성",
          (65,  80): "전이 확률 확인 — 출현 패턴 연결",
          (50,  65): "보통 전이 확률", (35, 50): "낮은 전이 확률",
          ( 0,  35): "매우 낮은 전이 확률 — 연관 패턴 미확인"}),
        ("통합양자(IQ)",      "s_iq",    "고급",
         "다중 지평(5/15/30회) + 갭 주기성",
         {(80, 101): "다중 지평 모두 과소출현 + 갭 초과 — 최포괄 신호",
          (65,  80): "다중 지평 과소출현 확인",
          (50,  65): "일부 지평 과소출현", (35, 50): "과소출현 미미",
          ( 0,  35): "다중 지평 과다출현 — 회귀 기대 낮음"}),
        ("클러스터(AC)",      "s_ac",    "고급",
         "5개 구간 클러스터 밀도 불균형",
         {(80, 101): "소속 클러스터 최저 밀도 — 구간 내 회귀 기대 강함",
          (65,  80): "클러스터 밀도 낮음 — 구간 과소출현",
          (50,  65): "클러스터 밀도 보통", (35, 50): "클러스터 밀도 양호",
          ( 0,  35): "클러스터 최고 밀도 — 해당 구간 과다출현"}),
    ]

    def _interpret(val: float, ranges: dict) -> str:
        for (lo, hi), text in ranges.items():
            if lo <= val < hi:
                return text
        return ""

    for rank, s in enumerate(top6, 1):
        print("─" * (W - 4))
        level_tag = _level(s.composite)
        print(f"  [{rank}위] 번호 {s.number:02d}번   앙상블 종합 점수: {s.composite:.2f}/100  {level_tag}")
        print()

        trad = [(nm, getattr(s, key), rng) for nm, key, cat, _, rng in indicator_meta if cat == "전통"]
        adv  = [(nm, getattr(s, key), rng) for nm, key, cat, _, rng in indicator_meta if cat == "고급"]

        print("    [전통 통계 지표 — 평균 회귀 관점]")
        for name, val, rng in trad:
            bar   = _bar(val, width=10)
            arrow = "▲" if val >= 65 else ("▼" if val <= 35 else "─")
            interp = _interpret(val, rng)
            print(f"    {arrow} {name:<14} {bar} {val:>5.1f}점   {interp}")

        print()
        print("    [고급 예측 엔진 6종]")
        for name, val, rng in adv:
            bar   = _bar(val, width=10)
            arrow = "▲" if val >= 65 else ("▼" if val <= 35 else "─")
            interp = _interpret(val, rng)
            print(f"    {arrow} {name:<16} {bar} {val:>5.1f}점   {interp}")

        # 핵심 동인 추출
        all_scores = [(nm, getattr(s, key)) for nm, key, *_ in indicator_meta]
        top_drivers = sorted(all_scores, key=lambda x: x[1], reverse=True)
        high = [f"{nm}({v:.0f})" for nm, v in top_drivers[:3] if v >= 65]
        low  = [f"{nm}({v:.0f})" for nm, v in top_drivers[-3:] if v <= 35]

        # 전통 지표 컨센서스 카운트
        trad_scores = [s.s_z, s.s_bb, s.s_rsi, s.s_ma, s.s_aroon]
        trad_signal_cnt = sum(1 for v in trad_scores if v >= 65)

        print()
        if high:
            print(f"    → 핵심 상승 동인: {', '.join(high)}")
        if low:
            print(f"    → 억제 요인:      {', '.join(low)}")
        if not high and not low:
            print(f"    → 안정 밸런스: 전 지표에서 균형 잡힌 중상위권 점수 획득")
        print(f"    → 전통 지표 회귀 신호: {trad_signal_cnt}/5개 활성  "
              f"({'강한 컨센서스' if trad_signal_cnt >= 4 else '중간 컨센서스' if trad_signal_cnt >= 3 else '단독 신호' if trad_signal_cnt >= 1 else '신호 미확인'})")
        print()

    print("─" * (W - 4))


# ── §5-5. 점수 분포 요약 ──────────────────────────────────────────────────────

def print_score_distribution(scored: list[ScoredNumber]) -> None:
    vals = [s.composite for s in scored]
    mu, sd = statistics.mean(vals), statistics.stdev(vals)
    print("─" * W)
    print("  📊 앙상블 종합 점수 분포".center(W))
    print("─" * W)
    print(f"  평균: {mu:.2f}  |  표준편차: {sd:.2f}  |  최솟값: {min(vals):.2f}  |  최댓값: {max(vals):.2f}")
    bands = [(75, 100, "◉ 강력 추천"), (60, 75, "● 중간 추천"),
             (50, 60, "○ 약한 추천"), (40, 50, "▽ 배제 고려"), (0, 40, "▼ 강력 배제")]
    print()
    for lo, hi, label in bands:
        nums = [s.number for s in scored if lo <= s.composite <= hi]
        bar  = "█" * len(nums) + "░" * (45 - len(nums))
        print(f"  {lo:>3}~{hi:<3}점  {label:<14}  {bar}  {len(nums):>2}개: {nums}")
    print()


# ── §5-6. 면책 고지 ───────────────────────────────────────────────────────────

def print_disclaimer() -> None:
    print("=" * W)
    print("  ⚠️  [중요 공지 — 반드시 확인하십시오]".center(W))
    print("=" * W)
    print("""
  본 분석 결과는 "통계적 패턴 해석 및 알고리즘 기반 점수화"이며,
  실제 로또 당첨 확률과 완전히 무관합니다.

  · 로또 6/45의 매 회차 추첨은 완전한 독립 사건입니다.
  · 어떤 알고리즘도 다음 회차 당첨 번호를 예측할 수 없습니다.
  · 고급 엔진 명칭(양자, 신경망 등)은 수학적 계산 공식의 은유적 표현이며,
    실제 양자컴퓨팅이나 딥러닝과 무관합니다.
  · 본 결과를 투자·배팅 근거로 사용하지 마십시오.
  · 복권은 오락 목적으로만 구매하십시오.
    """)
    print("=" * W)


# ════════════════════════════════════════════════════════════════════════════════
# §6. 메인 진입점
# ════════════════════════════════════════════════════════════════════════════════

def main(n_rounds: int = 100, seed: int = 42) -> None:
    print("\n" + "=" * W)
    print("  한국 로또 6/45 — 하이브리드 슈퍼 앙상블 분석 시스템".center(W))
    print("  전통 통계 지표 5종 (40%) + 고급 예측 엔진 6종 (60%)".center(W))
    print("=" * W)
    print(f"\n  분석 회차: {n_rounds}회  |  가중치 합계: {sum(WEIGHTS.values()):.2f}")

    print(f"\n  데이터 로딩 및 배치 계산 중 (11종 × 45번호)... ", end="", flush=True)
    draws  = make_sample_draws(n_rounds=n_rounds, seed=seed)
    scored = compute_hybrid_scores(draws)
    print("완료.\n")

    # 1. 전체 데이터 테이블
    print_full_table(scored)

    # 2. 기술 지표 분석 패널 (전통 5종 + 다중 신호 컨센서스)
    print_technical_panel(scored)

    # 3. 고급 예측 엔진 6종 패널 (웹페이지 상세 출력)
    print_engine_panel(scored)

    # 4. 점수 분포 요약
    print_score_distribution(scored)

    # 5. 상위 6개 앙상블 상세 해석
    print_top6_interpretation(scored)

    # 6. 가중치 요약
    print_weight_summary()

    # 7. 면책 고지
    print_disclaimer()


if __name__ == "__main__":
    main(n_rounds=100, seed=42)
