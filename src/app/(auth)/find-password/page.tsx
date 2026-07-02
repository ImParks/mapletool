import { Card } from "@/components/ui/Card";
import { Logo } from "@/components/ui/Logo";
import { FindPasswordForm } from "./FindPasswordForm";

export default function FindPasswordPage() {
  return (
    <div className="flex w-full max-w-[400px] flex-col gap-5">
      <div className="flex flex-col items-center gap-3.5 text-center">
        <Logo size="lg" />
        <div>
          <h1 className="text-[22px] font-extrabold">비밀번호 찾기</h1>
          <p className="mt-1.5 max-w-[32ch] text-sm leading-relaxed text-maple-text-secondary">
            가입한 이메일로 재설정 링크를 보내드려요.
          </p>
        </div>
      </div>

      <Card>
        <FindPasswordForm />
      </Card>
    </div>
  );
}
