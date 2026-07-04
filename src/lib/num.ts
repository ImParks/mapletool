/**
 * 숫자/숫자문자열을 [min, max] 범위의 정수로 정규화한다.
 * 파싱 불가·비유한 값은 min 으로 처리한다(폼 입력 방어).
 * 서버 액션(분/레벨/포스 clamp)과 클라이언트 입력(draft 커밋) 양쪽에서 공용으로 사용
 * — 같은 clamp 로직이 파일마다 미묘하게 다르게 복제되는 것을 막는다.
 */
export function clampInt(value: number | string, min: number, max: number): number {
  const n = typeof value === "string" ? parseInt(value, 10) : value;
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(Math.round(n), min), max);
}
