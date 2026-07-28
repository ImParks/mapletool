import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Logo } from "@/components/ui/Logo";
import { buttonClassName } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./ResetPasswordForm";

// 쿠키의 복구 세션 유무에 따라 화면이 갈리므로 요청마다 새로 렌더해야 한다
// (main/page.tsx 의 동일 주석 참고 — 우연한 정적 프리렌더를 원천 차단).
export const dynamic = "force-dynamic";

/** 링크가 유효하지 않을 때 보여주는 안내. 여기서 막지 않으면 폼을 채운 뒤에야 실패를 알게 된다. */
function InvalidLinkNotice() {
  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center">
      <div className="text-base font-extrabold text-maple-text-primary">링크가 만료되었어요</div>
      <p className="max-w-[32ch] text-[13px] leading-relaxed text-maple-text-muted">
        재설정 링크는 한 번만, 그리고 일정 시간 안에서만 쓸 수 있어요. 메일을 요청한 것과 같은
        브라우저에서 열어야 합니다. 다시 요청해 주세요.
      </p>
      <Link href="/find-password" className={cn(buttonClassName({ variant: "secondary", block: true }), "mt-1")}>
        비밀번호 찾기 다시 하기
      </Link>
      <Link href="/login" className="text-[13px] font-bold text-maple-text-link">
        로그인으로 돌아가기
      </Link>
    </div>
  );
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // /auth/callback 이 교환에 실패하면 ?error=... 를 붙여 여기로 보낸다.
  let linkValid = !error;

  if (linkValid && isSupabaseConfigured()) {
    // 실제 판정 기준은 쿠키의 세션이다. 메일 링크를 거치지 않고 이 URL 을 직접 열었거나,
    // 링크를 다른 브라우저에서 열어 code verifier 쿠키가 없었던 경우가 여기서 걸러진다.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    linkValid = Boolean(user);
  }

  return (
    <div className="flex w-full max-w-[400px] flex-col gap-5">
      <div className="flex flex-col items-center gap-3.5 text-center">
        <Logo size="lg" />
        <div>
          <h1 className="text-[22px] font-extrabold">비밀번호 재설정</h1>
          <p className="mt-1.5 max-w-[32ch] text-sm leading-relaxed text-maple-text-secondary">
            새로 사용할 비밀번호를 입력해 주세요.
          </p>
        </div>
      </div>

      <Card>{linkValid ? <ResetPasswordForm /> : <InvalidLinkNotice />}</Card>
    </div>
  );
}
