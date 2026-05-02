"""
lotto_technical_indicators.py
─────────────────────────────────────────────────────────────────────────────
한국 로또 6/45 기술 지표 적용 분석 모듈

금융 기술 지표(MA, RSI, 볼린저밴드, Aroon, Z-Score)를 복권 빈도 분석에
맞게 재해석하여 번호별 확률적 가중치를 산출합니다.

핵심 전제:
  ─ 복권 추첨은 독립 사건이다 (시계열 추세 없음).
  ─ 각 지표는 가격 추세가 아닌 빈도 통계를 추적한다.
  ─ 모든 가중치는 확률적 '힌트'이며, 당첨을 보장하지 않는다.

섹션 구조:
  1. 데이터 구조 및 샘플 생성
  2. 이동평균 (Frequency MA)
  3. RSI (Appearance Momentum RSI)
  4. 볼린저 밴드 (Cross-Sectional Frequency Bands)
  5. 아룬 (Gap Recency Aroon)
  6. Z-Score (기존 지표 재평가 + 개선)
  7. 통합 스코어링 엔진
  8. 번호 순위 및 추천
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import math
import random
import statistics
import sys
from dataclasses import dataclass, field
from typing import Sequence

# Windows 콘솔에서 한글/유니코드 출력이 깨지는 문제 방지
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


# ─────────────────────────────────────────────────────────────────────────────
# 1. 데이터 구조
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class DrawResult:
    """단일 회차 당첨 결과."""
    round: int
    numbers: list[int]   # 본 번호 6개 (정렬 불필요)
    bonus: int           # 보너스 번호


@dataclass
class TechnicalScore:
    """번호 하나에 대한 전체 기술 지표 점수."""
    number: int

    # ── 개별 지표 값 ──────────────────────────────────────────────
    ma_signal: float        # 단기MA − 장기MA: 양수 = 상승 모멘텀
    rsi: float              # 0–100: <30 과소출현(과매도), >70 과다출현(과매수)
    bollinger_pct_b: float  # %B: <0 하단밴드 하회, >1 상단밴드 상회
    aroon_oscillator: float # −100 ~ +100: 양수 = 최근 출현, 음수 = 장기 공백
    z_score: float          # 표준 Z-Score (전체 누적 기준)

    # ── 각 지표의 개별 가중치 승수 ────────────────────────────────
    ma_boost: float         = 1.0
    rsi_boost: float        = 1.0
    bb_boost: float         = 1.0
    aroon_boost: float      = 1.0
    z_boost: float          = 1.0

    # ── 5개 지표를 곱한 최종 복합 가중치 ─────────────────────────
    composite_boost: float  = 1.0


def make_sample_draws(n_rounds: int = 200, seed: int = 42) -> list[DrawResult]:
    """
    실제 데이터가 없을 때 사용하는 샘플 회차 생성기.
    실제 사용 시 이 함수를 API / CSV 로더로 대체하십시오.
    """
    rng = random.Random(seed)
    draws: list[DrawResult] = []
    for rnd in range(1, n_rounds + 1):
        pool = list(range(1, 46))
        rng.shuffle(pool)
        picks = sorted(pool[:7])
        draws.append(DrawResult(round=rnd, numbers=picks[:6], bonus=picks[6]))
    # 최신 회차가 인덱스 0에 오도록 역순 정렬 (실제 데이터와 동일한 관례)
    draws.reverse()
    return draws


# ─────────────────────────────────────────────────────────────────────────────
# 2. 이동평균 적용 (Frequency Moving Average)
# ─────────────────────────────────────────────────────────────────────────────

def compute_lottery_ma(
    draws: list[DrawResult],
    num: int,
    short_window: int = 10,
    long_window: int  = 30,
    include_bonus: bool = True,
) -> float:
    """
    빈도 이동평균 크로스오버 신호를 반환합니다.

    [금융 MA와의 차이]
    금융 MA → 가격의 시간 평균 (연속형 수치 평활화)
    복권 MA  → 출현 이진 시퀀스의 롤링 비율 비교

    [수식]
    MA(n, W) = (1/W) × Σ I(n ∈ draw_i),  i = 0..W-1
    Signal   = MA(n, short_W) − MA(n, long_W)

    Signal > 0 → 단기 빈도 > 장기 빈도 → 상승 크로스오버 (가중치 ↑)
    Signal < 0 → 단기 빈도 < 장기 빈도 → 하락 크로스오버 (가중치 ↓)

    반환값 범위: 이론적으로 ≈ [−0.3, +0.3] (6/45 게임 특성상)
    """
    sw = min(short_window, len(draws))
    lw = min(long_window,  len(draws))

    short_count = 0
    long_count  = 0

    for i in range(lw):
        appeared = num in draws[i].numbers or (include_bonus and draws[i].bonus == num)
        if i < sw:
            short_count += int(appeared)
        long_count += int(appeared)

    short_ma = short_count / sw if sw > 0 else 0.0
    long_ma  = long_count  / lw if lw > 0 else 0.0

    return short_ma - long_ma


def ma_to_boost(signal: float, scale: float = 0.4) -> float:
    """
    MA 신호 → 가중치 승수 변환.

    signal × scale 로 최대 ±(scale × 0.3) ≈ ±12% 조정.
    예: signal = +0.20 → boost = 1.08 (8% 상향)
        signal = −0.15 → boost = 0.94 (6% 하향)
    """
    return max(0.5, min(2.0, 1.0 + signal * scale))


# ─────────────────────────────────────────────────────────────────────────────
# 3. RSI 적용 (Appearance Momentum RSI)
# ─────────────────────────────────────────────────────────────────────────────

def compute_lottery_rsi(
    draws: list[DrawResult],
    num: int,
    window: int = 20,
    include_bonus: bool = True,
) -> float:
    """
    출현 모멘텀 RSI를 반환합니다 (0~100).

    [금융 RSI와의 차이]
    금융 RSI → 가격 변화의 크기(magnitude) 비율 분석
    복권 RSI → 출현/미출현 이진 비율 분석

    [수식]
    appearances = Σ I(n ∈ draw_i),  i = 0..W-1
    absences    = W − appearances

    RS  = appearances / absences
    RSI = 100 − (100 / (1 + RS))

    RSI > 70 → 과다출현 (과매수) → 평균 회귀 기대 → 가중치 억제
    RSI < 30 → 과소출현 (과매도) → 회귀 기대    → 가중치 상향

    주의: RSI가 높다고 번호를 "무조건 피하라"는 의미가 아님.
    복권은 독립 사건이므로 이는 약한 통계적 편향 신호에 불과합니다.
    """
    w = min(window, len(draws))
    appearances = 0

    for i in range(w):
        if num in draws[i].numbers or (include_bonus and draws[i].bonus == num):
            appearances += 1

    absences = w - appearances

    if absences == 0:
        return 100.0  # 매 회차 출현 → 극단적 과다출현
    if appearances == 0:
        return 0.0    # 단 한 번도 출현 안 함 → 극단적 과소출현

    rs = appearances / absences
    return 100.0 - (100.0 / (1.0 + rs))


def rsi_to_boost(rsi: float) -> float:
    """
    RSI 값 → 가중치 승수 변환 (평균 회귀 논리 적용).

    RSI > 70 → ×0.90 (10% 억제)
    RSI < 30 → ×1.10 (10% 상향)
    중립 구간 → 50 기준 선형 미세 조정 (최대 ±5%)
    """
    if rsi > 70:
        return 0.90
    if rsi < 30:
        return 1.10
    # 중립 구간: RSI=50 → boost=1.0, 선형 보간
    return 1.0 + (50.0 - rsi) / 50.0 * 0.05


# ─────────────────────────────────────────────────────────────────────────────
# 4. 볼린저 밴드 적용 (Cross-Sectional Frequency Bands)
# ─────────────────────────────────────────────────────────────────────────────

def compute_bollinger_bands(
    draws: list[DrawResult],
    window: int = 30,
    include_bonus: bool = True,
) -> dict[int, float]:
    """
    전체 45개 번호에 대한 볼린저 %B 딕셔너리를 반환합니다.

    [금융 볼린저 밴드와의 차이]
    금융 BB    → 단일 가격 시계열의 시간축 방향 ±2σ 밴드
    복권 BB    → 45개 번호 전체의 횡단면 빈도 분포 ±2σ 밴드

    [수식]
    rollingFreq(n, W) = W 회차 동안 번호 n의 출현 횟수

    μ_W = mean({rollingFreq(n) : n = 1..45})    ← 횡단면 평균
    σ_W = std ({rollingFreq(n) : n = 1..45})    ← 횡단면 표준편차

    UB = μ_W + 2σ_W
    LB = μ_W − 2σ_W

    %B(n) = (rollingFreq(n) − LB) / (UB − LB)
      %B > 1.0 → 상단 밴드 초과 (과다출현)
      %B < 0.0 → 하단 밴드 미달 (과소출현)
      %B = 0.5 → 횡단면 평균 (중립)

    Z-Score와의 차이: Z-Score는 전체 누적 기준,
    Bollinger %B는 최근 W회차만 반영 → 최근 추세에 더 민감.
    """
    w = min(window, len(draws))

    # 각 번호의 롤링 빈도 계산
    rolling_freq: dict[int, int] = {n: 0 for n in range(1, 46)}
    for i in range(w):
        for n in draws[i].numbers:
            rolling_freq[n] += 1
        if include_bonus:
            rolling_freq[draws[i].bonus] += 1

    freq_values = list(rolling_freq.values())
    mu = statistics.mean(freq_values)
    sigma = statistics.pstdev(freq_values) or 1.0  # 모집단 표준편차

    upper_band = mu + 2 * sigma
    lower_band = mu - 2 * sigma
    bandwidth  = upper_band - lower_band

    pct_b: dict[int, float] = {}
    for n in range(1, 46):
        if bandwidth > 0:
            pct_b[n] = (rolling_freq[n] - lower_band) / bandwidth
        else:
            pct_b[n] = 0.5  # 분산이 0일 경우 (이론상 불가)
    return pct_b


def bb_to_boost(pct_b: float) -> float:
    """
    볼린저 %B → 가중치 승수 변환.

    %B > 1.0 → ×0.92 (8% 억제)
    %B < 0.0 → ×1.08 (8% 상향)
    인밴드   → %B=0.5 기준 선형 미세 조정 (최대 ±4%)
    """
    if pct_b > 1.0:
        return 0.92
    if pct_b < 0.0:
        return 1.08
    # 인밴드 선형 보간: pct_b=0.5 → 1.0, pct_b=0→1.04, pct_b=1→0.96
    return 1.0 + (0.5 - pct_b) * 0.08


# ─────────────────────────────────────────────────────────────────────────────
# 5. 아룬 지표 적용 (Gap Recency Aroon)
# ─────────────────────────────────────────────────────────────────────────────

def compute_aroon(
    draws: list[DrawResult],
    num: int,
    window: int = 30,
    include_bonus: bool = True,
) -> float:
    """
    갭 재귀 아룬 오실레이터를 반환합니다 (−100 ~ +100).

    [금융 아룬과의 차이]
    금융 Aroon → "N기간 내 최고가/최저가 이후 경과 기간" 측정
    복권 Aroon → "마지막 출현까지의 경과 회차" + "최장 연속 공백" 측정

    [수식]
    AroonUp(n, W)   = ((W − drawsSinceLastSeen(n, W)) / W) × 100
                       ← 높을수록 최근에 출현 → 활성 모멘텀

    AroonDown(n, W) = ((W − longestConsecutiveGap(n, W)) / W) × 100
                       ← 높을수록 최장 공백이 최근에 발생 → 냉각 패턴

    Oscillator = AroonUp − AroonDown

    +100 → 방금 직전 출현 + 공백 없음 → 최강 활성 신호
    −100 → W회차 내 미출현 + 최장 공백 = W → 최강 냉각 신호
    """
    w = min(window, len(draws))

    draws_since_last_seen = w  # 기본값: 윈도우 내 미출현
    longest_gap           = 0
    current_gap           = 0

    for i in range(w):
        appeared = num in draws[i].numbers or (include_bonus and draws[i].bonus == num)
        if appeared:
            if draws_since_last_seen == w:
                # 윈도우 내 첫(=가장 최근) 출현 위치 기록
                draws_since_last_seen = i
            if current_gap > longest_gap:
                longest_gap = current_gap
            current_gap = 0
        else:
            current_gap += 1

    # 윈도우 끝의 후행 공백도 반영
    if current_gap > longest_gap:
        longest_gap = current_gap

    aroon_up   = ((w - draws_since_last_seen) / w) * 100
    aroon_down = ((w - longest_gap)           / w) * 100
    return aroon_up - aroon_down


def aroon_to_boost(oscillator: float) -> float:
    """
    아룬 오실레이터 → 가중치 승수 변환.

    > +50 → ×1.06 (6% 상향, 최근 출현 + 공백 없음)
    < −50 → ×0.94 (6% 억제, 장기 공백 패턴)
    중립  → 오실레이터/50 × 0.03 선형 미세 조정 (최대 ±3%)
    """
    if oscillator > 50:
        return 1.06
    if oscillator < -50:
        return 0.94
    return 1.0 + (oscillator / 50.0) * 0.03


# ─────────────────────────────────────────────────────────────────────────────
# 6. Z-Score 재평가 및 개선
# ─────────────────────────────────────────────────────────────────────────────
#
# ┌─────────────────────────────────────────────────────────────────────────┐
# │ [현재 사용 방식]                                                          │
# │ Z(n) = (freq(n) − μ_전체) / σ_전체                                        │
# │ Z > +1.5 → 과다출현 → 가중치 −15%                                        │
# │ Z < −1.5 → 과소출현 → 가중치 +15%                                        │
# │                                                                         │
# │ [금융 기술 지표와의 유사성]                                                  │
# │  ─ Z-Score ≈ 볼린저 %B의 전체 데이터 버전                                  │
# │  ─ 볼린저 %B : 최근 W회 기준의 횡단면 표준화 점수                             │
# │  ─ Z-Score  : 전체 누적 기준의 횡단면 표준화 점수                             │
# │  ─ 개념적으로 동일한 구조, 시간 범위만 다름                                   │
# │                                                                         │
# │ [4개 지표와의 결합 가능성]                                                  │
# │  ✅ MA   : Z는 누적, MA는 롤링 → 상호 보완 (시간 스케일 다름)                 │
# │  ✅ RSI  : Z는 절대 빈도 편차, RSI는 최근 윈도우 모멘텀 → 상호 보완            │
# │  ✅ BB   : Z의 롤링 버전이 %B → 함께 사용 시 장·단기 편차 모두 포착            │
# │  ✅ Aroon: Z는 빈도 편차, Aroon은 시간 재귀성 → 서로 다른 차원 측정            │
# │                                                                         │
# │ [개선 제안]                                                               │
# │  1. 단일 임계값(±1.5) 대신 연속 함수로 부드럽게 조정                           │
# │  2. 전체 Z-Score와 롤링 Z-Score(볼린저)를 동시에 활용                        │
# │  3. Z-Score가 같아도 최근 트렌드(MA, RSI)가 다르면 다르게 처리                 │
# └─────────────────────────────────────────────────────────────────────────┘

def compute_z_score(draws: list[DrawResult], num: int, include_bonus: bool = True) -> float:
    """
    전체 데이터 기준 Z-Score를 반환합니다.

    [현재 시스템과의 차이점]
    기존: 단순 임계값(±1.5) 이진 적용
    개선: 연속 함수로 부드럽게 처리 → z_to_boost() 에서 적용

    Z(n) = (freq(n) − μ_전체) / σ_전체
    """
    all_freq: dict[int, int] = {n: 0 for n in range(1, 46)}
    for draw in draws:
        for n in draw.numbers:
            all_freq[n] += 1
        if include_bonus:
            all_freq[draw.bonus] += 1

    freq_values = list(all_freq.values())
    mu    = statistics.mean(freq_values)
    sigma = statistics.pstdev(freq_values) or 1.0

    return (all_freq[num] - mu) / sigma


def z_to_boost(z: float) -> float:
    """
    Z-Score → 가중치 승수 변환 (개선된 연속 함수 버전).

    기존 이진 방식(±1.5 임계값)에서 S-커브 형태의 연속 함수로 개선.
    Z의 크기가 클수록 조정이 더 강하되, 극단값은 클리핑.

    공식: boost = 1.0 − tanh(z × 0.5) × 0.15
      z = 0   → boost = 1.00 (중립)
      z = +2  → boost ≈ 0.87 (−13% 억제, 과다출현)
      z = −2  → boost ≈ 1.13 (+13% 상향, 과소출현)
      z = +4  → boost ≈ 0.85 (−15% 억제, 극단 과다출현)

    tanh 사용 이유: S-커브로 부드럽게 포화 → 극단 이상치에 과잉 반응 방지.
    """
    return max(0.5, min(2.0, 1.0 - math.tanh(z * 0.5) * 0.15))


# ─────────────────────────────────────────────────────────────────────────────
# 7. 통합 스코어링 엔진
# ─────────────────────────────────────────────────────────────────────────────

def compute_all_technical_scores(
    draws: list[DrawResult],
    ma_short_w:   int = 10,
    ma_long_w:    int = 30,
    rsi_window:   int = 20,
    bb_window:    int = 30,
    aroon_window: int = 25,
    include_bonus: bool = True,
) -> list[TechnicalScore]:
    """
    전체 45개 번호에 대한 기술 지표 점수를 계산합니다.

    [지표 조합 논리]
    ─ Z-Score   : 전체 누적 기준 횡단면 편차 (장기 편향 탐지)
    ─ MA        : 단기/장기 롤링 빈도 크로스오버 (최근 추세)
    ─ RSI       : 최근 윈도우 출현 모멘텀 (단기 과열/냉각)
    ─ Bollinger : 최근 롤링 횡단면 편차 (단기 편향, Z의 보완)
    ─ Aroon     : 갭 재귀성 (마지막 출현 시점 + 최장 공백)

    5개가 같은 방향을 가리킬 때 가장 강한 신호.
    서로 충돌하면 곱셈으로 인해 상쇄 → 보수적 조정.

    [최종 가중치 공식]
    composite_boost = MA_boost × RSI_boost × BB_boost × Aroon_boost × Z_boost
                      [0.5 ~ 2.0 범위로 클리핑]
    """
    # 볼린저밴드는 전체 번호에 대해 한 번만 계산 (효율성)
    bb_pct_b_map = compute_bollinger_bands(draws, window=bb_window, include_bonus=include_bonus)

    scores: list[TechnicalScore] = []

    for num in range(1, 46):
        # ── 개별 지표 계산 ──────────────────────────────────────────────
        ma_signal        = compute_lottery_ma(draws, num, ma_short_w, ma_long_w, include_bonus)
        rsi              = compute_lottery_rsi(draws, num, rsi_window, include_bonus)
        bollinger_pct_b  = bb_pct_b_map[num]
        aroon_oscillator = compute_aroon(draws, num, aroon_window, include_bonus)
        z_score_val      = compute_z_score(draws, num, include_bonus)

        # ── 각 지표 → 가중치 승수 변환 ──────────────────────────────────
        ma_boost    = ma_to_boost(ma_signal)
        rsi_boost   = rsi_to_boost(rsi)
        bb_boost    = bb_to_boost(bollinger_pct_b)
        aroon_boost = aroon_to_boost(aroon_oscillator)
        z_boost     = z_to_boost(z_score_val)

        # ── 복합 가중치 (곱셈 조합) ─────────────────────────────────────
        composite = ma_boost * rsi_boost * bb_boost * aroon_boost * z_boost
        composite = max(0.5, min(2.0, composite))  # 안전 클리핑

        scores.append(TechnicalScore(
            number           = num,
            ma_signal        = round(ma_signal, 4),
            rsi              = round(rsi, 2),
            bollinger_pct_b  = round(bollinger_pct_b, 4),
            aroon_oscillator = round(aroon_oscillator, 2),
            z_score          = round(z_score_val, 4),
            ma_boost         = round(ma_boost, 4),
            rsi_boost        = round(rsi_boost, 4),
            bb_boost         = round(bb_boost, 4),
            aroon_boost      = round(aroon_boost, 4),
            z_boost          = round(z_boost, 4),
            composite_boost  = round(composite, 4),
        ))

    return scores


# ─────────────────────────────────────────────────────────────────────────────
# 8. 번호 순위 및 추천
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class NumberRanking:
    """번호별 최종 순위 정보."""
    rank: int
    number: int
    composite_boost: float
    signal_summary: str    # 5개 지표의 방향성 요약
    rsi: float
    z_score: float
    aroon_oscillator: float
    bollinger_pct_b: float
    ma_signal: float


def _signal_direction(score: TechnicalScore) -> str:
    """5개 지표의 방향성을 간략하게 요약합니다."""
    parts: list[str] = []

    # MA
    if score.ma_signal > 0.02:
        parts.append("MA↑")
    elif score.ma_signal < -0.02:
        parts.append("MA↓")
    else:
        parts.append("MA─")

    # RSI
    if score.rsi > 70:
        parts.append("RSI과열")
    elif score.rsi < 30:
        parts.append("RSI냉각")
    else:
        parts.append("RSI중립")

    # Bollinger
    if score.bollinger_pct_b > 1.0:
        parts.append("BB상단↑")
    elif score.bollinger_pct_b < 0.0:
        parts.append("BB하단↓")
    else:
        parts.append("BB인밴드")

    # Aroon
    if score.aroon_oscillator > 50:
        parts.append("Aroon활성")
    elif score.aroon_oscillator < -50:
        parts.append("Aroon냉각")
    else:
        parts.append("Aroon중립")

    # Z-Score
    if score.z_score > 1.5:
        parts.append("Z과다")
    elif score.z_score < -1.5:
        parts.append("Z과소")
    else:
        parts.append("Z정상")

    return " | ".join(parts)


def rank_numbers(
    scores: list[TechnicalScore],
    top_n: int = 45,
) -> list[NumberRanking]:
    """
    복합 가중치(composite_boost) 기준으로 번호를 순위화합니다.

    높은 composite_boost = 여러 지표가 동시에 긍정적 신호를 발신.
    낮은 composite_boost = 여러 지표가 동시에 억제 신호를 발신.

    [중요 주의사항]
    순위가 높다고 당첨 확률이 높아지는 것이 아닙니다.
    복권은 독립 사건이므로 이 순위는 통계적 경향에 대한 '참고 정보'입니다.
    """
    sorted_scores = sorted(scores, key=lambda s: s.composite_boost, reverse=True)

    rankings: list[NumberRanking] = []
    for rank, score in enumerate(sorted_scores[:top_n], start=1):
        rankings.append(NumberRanking(
            rank             = rank,
            number           = score.number,
            composite_boost  = score.composite_boost,
            signal_summary   = _signal_direction(score),
            rsi              = score.rsi,
            z_score          = score.z_score,
            aroon_oscillator = score.aroon_oscillator,
            bollinger_pct_b  = score.bollinger_pct_b,
            ma_signal        = score.ma_signal,
        ))
    return rankings


def recommend_numbers(
    scores: list[TechnicalScore],
    count: int = 6,
    use_weighted_sampling: bool = True,
    seed: int | None = None,
) -> tuple[list[int], list[NumberRanking]]:
    """
    기술 지표 가중치를 적용한 번호 추천 (확률적 선택).

    [선택 방식]
    use_weighted_sampling = True  → 가중치에 비례한 확률로 무작위 선택
                                    (가중치가 높아도 선택이 보장되지 않음 → 진정한 확률)
    use_weighted_sampling = False → 상위 N개 번호를 결정론적으로 선택
                                    (이 방식은 과적합 위험이 있어 비권장)

    [확률적 가중치 샘플링 수식]
    P(n 선택) = composite_boost(n) / Σ composite_boost(모든 번호)
    """
    rng = random.Random(seed)

    numbers  = [s.number          for s in scores]
    weights  = [s.composite_boost for s in scores]

    if use_weighted_sampling:
        selected_nums = rng.choices(numbers, weights=weights, k=count * 10)
        # 중복 제거하면서 순서 유지
        seen: set[int] = set()
        unique: list[int] = []
        for n in selected_nums:
            if n not in seen and len(unique) < count:
                seen.add(n)
                unique.append(n)
        # 충분하지 않으면 나머지를 무작위로 채움
        remaining = [n for n in numbers if n not in seen]
        rng.shuffle(remaining)
        unique.extend(remaining[:count - len(unique)])
        selected_nums = sorted(unique)
    else:
        # 결정론적 상위 N개 선택
        top_scores = sorted(scores, key=lambda s: s.composite_boost, reverse=True)
        selected_nums = sorted(s.number for s in top_scores[:count])

    # 선택된 번호의 순위 정보 반환
    score_map = {s.number: s for s in scores}
    all_rankings = rank_numbers(scores)
    rank_map = {r.number: r for r in all_rankings}
    selected_rankings = [rank_map[n] for n in selected_nums if n in rank_map]

    return selected_nums, selected_rankings


# ─────────────────────────────────────────────────────────────────────────────
# 9. 출력 및 메인 실행
# ─────────────────────────────────────────────────────────────────────────────

def print_indicator_report(scores: list[TechnicalScore], top_n: int = 15) -> None:
    """상위 N개 번호의 기술 지표 상세 리포트를 출력합니다."""

    rankings = rank_numbers(scores, top_n=top_n)

    header = (
        f"{'순위':>4} {'번호':>4} {'복합가중':>8} "
        f"{'MA신호':>8} {'RSI':>7} {'BB(%B)':>8} "
        f"{'Aroon':>7} {'Z-Score':>8}"
    )
    separator = "─" * len(header)

    print("\n" + "═" * len(header))
    print("  기술 지표 통합 번호 순위 리포트 (복합 가중치 기준)")
    print("═" * len(header))
    print(header)
    print(separator)

    for r in rankings:
        print(
            f"{r.rank:>4} "
            f"{r.number:>4} "
            f"{r.composite_boost:>8.4f} "
            f"{r.ma_signal:>+8.4f} "
            f"{r.rsi:>7.2f} "
            f"{r.bollinger_pct_b:>8.4f} "
            f"{r.aroon_oscillator:>+7.2f} "
            f"{r.z_score:>+8.4f}"
        )

    print(separator)
    print("\n  [지표 판독 기준]")
    print("  복합가중 > 1.0 → 여러 지표가 긍정 신호   | 복합가중 < 1.0 → 억제 신호")
    print("  RSI > 70 → 과다출현(과매수)              | RSI < 30 → 과소출현(과매도)")
    print("  BB(%B) > 1.0 → 상단 밴드 초과           | BB(%B) < 0 → 하단 밴드 미달")
    print("  Aroon > +50 → 최근 활성                  | Aroon < -50 → 장기 공백 패턴")
    print("  Z > +1.5 → 누적 과다출현                 | Z < -1.5 → 누적 과소출현")
    print()


def print_recommendation(
    selected_nums: list[int],
    selected_rankings: list[NumberRanking],
) -> None:
    """번호 추천 결과를 출력합니다."""
    print("═" * 60)
    print("  🎯 기술 지표 기반 번호 추천 (확률적 가중 샘플링)")
    print("═" * 60)
    print(f"\n  추천 번호: {' ─ '.join(f'{n:02d}' for n in selected_nums)}\n")

    for r in selected_rankings:
        print(f"  [{r.number:02d}] 전체순위 {r.rank:>2}위 | 복합가중 {r.composite_boost:.4f}")
        print(f"       {r.signal_summary}")

    print()
    print("  ⚠️  주의: 복권은 독립 사건입니다. 본 분석은 통계적 참고 정보이며")
    print("            당첨을 보장하지 않습니다. 책임감 있는 구매를 권장합니다.")
    print("═" * 60)


def print_z_score_analysis(scores: list[TechnicalScore]) -> None:
    """Z-Score 심층 분석 리포트를 출력합니다."""
    print("\n" + "═" * 60)
    print("  📊 Z-Score 심층 분석 (vs 기술 지표 비교)")
    print("═" * 60)

    over  = [(s.number, s.z_score) for s in scores if s.z_score >  1.5]
    under = [(s.number, s.z_score) for s in scores if s.z_score < -1.5]
    normal= [(s.number, s.z_score) for s in scores if -1.5 <= s.z_score <= 1.5]

    print(f"\n  과다출현 (Z > +1.5): {len(over)}개")
    for num, z in sorted(over, key=lambda x: -x[1]):
        s = next(sc for sc in scores if sc.number == num)
        print(f"    번호 {num:02d}  Z={z:+.3f}  RSI={s.rsi:.1f}  MA={s.ma_signal:+.4f}  Aroon={s.aroon_oscillator:+.1f}")

    print(f"\n  과소출현 (Z < -1.5): {len(under)}개")
    for num, z in sorted(under, key=lambda x: x[1]):
        s = next(sc for sc in scores if sc.number == num)
        print(f"    번호 {num:02d}  Z={z:+.3f}  RSI={s.rsi:.1f}  MA={s.ma_signal:+.4f}  Aroon={s.aroon_oscillator:+.1f}")

    print(f"\n  정상 범위 (-1.5 ≤ Z ≤ +1.5): {len(normal)}개")

    print("\n  [Z-Score ↔ 기술 지표 상관 관계 요약]")
    print("  ─ Z-Score vs Bollinger %B : 동일 구조, 시간 범위만 다름 (전체 vs 롤링)")
    print("  ─ Z-Score vs RSI          : Z는 누적 편차, RSI는 최근 모멘텀 → 상호 보완")
    print("  ─ Z-Score vs MA           : Z는 정적, MA는 동적 → 함께 사용 시 장단기 포착")
    print("  ─ Z-Score vs Aroon        : Z는 빈도 차원, Aroon은 시간 차원 → 독립 정보")
    print()


# ─────────────────────────────────────────────────────────────────────────────
# 메인 실행
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  한국 로또 6/45 기술 지표 분석 시스템")
    print("  (MA · RSI · 볼린저밴드 · Aroon · Z-Score 통합)")
    print("=" * 60)

    # ── 데이터 로드 (실제 환경에서는 API/CSV로 대체) ──────────────
    print("\n  [1/4] 회차 데이터 생성 중...")
    draws = make_sample_draws(n_rounds=300, seed=2025)
    print(f"        총 {len(draws)}회차 데이터 로드 완료.")

    # ── 전체 기술 지표 계산 ────────────────────────────────────────
    print("  [2/4] 기술 지표 계산 중 (5종 × 45번호)...")
    scores = compute_all_technical_scores(
        draws,
        ma_short_w   = 10,    # MA 단기 윈도우
        ma_long_w    = 30,    # MA 장기 윈도우
        rsi_window   = 20,    # RSI 계산 윈도우
        bb_window    = 30,    # 볼린저밴드 윈도우
        aroon_window = 25,    # 아룬 윈도우
        include_bonus = True, # 보너스 번호 포함 여부
    )
    print("        완료.")

    # ── 순위 리포트 출력 ───────────────────────────────────────────
    print("  [3/4] 순위 리포트 생성 중...")
    print_indicator_report(scores, top_n=15)

    # ── Z-Score 심층 분석 ──────────────────────────────────────────
    print_z_score_analysis(scores)

    # ── 번호 추천 ──────────────────────────────────────────────────
    print("  [4/4] 번호 추천 중...")
    selected, sel_rankings = recommend_numbers(
        scores,
        count                = 6,
        use_weighted_sampling = True,  # 확률적 가중 샘플링 (권장)
        seed                 = None,   # None = 매번 다른 결과
    )
    print_recommendation(selected, sel_rankings)
