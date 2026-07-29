// 메이플 컨텐츠 초기화 주기 계산 (한국 시간 KST 기준)
//  - daily       : 매일 00:00 초기화
//  - weekly_mon  : 매주 월요일 00:00 초기화 (주간 퀘스트)
//  - weekly_thu  : 매주 목요일 00:00 초기화 (주간 보스)
//  - monthly     : 매월 1일 00:00 초기화 (월간 보스 — 검은 마법사)
// 각 항목의 "현재 주기 키"를 만들어, 완료 기록의 존재 여부로 완료 상태를 판단한다.

export type ResetType = "daily" | "weekly_mon" | "weekly_thu" | "monthly";

/**
 * 전체 ResetType 목록. "현재 주기의 완료 기록을 전부 조회" 하는 곳이 주기를 하나씩
 * 손으로 나열하다 새 주기를 빠뜨리는 사고를 막기 위해 단일 출처로 둔다
 * (실제로 monthly 추가 전까지 page.tsx/warmup.ts 가 3개를 하드코딩하고 있었다).
 * satisfies 로 유니온 전수를 강제하지는 못하므로, 새 주기를 추가하면 여기에도 반드시 넣는다 —
 * 빠뜨리면 currentPeriodKeys() 가 그 주기를 못 돌려주고 완료가 화면에서 사라진다.
 */
export const ALL_RESET_TYPES: readonly ResetType[] = [
  "daily",
  "weekly_mon",
  "weekly_thu",
  "monthly",
] as const;

/**
 * 주어진 시각을 KST 기준 연/월/일/요일로 변환한다(일=0, 월=1, … 토=6).
 * 시간대 변환 로직이 여러 파일에 복제되는 것을 막기 위해 export 한다 —
 * KST 날짜/요일이 필요한 곳은 Intl 변환을 새로 만들지 말고 이 함수를 재사용한다.
 */
export function kstParts(now: Date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value])
  );
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdayMap[parts.weekday as string],
  };
}

/** KST 자정 기준의 일수(UTC epoch day가 아닌, 표시용 일련번호) */
function kstDayNumber(now: Date): number {
  const { year, month, day } = kstParts(now);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

/**
 * DB 에서 읽은 문자열을 ResetType 으로 좁힌다. 아는 값이 아니면 null.
 *
 * 이 프로젝트에는 생성된 Supabase 타입이 없어 DB→TS 경계가 전부 `as ResetType` 무검증
 * 캐스팅이다. 코드보다 마이그레이션이 먼저 배포되는 등으로 코드가 모르는 값이 흘러들면
 * currentPeriodKey 가 그 값으로 엉뚱한 키를 만들거나 RESET_LABEL 이 undefined 를 렌더한다.
 * 완료 기록처럼 되돌리기 어려운 쓰기 경로에서는 캐스팅 대신 이 함수로 좁힌다.
 */
export function asResetType(value: string | null | undefined): ResetType | null {
  return ALL_RESET_TYPES.includes(value as ResetType) ? (value as ResetType) : null;
}

/**
 * 지정한 KST 달력 날짜의 00:00 에 해당하는 실제 시각(Date)을 반환한다.
 * KST 는 서머타임이 없어 항상 UTC+9 고정이므로 단순 오프셋 계산으로 정확하다.
 * (관리자 통계의 "오늘 00:00 KST 이후 접속" 같은 경계 계산에 사용.)
 */
export function kstMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - 9 * 60 * 60 * 1000);
}

/**
 * 항목의 현재 주기 키를 반환한다.
 * 같은 주기 안에서는 항상 같은 문자열, 초기화가 지나면 다른 문자열이 된다.
 *
 * **키 형식은 절대 바꾸지 말 것** — completions.period_key 에 그대로 저장돼 있어서, 형식을
 * 바꾸면 이미 쌓인 완료 기록이 전부 "다른 주기의 기록"이 되어 조용히 고아가 된다
 * (period_key 컬럼에는 CHECK 도 length 제한도 없어 DB 가 막아주지 않는다).
 *
 * switch + never 로 전수 분기를 강제한다. 예전에는 "daily 가 아니면 전부 주간" 구조라
 * ResetType 에 새 값을 추가하고 분기를 빼먹어도 **컴파일이 통과하고** 그 값이 조용히
 * 목요일 주기 키로 떨어졌다(monthly 를 추가만 했을 때 `monthly-20657` 이 나왔다).
 */
export function currentPeriodKey(resetType: ResetType, now: Date = new Date()): string {
  const dayNum = kstDayNumber(now);
  const { year, month, weekday } = kstParts(now);

  switch (resetType) {
    case "daily":
      return `d-${dayNum}`;

    case "weekly_mon":
    case "weekly_thu": {
      // 주간: 마지막 초기화 요일이 지난 시점의 일수를 기준으로 묶는다.
      const resetWeekday = resetType === "weekly_mon" ? 1 : 4;
      // 이번 주기 시작일까지 거슬러 올라간 일수
      const diff = (weekday - resetWeekday + 7) % 7;
      const periodStart = dayNum - diff;
      return `${resetType}-${periodStart}`;
    }

    case "monthly":
      // 월(月)은 요일/일수가 아니라 달력 그 자체가 주기라 dayNum 계산이 필요 없다.
      // 월을 2자리로 패딩해 자릿수를 고정한다(사전순 정렬 = 시간순 정렬).
      return `monthly-${year}-${String(month).padStart(2, "0")}`;

    default: {
      // 새 ResetType 을 추가하고 분기를 안 넣으면 여기서 컴파일 에러가 난다.
      const exhaustive: never = resetType;
      throw new Error(`currentPeriodKey(): 알 수 없는 reset_type: ${String(exhaustive)}`);
    }
  }
}

/**
 * 지금 이 순간 유효한 **모든** 주기 키를 반환한다.
 * "현재 주기의 완료 기록을 전부 가져온다" 는 쿼리(`.in("period_key", ...)`)가 주기를 손으로
 * 나열하지 않도록 하기 위한 헬퍼 — 나열하면 새 주기가 추가될 때마다 조용히 누락된다.
 */
export function currentPeriodKeys(now: Date = new Date()): string[] {
  return ALL_RESET_TYPES.map((t) => currentPeriodKey(t, now));
}

export const RESET_LABEL: Record<ResetType, string> = {
  daily: "매일 00시 초기화",
  weekly_mon: "월요일 00시 초기화",
  weekly_thu: "목요일 00시 초기화",
  // 넥슨 API 는 cycle="bossMonthly" 라는 사실만 알려주고 초기화 앵커는 알려주지 않으며,
  // date 파라미터 조회 범위가 최근 13일뿐이라 월 경계를 관측해 확인할 수도 없다.
  // 앵커가 "매월 1일 00:00 KST" 라는 것은 인게임 확인으로 확정했다(2026-07-29).
  monthly: "매월 1일 00시 초기화",
};
