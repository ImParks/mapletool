import type { ReactNode } from "react";
import { Logo } from "@/components/ui/Logo";

/**
 * 배경 글로우 + 로고 + 중앙 정렬 안내 박스. env 미설정/키 미등록/넥슨 오류 같은
 * "본 화면 대신 안내만 보여줘야 하는" 상태에서 main/admin 페이지가 공용으로 사용한다.
 */
export function CenteredNotice({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen w-full overflow-x-hidden">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0" style={{ background: "var(--bg-glow)" }} />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center gap-6 px-5 py-10">
        <Logo size="lg" />
        <div className="w-full max-w-[420px]">{children}</div>
      </div>
    </div>
  );
}
