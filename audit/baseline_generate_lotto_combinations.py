# -*- coding: utf-8 -*-
"""
generate_lotto_combinations.py
════════════════════════════════════════════════════════════════════════════════
한국 로또 6/45 — 전체 조합 생성 및 필터링 스크립트
GitHub → fetchGithubCombinations() 가 참조하는 lotto_combinations.txt 관리

[동작 조건]
  ┌─────────────────────────────────────────┬────────────────────────────────┐
  │ 조건                                    │ 동작                           │
  ├─────────────────────────────────────────┼────────────────────────────────┤
  │ 파일 없음                               │ 8,145,060개 전체 생성·필터링    │
  │ 파일 있음 + 지난 회차에 생성됨          │ 구버전 판단 → 재생성            │
  │ 파일 있음 + 이번 회차 이후에 생성됨     │ 최신 파일 → 재사용 (단, 무결성  │
  │                                         │  검사 탈락 시 재생성)           │
  └─────────────────────────────────────────┴────────────────────────────────┘

[회차 기준점]
  한국 로또 추첨: 매주 토요일 오후 8시 39분 KST (UTC+9)
  "이번 회차" = 직전 토요일 20:39 KST 이후 ~ 다음 토요일 20:39 KST 이전

[필터 조건] — TypeScript passesPythonFilters() 와 동일 (임계값 변경 없음)
  1. 총합  : 85 ≤ Σ ≤ 189
  2. Ratio : (상위3 합) / (하위3 합) — 1.3 ≤ ratio ≤ 7.5
  3. 번대별: 각 십의 자리 구간(1~10, 11~20, …, 41~45) 당 ≤ 3개
  4. 연속번호: 2연속 쌍 ≤ 2개, 3연속 이상 없음
  5. AC    : 5 ≤ AC값 ≤ 10  (산술 복잡도)
  6. Sum46 : 합이 46이 되는 쌍 ≤ 2개 — 핫패스에서 제외 (아래 [최적화 근거] 참조)

[최적화 근거 — 전수 실측 (C(45,6)=8,145,060 전부 평가, 임계값 변경 없음)]
  · 최종 통과 6,657,176개 (81.73%) — 구 순서·신 순서 불일치 0개로 동등성 검증됨
  · Sum46 제거 1,540개 = C(22,3) 정확히 일치. 상보쌍 (a,46-a) 22개 중 3쌍을
    고른 조합이 곧 Sum46 탈락 집합 전체이며, 이 1,540개의 AC값은 전부 0~4
    (분포 {0:4, 1:10, 2:197, 3:122, 4:1207}) → Sum46 탈락 ⊆ AC 탈락.
    즉 Sum46은 AC가 이미 100% 포함하므로 핫패스에서 호출하지 않음.
    (함수 is_valid_sum46 자체는 인터페이스 호환을 위해 유지)
  · AC 상한(≤10)은 구조적으로 항상 참: 15개 쌍의 서로 다른 차이값은 최대
    15개 → AC = distinct-5 ≤ 10. 하한(≥5)만 실질 필터로 동작.
  · 필터 단가 실측 (20만 조합 환산→8.1M 추정): 총합 0.8s · 비율 0.7s ·
    번대별 3.7s · 연속 2.3s · AC 11.8s · Sum46 8.8s.
    → 값싼 고제거율 필터를 앞에, 비싼 AC를 마지막에 배치 (AND이므로 결과 동일).
  · 100만 조합 벤치마크: 구 순서 3.07s → 신 순서 1.99s (약 35% 단축, 동일 통과수)

[출력 형식]  01 04 06 11 24 41
════════════════════════════════════════════════════════════════════════════════
"""

from __future__ import annotations

import itertools
import os
import sys
import time
from datetime import datetime, timedelta, timezone

# Windows 콘솔 한글 출력 호환
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


# ════════════════════════════════════════════════════════════════════════════════
# §0. 상수 설정
# ════════════════════════════════════════════════════════════════════════════════

OUTPUT_FILE   = "lotto_combinations.txt"   # 생성·저장할 파일명
TOTAL_COMBOS  = 8_145_060                  # C(45,6) 전체 조합 수

# 필터 임계값 — TypeScript ADVANCED_SUM_MIN / ADVANCED_SUM_MAX 와 동일 (변경 없음)
SUM_MIN = 85
SUM_MAX = 189
RATIO_MIN = 1.3
RATIO_MAX = 7.5
AC_MIN = 5
AC_MAX = 10

# 전수 실측으로 확인된 기대 통과 수 (구·신 순서 불일치 0개).
# 무결성 가드용 기준값. 필터 임계값을 바꾸면 이 값도 함께 재측정해야 함.
EXPECTED_PASS_COUNT = 6_657_176
# CURRENT 판정된 파일이라도 행 수가 기대치의 이 비율 미만이면 파손·절단으로 보고 재생성.
INTEGRITY_MIN_RATIO = 0.90

# 한국 로또 추첨 시각 (KST = UTC+9)
KST            = timezone(timedelta(hours=9))
DRAW_WEEKDAY   = 5      # 토요일 (Python: 월=0, 일=6)
DRAW_HOUR_KST  = 20     # 오후 8시
DRAW_MINUTE_KST = 39    # 39분

# 진행률 리포트 간격 (콤보 단위)
REPORT_EVERY = 500_000

# 배치 쓰기 크기 (행 단위)
WRITE_BATCH = 50_000


# ════════════════════════════════════════════════════════════════════════════════
# §1. 로또 추첨 일정 유틸리티
# ════════════════════════════════════════════════════════════════════════════════

def get_last_draw_utc() -> datetime:
    """
    현재 시각 기준으로 가장 최근에 완료된 추첨 시각을 UTC 로 반환합니다.

    [알고리즘]
      1. UTC → KST 변환
      2. 오늘부터 거슬러 올라가 가장 최근 토요일 날짜 계산
      3. 해당 날짜 20:39 KST → UTC 변환
      4. 아직 추첨 시각이 안 됐으면 1주 전으로 조정
    """
    now_utc = datetime.now(timezone.utc)
    now_kst = now_utc.astimezone(KST)

    # 가장 최근 토요일 날짜 (오늘이 토요일이면 오늘)
    days_since_sat = (now_kst.weekday() - DRAW_WEEKDAY) % 7
    last_sat_date  = now_kst.date() - timedelta(days=days_since_sat)

    # 해당 토요일 추첨 시각 (KST)
    candidate_kst = datetime(
        last_sat_date.year, last_sat_date.month, last_sat_date.day,
        DRAW_HOUR_KST, DRAW_MINUTE_KST, 0,
        tzinfo=KST,
    )

    # 아직 추첨 전이라면 1주 전 회차가 "가장 최근 완료 추첨"
    if candidate_kst > now_utc.astimezone(KST):
        candidate_kst -= timedelta(weeks=1)

    return candidate_kst.astimezone(timezone.utc)


def describe_draw_period(last_draw_utc: datetime) -> str:
    """추첨 회차 기간을 사람이 읽기 쉬운 문자열로 반환합니다."""
    last_kst  = last_draw_utc.astimezone(KST)
    next_kst  = last_kst + timedelta(weeks=1)
    return (
        f"{last_kst.strftime('%Y-%m-%d %H:%M')} KST"
        f" ~ {next_kst.strftime('%Y-%m-%d %H:%M')} KST"
    )


# ════════════════════════════════════════════════════════════════════════════════
# §2. 파일 신선도(Freshness) 판별 + 무결성(Integrity) 가드
# ════════════════════════════════════════════════════════════════════════════════

class FileStatus:
    """파일 상태 판별 결과."""
    MISSING      = "MISSING"        # 파일 없음
    STALE        = "STALE"          # 지난 회차에 생성된 구버전
    CURRENT      = "CURRENT"        # 이번 회차에 생성된 최신 버전
    UNREADABLE   = "UNREADABLE"     # 파일 존재하지만 mtime 읽기 실패
    CORRUPT      = "CORRUPT"        # mtime은 최신이나 내용이 파손·절단됨


def count_valid_lines(filepath: str) -> int | None:
    """빈 줄을 제외한 유효 행 수를 셉니다. 읽기 실패 시 None."""
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return sum(1 for line in f if line.strip())
    except (IOError, OSError):
        return None


def check_file_freshness(filepath: str) -> tuple[str, str]:
    """
    파일의 신선도와 무결성을 판별하여 (상태코드, 설명 메시지) 를 반환합니다.

    [판별 기준]
      파일 mtime ≥ 직전 추첨 시각  →  CURRENT 후보 → 행 수 검사
        행 수 ≥ 기대치×90%          →  CURRENT  (이번 회차 파일, 재사용)
        행 수 <  기대치×90%         →  CORRUPT  (절단·파손 의심, 재생성)
        행 수 측정 불가             →  UNREADABLE (안전하게 재생성)
      파일 mtime <  직전 추첨 시각  →  STALE    (지난 회차 파일, 재생성)
      파일 없음                     →  MISSING  (재생성 필요)
      mtime 읽기 오류               →  UNREADABLE (안전하게 재생성)

    [무결성 가드를 둔 이유]
      mtime만으로는 파일 내용 파손을 검출할 수 없습니다. 실제로 리포지토리에
      체크인된 구 파일(137,496행)은 기대 통과수 6,657,176행의 약 2%에 불과했고
      현행 필터 부적합 조합을 9,942개(7.23%) 포함하고 있었습니다.
      mtime이 최신이라도 행 수가 현저히 부족하면 재생성하는 것이 안전합니다.

    [mtime 선택 이유]
      - os.path.getmtime() : 수정 시간(mtime) — 파일 내용 갱신 기준
      - os.path.getctime() : Windows에서는 생성 시간(creation time)
                             Linux에서는 inode 변경 시간(ctime)
      mtime 은 플랫폼 무관하게 파일 데이터 마지막 갱신 시각을 의미하므로
      어느 OS에서나 일관된 동작이 보장됩니다.
    """
    last_draw_utc = get_last_draw_utc()
    period_str    = describe_draw_period(last_draw_utc)

    # ── 파일 부재 확인 ────────────────────────────────────────────────────────
    if not os.path.exists(filepath):
        return FileStatus.MISSING, "파일 없음 → 생성 필요"

    # ── mtime 읽기 ────────────────────────────────────────────────────────────
    try:
        raw_mtime  = os.path.getmtime(filepath)
        # os.path.getmtime() 은 항상 Unix timestamp(UTC 기반) 반환
        # → timezone.utc 로 명시적 변환하여 DST·로컬 타임존 영향 제거
        file_utc   = datetime.fromtimestamp(raw_mtime, tz=timezone.utc)
        file_kst   = file_utc.astimezone(KST)
    except OSError as exc:
        return FileStatus.UNREADABLE, f"mtime 읽기 실패({exc}) → 안전을 위해 재생성"

    # ── 신선도 비교 ───────────────────────────────────────────────────────────
    if file_utc >= last_draw_utc:
        # 이번 회차 파일 후보 → 무결성 가드
        line_count = count_valid_lines(filepath)
        threshold = int(EXPECTED_PASS_COUNT * INTEGRITY_MIN_RATIO)
        if line_count is None:
            return FileStatus.UNREADABLE, "행 수 측정 불가 → 안전을 위해 재생성"
        if line_count < threshold:
            return (
                FileStatus.CORRUPT,
                f"최신 mtime이나 행 수 부족 (실측: {line_count:,}행, "
                f"기대: {EXPECTED_PASS_COUNT:,}행의 {INTEGRITY_MIN_RATIO:.0%} = "
                f"{threshold:,}행 미만)\n"
                f"  → 절단·파손 의심 → 재생성 필요",
            )
        return (
            FileStatus.CURRENT,
            f"최신 회차 파일 (생성: {file_kst.strftime('%Y-%m-%d %H:%M')} KST, "
            f"{line_count:,}행)\n"
            f"  현재 회차 기간: {period_str}",
        )
    else:
        return (
            FileStatus.STALE,
            f"구버전 파일 (생성: {file_kst.strftime('%Y-%m-%d %H:%M')} KST)\n"
            f"  마지막 추첨:    {last_draw_utc.astimezone(KST).strftime('%Y-%m-%d %H:%M')} KST\n"
            f"  → 파일이 추첨 이전 데이터 → 재생성 필요",
        )


# ════════════════════════════════════════════════════════════════════════════════
# §3. 필터 함수 — TypeScript passesPythonFilters() 와 동일 조건
# ════════════════════════════════════════════════════════════════════════════════
# 모든 함수는 정렬된 튜플 combo (오름차순, 길이=6) 를 인자로 받습니다.
# itertools.combinations 출력은 자연적으로 오름차순이므로 추가 정렬 불필요.

def is_valid_ac(combo: tuple[int, ...]) -> bool:
    """
    AC(산술 복잡도) 검사: 5 ≤ AC ≤ 10

    AC = (6개 번호 간 차이값 집합의 크기) − 5
    모든 C(6,2)=15 쌍의 |a−b| 중 서로 다른 값의 개수에서 5를 뺀 값.
    combo 가 오름차순이므로 b>a → abs 생략, 그냥 b−a 사용.

    [참고] 상한(≤10)은 구조적으로 항상 참입니다. 서로 다른 차이값은 최대
    15개이므로 AC ≤ 10이 항상 성립하고, 실질 필터는 하한(≥5)만 수행합니다.
    스펙(TypeScript)과 문자 그대로 일치시키기 위해 조건식은 그대로 둡니다.
    """
    diffs: set[int] = set()
    for i in range(6):
        for j in range(i + 1, 6):
            diffs.add(combo[j] - combo[i])
    ac = len(diffs) - 5
    return AC_MIN <= ac <= AC_MAX


def is_valid_sum46(combo: tuple[int, ...]) -> bool:
    """
    합46 쌍 검사: 합이 46이 되는 쌍 ≤ 2개

    [핫패스 제외 — 삭제가 아닌 제외인 이유]
      전수 실측 결과 Sum46 탈락 집합(1,540개)은 상보쌍 (a,46-a) 22개 중
      3쌍을 고른 조합 C(22,3)=1,540과 정확히 일치하며, 이들의 AC값은
      전부 0~4로 AC 하한(≥5) 탈락에 완전히 포함됩니다.
      즉 단독 제거 기여 0개·순차 누적 기여 0개이므로 핫패스에서 호출하지
      않아 8.1M회 × 15쌍 검사를 절약합니다. 결과는 동일합니다(불일치 0개 검증).
      인터페이스 호환(TypeScript 미러·진단용)을 위해 함수는 유지합니다.
    """
    pairs = 0
    for i in range(6):
        for j in range(i + 1, 6):
            if combo[i] + combo[j] == 46:
                pairs += 1
                if pairs > 2:
                    return False
    return True


def is_valid_ratio(combo: tuple[int, ...]) -> bool:
    """
    상/하위 비율 검사: 1.3 ≤ (상위3합 / 하위3합) ≤ 7.5

    오름차순 정렬 기준:
      하위3 = combo[0] + combo[1] + combo[2]
      상위3 = combo[3] + combo[4] + combo[5]
    """
    small = combo[0] + combo[1] + combo[2]
    if small == 0:
        return False
    ratio = (combo[3] + combo[4] + combo[5]) / small
    return RATIO_MIN <= ratio <= RATIO_MAX


def is_valid_range_pattern(combo: tuple[int, ...]) -> bool:
    """
    번대별 분산 검사: 각 구간(1~10, 11~20, 21~30, 31~40, 41~45)에 ≤ 3개

    구간 인덱스 = min((n-1) // 10, 4)
    counts[i] > 3 가 하나라도 있으면 기각.

    [수정] 기존 코드는 루프 안에서 min((n-1)//10, 4)를 두 번 계산했습니다.
    한 번만 계산하도록 수정 (결과 동일, 호출 8.1M회 × 절약).
    """
    counts = [0, 0, 0, 0, 0]
    for n in combo:
        idx = (n - 1) // 10
        if idx > 4:
            idx = 4
        counts[idx] += 1
        if counts[idx] > 3:   # 조기 종료
            return False
    return True


def is_valid_consecutive(combo: tuple[int, ...]) -> bool:
    """
    연속번호 검사: 2연속 쌍 ≤ 2개, 3연속 이상 없음

    오름차순 combo 기준:
      ① combo[i]+1 == combo[i+1] → 연속 쌍 발견
      ② combo[i]+2 == combo[i+2] → 3연속 → 즉시 False
    """
    pairs = 0
    for i in range(5):
        if combo[i] + 1 == combo[i + 1]:
            pairs += 1
            # 3연속 체크
            if i < 4 and combo[i] + 2 == combo[i + 2]:
                return False
    return pairs <= 2


def passes_all_filters(combo: tuple[int, ...]) -> bool:
    """
    5개 유효 필터를 모두 통과하는지 검사합니다 (Sum46은 핫패스 제외, §3 참조).

    [성능 최적화 순서 — AND이므로 판정 결과는 순서와 무관]
    총합(값쌈·제거율 7.96%) → 비율(값쌈) → 번대별 → 연속 → AC(비쌈·제거율 1.7%)
    실측 단가(8.1M 환산): 총합 0.8s · 비율 0.7s · 번대별 3.7s ·
    연속 2.3s · AC 11.8s · Sum46(제외) 8.8s.
    비싼 AC를 마지막에 두어 탈락 조합에 대한 불필요한 AC 계산을 줄입니다.
    각 필터는 실패 즉시 반환(단락 평가)하여 불필요한 계산을 줄입니다.

    [동등성] 구 순서(총합→AC→Sum46→비율→번대별→연속)와 8,145,060개 전수 비교
    불일치 0개, 통과수 6,657,176개 동일.
    """
    total = combo[0] + combo[1] + combo[2] + combo[3] + combo[4] + combo[5]
    if not (SUM_MIN <= total <= SUM_MAX):
        return False
    if not is_valid_ratio(combo):
        return False
    if not is_valid_range_pattern(combo):
        return False
    if not is_valid_consecutive(combo):
        return False
    if not is_valid_ac(combo):
        return False
    return True


def passes_all_filters_legacy(combo: tuple[int, ...]) -> bool:
    """
    변경 전 순서의 동등성 검증용 레거시 판정 (총합→AC→Sum46→비율→번대별→연속).
    생성 경로에서는 사용하지 않고 --verify 에서만 사용합니다.
    """
    total = combo[0] + combo[1] + combo[2] + combo[3] + combo[4] + combo[5]
    if not (SUM_MIN <= total <= SUM_MAX):
        return False
    if not is_valid_ac(combo):
        return False
    if not is_valid_sum46(combo):
        return False
    if not is_valid_ratio(combo):
        return False
    if not is_valid_range_pattern(combo):
        return False
    if not is_valid_consecutive(combo):
        return False
    return True


# ════════════════════════════════════════════════════════════════════════════════
# §4. 조합 생성 엔진
# ════════════════════════════════════════════════════════════════════════════════

def generate_combinations(output_path: str) -> int:
    """
    8,145,060개 전체 조합을 순회하며 필터를 통과한 조합만 파일에 저장합니다.

    [처리 흐름]
      1. itertools.combinations(range(1,46), 6) 으로 C(45,6) 전체를 오름차순 생성
         → 추가 정렬 불필요, 중복 없음
      2. passes_all_filters() 로 필터 순차 적용 (조기 탈락 최적화)
      3. 통과 조합을 WRITE_BATCH 행 단위로 묶어 배치 쓰기
         → 매 행마다 I/O 하지 않아 성능 대폭 향상
      4. REPORT_EVERY 간격으로 진행률·통과 수·속도 출력

    [출력 형식]  "01 04 06 11 24 41\\n"  (2자리 제로패딩, 공백 구분)

    반환값: 최종 저장된 조합 수
    """
    print(f"\n  생성 시작: {TOTAL_COMBOS:,}개 전체 조합 → 필터 적용 후 저장")
    print(f"  필터 기준: 총합 {SUM_MIN}~{SUM_MAX}  비율 {RATIO_MIN}~{RATIO_MAX}  "
          f"번대별 ≤3  연속 ≤2쌍(3연속 금지)  AC {AC_MIN}~{AC_MAX}  "
          f"(Sum46은 AC에 포함되어 핫패스 제외)")
    print(f"  출력 파일: {output_path}\n")

    t_start   = time.perf_counter()
    processed = 0
    saved     = 0
    batch: list[str] = []

    try:
        with open(output_path, "w", newline="\n", encoding="utf-8") as fout:
            for combo in itertools.combinations(range(1, 46), 6):
                processed += 1

                if passes_all_filters(combo):
                    batch.append(" ".join(f"{n:02d}" for n in combo))
                    saved += 1

                    # 배치 쓰기: 메모리 대신 WRITE_BATCH 단위로 I/O
                    if len(batch) >= WRITE_BATCH:
                        fout.write("\n".join(batch) + "\n")
                        batch.clear()

                # 진행률 리포트
                if processed % REPORT_EVERY == 0:
                    elapsed  = time.perf_counter() - t_start
                    pct      = processed / TOTAL_COMBOS * 100
                    speed    = processed / elapsed / 1_000
                    remaining = (TOTAL_COMBOS - processed) / (processed / elapsed) if elapsed > 0 else 0
                    print(
                        f"  [{pct:5.1f}%] {processed:>9,} / {TOTAL_COMBOS:,}  "
                        f"통과: {saved:>6,}  "
                        f"속도: {speed:,.0f}K/s  "
                        f"남은 시간: {remaining:.0f}s"
                    )

            # 마지막 남은 배치 플러시
            if batch:
                fout.write("\n".join(batch) + "\n")

    except IOError as exc:
        print(f"\n  [오류] 파일 쓰기 실패: {exc}", file=sys.stderr)
        raise

    elapsed_total = time.perf_counter() - t_start
    pass_rate     = saved / TOTAL_COMBOS * 100

    print(f"\n  완료!")
    print(f"  처리: {processed:,}개  |  통과: {saved:,}개  |  통과율: {pass_rate:.2f}%")
    print(f"  소요 시간: {elapsed_total:.1f}초  |  파일: {output_path}")

    return saved


# ════════════════════════════════════════════════════════════════════════════════
# §5. 진단·검증 (필터별 통계, 전·후 동등성 확인)
# ════════════════════════════════════════════════════════════════════════════════

def diagnose_filters(sample_size: int = 300_000, seed: int = 20260925) -> None:
    """
    필터별 통계를 출력합니다 (기본: 고정 시드 무작위 표본 — 추정치로 표시).
    전수 실측치(주석 [M] 표시)와 함께 보면 각 필터의 영향·방향을 파악할 수 있습니다.

    [M] = 8,145,060개 전수 실측 확정값 (별도 감사 스크립트로 측정)
      총합: 통과 7,496,423 (92.04%) · 단독제거 648,637 (7.96%)
      AC: 통과 8,006,396 (98.30%) · 단독제거 138,664 (1.70%)
      Sum46: 통과 8,143,520 (99.98%) · 단독제거 1,540 (0.02%) · 순차기여 0
      비율: 통과 7,975,089 (97.91%) · 단독제거 169,971 (2.09%)
      번대별: 통과 7,605,200 (93.37%) · 단독제거 539,860 (6.63%)
      연속: 통과 7,676,760 (94.25%) · 단독제거 468,300 (5.75%)
      순차 누적(총합→AC→Sum46→비율→번대별→연속):
        7,496,423 → 7,383,436(-112,987) → 7,383,436(-0) → 7,264,745(-118,691)
        → 6,905,313(-359,432) → 6,657,176(-248,137, 최종 81.73%)
    """
    import random
    print("=" * 72)
    print("  필터 진단 — 표본 추정치 + 전수 실측 대조".center(72))
    print("=" * 72)
    print("  [M] 전수 실측 (8,145,060개 전부, 확정값):")
    print("    총합   통과 7,496,423 (92.04%) · 단독제거 648,637 (7.96%)")
    print("    AC     통과 8,006,396 (98.30%) · 단독제거 138,664 (1.70%)")
    print("    Sum46  통과 8,143,520 (99.98%) · 단독제거   1,540 (0.02%) · 순차기여 0")
    print("    비율   통과 7,975,089 (97.91%) · 단독제거 169,971 (2.09%)")
    print("    번대별 통과 7,605,200 (93.37%) · 단독제거 539,860 (6.63%)")
    print("    연속   통과 7,676,760 (94.25%) · 단독제거 468,300 (5.75%)")
    print("    최종 통과 6,657,176 (81.73%) · 총 제거 1,487,884 (18.27%)")
    print("    Sum46 탈락 1,540개 = C(22,3). AC값 전부 0~4 → AC에 완전 포함.")
    print("    AC 상한(≤10)은 구조적으로 항상 참 (차이값 최대 15종 → AC≤10).")
    print()
    print(f"  [S] 표본 측정 (n={sample_size:,}, seed={seed} — 추정치):")

    rng = random.Random(seed)
    keys = ("sum", "ac", "s46", "ratio", "range", "cons")
    indiv = dict.fromkeys(keys, 0)
    seq = dict.fromkeys(keys, 0)
    both_new_old = 0
    for _ in range(sample_size):
        combo = tuple(sorted(rng.sample(range(1, 46), 6)))
        total = sum(combo)
        f_sum = SUM_MIN <= total <= SUM_MAX
        diffs = set()
        for i in range(6):
            for j in range(i + 1, 6):
                diffs.add(combo[j] - combo[i])
        f_ac = AC_MIN <= len(diffs) - 5 <= AC_MAX
        p46 = sum(1 for i in range(6) for j in range(i + 1, 6)
                  if combo[i] + combo[j] == 46)
        f_s46 = p46 <= 2
        small = combo[0] + combo[1] + combo[2]
        f_ratio = RATIO_MIN <= (combo[3] + combo[4] + combo[5]) / small <= RATIO_MAX
        counts = [0, 0, 0, 0, 0]
        f_range = True
        for n in combo:
            idx = (n - 1) // 10
            if idx > 4:
                idx = 4
            counts[idx] += 1
            if counts[idx] > 3:
                f_range = False
                break
        pairs = 0
        f_cons = True
        for i in range(5):
            if combo[i] + 1 == combo[i + 1]:
                pairs += 1
                if i < 4 and combo[i] + 2 == combo[i + 2]:
                    f_cons = False
                    break
        if f_cons:
            f_cons = pairs <= 2
        f = {"sum": f_sum, "ac": f_ac, "s46": f_s46, "ratio": f_ratio,
             "range": f_range, "cons": f_cons}
        for k in keys:
            if f[k]:
                indiv[k] += 1
        pre = True
        for k in ("sum", "ac", "s46", "ratio", "range", "cons"):
            if not f[k]:
                pre = False
            elif pre:
                seq[k] += 1
        if passes_all_filters(combo) == passes_all_filters_legacy(combo):
            both_new_old += 1

    for k in keys:
        print(f"    {k:>6}: 표본통과 {indiv[k]:>7,} ({indiv[k]/sample_size*100:5.2f}%) "
              f"· 순차누적 {seq[k]:>7,}")
    print(f"    신·구 판정 일치: {both_new_old:,}/{sample_size:,} "
          f"({both_new_old/sample_size*100:.2f}%)")
    print("  ※ [S]는 추정치입니다. 확정값은 [M]을 사용하십시오.")
    print("=" * 72)


def verify_equivalence(limit: int = 0) -> int:
    """
    신·구 판정의 전수 동등성을 검증합니다.
    limit=0 이면 8,145,060개 전부, limit>0 이면 앞부분 limit개만 검사합니다.
    반환값: 불일치 개수 (0이어야 정상).
    """
    scope = TOTAL_COMBOS if limit <= 0 else min(limit, TOTAL_COMBOS)
    print(f"\n  동등성 검증: {scope:,}개 조합에 대해 신·구 판정 비교 중 ...")
    t0 = time.perf_counter()
    disagree = 0
    first_bad: list[tuple[int, ...]] = []
    for n, combo in enumerate(itertools.combinations(range(1, 46), 6), 1):
        if n > scope:
            break
        if passes_all_filters(combo) != passes_all_filters_legacy(combo):
            disagree += 1
            if len(first_bad) < 5:
                first_bad.append(combo)
        if n % 1_000_000 == 0:
            print(f"    {n:>9,} / {scope:,} ... {time.perf_counter()-t0:.1f}s "
                  f"불일치 {disagree}")
    print(f"  검증 완료: 검사 {min(n, scope):,}개 · 불일치 {disagree}개 · "
          f"{time.perf_counter()-t0:.1f}s")
    for c in first_bad:
        print(f"    불일치 예시: {c}")
    return disagree


# ════════════════════════════════════════════════════════════════════════════════
# §6. 메인 진입점
# ════════════════════════════════════════════════════════════════════════════════

def main(filepath: str = OUTPUT_FILE) -> None:
    """
    파일 신선도·무결성을 판별하고, 필요 시 조합을 재생성합니다.

    [실행 흐름]
      ① check_file_freshness() 로 파일 상태 판별
      ② CURRENT → 재사용 메시지 출력 후 종료
      ③ MISSING / STALE / UNREADABLE / CORRUPT → generate_combinations() 실행

    [매개변수]
      filepath : 읽거나 쓸 lotto_combinations.txt 경로
                 절대경로·상대경로 모두 허용

    [CLI]
      python generate_lotto_combinations.py                 → 기본 동작 (신선도 관리)
      python generate_lotto_combinations.py --diagnose      → 필터 진단 출력 후 종료
      python generate_lotto_combinations.py --verify [N]    → 신·구 동등성 검증
    """
    W = 72
    print("=" * W)
    print("  한국 로또 6/45 — 조합 파일 신선도 관리 시스템".center(W))
    print("=" * W)
    now_kst = datetime.now(KST)
    print(f"\n  현재 시각: {now_kst.strftime('%Y-%m-%d %H:%M:%S')} KST")

    # ── 파일 신선도 판별 ──────────────────────────────────────────────────────
    status, message = check_file_freshness(filepath)

    print(f"\n  [파일 상태: {status}]")
    for line in message.splitlines():
        print(f"  {line}")

    # ── 분기 처리 ─────────────────────────────────────────────────────────────
    if status == FileStatus.CURRENT:
        # 이번 회차에 생성된 최신 파일 → 재사용
        print("\n  → 이번 회차 기준 최신 파일입니다. 재생성을 건너뜁니다.")
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                # 빈 줄 제외한 유효 조합 수만 카운트
                line_count = sum(1 for line in f if line.strip())
            print(f"  → 파일 내 조합 수: {line_count:,}개")
        except IOError:
            print("  → (파일 행 수 카운트 실패)")
        print()

    elif status in (FileStatus.MISSING, FileStatus.STALE,
                    FileStatus.UNREADABLE, FileStatus.CORRUPT):
        # 파일 없음·구버전·읽기 불가·파손 → 전체 재생성
        if status == FileStatus.STALE:
            print("\n  → 지난 회차 기준 파일입니다. 최신 회차 기준으로 재생성합니다.")
        elif status == FileStatus.MISSING:
            print("\n  → 파일이 없습니다. 새로 생성합니다.")
        elif status == FileStatus.CORRUPT:
            print("\n  → 파일 내용이 파손·절단된 것으로 보입니다. 재생성합니다.")
        else:
            print("\n  → 파일 상태를 확인할 수 없습니다. 안전을 위해 재생성합니다.")

        print()
        saved = generate_combinations(filepath)
        print()
        print("─" * W)
        print(f"  저장 완료: {filepath}")
        print(f"  조합 수  : {saved:,}개")
        if saved != EXPECTED_PASS_COUNT:
            print(f"  [경고] 기대 통과수({EXPECTED_PASS_COUNT:,}개)와 다릅니다. "
                  f"필터 임계값 변경 여부를 확인하십시오.")
        now_done = datetime.now(KST)
        print(f"  생성 시각: {now_done.strftime('%Y-%m-%d %H:%M:%S')} KST")
        print("─" * W)

    print("\n" + "=" * W)


if __name__ == "__main__":
    if "--diagnose" in sys.argv:
        diagnose_filters()
    elif "--verify" in sys.argv:
        idx = sys.argv.index("--verify")
        lim = 0
        if idx + 1 < len(sys.argv) and sys.argv[idx + 1].isdigit():
            lim = int(sys.argv[idx + 1])
        bad = verify_equivalence(limit=lim)
        sys.exit(1 if bad else 0)
    else:
        # 스크립트와 같은 디렉토리에 lotto_combinations.txt 생성
        script_dir = os.path.dirname(os.path.abspath(__file__))
        target     = os.path.join(script_dir, OUTPUT_FILE)
        main(filepath=target)
