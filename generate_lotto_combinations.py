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
  │ 파일 있음 + 이번 회차 이후에 생성됨     │ 최신 파일 → 재사용             │
  └─────────────────────────────────────────┴────────────────────────────────┘

[회차 기준점]
  한국 로또 추첨: 매주 토요일 오후 8시 39분 KST (UTC+9)
  "이번 회차" = 직전 토요일 20:39 KST 이후 ~ 다음 토요일 20:39 KST 이전

[필터 조건] — TypeScript passesPythonFilters() 와 동일
  1. 총합  : 85 ≤ Σ ≤ 189
  2. AC    : 5 ≤ AC값 ≤ 10  (산술 복잡도)
  3. Sum46 : 합이 46이 되는 쌍 ≤ 2개
  4. Ratio : (상위3 합) / (하위3 합) — 1.3 ≤ ratio ≤ 7.5
  5. 번대별: 각 십의 자리 구간(1~10, 11~20, …, 41~45) 당 ≤ 3개
  6. 연속번호: 2연속 쌍 ≤ 2개, 3연속 이상 없음

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

# 필터 임계값 — TypeScript ADVANCED_SUM_MIN / ADVANCED_SUM_MAX 와 동일
SUM_MIN = 85
SUM_MAX = 189

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
# §2. 파일 신선도(Freshness) 판별
# ════════════════════════════════════════════════════════════════════════════════

class FileStatus:
    """파일 상태 판별 결과."""
    MISSING      = "MISSING"        # 파일 없음
    STALE        = "STALE"          # 지난 회차에 생성된 구버전
    CURRENT      = "CURRENT"        # 이번 회차에 생성된 최신 버전
    UNREADABLE   = "UNREADABLE"     # 파일 존재하지만 mtime 읽기 실패


def check_file_freshness(filepath: str) -> tuple[str, str]:
    """
    파일의 신선도를 판별하여 (상태코드, 설명 메시지) 를 반환합니다.

    [판별 기준]
      파일 mtime ≥ 직전 추첨 시각  →  CURRENT  (이번 회차 파일, 재사용)
      파일 mtime <  직전 추첨 시각  →  STALE    (지난 회차 파일, 재생성)
      파일 없음                     →  MISSING  (재생성 필요)
      mtime 읽기 오류               →  UNREADABLE (안전하게 재생성)

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
        return FileStatus.MISSING, f"파일 없음 → 생성 필요"

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
        return (
            FileStatus.CURRENT,
            f"최신 회차 파일 (생성: {file_kst.strftime('%Y-%m-%d %H:%M')} KST)\n"
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
# §3. 필터 함수 — TypeScript passesPythonFilters() 완전 포팅
# ════════════════════════════════════════════════════════════════════════════════
# 모든 함수는 정렬된 튜플 combo (오름차순, 길이=6) 를 인자로 받습니다.
# itertools.combinations 출력은 자연적으로 오름차순이므로 추가 정렬 불필요.

def is_valid_ac(combo: tuple[int, ...]) -> bool:
    """
    AC(산술 복잡도) 검사: 5 ≤ AC ≤ 10

    AC = (6개 번호 간 차이값 집합의 크기) − 5
    모든 C(6,2)=15 쌍의 |a−b| 중 서로 다른 값의 개수에서 5를 뺀 값.
    combo 가 오름차순이므로 b>a → abs 생략, 그냥 b−a 사용.
    """
    diffs: set[int] = set()
    for i in range(6):
        for j in range(i + 1, 6):
            diffs.add(combo[j] - combo[i])
    ac = len(diffs) - 5
    return 5 <= ac <= 10


def is_valid_sum46(combo: tuple[int, ...]) -> bool:
    """
    합46 쌍 검사: 합이 46이 되는 쌍 ≤ 2개

    a + b = 46 이 되는 (a, b) 쌍이 3개 이상이면 기각.
    조기 종료(pairs > 2 즉시 False) 로 성능 최적화.
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
    return 1.3 <= ratio <= 7.5


def is_valid_range_pattern(combo: tuple[int, ...]) -> bool:
    """
    번대별 분산 검사: 각 구간(1~10, 11~20, 21~30, 31~40, 41~45)에 ≤ 3개

    구간 인덱스 = min((n-1) // 10, 4)
    counts[i] > 3 가 하나라도 있으면 기각.
    """
    counts = [0, 0, 0, 0, 0]
    for n in combo:
        counts[min((n - 1) // 10, 4)] += 1
        if counts[min((n - 1) // 10, 4)] > 3:   # 조기 종료
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
    6개 필터를 모두 통과하는지 검사합니다.

    [성능 최적화 순서]
    총합 범위 → AC → Sum46 → Ratio → 번대별 → 연속
    총합 필터가 가장 많은 조합을 탈락시키므로 첫 번째로 배치합니다.
    각 필터는 실패 즉시 반환(단락 평가)하여 불필요한 계산을 줄입니다.
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
         → 추가 정렬 불필요, 중복 없음 (기존 파일의 중복 버그 자동 해결)
      2. passes_all_filters() 로 6개 필터 순차 적용 (조기 탈락 최적화)
      3. 통과 조합을 WRITE_BATCH 행 단위로 묶어 배치 쓰기
         → 매 행마다 I/O 하지 않아 성능 대폭 향상
      4. REPORT_EVERY 간격으로 진행률·통과 수·속도 출력

    [출력 형식]  "01 04 06 11 24 41\\n"  (2자리 제로패딩, 공백 구분)

    반환값: 최종 저장된 조합 수
    """
    print(f"\n  생성 시작: {TOTAL_COMBOS:,}개 전체 조합 → 필터 적용 후 저장")
    print(f"  필터 기준: 총합 {SUM_MIN}~{SUM_MAX}  AC 5~10  합46 ≤2쌍  "
          f"비율 1.3~7.5  번대별 ≤3  연속 ≤2쌍")
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
# §5. 메인 진입점
# ════════════════════════════════════════════════════════════════════════════════

def main(filepath: str = OUTPUT_FILE) -> None:
    """
    파일 신선도를 판별하고, 필요 시 조합을 재생성합니다.

    [실행 흐름]
      ① check_file_freshness() 로 파일 상태 판별
      ② CURRENT → 재사용 메시지 출력 후 종료
      ③ MISSING / STALE / UNREADABLE → generate_combinations() 실행

    [매개변수]
      filepath : 읽거나 쓸 lotto_combinations.txt 경로
                 절대경로·상대경로 모두 허용
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

    elif status in (FileStatus.MISSING, FileStatus.STALE, FileStatus.UNREADABLE):
        # 파일 없음·구버전·읽기 불가 → 전체 재생성
        if status == FileStatus.STALE:
            print("\n  → 지난 회차 기준 파일입니다. 최신 회차 기준으로 재생성합니다.")
        elif status == FileStatus.MISSING:
            print("\n  → 파일이 없습니다. 새로 생성합니다.")
        else:
            print("\n  → 파일 상태를 확인할 수 없습니다. 안전을 위해 재생성합니다.")

        print()
        saved = generate_combinations(filepath)
        print()
        print("─" * W)
        print(f"  저장 완료: {filepath}")
        print(f"  조합 수  : {saved:,}개")
        now_done = datetime.now(KST)
        print(f"  생성 시각: {now_done.strftime('%Y-%m-%d %H:%M:%S')} KST")
        print("─" * W)

    print("\n" + "=" * W)


if __name__ == "__main__":
    # 스크립트와 같은 디렉토리에 lotto_combinations.txt 생성
    script_dir = os.path.dirname(os.path.abspath(__file__))
    target     = os.path.join(script_dir, OUTPUT_FILE)
    main(filepath=target)
