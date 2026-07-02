import type { ReactNode } from "react";

/**
 * 인증 화면(랜딩/로그인/회원가입/비밀번호 찾기) 공통 레이아웃.
 * 뷰포트 중앙 정렬 + 아주 옅은 라디얼 오렌지/라벤더 배경 글로우.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen w-full overflow-x-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{ background: "var(--bg-glow)" }}
      />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-5 py-10">
        {children}
      </div>
    </div>
  );
}
