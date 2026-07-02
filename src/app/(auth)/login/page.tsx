import { ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Logo } from "@/components/ui/Logo";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="flex w-full max-w-[400px] flex-col gap-5">
      <div className="flex flex-col items-center gap-3.5 text-center">
        <Logo size="lg" />
        <p className="max-w-[30ch] text-sm leading-relaxed text-maple-text-secondary">
          메이플 숙제 헌터 계정으로 로그인하세요.
        </p>
      </div>

      <Card>
        <LoginForm />
      </Card>

      <div className="flex items-center justify-center gap-1.5 text-center text-[11.5px] text-maple-text-muted">
        <ShieldCheck className="h-3.5 w-3.5 text-maple-success" aria-hidden="true" />
        비밀번호와 API 키는 안전하게 암호화되어 보관됩니다.
      </div>
    </div>
  );
}
