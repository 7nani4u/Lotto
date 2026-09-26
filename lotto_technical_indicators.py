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

[확률 전제 — 반드시 준수]
  로또 6/45 매 회차 추첨은 독립 사건이며 모든 번호 조합의 추첨 확률은 동일합니다.
  본 파일의 모든 점수·랭킹·융합은 "과거 출현 패턴의 기술적 서술"일 뿐,
  미래 당첨 확률을 높이거나 보장하지 않습니다. 실측된 엔진 간 중복·역상관
  (아래 [알려진 중복] 참조)은 가중치 설계 시 반드시 함께 제시합니다.

[알려진 중복 — 실측, seed 42/7/123 3종 표본(n=100)에서 안정적]
  · QA × IQ 상관계수 ≈ +0.95 (둘 다 갭+빈도 회귀 신호, 합산 가중 22%)
  · 볼린저밴드 × RSI ≈ +0.81~0.83 (둘 다 롤링 윈도우 과소출현 신호)
  · M3D × 앙상블 종합 ≈ −0.36~−0.58 (M3D만 모멘텀 방향, 나머지는 회귀 방향)
  가중치는 기존 의도 보존을 위해 변경하지 않고, diagnose_engines()로 상시 확인합니다.

[출현(Appearance) 정의 — 전 엔진 통일]
  보너스볼을 포함한 7개 번호 기준 (_appears ≡ _iter_nums 기본값).
  과거에는 QA/NP/QF/M3D/AC가 메인 6개만, BB/Z/IQ/MA/RSI/Aroon이 7개를 세어
  같은 "출현"이 엔진마다 다른 의미였습니다. _iter_nums()로 통일합니다.
════════════════════════════════════════════════════════════════════════════════
"""

from __future__ import annotations

import collections
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
        # [수정] 셔플된 앞 6개를 본번호, 7번째를 보너스로 (정렬 전 분할).
        # 기존에는 정렬 후 앞 6개를 취해 보너스가 항상 최대값, 본번호가
        # 저구간 편향되는 구조적 편향이 있었음. 실제 추첨(순서 무관 6+1)과
        # 동일한 분포가 되도록 수정. 표시는 오름차순 정렬.
        mains = sorted(pool[:6])
        draws.append(DrawResult(round=rnd, numbers=mains, bonus=pool[6]))
    draws.reverse()
    return draws

def _appears(draw: DrawResult, num: int) -> bool:
    return num in draw.numbers or draw.bonus == num


def _iter_nums(draw: DrawResult, include_bonus: bool = True) -> list[int]:
    """
    한 회차의 추첨 번호 목록을 반환합니다 (기본: 보너스 포함 7개).

    [통일 이유] 엔진마다 출현 집계 범위가 달랐습니다 (QA/NP/QF/M3D/AC=메인 6개,
    BB/Z/IQ/MA/RSI/Aroon=7개). 전이·빈도·갭 계산을 모두 이 헬퍼로 통일하여
    "출현"의 정의가 엔진마다 달라지는 문제를 제거합니다.
    """
    if include_bonus:
        return [*draw.numbers, draw.bonus]
    return list(draw.numbers)


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
        for n in _iter_nums(d): freq[n] += 1
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
        for n in _iter_nums(d): freq[n] += 1
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
        # [수정] 보너스볼을 freq에도 집계. 기존에는 last_seen만 보너스를 반영하고
        # freq는 메인 6개만 세어 갭과 빈도의 기준이 서로 달랐음. IQ/BB/Z와 통일.
        for n in _iter_nums(d):
            freq[n] += 1
            if last_seen[n] == -1: last_seen[n] = idx
    for n in range(1, 46):
        # [수정] 미출현 갭 하드코딩 50 → 실제 window. 데이터가 50회 미만이면
        # 관측 가능한 최대 갭(window)을 사용해야 편향이 없음.
        gap = window if last_seen[n] == -1 else last_seen[n]
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
        for n in _iter_nums(d): scores[n] += 1.0
    # [수정] 최근 회차 7개 번호(보너스 포함)를 흐름 기점으로 사용. 집계와 통일.
    for n in _iter_nums(draws[0]):
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
        for n in _iter_nums(d): recent5[n] += 1
    for d in draws[5:10]:
        for n in _iter_nums(d): prev5[n] += 1
    for n in range(1, 46):
        scores[n] += (recent5[n] - prev5[n]) * 2.5
    if len(draws) > 7:
        for n in _iter_nums(draws[7]): scores[n] += 3.0
    # 역전: 감소 추세 번호(Delta 낮음)에 높은 점수
    raw_inv = {n: -scores[n] for n in range(1, 46)}
    return _normalize(raw_inv)


# ── 공용: 연속 회차 전이 카운트 ─────────────────────────────────────────────
def build_transition_counts(draws: list[DrawResult],
                            window: int) -> dict[int, dict[int, int]]:
    """
    연속 회차 간 번호 전이 카운트 T[p][c]를 구성합니다.
    T[p][c] = 번호 p가 나온 회차의 "다음(최신 방향)" 회차에 번호 c가 나온 횟수.
    draws[0]이 최신이므로 draws[i+1](과거) → draws[i](최신) 방향으로 집계합니다.

    [통합 이유] Engine-4(M3D)와 흐름분석 _connection_scores_all()이 같은
    45×45 행렬을 각자 구축했습니다 (실측 상관계수 ≈ +0.94의 근원).
    계산 로직은 하나로 통일하고, 윈도우·조회 방식의 차이만 호출자가 지정합니다.
    집계는 _iter_nums() 7개 번호 기준 (기존 메인-6개 한정에서 변경, 통일 목적).
    """
    w = min(window, len(draws))
    T: dict[int, dict[int, int]] = {p: {c: 0 for c in range(1, 46)} for p in range(1, 46)}
    for i in range(w - 1):
        prev_nums = _iter_nums(draws[i + 1])
        cur_nums = _iter_nums(draws[i])
        for p in prev_nums:
            row = T[p]
            for c in cur_nums:
                row[c] += 1
    return T


# ── Engine-4: 통합 3D 엔진 / 마르코프 3D (M3D) ───────────────────────────────
def calc_markov_3d(draws: list[DrawResult]) -> dict[int, float]:
    """
    [통합 3D 엔진 — Markov 3D]
    3가지 차원(번호 × 시간 × 전이 확률)을 결합한 통합 예측 시스템.
    전이 확률 행렬: T[p][c] = 번호 p 이후 회차에 번호 c가 출현한 횟수.
    최근 회차 번호들로부터 다음 회차에 출현할 번호를 전이 확률로 예측.
      Score(n) = Σ T[last_num][n] × 1.5  (최근 회차 번호 기준)

    [참고] 흐름분석의 연결강도와 같은 행렬을 공유하므로 둘은 유사한 신호입니다
    (실측 r≈+0.94). 모멘텀 방향 신호라 회귀 앙상블과 역상관(r≈−0.4~−0.6)이며,
    이는 다변화 의도로 유지합니다. 가중치는 변경하지 않습니다.
    """
    scores = {n: 0.0 for n in range(1, 46)}
    window = min(50, len(draws))
    if window < 20:
        return scores
    transition = build_transition_counts(draws, window)
    for n in range(1, 46):
        for last_num in _iter_nums(draws[0]):
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
            for n in _iter_nums(d): freq[n] += 1
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
        for n in _iter_nums(d):
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

# 융합 시 흐름 점수 비중 기본값 (§5-7 compute_fused_ranking과 공유).
# 모듈 상단에 두어 §5-1 테이블 함수 기본인자에서도 참조 가능하게 함.
FLOW_WEIGHT_DEFAULT = 0.25  # CLI --flow-weight로 변경 가능

def compute_hybrid_scores(draws: list[DrawResult]) -> list[ScoredNumber]:
    """
    모든 엔진 점수를 O(N) 배치로 계산하고 앙상블 종합 점수를 반환합니다.
    횡단면 데이터(볼린저·Z-Score·6종 고급 엔진)는 한 번 계산 후 전체 공유.
    """
    # [수정] 빈 입력 방어. 기존에는 calc_ma 등에서 ZeroDivisionError로 추락.
    if not draws:
        raise ValueError("compute_hybrid_scores: draws가 비어 있습니다 (최소 1회차 필요).")
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

def compute_agreement(scored: list[ScoredNumber], threshold: float = 65.0) -> dict[int, int]:
    """
    번호별 엔진 합의 수 (11종 지표 중 threshold 이상인 지표 개수).
    표의 '합의' 컬럼과 선택 조언의 근거로 사용합니다.
    """
    keys = ["s_z", "s_bb", "s_rsi", "s_ma", "s_aroon",
            "s_qa", "s_qf", "s_np", "s_m3d", "s_iq", "s_ac"]
    return {s.number: sum(1 for k in keys if getattr(s, k) >= threshold)
            for s in scored}


def compute_stability(draws: list[DrawResult],
                      n_iter: int = 20,
                      seed: int = 917,
                      flow_weight: float = FLOW_WEIGHT_DEFAULT,
                      topk: int = 6,
                      frac: float = 0.8) -> dict[int, float] | None:
    """
    부트스트랩 안정도: 순서-preserving 80% 서브샘플을 n_iter회 반복하며
    융합 상위 topk 진입 빈도를 측정합니다 (0~1).

    [용도] 점수 0.007점 차이 같은 컷오프 임의성을 폭로합니다. 진입률 1.0이면
    데이터 섭동에 강건한 선택, 0.5 근처면 동전 던지기와 다름없습니다.
    예측 적중률이 아니라 "선택의 재현성"임에 유의하십시오.
    draws < 30회면 None 반환 (엔진 최소 윈도우 미달).
    """
    if n_iter <= 0 or len(draws) < 30:
        return None
    rng = random.Random(seed)
    m = max(20, int(len(draws) * frac))
    counts = {n: 0 for n in range(1, 46)}
    for _ in range(n_iter):
        idx = sorted(rng.sample(range(len(draws)), m))  # 최신우선 순서 유지
        sub = [draws[i] for i in idx]
        try:
            sc = compute_hybrid_scores(sub)
            fl = compute_flow_analysis(sub)
            fu = compute_fused_ranking(sc, fl, flow_weight)
        except ValueError:
            continue
        for p in fu[:topk]:
            counts[p["number"]] += 1
    return {n: counts[n] / n_iter for n in range(1, 46)}


def print_full_table(scored: list[ScoredNumber],
                     flow_data: dict | None = None,
                     fused: list[dict] | None = None,
                     stability: dict[int, float] | None = None,
                     flow_weight: float = FLOW_WEIGHT_DEFAULT) -> None:
    """
    📋 전체 데이터 테이블 — 1~45번 출현가능성 점수 전체

    fused 전달 시: 융합 점수 기준 정렬 + 융합/합의/안정도 컬럼으로
    "가져갈 번호"를 표에서 바로 판독할 수 있게 합니다.
    미전달 시: 기존 레이아웃(앙상블 종합 기준)으로 동작합니다.
    """
    comp_map = {s.number: s for s in scored}
    if fused is not None:
        order = [p["number"] for p in fused]  # 실제 선정 기준 = 융합 순위
        fused_map = {p["number"]: p for p in fused}
        ens_rank = {s.number: i + 1 for i, s in enumerate(scored)}
        title = ("📋 전체 데이터 테이블 — 1~45번 출현가능성 점수 전체 "
                 "(융합 순위순 = 실제 선정 순서)")
    else:
        order = [s.number for s in scored]
        fused_map = {}
        ens_rank = {}
        title = "📋 전체 데이터 테이블 — 1~45번 출현가능성 점수 전체 (종합 점수 내림차순)"
    agree = compute_agreement(scored)

    print("\n" + "=" * W)
    print(f"  {title}".center(W))
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
    if fused is not None:
        hdr1 += f"  {'── 선정 근거 ──────────':^22}"
        hdr2 += f"  {'융합':>6} {'합의':>4} {'안정':>4}  {'판정'}"
    print(hdr1)
    print(hdr2)
    print("-" * W)

    for rank, num in enumerate(order, 1):
        s = comp_map[num]
        if fused is not None:
            p = fused_map[num]
            gap = abs(ens_rank[num] - rank)
            contested = gap >= 10
            if rank <= 6:
                tier = "▶확정"
            elif rank <= 12:
                tier = "◆차순"
            elif rank > 39:
                tier = "✕회피"
            else:
                tier = "·"
            if contested:
                tier += "※"
            stab = stability or {}
            stab_txt = f"{stab.get(num, -1):.0%}" if stab.get(num, -1) >= 0 else "─"
            print(
                f"{tier:>4}{rank:>3}  {num:>2}번  "
                f"{s.s_z:>5.1f} {s.s_bb:>5.1f} {s.s_rsi:>5.1f} "
                f"{s.s_ma:>5.1f} {s.s_aroon:>5.1f}  "
                f"{s.s_qa:>5.1f} {s.s_qf:>5.1f} {s.s_np:>5.1f} "
                f"{s.s_m3d:>5.1f} {s.s_iq:>5.1f} {s.s_ac:>5.1f}  "
                f"{s.composite:>6.2f} {p['fused']:>6.2f} {agree[num]:>2}/11 {stab_txt:>4}"
            )
        else:
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
    if fused is not None:
        margin = fused[5]["fused"] - fused[6]["fused"]
        print(
            "  ▶확정 = 융합 상위 6개(가져갈 번호)  ◆차순 = 7~12위(교체 후보)  "
            "✕회피 = 하위 6개  ※ = 앙상블 순위와 10위 이상 엇갈림(의견 분열)\n"
            "  합의 = 11종 지표 중 65점 이상 개수  안정 = subsample 재현율 "
            f"(컷오프 격차: 6위−7위 = {margin:.3f}점"
            f"{' → 경계! 7위가 언제든 뒤집힐 수 있음' if margin < 0.5 else ''})"
        )
    else:
        print(
            "  ▶ = 앙상블 상위 6개 추천 번호\n"
            "  컬럼: Z=Z-Score  BB=볼린저밴드  RSI  MA  Aroon  "
            "QA=양자분석  QF=양자플럭스  NP=신경패턴  M3D=통합3D  IQ=통합양자  AC=클러스터"
        )


def print_pick_advice(scored: list[ScoredNumber],
                      fused: list[dict],
                      stability: dict[int, float] | None,
                      flow_weight: float = FLOW_WEIGHT_DEFAULT) -> None:
    """
    표 바로 다음에 "어떤 번호를 가져갈지"를 한 박스로 답합니다.
    근거: 융합 순위 + 합의 수 + 안정도. 당첨 보장이 아님을 명시합니다.
    """
    agree = compute_agreement(scored)
    ens_rank = {s.number: i + 1 for i, s in enumerate(scored)}
    picks = fused[:6]
    next2 = fused[6:8]
    avoid = fused[-6:]
    contested = [p for p in picks
                 if abs(ens_rank[p["number"]] - (fused.index(p) + 1)) >= 10]

    def tag(p: dict) -> str:
        n = p["number"]
        st = f"안정{stability[n]:.0%}" if stability else "안정미측정"
        stars = "★" * round((stability[n] if stability else 0.5) * 3) or "☆"
        return (f"{n:02d}번(융합{p['fused']:.1f}·합의{agree[n]}/11·{st}){stars}")

    print("─" * W)
    print("  ✅ 가져갈 번호 — 위 표 ▶확정 6개".center(W))
    print("─" * W)
    halves = [" — ".join(tag(p) for p in picks[:3]),
              " — ".join(tag(p) for p in picks[3:])]
    for h in halves:
        print(f"  {h}")
    print()
    margin = picks[-1]["fused"] - next2[0]["fused"]
    print(f"  🔄 교체 후보 (7~8위, 6위와 {margin:.3f}점 차"
          f"{' — 사실상 동점, 취향대로 교체 가능' if margin < 0.5 else ''}): "
          f"{' · '.join(tag(p) for p in next2)}")
    if contested:
        print(f"  ⚠️ 의견 분열 (앙상블과 10위 이상 엇갈림 — 신중): "
              f"{', '.join(f'{p['number']:02d}번' for p in contested)}")
    print(f"  ✕ 낮게 평가된 번호 (참고용, 배제의 근거 아님): "
          f"{' · '.join(f'{p['number']:02d}번' for p in avoid)}")
    print()
    print("  ※ 이 선택은 '모델이 선호하고 재현되는' 번호이지 '나올' 번호가 아닙니다.")
    print("  ※ 컷오프 격차가 0.5점 미만이면 6~8위는 사실상 동점입니다.")
    print()


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
    print("  ※ 중복 주의 (실측): QA×IQ r≈+0.95 → 합산 22%가 사실상 단일 신호,")
    print("    BB×RSI r≈+0.82, M3D는 앙상블과 역상관(모멘텀 vs 회귀). 가중치据置.")
    print()


# ── §5-4. 상위 6개 상세 해석 ─────────────────────────────────────────────────

def print_top6_interpretation(scored: list[ScoredNumber]) -> None:
    # [참고] 이 섹션은 순수 앙상블 상위 6개(흐름 미반영)를 해석합니다.
    # 흐름이 반영된 최종 후보는 print_flow_top6_reasoning()(융합 랭킹)을 보십시오.
    # 두 목록이 다를 수 있으며, 이는 흐름 신호가 앙상블과 다른 방향을 보기 때문입니다.
    top6 = scored[:6]
    print("=" * W)
    print("  🎯 출현가능성 상위 6개 번호 — 순수 앙상블 상세 동인 분석 (흐름 미반영)".center(W))
    print("=" * W)
    print(f"\n  순수 앙상블 추천 번호:  {' — '.join(f'{s.number:02d}번' for s in top6)}\n")

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
# §5-9. 번호 흐름 분석 — 연결 구조 기반 (이전·현재·다음 회차 흐름)
# ════════════════════════════════════════════════════════════════════════════════
# 2번째 스크린샷 분석 의도 반영:
#   ① 단순 빈도가 아닌, 회차 간 흐름의 연결성(연결 구조) 중심 분석
#   ② 최근/중기/장기 추세 구분 (상승·하락·급락·급등·안정)
#   ③ 출현 간격·주기성으로 "출현 임박" 번호 탐색
#   ④ 구간별 흐름 변화 (상승·하락 구간 포착)
#   ⑤ 전이 확률 행렬로 이전→현재→다음 연결 강도 산출
# ════════════════════════════════════════════════════════════════════════════════

def _flow_trend_all(draws: list[DrawResult]) -> dict[int, dict]:
    """
    각 번호의 출현 추세를 단기(최근 5회) vs 직전 5회 비교로 분류합니다.
    분류: 급락 / 하락 / 급등 / 상승 / 안정 (+ 데이터부족)
    급락 = 이전엔 보통이었지만 최근 뚝 떨어짐 → 평균 회귀 기대

    [수정] 회차가 10회 미만이면 f5/prev5 비교가 편향되므로 추세를 "데이터부족"으로
    표기합니다. 기존에는 데이터 부족 시에도 급락/하락을 단정했습니다.
    """
    # 7개 번호(보너스 포함) 기준 기대값 — _iter_nums/_appears 집계와 통일.
    exp5 = 5 * 7 / 45  # 5회차 이론 기대 출현 횟수 (보너스 포함)
    short = len(draws) < 10
    result: dict[int, dict] = {}
    for n in range(1, 46):
        f5    = sum(1 for d in draws[:5]  if _appears(d, n))
        f10   = sum(1 for d in draws[:10] if _appears(d, n))
        f20   = sum(1 for d in draws[:20] if _appears(d, n))
        prev5 = f10 - f5
        r5    = f5    / exp5 if exp5 > 0 else 1.0
        rp5   = prev5 / exp5 if exp5 > 0 else 1.0

        if short:
            trend = "데이터부족"
        elif r5 < 0.4 and rp5 >= 0.8: trend = "급락"   # 이전엔 보통 → 최근 급감
        elif r5 > 1.6 and rp5 < 0.5:  trend = "급등"   # 이전엔 없다가 → 최근 급증
        elif r5 > 1.4 and rp5 > 1.0:  trend = "상승"   # 전반적 상승
        elif r5 < 0.4 and rp5 < 0.5:  trend = "하락"   # 전반적 공백
        else:                          trend = "안정"   # 평균 수준 유지

        result[n] = {
            "f5": f5, "f10": f10, "f20": f20,
            "prev5": prev5, "r5": r5, "rp5": rp5,
            "trend": trend,
        }
    return result


def _gap_analysis_all(draws: list[DrawResult]) -> dict[int, dict]:
    """
    각 번호의 출현 간격 통계를 계산합니다.
    - cur_gap      : 마지막 출현 이후 경과 회차
    - avg_gap      : 역사적 평균 출현 간격 (이론값 45/7 ≈ 6.4)
    - cv           : 변동계수 (std/avg, 낮을수록 주기적)
    - overdue      : cur_gap / avg_gap 비율 (1.0 초과 = 평균 대기 초과)
    - periodic     : "강함" / "보통" / "약함"
    """
    history = min(80, len(draws))
    result: dict[int, dict] = {}
    for n in range(1, 46):
        idx     = [i for i in range(history) if _appears(draws[i], n)]
        cur_gap = idx[0] if idx else history
        # idx 는 오름차순(최근=작은 인덱스, 과거=큰 인덱스) → 간격은 idx[i+1] - idx[i]
        gaps    = [idx[i + 1] - idx[i] for i in range(len(idx) - 1)]
        avg_gap = (sum(gaps) / len(gaps)) if gaps else 45.0 / 7.0
        std_gap = statistics.stdev(gaps) if len(gaps) >= 2 else avg_gap
        cv      = std_gap / avg_gap if avg_gap > 0 else 1.0
        overdue = cur_gap / avg_gap if avg_gap > 0 else 0.0
        result[n] = {
            "cur_gap":      cur_gap,
            "avg_gap":      avg_gap,
            "std_gap":      std_gap,
            "cv":           cv,
            "overdue":      overdue,
            "is_overdue":   overdue > 1.2,
            "is_long_absent": cur_gap >= 10,
            "appear_count": len(idx),
            "periodic":     "강함" if cv < 0.35 else ("보통" if cv < 0.65 else "약함"),
        }
    return result


def _connection_scores_all(draws: list[DrawResult]) -> dict[int, float]:
    """
    전이 확률 행렬 T[prev][next] 를 구성하고,
    최근 6회차 번호를 기점으로 가중 전이 점수를 계산합니다.
    이전 회차와 강하게 연결된 번호일수록 다음 회차 출현 가능성이 높다고 봅니다.

    [수정] 행렬 구축을 build_transition_counts()로 통일 (Engine-4 M3D와 공유).
    윈도우(60회)·최근 6회차 가중 조회 방식은 기존 그대로 유지합니다.
    집계는 7개 번호 기준 (_iter_nums)으로 통일합니다.
    """
    window = min(60, len(draws))
    if window < 10:
        return {n: 50.0 for n in range(1, 46)}

    T = build_transition_counts(draws, window)

    scores: dict[int, float] = {n: 0.0 for n in range(1, 46)}
    for lag in range(min(6, len(draws))):
        weight = 2.0 / (lag + 1)          # 최근 회차일수록 가중치 높음
        for prev_n in _iter_nums(draws[lag]):
            row = T[prev_n]
            for cand in range(1, 46):
                scores[cand] += row[cand] * weight

    vals = list(scores.values())
    lo, hi = min(vals), max(vals)
    span = hi - lo if hi > lo else 1.0
    return {n: (scores[n] - lo) / span * 100.0 for n in range(1, 46)}


def _segment_flow_all(draws: list[DrawResult]) -> list[dict]:
    """
    5개 구간(1~10 / 11~20 / 21~30 / 31~40 / 41~45)의
    최근 5회차 vs 직전 5회차 출현 수를 비교해 구간 흐름을 분석합니다.

    [수정] 집계·기대값을 7개 번호(보너스 포함) 기준으로 통일합니다.
    기존에는 메인 6개만 세면서 exp5도 6개 기준으로 계산해, 추세(_flow_trend_all,
    7개 기준)와 구간 흐름의 분모가 서로 달랐습니다. 회차 10회 미만이면
    추세를 "데이터부족"으로 표기합니다.
    """
    segs = [(1, 10, "1~10"), (11, 20, "11~20"), (21, 30, "21~30"),
            (31, 40, "31~40"), (41, 45, "41~45")]
    short = len(draws) < 10
    result: list[dict] = []
    for lo, hi, name in segs:
        size = hi - lo + 1
        exp5 = 5 * 7 * size / 45          # 5회차 이론 기대 출현 (7개 번호 기준)
        r5   = sum(1 for d in draws[:5]    for n in _iter_nums(d) if lo <= n <= hi)
        p5   = sum(1 for d in draws[5:10]  for n in _iter_nums(d) if lo <= n <= hi)
        r20  = sum(1 for d in draws[:20]   for n in _iter_nums(d) if lo <= n <= hi)
        p20  = sum(1 for d in draws[20:40] for n in _iter_nums(d) if lo <= n <= hi)
        rr5  = r5 / exp5 if exp5 > 0 else 1.0
        rp5  = p5 / exp5 if exp5 > 0 else 1.0

        if short:
            trend = "데이터부족"
        elif rr5 > rp5 * 1.3: trend = "상승"
        elif rr5 < rp5 * 0.7: trend = "하락"
        else:                  trend = "안정"

        result.append({
            "name": name, "lo": lo, "hi": hi,
            "r5": r5, "p5": p5, "r20": r20, "p20": p20,
            "rr5": rr5, "rp5": rp5, "trend": trend,
        })
    return result


def compute_flow_analysis(draws: list[DrawResult]) -> dict:
    """
    모든 흐름 분석 데이터를 일괄 계산합니다.
    반환 딕셔너리는 print_flow_analysis / print_flow_top6_reasoning 에서 공유합니다.
    """
    flow_trend  = _flow_trend_all(draws)
    gap_data    = _gap_analysis_all(draws)
    conn_scores = _connection_scores_all(draws)
    seg_flow    = _segment_flow_all(draws)

    # 장기 미출현 번호 (최근 10회차 이상 연속 미출현)
    # [수정] 회차가 10회 미만이면 "10회차 이상" 판정이 무의미하므로 빈 목록 반환.
    # 기존에는 min(10, len)으로 짧은 데이터에서도 전원 미출현 판정이 가능했음.
    long_absent: list[int] = []
    if len(draws) >= 10:
        for n in range(1, 46):
            for i in range(10):
                if _appears(draws[i], n):
                    break
            else:
                long_absent.append(n)

    # 최근 재등장 번호 (5회차 이상 공백 후 최근 3회차 내 출현)
    recently_back: list[int] = []
    for n in range(1, 46):
        appeared = any(_appears(draws[i], n) for i in range(min(3, len(draws))))
        if not appeared:
            continue
        absent_cnt = 0
        for i in range(3, min(23, len(draws))):
            if _appears(draws[i], n):
                break
            absent_cnt += 1
        if absent_cnt >= 5:
            recently_back.append(n)

    return {
        "flow_trend":    flow_trend,
        "gap_data":      gap_data,
        "conn_scores":   conn_scores,
        "seg_flow":      seg_flow,
        "long_absent":   sorted(long_absent),
        "recently_back": sorted(recently_back),
    }


def print_flow_analysis(draws: list[DrawResult],
                        scored: list[ScoredNumber],
                        flow_data: dict) -> None:
    """
    번호 흐름 분석 결과를 5개 항목으로 구분하여 시각화 출력합니다.
    이전·현재·다음 회차의 연결 구조를 중심으로 설명합니다.
    """
    ft = flow_data["flow_trend"]
    gd = flow_data["gap_data"]
    cs = flow_data["conn_scores"]
    sf = flow_data["seg_flow"]
    la = flow_data["long_absent"]
    rb = flow_data["recently_back"]

    print("\n" + "=" * W)
    print("  🔗 번호 흐름 분석 — 이전·현재·다음 회차 연결 구조".center(W))
    print("  단순 빈도가 아닌 회차 간 흐름의 연결성 중심으로 분석합니다.".center(W))
    print("=" * W)

    # ── 1. 최근 회차 흐름 요약 ────────────────────────────────────────────────
    print()
    print("  ┌─ 【1】 최근 회차 흐름 분석 요약 (최근 10회차 기준)")
    # [수정] 7개 번호(보너스 포함) 기준 집계. 기존에는 메인 6개만 세어
    # 추세(_flow_trend_all, 7개 기준)와 같은 패널 안에서 분모가 달랐음.
    all10    = [n for d in draws[:10] for n in _iter_nums(d)]
    cnt10    = collections.Counter(all10)
    hot8     = [n for n, _ in cnt10.most_common(8)]
    cold8    = sorted(n for n in range(1, 46) if cnt10.get(n, 0) == 0)[:8]
    rising   = sorted(n for n in range(1, 46) if ft[n]["trend"] in ("상승", "급등"))
    falling  = sorted(n for n in range(1, 46) if ft[n]["trend"] in ("하락", "급락"))
    print(f"  │  최근 10회차 고빈도 번호    : {hot8}")
    print(f"  │  최근 10회차 미출현 번호    : {cold8}")
    print(f"  │  상승/급등 추세 번호         : {rising  if rising  else '해당 없음'}")
    print(f"  │  하락/급락 추세 번호         : {falling if falling else '해당 없음'}")
    print(f"  │  ※ 하락/급락 번호는 흐름상 평균 회귀 가능성이 있습니다.")
    print(f"  └{'─' * (W - 4)}")

    # ── 2. 장기 흐름 분석 요약 ────────────────────────────────────────────────
    print()
    print("  ┌─ 【2】 장기 흐름 분석 요약")
    overdue_sorted = sorted(
        [(n, gd[n]["cur_gap"], gd[n]["avg_gap"], gd[n]["overdue"])
         for n in range(1, 46) if gd[n]["is_overdue"]],
        key=lambda x: x[3], reverse=True,
    )
    print(f"  │  장기 미출현 번호 (10회차 이상 연속 미출현): {la if la else '없음'}")
    print(f"  │  최근 재등장 번호 (장기 공백 후 최근 복귀) : {rb if rb else '없음'}")
    print(f"  │  평균 대기 초과 번호 (상위 8개, 출현 임박 가능성):")
    for n, cur, avg, ratio in overdue_sorted[:8]:
        filled = min(int(ratio * 4), 16)
        bar = "█" * filled + "░" * (16 - filled)
        print(f"  │    {n:02d}번  [{bar}] 현재 {cur:>2}회 대기 / 평균 {avg:>4.1f}회 = {ratio:.1f}배")
    print(f"  └{'─' * (W - 4)}")

    # ── 3. 번호 구간별 흐름 변화 ──────────────────────────────────────────────
    print()
    print("  ┌─ 【3】 번호 구간별 흐름 변화 (최근 5회 vs 직전 5회)")
    for seg in sf:
        arrow = "↑" if seg["trend"] == "상승" else ("↓" if seg["trend"] == "하락" else "→")
        bar_r = "█" * seg["r5"] + "░" * max(0, 14 - seg["r5"])
        bar_p = "█" * seg["p5"] + "░" * max(0, 14 - seg["p5"])
        diff  = seg["rr5"] - seg["rp5"]
        ds    = f"+{diff:.2f}" if diff >= 0 else f"{diff:.2f}"
        print(f"  │  [{seg['name']:>6}] {arrow} {seg['trend']:>2}  "
              f"최근5회: {bar_r}({seg['r5']:>2}개)  "
              f"직전5회: {bar_p}({seg['p5']:>2}개)  변화율: {ds}")
    print(f"  └{'─' * (W - 4)}")

    # ── 4. 이전↔현재↔다음 연결 구조 분석 ────────────────────────────────────
    print()
    print("  ┌─ 【4】 이전↔현재↔다음 회차 연결 구조 분석")
    print(f"  │  최근 5회차 번호 흐름 (최신 → 과거):")
    for i in range(min(5, len(draws))):
        nums_str = "  ".join(f"{n:02d}" for n in draws[i].numbers)
        label    = "최근 1회차전" if i == 0 else f"최근 {i + 1}회차전"
        print(f"  │    [{label}] {nums_str}")

    recent_set = set(draws[0].numbers)
    cands = sorted(
        [(n, cs[n]) for n in range(1, 46) if n not in recent_set],
        key=lambda x: x[1], reverse=True,
    )[:12]
    print(f"  │")
    print(f"  │  연결 흐름 기반 다음 회차 예측 후보 (최근 회차 미포함, 상위 12개):")
    for n, score in cands:
        cur   = gd[n]["cur_gap"]
        trend = ft[n]["trend"]
        perio = gd[n]["periodic"]
        od_mk = " ★초과대기" if gd[n]["is_overdue"] else ""
        print(f"  │    {n:02d}번  연결강도: {score:>5.1f}  대기: {cur:>2}회  "
              f"추세: {trend:>3}  주기성: {perio}{od_mk}")
    print(f"  └{'─' * (W - 4)}")

    # ── 5. 출현 주기성 분석 ────────────────────────────────────────────────────
    print()
    print("  ┌─ 【5】 출현 주기성 분석 (강한 주기성 번호 탐색)")
    strong_p = sorted(
        [(n, gd[n]["cur_gap"], gd[n]["avg_gap"], gd[n]["overdue"])
         for n in range(1, 46) if gd[n]["periodic"] == "강함"],
        key=lambda x: x[3], reverse=True,
    )
    if strong_p:
        print(f"  │  규칙적 주기로 출현하는 번호 (출현 임박 순):")
        for n, cur, avg, ratio in strong_p[:8]:
            prog  = min(ratio, 2.0)
            filled = int(prog * 7)
            bar   = "█" * filled + "░" * max(0, 14 - filled)
            stat  = "◎ 임박" if ratio >= 0.9 else ("○ 대기" if ratio >= 0.5 else "● 초기")
            print(f"  │    {n:02d}번  [{bar}] 평균 {avg:>4.1f}회 간격  현재 {cur:>2}회  {stat}")
    else:
        print(f"  │  현재 강한 주기성을 보이는 번호가 없습니다.")
    print(f"  └{'─' * (W - 4)}")
    print()


# ════════════════════════════════════════════════════════════════════════════════
# §5-7. 앙상블 × 흐름 융합 랭킹 — 흐름 신호의 실제 선정 반영
# ════════════════════════════════════════════════════════════════════════════════
# [고도화 이유] 기존 print_flow_top6_reasoning()은 순수 앙상블 상위 6개에 흐름
# 해설만 덧붙였습니다. 제목의 "앙상블 × 흐름 종합"과 달리 흐름 점수가 선정에
# 전혀 반영되지 않았고, 실측상 흐름 연결강도 상위 6개와 앙상블 상위 6개는
# 완전히 겹치지 않았습니다 (seed 42 기준 교집합 0개). 아래 융합 랭킹이 흐름을
# 실제 선정에 반영하는 유일한 경로입니다. 융합은 발견적(heuristic) 가중합이며
# 당첨 확률 개선을 의미하지 않습니다.
# ════════════════════════════════════════════════════════════════════════════════

FLOW_TREND_SCORES = {
    "급락": 100.0,   # 강한 회귀 기대
    "하락": 75.0,
    "안정": 50.0,
    "상승": 35.0,
    "급등": 20.0,    # 모멘텀 과열 → 회귀 관점에서 감점
    "데이터부족": 50.0,
}


def compute_flow_scores(flow_data: dict) -> dict[int, float]:
    """
    번호별 흐름 점수 (0~100)를 산출합니다.
    구성: 연결강도(conn, 이미 0~100) + 대기초과율(overdue, 2.0 상한→0~100) +
          추세 매핑(급락 100 … 급등 20)의 산술평균.
    overdue 상한 2.0: 장기 미출현 1개 번호가 융합을 독점하지 못하도록 제한.
    """
    gd = flow_data["gap_data"]
    cs = flow_data["conn_scores"]
    ft = flow_data["flow_trend"]
    out: dict[int, float] = {}
    for n in range(1, 46):
        overdue_score = min(gd[n]["overdue"], 2.0) / 2.0 * 100.0
        trend_score = FLOW_TREND_SCORES.get(ft[n]["trend"], 50.0)
        out[n] = (cs[n] + overdue_score + trend_score) / 3.0
    return out


def compute_fused_ranking(scored: list[ScoredNumber],
                          flow_data: dict,
                          flow_weight: float = FLOW_WEIGHT_DEFAULT
                          ) -> list[dict]:
    """
    앙상블 종합 점수와 흐름 점수의 가중합으로 최종 순위를 산출합니다.
      fused(n) = (1 − w) × composite(n) + w × flow(n)
    w=0이면 순수 앙상블과 동일합니다. 반환은 fused 내림차순 딕셔너리 목록
    (number / fused / composite / flow 키 포함).
    """
    if not 0.0 <= flow_weight <= 1.0:
        raise ValueError(f"flow_weight는 0~1 범위여야 합니다 (입력: {flow_weight}).")
    flow_scores = compute_flow_scores(flow_data)
    comp = {s.number: s.composite for s in scored}
    ranked = [
        {"number": n,
         "fused": (1.0 - flow_weight) * comp[n] + flow_weight * flow_scores[n],
         "composite": comp[n],
         "flow": flow_scores[n]}
        for n in range(1, 46)
    ]
    ranked.sort(key=lambda x: (-x["fused"], x["number"]))
    return ranked


def recommend_combination(scored: list[ScoredNumber],
                          flow_data: dict,
                          flow_weight: float = FLOW_WEIGHT_DEFAULT,
                          topk: int = 6) -> dict:
    """
    융합 랭킹 상위 topk개 번호를 오름차순 조합으로 반환합니다 (파이프라인용).
    {"numbers": [...], "fused": [...], "flow_weight": w} 형식.
    """
    ranked = compute_fused_ranking(scored, flow_data, flow_weight)
    picks = ranked[:topk]
    return {"numbers": sorted(p["number"] for p in picks),
            "fused": [round(p["fused"], 2) for p in picks],
            "flow_weight": flow_weight}


def print_flow_top6_reasoning(scored: list[ScoredNumber],
                               draws: list[DrawResult],
                               flow_data: dict,
                               fused: list[dict] | None = None,
                               flow_weight: float = FLOW_WEIGHT_DEFAULT) -> None:
    """
    융합 랭킹 상위 6개 번호에 대해 흐름 분석 기반 선정 근거와 최종 요약을 출력합니다.
    당첨 보장이 아닌 '흐름상 유리한 가능성' 관점으로 설명합니다.

    [수정] 선정 기준이 순수 앙상블 상위 6개(scored[:6])에서 융합 랭킹 상위 6개로
    변경되었습니다. 기존 동작이 필요하면 fused=None 대신 flow_weight=0을 전달하면
    순수 앙상블 순위가 그대로 재현됩니다.
    """
    ft  = flow_data["flow_trend"]
    gd  = flow_data["gap_data"]
    cs  = flow_data["conn_scores"]
    sf  = flow_data["seg_flow"]
    rb  = flow_data["recently_back"]
    if fused is None:
        fused = compute_fused_ranking(scored, flow_data, flow_weight)
    comp_map = {s.number: s for s in scored}
    top6 = fused[:6]

    def _all_ind_scores(s: ScoredNumber) -> list[tuple[str, float]]:
        return [
            ("Z-Score", s.s_z), ("볼린저밴드", s.s_bb), ("RSI", s.s_rsi),
            ("MA", s.s_ma), ("Aroon", s.s_aroon), ("양자분석", s.s_qa),
            ("양자플럭스", s.s_qf), ("신경패턴", s.s_np),
            ("통합3D", s.s_m3d), ("통합양자", s.s_iq), ("클러스터", s.s_ac),
        ]

    print("=" * W)
    print("  🏆 출현가능성 상위 6개 번호 — 앙상블 × 흐름 융합 선정 근거".center(W))
    print("  ※ 통계적 흐름 분석 결과이며, 당첨 보장이 아닙니다.".center(W))
    print("=" * W)
    print(f"\n  융합 예측 후보 (앙상블 {(1.0-flow_weight)*100:.0f}% + 흐름 {flow_weight*100:.0f}%):  "
          f"{' — '.join(f'{p['number']:02d}번' for p in top6)}\n")

    for rank, p in enumerate(top6, 1):
        n    = p["number"]
        s    = comp_map[n]
        n_ft = ft[n]
        n_gd = gd[n]
        n_cs = cs[n]
        # 소속 구간 탐색
        n_seg = next((seg for seg in sf if seg["lo"] <= n <= seg["hi"]), None)

        print("─" * (W - 4))
        print(f"  [{rank}위 예측 후보] {n:02d}번   융합 점수: {p['fused']:.2f} "
              f"(앙상블 {p['composite']:.1f} + 흐름 {p['flow']:.1f})  {_level(p['fused'])}")
        print()

        # ── 선정 근거 목록 구성 ───────────────────────────────────────────────
        reasons: list[str] = []

        if n_gd["is_long_absent"]:
            reasons.append(
                f"장기 미출현 — {n_gd['cur_gap']}회차 대기 중 "
                f"(평균 {n_gd['avg_gap']:.1f}회 대비 {n_gd['overdue']:.1f}배), "
                f"흐름상 재등장 가능성"
            )
        elif n_gd["is_overdue"]:
            reasons.append(
                f"평균 대기 초과 — 현재 {n_gd['cur_gap']}회 대기 / "
                f"평균 {n_gd['avg_gap']:.1f}회 ({n_gd['overdue']:.1f}배), "
                f"출현 임박 가능성"
            )

        trend = n_ft["trend"]
        if trend == "데이터부족":
            reasons.append(
                "추세 판단 보류 — 분석 회차가 10회 미만이라 단기/직전 비교가 편향됨"
            )
        elif trend == "급락":
            reasons.append(
                f"최근 급락 추세 — 이전5회 {n_ft['prev5']}번 → 최근5회 {n_ft['f5']}번으로 감소, "
                f"흐름상 평균 회귀 가능성"
            )
        elif trend == "하락":
            reasons.append("출현 감소 추세 — 흐름상 저조 구간, 회귀 가능성")
        elif trend in ("상승", "급등"):
            reasons.append(
                f"출현 {trend} 추세 — 최근5회 {n_ft['f5']}번 출현, 모멘텀 지속 가능성"
            )
        else:
            reasons.append(
                f"안정적 출현 패턴 — 최근5회 {n_ft['f5']}번 출현, 평균 수준 유지"
            )

        if n_cs >= 70:
            reasons.append(
                f"연결 흐름 강도 높음 (점수 {n_cs:.0f}/100) — "
                f"이전 회차들과 강한 전이 연관성"
            )
        elif n_cs >= 50:
            reasons.append(f"연결 흐름 중간 수준 (점수 {n_cs:.0f}/100)")

        if n_gd["periodic"] == "강함":
            prog = n_gd["overdue"]
            stat = "출현 임박" if prog >= 0.9 else "대기 진행 중"
            reasons.append(
                f"규칙적 주기 패턴 감지 (변동계수 {n_gd['cv']:.2f}) — "
                f"현재 주기 진행률 {prog:.1%}, {stat}"
            )

        if n in rb:
            reasons.append("장기 공백 후 최근 재등장 — 복귀 흐름 패턴 진행 가능성")

        if n_seg:
            seg_note = (
                f"소속 구간 [{n_seg['name']}] {n_seg['trend']} 추세 "
                f"(최근5회 {n_seg['r5']}개 / 직전5회 {n_seg['p5']}개)"
            )
            if n_seg["trend"] == "하락":
                seg_note += " — 구간 내 회귀 가능성"
            reasons.append(seg_note)

        high_ind = [(nm, v) for nm, v in _all_ind_scores(s) if v >= 70]
        if high_ind:
            hs = ", ".join(
                f"{nm}({v:.0f})" for nm, v in sorted(high_ind, key=lambda x: -x[1])[:4]
            )
            reasons.append(f"앙상블 강점 지표: {hs}")

        print(f"  ▸ 번호별 선정 근거:")
        for i, reason in enumerate(reasons, 1):
            print(f"     {i}. {reason}")

        print()
        print(f"  ▸ 흐름 상세 데이터:")
        print(f"     출현 추세  : {trend:<6}  "
              f"(최근5회: {n_ft['f5']}번 출현 / 직전5회: {n_ft['prev5']}번 출현)")
        print(f"     대기 상태  : 현재 {n_gd['cur_gap']}회 대기 / "
              f"평균 {n_gd['avg_gap']:.1f}회 / 초과율 {n_gd['overdue']:.1f}배")
        print(f"     연결 강도  : {n_cs:>5.1f}/100   주기성: {n_gd['periodic']}")
        if n_seg:
            print(f"     구간 흐름  : [{n_seg['name']}] {n_seg['trend']} "
                  f"(최근5: {n_seg['r5']}개 / 직전5: {n_seg['p5']}개)")
        print()

    print("─" * (W - 4))

    # ── 핵심 이유 요약 ─────────────────────────────────────────────────────────
    print()
    print("  ┌─ 출현 가능성이 높다고 판단한 핵심 이유 요약")
    print(f"  │  1. 융합 랭킹 상위 6개 — 앙상블×흐름 가중합 (w={flow_weight:.2f})")
    print(f"  │  2. 평균 대기 초과 여부 — 과소출현 구간 진입 가능성")
    print(f"  │  3. 회차 간 연결 흐름 — 전이 확률 기반 다음 회차 연관성")
    print(f"  │  4. 구간 흐름 분석 — 저조한 구간에서의 흐름상 회귀 가능성")
    print(f"  │  5. 주기성 분석 — 규칙적 출현 패턴 기반 임박 여부")
    print(f"  │")
    print(f"  │  ※ 이 분석은 '흐름상 유리한 가능성'을 나타낼 뿐입니다.")
    print(f"  │     로또는 완전 무작위 추첨이며, 어떤 분석도 당첨을 보장하지 않습니다.")
    print(f"  └{'─' * (W - 4)}")
    print()


# ════════════════════════════════════════════════════════════════════════════════
# §5-8. 엔진 중복 진단 · 실데이터 로더 · 홀드아웃 백테스트
# ════════════════════════════════════════════════════════════════════════════════

def diagnose_engines(scored: list[ScoredNumber]) -> None:
    """
    11종 지표 점수 간 상관계수로 중복 신호를 점검합니다.
    |r|≥0.80 쌍과 종합 점수 대비 상관을 출력합니다 (서술용, 가중치 변경 없음).
    """
    keys = ["s_z", "s_bb", "s_rsi", "s_ma", "s_aroon",
            "s_qa", "s_qf", "s_np", "s_m3d", "s_iq", "s_ac"]
    vec = {k: [getattr(s, k) for s in scored] for k in keys}
    print("─" * W)
    print("  🔍 엔진 중복 진단 — 지표 간 상관계수".center(W))
    print("─" * W)
    print("  기준: |r| ≥ 0.80 (강한 중복 의심). 가중치는 변경하지 않습니다.")
    found = False
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            try:
                r = statistics.correlation(vec[keys[i]], vec[keys[j]])
            except statistics.StatisticsError:
                continue
            if abs(r) >= 0.80:
                found = True
                print(f"    {keys[i]:>8} × {keys[j]:<8}  r={r:+.3f}  "
                      f"{'← 동일 신호 이중 계산 의심' if abs(r) >= 0.90 else ''}")
    if not found:
        print("    강한 중복 쌍 없음.")
    comp = [s.composite for s in scored]
    parts = []
    for k in keys:
        try:
            parts.append(f"{k}={statistics.correlation(vec[k], comp):+.2f}")
        except statistics.StatisticsError:
            parts.append(f"{k}=n/a")
    print("  종합 대비 상관: " + "  ".join(parts))
    print("  ※ M3D가 음수면 모멘텀↔회귀 방향 충돌 (다변화 의도로 유지, 가중치据置).")
    print()


def load_draws_json(path: str) -> list[DrawResult]:
    """
    실제 추첨 기록 JSON을 로드합니다. 형식:
      [{"round": 1200, "numbers": [1,2,3,4,5,6], "bonus": 7}, ...]
    또는 {"draws": [...]}. 최신 회차가 앞에 오도록 내림차순 정렬합니다.
    """
    import json
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    items = raw["draws"] if isinstance(raw, dict) and "draws" in raw else raw
    draws = [DrawResult(round=int(d["round"] if "round" in d else d.get("ltEpsd", 0)),
                        numbers=sorted(int(x) for x in d["numbers"])[:6],
                        bonus=int(d["bonus"] if "bonus" in d else d.get("bnsWnNo", 0)))
             for d in items]
    draws.sort(key=lambda d: d.round, reverse=True)
    if not draws:
        raise ValueError(f"{path}: 회차 데이터가 비어 있습니다.")
    return draws


def holdout_backtest(draws: list[DrawResult],
                     holdout: int = 10,
                     topk: int = 6,
                     flow_weight: float = FLOW_WEIGHT_DEFAULT) -> dict:
    """
    홀드아웃 백테스트 (누수 방지: 타깃보다 과거 데이터로만 학습).

    각 타깃 회차 i(0=최신)에 대해 draws[i+1:] (과거のみ) 로 융합 랭킹을 계산하고
    실제 메인 6개 번호와 적중 수를 셉니다. 무작위 6개 조합의 기대 적중은
    6×6/45 = 0.80개이므로, 평균 적중이 0.80 근처면 "패턴 무의미" 구간입니다.
    과거 적합이 좋아도 미래 당첨 확률 상승으로 해석하지 마십시오.
    """
    holdout = min(holdout, max(0, len(draws) - 20))
    if holdout <= 0:
        raise ValueError("holdout_backtest: 학습용 20회차+검증 회차가 필요합니다.")
    hits: list[int] = []
    for i in range(holdout):
        train = draws[i + 1:]
        if len(train) < 20:
            break
        scored = compute_hybrid_scores(train)
        flow = compute_flow_analysis(train)
        rec = recommend_combination(scored, flow, flow_weight, topk)
        actual = set(draws[i].numbers)
        hits.append(sum(1 for n in rec["numbers"] if n in actual))
    mean_hits = sum(hits) / len(hits) if hits else 0.0
    return {"targets": len(hits),
            "hits": hits,
            "mean_hits": round(mean_hits, 3),
            "hit3_rate": round(sum(1 for h in hits if h >= 3) / len(hits) * 100, 2) if hits else 0.0,
            "random_baseline": 0.80,
            "flow_weight": flow_weight}


def print_backtest_report(res: dict) -> None:
    print("─" * W)
    print("  🧪 홀드아웃 백테스트 — 과거 재현 서술 (예측 성능 보장 아님)".center(W))
    print("─" * W)
    print(f"  검증 타깃: {res['targets']}회차  |  회차별 적중: {res['hits']}")
    print(f"  평균 적중: {res['mean_hits']}개  |  무작위 기대: {res['random_baseline']}개  |  "
          f"3개+ 적중률: {res['hit3_rate']}%")
    if res["mean_hits"] <= res["random_baseline"] + 0.05:
        print("  → 무작위 수준. 흐름·앙상블 신호에 예측력이 있다고 볼 수 없습니다.")
    else:
        print("  → 과거 구간에서 무작위를 상회. 단, 과적합 가능성과 독립추첨 전제상")
        print("    미래 당첨 확률 상승으로 해석해서는 안 됩니다.")
    print()


# ════════════════════════════════════════════════════════════════════════════════
# §6. 메인 진입점
# ════════════════════════════════════════════════════════════════════════════════

def main(n_rounds: int = 100, seed: int = 42,
         flow_weight: float = FLOW_WEIGHT_DEFAULT,
         history_path: str | None = None,
         holdout: int = 0,
         topk: int = 6,
         stability_iters: int = 20,
         quiet: bool = False) -> None:
    if history_path:
        draws = load_draws_json(history_path)
        data_label = f"실데이터 {len(draws)}회차 ({history_path})"
    else:
        draws = make_sample_draws(n_rounds=n_rounds, seed=seed)
        data_label = f"샘플 {n_rounds}회차 (seed={seed}) — 시연용 무작위 데이터"
    if not quiet:
        print("\n" + "=" * W)
        print("  한국 로또 6/45 — 하이브리드 슈퍼 앙상블 분석 시스템".center(W))
        print("  전통 통계 지표 5종 (40%) + 고급 예측 엔진 6종 (60%)".center(W))
        print("=" * W)
        print(f"\n  데이터: {data_label}  |  가중치 합계: {sum(WEIGHTS.values()):.2f}  |  "
              f"융합 흐름비중: {flow_weight:.2f}")

    if holdout > 0:
        if not history_path:
            print("\n  [경고] --holdout는 실데이터(--history)와 함께 사용해야 합니다. "
                  "샘플 데이터 백테스트는 무의미하므로 건너뜁니다.")
        else:
            print(f"\n  홀드아웃 백테스트 수행 중 ... ", end="", flush=True)
            res = holdout_backtest(draws, holdout, topk, flow_weight)
            print("완료.\n")
            print_backtest_report(res)

    if not quiet:
        print(f"\n  데이터 로딩 및 배치 계산 중 (11종 × 45번호)... ", end="", flush=True)
    scored = compute_hybrid_scores(draws)
    flow_data = compute_flow_analysis(draws)
    fused = compute_fused_ranking(scored, flow_data, flow_weight)
    stability = compute_stability(draws, n_iter=stability_iters,
                                  flow_weight=flow_weight, topk=topk)
    if not quiet:
        print("완료.\n")

        # 1. 전체 데이터 테이블 (융합 순위순 + 선정 근거 컬럼 + 선택 조언)
        print_full_table(scored, flow_data, fused, stability, flow_weight)
        print_pick_advice(scored, fused, stability, flow_weight)

        # 2. 기술 지표 분석 패널 — 요구사항 1번에 의해 출력 삭제
        # print_technical_panel(scored)

        # 3. 고급 예측 엔진 6종 패널
        print_engine_panel(scored)

        # 3-2. 엔진 중복 진단 (신규)
        diagnose_engines(scored)

        # 4. 점수 분포 요약
        print_score_distribution(scored)

        # 5. 상위 6개 순수 앙상블 상세 해석
        print_top6_interpretation(scored)

        # 6. 가중치 요약
        print_weight_summary()

        # 7. 번호 흐름 분석 — 회차 간 연결 구조 분석
        print(f"\n  번호 흐름 분석 계산 완료 (융합 상위: "
              f"{' '.join(f'{p['number']:02d}' for p in fused[:6])}).\n")
        print_flow_analysis(draws, scored, flow_data)

        # 8. 융합 랭킹 기반 번호별 선정 근거 최종 요약
        print_flow_top6_reasoning(scored, draws, flow_data, fused, flow_weight)

        # 9. 면책 고지
        print_disclaimer()
    return None


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="로또 6/45 하이브리드 앙상블 + 흐름 융합 분석")
    ap.add_argument("--rounds", type=int, default=100, help="샘플 회차 수 (기본 100)")
    ap.add_argument("--seed", type=int, default=42, help="샘플 시드 (기본 42)")
    ap.add_argument("--flow-weight", type=float, default=FLOW_WEIGHT_DEFAULT,
                    help="융합 시 흐름 비중 0~1 (기본 0.25, 0=순수 앙상블)")
    ap.add_argument("--history", type=str, default=None,
                    help="실제 추첨 기록 JSON 경로")
    ap.add_argument("--holdout", type=int, default=0,
                    help="홀드아웃 백테스트 타깃 회차 수 (실데이터 전용)")
    ap.add_argument("--topk", type=int, default=6, help="추천 조합 개수 (기본 6)")
    ap.add_argument("--stability-iters", type=int, default=20,
                    help="안정도 부트스트랩 반복 수 (기본 20, 0=미측정)")
    ap.add_argument("--predict", action="store_true",
                    help="패널 출력 없이 융합 추천 조합 1행만 출력")
    args = ap.parse_args()
    if args.predict:
        draws = (load_draws_json(args.history) if args.history
                 else make_sample_draws(n_rounds=args.rounds, seed=args.seed))
        scored = compute_hybrid_scores(draws)
        flow = compute_flow_analysis(draws)
        rec = recommend_combination(scored, flow, args.flow_weight, args.topk)
        print(" ".join(f"{n:02d}" for n in rec["numbers"]))
    else:
        main(n_rounds=args.rounds, seed=args.seed, flow_weight=args.flow_weight,
             history_path=args.history, holdout=args.holdout, topk=args.topk,
             stability_iters=args.stability_iters)
