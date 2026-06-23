// 메이플 컨텐츠 초기화 주기 계산 (한국 시간 KST 기준)
//  - daily       : 매일 00:00 초기화
//  - weekly_mon  : 매주 월요일 00:00 초기화 (주간 퀘스트)
//  - weekly_thu  : 매주 목요일 00:00 초기화 (주간 보스)
// 각 항목의 "현재 주기 키"를 만들어, 완료 기록의 존재 여부로 완료 상태를 판단한다.

export type ResetType = "daily" | "weekly_mon" | "weekly_thu";

/** 주어진 시각을 KST 기준 연/월/일/요일로 변환 */
function kstParts(now: Date) {
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
 * 항목의 현재 주기 키를 반환한다.
 * 같은 주기 안에서는 항상 같은 문자열, 초기화가 지나면 다른 문자열이 된다.
 */
export function currentPeriodKey(resetType: ResetType, now: Date = new Date()): string {
  const dayNum = kstDayNumber(now);
  const { weekday } = kstParts(now);

  if (resetType === "daily") {
    return `d-${dayNum}`;
  }

  // 주간: 마지막 초기화 요일이 지난 시점의 일수를 기준으로 묶는다.
  const resetWeekday = resetType === "weekly_mon" ? 1 : 4;
  // 이번 주기 시작일까지 거슬러 올라간 일수
  const diff = (weekday - resetWeekday + 7) % 7;
  const periodStart = dayNum - diff;
  return `${resetType}-${periodStart}`;
}

export const RESET_LABEL: Record<ResetType, string> = {
  daily: "매일 00시 초기화",
  weekly_mon: "월요일 00시 초기화",
  weekly_thu: "목요일 00시 초기화",
};
