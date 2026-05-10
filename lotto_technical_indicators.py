# -*- coding: utf-8 -*-
"""
lotto_technical_indicators.py
════════════════════════════════════════════════════════════════════════════════
한국 로또 6/45 — 기술적 지표 기반 통계 패턴 분석 시스템
[최근 1년치(≈52회차) 최적화 파라미터 적용판]

[분석 철학]
  복권 추첨은 이론적으로 완전한 독립 사건입니다. 그러나 과거 데이터에서
  관찰되는 번호별 출현 빈도 편차는 단기적으로 통계적 불균형을 만듭니다.
  본 시스템은 이 불균형을 "평균 회귀(Mean Reversion)" 가설 아래 분석합니다.

  평균 회귀 가설:
    장기적으로 각 번호의 출현율은 이론값(6/45 ≈ 13.3%)에 수렴한다.
    따라서 현재 출현율이 이론값보다 낮은 번호는 향후 출현 가능성이
    상대적으로 높을 수 있다.

  ⚠️ 중요: 이 분석은 통계적 패턴 해석이며, 실제 당첨 확률과는 무관합니다.
           복권은 매 회차 독립 추첨이므로 과거 패턴이 미래를 보장하지 않습니다.

[지표 채택 이유 및 가중치]  ── 1년치(52회차) 최적화 기준
  ┌──────────────────┬────────┬───────────────────────────────────────────┐
  │ 지표              │ 가중치  │ 채택 이유                                   │
  ├──────────────────┼────────┼───────────────────────────────────────────┤
  │ Z-Score          │  32%   │ 52회차 전체 사용 → 1년 기준 가장 안정적 편차  │
  │ 볼린저밴드 %B     │  25%   │ 45회차 롤링 횡단면, Z의 단기 보완판           │
  │ RSI              │  20%   │ 26회차(반년) 모멘텀, 직관적 과매수/과매도      │
  │ MA 크로스오버     │  13%   │ 5vs47 극단 대비로 단기변동성 높아 소폭 하향    │
  │ Aroon 오실레이터  │  10%   │ 47회차 갭 재귀성, 보조 참고용               │
  └──────────────────┴────────┴───────────────────────────────────────────┘

  종합점수 = 0.32×Z점수 + 0.25×BB점수 + 0.20×RSI점수 + 0.13×MA점수 + 0.10×Aroon점수

[1년치 파라미터 최적화 근거]
  MA  short=5  / long=47 : 대비 9.4배(기존 3배) → "최근 5회 추세 vs 47회 기준선" 강화
  RSI window=26           : 52회차의 절반(반년) → 자연스러운 모멘텀 기준점
  BB  window=45           : 52회차의 86% → 1년 전체 횡단면 분포에 근접
  Aroon window=47         : 52회차의 90% → 연간 최장공백 패턴 포착
  score_ma 범위 ±0.40     : 5/47 윈도우 시 신호 최대 ±0.35 발생 → 클리핑 방지
  score_z  범위 ±2.5      : 52회차 Z값 실질 분포 범위 수용 → 구분력 향상
════════════════════════════════════════════════════════════════════════════════
"""

from __future__ import annotations

import math
import random
import statistics
import sys
from dataclasses import dataclass
from typing import Optional

# Windows 콘솔 한글/유니코드 출력 호환
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


# ════════════════════════════════════════════════════════════════════════════════
# §0. 데이터 구조 정의
# ════════════════════════════════════════════════════════════════════════════════

@dataclass
class DrawResult:
    """단일 회차 당첨 번호."""
    round: int
    numbers: list[int]  # 본 번호 6개
    bonus:   int        # 보너스 번호


@dataclass
class IndicatorValues:
    """번호 하나에 대한 5개 지표의 원시값."""
    number: int

    # ── 원시 지표 값 ────────────────────────────────────────────────
    ma_signal:         float   # 단기MA − 장기MA: 양수 = 최근 빈도 증가 추세
    rsi:               float   # 0~100: <30 과소출현, >70 과다출현
    bollinger_pct_b:   float   # %B: <0 하단밴드 하회, 0.5 중앙, >1 상단밴드 초과
    aroon_oscillator:  float   # −100~+100: 양수 = 최근 출현, 음수 = 장기 공백
    z_score:           float   # 표준 Z-Score: 음수 = 누적 과소출현


@dataclass
class ScoredNumber:
    """번호 하나의 5개 지표 점수 및 종합점수 (모두 0~100 정규화)."""
    number: int

    # ── 원시값 (해석용) ──────────────────────────────────────────────
    raw: IndicatorValues

    # ── 정규화 점수 (0~100, 높을수록 평균 회귀 가능성 높음) ─────────────
    score_ma:      float  # MA 크로스오버 점수
    score_rsi:     float  # RSI 점수
    score_bb:      float  # 볼린저밴드 %B 점수
    score_aroon:   float  # Aroon 오실레이터 점수
    score_z:       float  # Z-Score 점수

    # ── 종합점수 (가중 평균) ─────────────────────────────────────────
    composite: float      # 0~100: 높을수록 상대적 출현 가능성 높음


# ════════════════════════════════════════════════════════════════════════════════
# §1. 샘플 데이터 생성기 (실제 환경에서는 API/CSV 로더로 대체)
# ════════════════════════════════════════════════════════════════════════════════

def make_sample_draws(n_rounds: int = 300, seed: int = 42) -> list[DrawResult]:
    """
    실제 데이터 없을 때 사용하는 무작위 샘플 회차 생성기.

    실제 사용 방법:
        draws = load_from_csv("lotto_history.csv")  # 또는 API 호출
    """
    rng = random.Random(seed)
    draws: list[DrawResult] = []
    for rnd in range(1, n_rounds + 1):
        pool = list(range(1, 46))
        rng.shuffle(pool)
        picks = sorted(pool[:7])
        draws.append(DrawResult(round=rnd, numbers=picks[:6], bonus=picks[6]))
    draws.reverse()  # 최신 회차가 인덱스 0에 위치 (관례)
    return draws


# ════════════════════════════════════════════════════════════════════════════════
# §2. 지표별 원시값 계산 함수
# ════════════════════════════════════════════════════════════════════════════════

def _appears(draw: DrawResult, num: int, include_bonus: bool) -> bool:
    """해당 회차에 번호가 출현했는지 확인."""
    return num in draw.numbers or (include_bonus and draw.bonus == num)


# ── §2-1. 이동평균 (Frequency MA) ────────────────────────────────────────────
def calc_ma(draws: list[DrawResult], num: int,
            short_w: int = 10, long_w: int = 30,
            include_bonus: bool = True) -> float:
    """
    빈도 이동평균 크로스오버 신호를 반환합니다.

    [원리] 각 회차를 이진 신호(출현=1, 미출현=0)로 변환 후
           단기(short_w) 평균과 장기(long_w) 평균의 차이를 계산합니다.

    반환값: 단기MA − 장기MA
      양수 → 최근 출현 빈도가 장기 평균보다 높음 (상승 추세)
      음수 → 최근 출현 빈도가 장기 평균보다 낮음 (하락 추세, 회귀 가능성)
    """
    sw = min(short_w, len(draws))
    lw = min(long_w,  len(draws))
    short_cnt = sum(1 for i in range(sw) if _appears(draws[i], num, include_bonus))
    long_cnt  = sum(1 for i in range(lw) if _appears(draws[i], num, include_bonus))
    return (short_cnt / sw) - (long_cnt / lw)


# ── §2-2. RSI (Appearance Momentum RSI) ──────────────────────────────────────
def calc_rsi(draws: list[DrawResult], num: int,
             window: int = 20, include_bonus: bool = True) -> float:
    """
    출현 모멘텀 RSI를 반환합니다 (0~100).

    [원리]
      appearances(출현 횟수) / absences(미출현 횟수) = RS
      RSI = 100 − 100 / (1 + RS)

      RSI > 70 → 과다출현 (과매수): 최근 너무 자주 나옴 → 억제 가능성
      RSI < 30 → 과소출현 (과매도): 최근 거의 안 나옴 → 회귀 가능성
    """
    w = min(window, len(draws))
    appeared = sum(1 for i in range(w) if _appears(draws[i], num, include_bonus))
    absent   = w - appeared
    if absent == 0:   return 100.0
    if appeared == 0: return 0.0
    rs = appeared / absent
    return 100.0 - (100.0 / (1.0 + rs))


# ── §2-3. 볼린저밴드 (Cross-Sectional Frequency Bands) ───────────────────────
def calc_bollinger_all(draws: list[DrawResult], window: int = 30,
                       include_bonus: bool = True) -> dict[int, float]:
    """
    전체 45개 번호에 대한 볼린저 %B를 한 번에 계산합니다.

    [원리] 개별 번호의 시계열 밴드가 아닌, 같은 윈도우 내
           45개 번호 전체의 빈도 분포를 횡단면으로 분석합니다.

      롤링빈도(n, W) = 최근 W회차 동안 번호 n의 출현 횟수
      μ = 45개 번호의 롤링빈도 평균
      σ = 45개 번호의 롤링빈도 표준편차
      상단밴드(UB) = μ + 2σ,  하단밴드(LB) = μ − 2σ
      %B(n) = (롤링빈도(n) − LB) / (UB − LB)

      %B < 0 → 하단밴드 하회 (횡단면 과소출현)
      %B > 1 → 상단밴드 초과 (횡단면 과다출현)
    """
    w = min(window, len(draws))
    freq: dict[int, int] = {n: 0 for n in range(1, 46)}
    for i in range(w):
        for n in draws[i].numbers:
            freq[n] += 1
        if include_bonus:
            freq[draws[i].bonus] += 1

    vals  = list(freq.values())
    mu    = statistics.mean(vals)
    sigma = statistics.pstdev(vals) or 1.0
    ub = mu + 2 * sigma
    lb = mu - 2 * sigma
    bw = ub - lb or 1.0
    return {n: (freq[n] - lb) / bw for n in range(1, 46)}


# ── §2-4. Aroon (Gap Recency Aroon) ──────────────────────────────────────────
def calc_aroon(draws: list[DrawResult], num: int,
               window: int = 30, include_bonus: bool = True) -> float:
    """
    갭 재귀 아룬 오실레이터를 반환합니다 (−100 ~ +100).

    [원리]
      AroonUp   = ((W − 마지막출현까지경과회차) / W) × 100
      AroonDown = ((W − 윈도우내최장공백) / W) × 100
      Oscillator = AroonUp − AroonDown

      +100 → 아주 최근에 출현하고 공백도 짧음 (활성)
      −100 → 오래 미출현하고 최장 공백도 김 (냉각, 회귀 가능성)
    """
    w = min(window, len(draws))
    since_last = w
    longest = cur_gap = 0
    for i in range(w):
        if _appears(draws[i], num, include_bonus):
            if since_last == w:
                since_last = i
            if cur_gap > longest:
                longest = cur_gap
            cur_gap = 0
        else:
            cur_gap += 1
    if cur_gap > longest:
        longest = cur_gap
    aroon_up   = ((w - since_last) / w) * 100
    aroon_down = ((w - longest)    / w) * 100
    return aroon_up - aroon_down


# ── §2-5. Z-Score ─────────────────────────────────────────────────────────────
def calc_zscore_all(draws: list[DrawResult],
                    include_bonus: bool = True) -> dict[int, float]:
    """
    전체 데이터 기준 Z-Score를 한 번에 계산합니다.

    [원리]
      freq(n) = 전체 회차 동안의 번호 n 누적 출현 횟수
      μ = 45개 번호의 평균 출현 횟수
      σ = 45개 번호의 표준편차
      Z(n) = (freq(n) − μ) / σ

      Z > +1.5 → 평균보다 유의미하게 많이 출현 (과다출현)
      Z < −1.5 → 평균보다 유의미하게 적게 출현 (과소출현, 회귀 가능성)
    """
    freq: dict[int, int] = {n: 0 for n in range(1, 46)}
    for d in draws:
        for n in d.numbers:
            freq[n] += 1
        if include_bonus:
            freq[d.bonus] += 1
    vals  = list(freq.values())
    mu    = statistics.mean(vals)
    sigma = statistics.pstdev(vals) or 1.0
    return {n: (freq[n] - mu) / sigma for n in range(1, 46)}


# ════════════════════════════════════════════════════════════════════════════════
# §3. 지표값 → 0~100 점수 변환 함수
#
# [변환 원칙] 평균 회귀 관점에서 "과소출현 번호에 높은 점수"를 부여합니다.
#   모든 점수는 0~100으로 정규화됩니다.
#   점수 50 = 완전 중립 (이론적 기대값에 정확히 위치)
#   점수 > 50 = 상대적으로 저출현 (평균 회귀 기대 높음)
#   점수 < 50 = 상대적으로 과출현 (평균 회귀 기대 낮음)
# ════════════════════════════════════════════════════════════════════════════════

def score_ma(signal: float) -> float:
    """
    MA 크로스오버 신호 → 점수 (0~100).

    신호 범위 ≈ [−0.40, +0.40]
      short=5 / long=47 윈도우 시 신호 최대 ±0.35 발생 → ±0.40으로 클리핑 방지
    음수 신호(최근 빈도 감소) → 높은 점수 (회귀 가능성)
    양수 신호(최근 빈도 증가) → 낮은 점수 (과열 가능성)

    score = (−signal + 0.40) / 0.80 × 100
    """
    raw = (-signal + 0.40) / 0.80 * 100
    return max(0.0, min(100.0, raw))


def score_rsi(rsi: float) -> float:
    """
    RSI → 점수 (0~100).

    RSI=0   → score=100 (극단적 과소출현, 회귀 기대 최대)
    RSI=50  → score=50  (중립)
    RSI=100 → score=0   (극단적 과다출현, 회귀 기대 없음)

    score = 100 − RSI
    """
    return max(0.0, min(100.0, 100.0 - rsi))


def score_bb(pct_b: float) -> float:
    """
    볼린저 %B → 점수 (0~100).

    %B=−0.5 → score=150 → 클리핑 → 100 (하단밴드 대폭 하회)
    %B=0.0  → score=100 (하단밴드)
    %B=0.5  → score=50  (중앙선)
    %B=1.0  → score=0   (상단밴드)
    %B=1.5  → score=−50 → 클리핑 → 0

    score = (1 − %B) × 100
    """
    return max(0.0, min(100.0, (1.0 - pct_b) * 100.0))


def score_aroon(oscillator: float) -> float:
    """
    Aroon 오실레이터 → 점수 (0~100).

    오실레이터=−100 → score=100 (장기 미출현, 회귀 가능성)
    오실레이터=0    → score=50  (중립)
    오실레이터=+100 → score=0   (방금 출현, 단기 과열)

    score = (−oscillator + 100) / 2
    """
    return max(0.0, min(100.0, (-oscillator + 100.0) / 2.0))


def score_z(z: float) -> float:
    """
    Z-Score → 점수 (0~100).

    Z=−2.5 → score=100 (극단적 과소출현)
    Z= 0.0 → score=50  (평균)
    Z=+2.5 → score=0   (극단적 과다출현)

    선형 변환: score = (−Z + 2.5) / 5.0 × 100
    52회차(1년) 기준: Z 실질 분포 ±2.5 이내 → 정규화 해상도 향상
    (0회 출현 번호 Z ≈ −3.1 → 클리핑 100, 극히 드묾)
    """
    return max(0.0, min(100.0, (-z + 2.5) / 5.0 * 100.0))


# ════════════════════════════════════════════════════════════════════════════════
# §4. 통합 스코어링 엔진
# ════════════════════════════════════════════════════════════════════════════════

# 지표별 가중치 (합 = 1.0) — 1년치(52회차) 최적화 기준
WEIGHTS = {
    "z":     0.32,   # Z-Score          : 52회차 전체 사용 → 1년 기준 최안정 지표, 소폭 상향
    "bb":    0.25,   # 볼린저밴드 %B     : 45회차 롤링 횡단면, Z 단기 보완 역할 유지
    "rsi":   0.20,   # RSI               : 26회차(반년) 모멘텀, 직관적 유지
    "ma":    0.13,   # MA 크로스오버     : short=5 고변동성으로 소폭 하향 (기존 0.15)
    "aroon": 0.10,   # Aroon 오실레이터  : 47회차 갭 재귀성, 보조 참고 유지
}

def compute_scores(draws: list[DrawResult],
                   ma_short_w:    int  = 5,
                   ma_long_w:     int  = 47,
                   rsi_window:    int  = 26,
                   bb_window:     int  = 45,
                   aroon_window:  int  = 47,
                   include_bonus: bool = True) -> list[ScoredNumber]:
    """
    전체 45개 번호에 대한 통합 점수를 계산합니다.

    [계산 순서]
    Step 1. 볼린저밴드 %B와 Z-Score를 전체 번호 기준으로 일괄 계산 (효율성)
    Step 2. 번호별로 MA, RSI, Aroon을 순차 계산
    Step 3. 각 지표값을 0~100 점수로 정규화
    Step 4. 가중 평균으로 종합점수 계산

    종합점수 = Σ(지표점수 × 가중치)
    """
    # Step 1: 횡단면 일괄 계산
    bb_map = calc_bollinger_all(draws, window=bb_window, include_bonus=include_bonus)
    z_map  = calc_zscore_all(draws, include_bonus=include_bonus)

    results: list[ScoredNumber] = []

    for num in range(1, 46):
        # Step 2: 번호별 개별 계산
        ma_val    = calc_ma(draws, num, ma_short_w, ma_long_w, include_bonus)
        rsi_val   = calc_rsi(draws, num, rsi_window, include_bonus)
        bb_val    = bb_map[num]
        aroon_val = calc_aroon(draws, num, aroon_window, include_bonus)
        z_val     = z_map[num]

        raw = IndicatorValues(
            number=num,
            ma_signal=round(ma_val, 4),
            rsi=round(rsi_val, 2),
            bollinger_pct_b=round(bb_val, 4),
            aroon_oscillator=round(aroon_val, 2),
            z_score=round(z_val, 4),
        )

        # Step 3: 정규화 점수
        s_ma    = score_ma(ma_val)
        s_rsi   = score_rsi(rsi_val)
        s_bb    = score_bb(bb_val)
        s_aroon = score_aroon(aroon_val)
        s_z     = score_z(z_val)

        # Step 4: 가중 평균 종합점수
        composite = (
            WEIGHTS["z"]     * s_z    +
            WEIGHTS["bb"]    * s_bb   +
            WEIGHTS["rsi"]   * s_rsi  +
            WEIGHTS["ma"]    * s_ma   +
            WEIGHTS["aroon"] * s_aroon
        )

        results.append(ScoredNumber(
            number=num, raw=raw,
            score_ma=round(s_ma, 2),
            score_rsi=round(s_rsi, 2),
            score_bb=round(s_bb, 2),
            score_aroon=round(s_aroon, 2),
            score_z=round(s_z, 2),
            composite=round(composite, 2),
        ))

    return results


# ════════════════════════════════════════════════════════════════════════════════
# §5. 출력 포맷터
# ════════════════════════════════════════════════════════════════════════════════

W = 96  # 출력 전체 너비

def _bar(score: float, width: int = 10) -> str:
    """점수(0~100)를 미니 막대그래프로 표현."""
    filled = round(score / 100 * width)
    return "█" * filled + "░" * (width - filled)


def _level(score: float) -> str:
    """종합점수 구간 레이블."""
    if score >= 75: return "◉ 강한 회귀 신호"
    if score >= 60: return "● 중간 회귀 신호"
    if score >= 50: return "○ 약한 회귀 신호"
    if score >= 40: return "▽ 약한 억제 신호"
    return               "▼ 강한 억제 신호"


def print_step_by_step_logic() -> None:
    """단계별 분석 로직 설명."""
    print("\n" + "=" * W)
    print("  [단계별 분석 로직 설명]".center(W))
    print("=" * W)

    steps = [
        ("STEP 1", "데이터 준비",
         "과거 회차 당첨 번호를 로드합니다. 각 번호(1~45)를 독립적인 시계열로 취급합니다.\n"
         "         각 회차는 해당 번호의 출현(1) 또는 미출현(0)으로 이진 변환됩니다."),

        ("STEP 2", "지표 원시값 계산 (5종) — 1년치(52회차) 최적화 파라미터",
         "① MA   : 단기(5회) vs 장기(47회) 이진 평균 비교 → 빈도 추세 방향\n"
         "         ② RSI  : 최근 26회(반년) 출현/미출현 비율 → 0~100 모멘텀 지수\n"
         "         ③ BB   : 전체 45번호 롤링빈도(45회)의 횡단면 분포 → %B 위치\n"
         "         ④ Aroon: 47회 기간 내 마지막 출현 경과 + 최장공백 → 오실레이터\n"
         "         ⑤ Z    : 52회차 전체 누적 빈도의 횡단면 표준편차 위치"),

        ("STEP 3", "0~100 점수 정규화 (평균 회귀 방향) — 1년치 최적화",
         "모든 지표를 동일 척도로 변환합니다. 과소출현 = 높은 점수 원칙:\n"
         "         MA점수  = (−신호 + 0.40) / 0.80 × 100  → 5/47 윈도우 신호범위 ±0.40 수용\n"
         "         RSI점수 = 100 − RSI                    → 과매도일수록 고점수\n"
         "         BB점수  = (1 − %B) × 100               → 하단밴드일수록 고점수\n"
         "         Aroon점수 = (−오실레이터 + 100) / 2     → 장기 미출현일수록 고점수\n"
         "         Z점수   = (−Z + 2.5) / 5.0 × 100       → 52회차 실질범위 ±2.5 최적화"),

        ("STEP 4", "가중 평균 종합점수 산출",
         "종합점수 = 0.32×Z점수 + 0.25×BB점수 + 0.20×RSI점수\n"
         "                      + 0.13×MA점수 + 0.10×Aroon점수\n"
         "         가중치 배분 근거: Z-Score(52회차 전체, 최안정) > BB(45회차 횡단면)\n"
         "         > RSI(26회차 반년 모멘텀) > MA(5회차 단기 고변동 하향) > Aroon(갭 보조)"),

        ("STEP 5", "순위화 및 추천",
         "45개 번호를 종합점수 기준으로 내림차순 정렬합니다.\n"
         "         상위 6개 번호를 추천하되, 이는 확률 예측이 아닌 통계 패턴 해석입니다."),
    ]

    for code, title, desc in steps:
        print(f"\n  [{code}] {title}")
        print(f"         {desc}")
    print()


def print_full_table(scored: list[ScoredNumber]) -> None:
    """
    전체 45개 번호 분석 테이블 출력.

    컬럼: 번호 / MA / RSI / BB(%B) / Aroon / Z-Score /
           MA점수 / RSI점수 / BB점수 / Aroon점수 / Z점수 / 종합점수 / 신호
    """
    sorted_all = sorted(scored, key=lambda s: s.composite, reverse=True)

    print("\n" + "=" * W)
    print("  [전체 번호 분석 테이블] (종합점수 기준 내림차순)".center(W))
    print("=" * W)

    # 헤더 (원시값 파트)
    hdr1 = (f"{'순위':>4} {'번호':>4}  "
            f"{'── 원시 지표값 ──────────────────────────────':^46}  "
            f"{'── 정규화 점수(0~100) ───────────────────────────────────':^58}  "
            f"{'종합':>6}")
    print(hdr1)

    hdr2 = (f"{'':>4} {'':>4}  "
            f"{'MA신호':>8} {'RSI':>7} {'BB(%B)':>8} {'Aroon':>7} {'Z-Score':>8}  "
            f"{'MA점수':>7} {'RSI점수':>7} {'BB점수':>7} {'Aroon점수':>9} {'Z점수':>7}  "
            f"{'점수':>6}  {'신호':}")
    print(hdr2)
    print("-" * W)

    for rank, s in enumerate(sorted_all, 1):
        r = s.raw
        marker = "▶" if rank <= 6 else " "
        print(
            f"{marker}{rank:>3} {s.number:>4}번  "
            f"{r.ma_signal:>+8.4f} {r.rsi:>7.2f} {r.bollinger_pct_b:>8.4f} "
            f"{r.aroon_oscillator:>+7.2f} {r.z_score:>+8.4f}  "
            f"{s.score_ma:>7.2f} {s.score_rsi:>7.2f} {s.score_bb:>7.2f} "
            f"{s.score_aroon:>9.2f} {s.score_z:>7.2f}  "
            f"{s.composite:>6.2f}  {_level(s.composite)}"
        )
        if rank == 6:
            print("  " + "· " * 47)  # 추천 번호와 나머지 구분선

    print("-" * W)
    print("  ▶ = 상위 6개 추천 번호")
    print()


def print_indicator_legend() -> None:
    """지표 판독 기준 범례."""
    print("─" * W)
    print("  [지표 판독 기준]".center(W))
    print("─" * W)
    rows = [
        ("MA 신호",    "> 0", "최근 출현 빈도 증가 (상승 추세)",  "< 0", "최근 출현 빈도 감소 ★ 회귀 기대"),
        ("RSI",        "> 70","과다출현 (과매수 구간)",           "< 30","과소출현 (과매도) ★ 회귀 기대"),
        ("BB (%B)",    "> 1", "상단밴드 초과 (횡단면 과열)",      "< 0", "하단밴드 미달 ★ 회귀 기대"),
        ("Aroon",      "> +50","최근 활성 출현",                 "< −50","장기 공백 ★ 회귀 기대"),
        ("Z-Score",    "> +1.5","누적 과다출현",                 "< −1.5","누적 과소출현 ★ 회귀 기대"),
        ("종합점수",   "≥ 75", "강한 복수 회귀 신호",            "< 40", "강한 복수 억제 신호"),
    ]
    print(f"  {'지표':^10}  {'과열 기준':^16} {'의미':^28}  {'냉각 기준':^16} {'의미':^28}")
    print("  " + "-" * (W - 2))
    for ind, h_crit, h_mean, c_crit, c_mean in rows:
        print(f"  {ind:<10}  {h_crit:^16} {h_mean:<28}  {c_crit:^16} {c_mean:<28}")
    print()


def _interpret_indicator(label: str, raw_val: float,
                          score: float, detail: str) -> str:
    """개별 지표 해석 한 줄 문자열."""
    direction = "▲" if score >= 60 else ("▼" if score <= 40 else "─")
    return f"    {direction} {label:<16}: {detail} (점수 {score:.1f}/100)"


def print_top6_interpretation(scored: list[ScoredNumber],
                               draws: list[DrawResult]) -> None:
    """상위 6개 추천 번호에 대한 상세 해석."""
    top6 = sorted(scored, key=lambda s: s.composite, reverse=True)[:6]
    recommended = [s.number for s in top6]

    print("=" * W)
    print("  [🎯 상위 추천 번호 6개 — 상세 해석]".center(W))
    print("=" * W)
    print()
    print(f"  추천 번호: {' — '.join(f'{n:02d}' for n in recommended)}")
    print()

    # 전체 총 회차 수 (참고용)
    total = len(draws)

    for rank, s in enumerate(top6, 1):
        r  = s.raw
        n  = s.number

        # 전체 누적 출현 횟수 계산 (해석용)
        total_count = sum(1 for d in draws if n in d.numbers or d.bonus == n)
        expected    = round(total * (6 / 45), 1)   # 이론적 기대 출현 횟수 (보너스 제외 기준 보정 없이 단순 참조)

        print("─" * W)
        print(f"  [{rank}위] 번호 {n:02d}번  ·  종합점수 {s.composite:.2f} / 100  ({_level(s.composite)})")
        print(f"       누적 출현 횟수: {total_count}회  /  이론 기댓값: ≈{expected:.0f}회  "
              f"({'부족' if total_count < expected else '초과' if total_count > expected else '일치'})")
        print()

        # 지표별 상세 해석
        # ① MA
        if r.ma_signal < -0.02:
            ma_detail = f"단기 빈도({r.ma_signal:+.4f}) < 장기 빈도 → 최근 출현 둔화"
        elif r.ma_signal > 0.02:
            ma_detail = f"단기 빈도({r.ma_signal:+.4f}) > 장기 빈도 → 최근 출현 가속"
        else:
            ma_detail = f"단기/장기 빈도 유사({r.ma_signal:+.4f}) → 중립"
        print(_interpret_indicator("MA 크로스오버", r.ma_signal, s.score_ma, ma_detail))

        # ② RSI
        if r.rsi < 30:
            rsi_detail = f"RSI {r.rsi:.1f} → 과소출현 구간 (과매도) — 평균 회귀 기대↑"
        elif r.rsi > 70:
            rsi_detail = f"RSI {r.rsi:.1f} → 과다출현 구간 (과매수) — 평균 회귀 기대↓"
        else:
            rsi_detail = f"RSI {r.rsi:.1f} → 중립 구간 (30~70)"
        print(_interpret_indicator("RSI", r.rsi, s.score_rsi, rsi_detail))

        # ③ Bollinger
        if r.bollinger_pct_b < 0:
            bb_detail = f"%B {r.bollinger_pct_b:.4f} → 하단밴드 하회 (최근 과소출현 극단)"
        elif r.bollinger_pct_b > 1:
            bb_detail = f"%B {r.bollinger_pct_b:.4f} → 상단밴드 초과 (최근 과다출현 극단)"
        elif r.bollinger_pct_b < 0.5:
            bb_detail = f"%B {r.bollinger_pct_b:.4f} → 중앙선 하방 (하단밴드 방향)"
        else:
            bb_detail = f"%B {r.bollinger_pct_b:.4f} → 중앙선 상방 (상단밴드 방향)"
        print(_interpret_indicator("볼린저밴드 %B", r.bollinger_pct_b, s.score_bb, bb_detail))

        # ④ Aroon
        if r.aroon_oscillator < -50:
            aroon_detail = f"오실레이터 {r.aroon_oscillator:+.1f} → 장기 공백 패턴 (냉각, 회귀 기대)"
        elif r.aroon_oscillator > 50:
            aroon_detail = f"오실레이터 {r.aroon_oscillator:+.1f} → 최근 활성 출현 (모멘텀)"
        else:
            aroon_detail = f"오실레이터 {r.aroon_oscillator:+.1f} → 혼재 신호 (중립)"
        print(_interpret_indicator("Aroon 오실레이터", r.aroon_oscillator, s.score_aroon, aroon_detail))

        # ⑤ Z-Score
        if r.z_score < -1.5:
            z_detail = f"Z = {r.z_score:+.4f} → 통계적 유의 과소출현 (1.5σ 하회)"
        elif r.z_score > 1.5:
            z_detail = f"Z = {r.z_score:+.4f} → 통계적 유의 과다출현 (1.5σ 초과)"
        else:
            z_detail = f"Z = {r.z_score:+.4f} → 정상 범위 이내 (±1.5σ)"
        print(_interpret_indicator("Z-Score", r.z_score, s.score_z, z_detail))

        # 종합 해석
        print()
        high_scores = sorted(
            [("Z", s.score_z), ("BB", s.score_bb), ("RSI", s.score_rsi),
             ("MA", s.score_ma), ("Aroon", s.score_aroon)],
            key=lambda x: x[1], reverse=True
        )
        top_signals = [f"{name}({sc:.0f}점)" for name, sc in high_scores[:3] if sc > 55]
        if top_signals:
            print(f"       → 핵심 신호: {', '.join(top_signals)} 지표가 동시에 과소출현 방향을 가리킵니다.")
        else:
            print(f"       → 특이 신호 없음: 복합적인 중립 신호 상태입니다.")
        print()

    print("─" * W)


def print_score_distribution(scored: list[ScoredNumber]) -> None:
    """전체 45번호의 종합점수 분포 요약."""
    scores = [s.composite for s in scored]
    mu  = statistics.mean(scores)
    sd  = statistics.stdev(scores)
    mn  = min(scores)
    mx  = max(scores)

    print("─" * W)
    print("  [종합점수 분포 요약]".center(W))
    print("─" * W)
    print(f"  평균: {mu:.2f}  |  표준편차: {sd:.2f}  |  최솟값: {mn:.2f}  |  최댓값: {mx:.2f}")

    bands = [
        ("75~100", "◉ 강한 회귀 신호"),
        ("60~75",  "● 중간 회귀 신호"),
        ("50~60",  "○ 약한 회귀 신호"),
        ("40~50",  "▽ 약한 억제 신호"),
        ("0~40",   "▼ 강한 억제 신호"),
    ]
    thresholds = [(75, 100), (60, 75), (50, 60), (40, 50), (0, 40)]
    print()
    for (lo, hi), (range_label, desc) in zip(thresholds, bands):
        nums = [s.number for s in scored if lo <= s.composite <= hi]
        bar  = "█" * len(nums) + "░" * (45 - len(nums))
        print(f"  {range_label:>8}점  {desc:<18}  {bar}  {len(nums):>2}개번호: {nums}")
    print()


def print_disclaimer() -> None:
    """필수 면책 고지."""
    print("=" * W)
    print("  ⚠️  [중요 공지 — 반드시 확인하십시오]".center(W))
    print("=" * W)
    print("""
  본 분석 결과는 "통계적 패턴 해석"이며, 실제 로또 당첨 확률과 무관합니다.

  [과학적 사실]
  · 로또 6/45의 매 회차 추첨은 완전한 독립 사건입니다.
  · 각 번호의 이론적 선택 확률은 정확히 6/45 = 13.333...%입니다.
  · 이 확률은 과거 당첨 이력과 상관없이 매 회차 동일하게 유지됩니다.
  · "도박사의 오류(Gambler's Fallacy)": 오래 안 나온 번호가 곧 나온다는
    믿음은 통계적으로 근거가 없습니다.

  [본 시스템의 한계]
  · 모든 지표는 과거 데이터 기반이며, 미래를 예측하는 도구가 아닙니다.
  · 평균 회귀는 장기(수천 회차)에 걸쳐 관찰되는 현상이며,
    단기 예측력은 없습니다.
  · 종합점수는 상대적 통계 경향성 지표이지 확률 수치가 아닙니다.

  [권장 사항]
  · 복권은 오락 목적으로만 구매하십시오.
  · 본 분석 결과를 투자 또는 배팅 근거로 사용하지 마십시오.
  · 책임감 있는 복권 구매를 권장합니다.
    """)
    print("=" * W)


# ════════════════════════════════════════════════════════════════════════════════
# §6. 메인 실행 엔트리포인트
# ════════════════════════════════════════════════════════════════════════════════

def main(
    n_rounds:      int  = 52,     # 분석할 회차 수 (1년치 ≈ 52회차)
    ma_short_w:    int  = 5,      # MA 단기 윈도우 (최근 5회, ≈1.25개월)
    ma_long_w:     int  = 47,     # MA 장기 윈도우 (47회, ≈52의 90% 기준선)
    rsi_window:    int  = 26,     # RSI 계산 윈도우 (반년치 모멘텀)
    bb_window:     int  = 45,     # 볼린저밴드 롤링 윈도우 (45회, ≈86%)
    aroon_window:  int  = 47,     # Aroon 계산 윈도우 (47회, 연간 갭 패턴)
    include_bonus: bool = True,   # 보너스 번호 포함 여부
    seed:          int  = 42,     # 샘플 데이터 재현 시드
) -> None:

    print("\n" + "=" * W)
    print("  한국 로또 6/45 — 기술 지표 기반 통계 패턴 분석 시스템".center(W))
    print("  MA  ·  RSI  ·  볼린저밴드  ·  Aroon  ·  Z-Score  통합 분석".center(W))
    print("=" * W)
    print(f"\n  분석 파라미터: {n_rounds}회차  |  MA {ma_short_w}/{ma_long_w}  |  "
          f"RSI {rsi_window}  |  BB {bb_window}  |  Aroon {aroon_window}  |  "
          f"보너스 {'포함' if include_bonus else '제외'}")

    # ── 단계별 로직 설명 ──────────────────────────────────────────────────────
    print_step_by_step_logic()

    # ── 데이터 로드 ───────────────────────────────────────────────────────────
    print(f"  데이터 로딩 중... ", end="", flush=True)
    draws = make_sample_draws(n_rounds=n_rounds, seed=seed)
    print(f"{len(draws)}회차 완료.")

    # ── 통합 점수 계산 ────────────────────────────────────────────────────────
    print(f"  지표 계산 중 (5종 × 45번호)... ", end="", flush=True)
    scored = compute_scores(
        draws,
        ma_short_w=ma_short_w, ma_long_w=ma_long_w,
        rsi_window=rsi_window, bb_window=bb_window,
        aroon_window=aroon_window, include_bonus=include_bonus,
    )
    print("완료.\n")

    # ── 전체 번호 분석 테이블 ─────────────────────────────────────────────────
    print_full_table(scored)
    print_indicator_legend()
    print_score_distribution(scored)

    # ── 상위 6개 상세 해석 ───────────────────────────────────────────────────
    print_top6_interpretation(scored, draws)

    # ── 가중치 요약 ───────────────────────────────────────────────────────────
    print("─" * W)
    print("  [가중치 설정 근거]".center(W))
    print("─" * W)
    weight_info = [
        ("Z-Score",        f"{WEIGHTS['z']*100:.0f}%",
         "52회차 전체 사용 → 1년 기준 가장 안정적 편차 지표, 소폭 상향(30→32%)"),
        ("볼린저밴드 %B",  f"{WEIGHTS['bb']*100:.0f}%",
         "45회차 롤링 횡단면 → Z-Score 단기 보완, 연간 빈도분포 86% 포착"),
        ("RSI",            f"{WEIGHTS['rsi']*100:.0f}%",
         "26회차(반년) 모멘텀 → 과열/냉각 포착, 52회차의 자연 기준점"),
        ("MA 크로스오버",  f"{WEIGHTS['ma']*100:.0f}%",
         "5vs47 극단 대비로 신호 강도 향상 but 5회차 단기 고변동 → 소폭 하향(15→13%)"),
        ("Aroon",          f"{WEIGHTS['aroon']*100:.0f}%",
         "47회차 갭 재귀성 → 연간 최장공백 번호 포착, 도박사 오류 취약 최소 유지"),
    ]
    for name, wt, reason in weight_info:
        print(f"  {name:<16} {wt:>4}  —  {reason}")
    print()

    # ── 면책 고지 ─────────────────────────────────────────────────────────────
    print_disclaimer()


if __name__ == "__main__":
    main(
        n_rounds      = 52,    # 최근 1년치 (주 1회 기준 ≈ 52회차)
        ma_short_w    = 5,     # 단기: 최근 5회차 (≈1.25개월) — 대비 극대화
        ma_long_w     = 47,    # 장기: 47회차 (52의 90%) — 연간 기준선
        rsi_window    = 26,    # 반년치 모멘텀 (52의 절반)
        bb_window     = 45,    # 11개월 횡단면 (52의 86%)
        aroon_window  = 47,    # 연간 갭 패턴 (52의 90%)
        include_bonus = True,
        seed          = 42,
    )
