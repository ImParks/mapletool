import type { ActionResult } from "@/lib/action-result";

/**
 * Next.js 가 내부 제어 흐름에 쓰는 "에러"인지 판별한다. redirect()/notFound() 는 서버 액션
 * 안에서 예외를 던지는 방식으로 동작하므로, 이걸 삼켜버리면 로그아웃/회원탈퇴 후 화면 이동이
 * 사라진다. 반드시 다시 throw 해서 Next 라우터가 처리하게 둔다.
 */
function isNextControlFlowError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}

/**
 * 서버 액션 호출을 감싸 "던져진 예외"를 "화면에 띄울 에러 메시지"로 정규화한다.
 *
 * 왜 필요한가: 액션 본문이 `{ error }` 를 반환하도록 잘 짜여 있어도, 호출 자체가 실패하는
 * 경로가 따로 있다 — 함수 실행시간 초과(Vercel 서버리스 타임아웃), 네트워크 단절, 재배포로
 * 인한 Server Action ID 불일치 등. 이때 호출부에서 잡지 않으면 예외가 React 트랜지션 밖으로
 * 새어나가 가장 가까운 error boundary(=error.tsx)까지 올라가고, **모달 안에서 누른 버튼 하나
 * 때문에 화면 전체가 에러 페이지로 교체된다.** 이 래퍼가 그 경로를 막는다.
 */
export async function runAction<T>(
  action: () => Promise<ActionResult<T>>,
  fallbackMessage: string
): Promise<ActionResult<T>> {
  try {
    return await action();
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;
    // 원본 예외는 콘솔에만 남기고, 사용자에게는 준비된 한국어 문구만 보여준다.
    console.error(error);
    return { error: fallbackMessage };
  }
}

/**
 * 반환값이 없는(성공 시 redirect 하는) 액션용. 실패하면 에러 메시지를 돌려주고, 성공하면
 * null 을 돌려준다.
 */
export async function runVoidAction(
  action: () => Promise<unknown>,
  fallbackMessage: string
): Promise<string | null> {
  try {
    await action();
    return null;
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;
    console.error(error);
    return fallbackMessage;
  }
}
