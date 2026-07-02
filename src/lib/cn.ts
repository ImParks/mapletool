type ClassValue = string | number | bigint | null | false | undefined;

/** Tailwind 클래스명을 조건부로 이어붙이는 아주 작은 헬퍼 (clsx 대체, 새 의존성 없음). */
export function cn(...values: ClassValue[]): string {
  return values.filter((value): value is string | number | bigint => Boolean(value)).join(" ");
}
