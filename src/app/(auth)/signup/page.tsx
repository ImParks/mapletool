import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Logo } from "@/components/ui/Logo";
import { SignupForm } from "./SignupForm";

export default function SignupPage() {
  return (
    <div className="flex w-full max-w-[400px] flex-col gap-5">
      <div className="flex flex-col items-center gap-3.5 text-center">
        <Logo size="lg" />
        <p className="max-w-[32ch] text-sm leading-relaxed text-maple-text-secondary">
          계정을 만들면 API 키와 숙제 기록이 안전하게 저장돼요.
        </p>
      </div>

      <Card>
        <SignupForm />
      </Card>

      <div className="text-center text-[13px] text-maple-text-secondary">
        이미 계정이 있으신가요?{" "}
        <Link href="/login" className="font-extrabold text-maple-text-link">
          로그인
        </Link>
      </div>
    </div>
  );
}
