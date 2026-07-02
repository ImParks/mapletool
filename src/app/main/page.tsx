import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

/**
 * TODO(다음 단계): 이 페이지는 로그인/회원가입 성공 후 리다이렉트 대상이 404 나지 않도록 만든
 * 임시 자리표시 화면이다. 실제로는 "월드 선택 + 캐릭터 슬라이더 + 인라인 숙제 상세" 메인
 * 화면(핸드오프 문서 #5)으로 교체될 예정이며, 그때 인증 가드(비로그인 접근 차단)도 함께
 * 다뤄야 한다.
 */
export default function MainPlaceholderPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-5 py-10 text-center">
      <Logo size="lg" />
      <h1 className="text-xl font-extrabold text-maple-text-primary">메인 화면 준비 중이에요</h1>
      <p className="max-w-[32ch] text-sm leading-relaxed text-maple-text-secondary">
        로그인에 성공했습니다. 월드 · 캐릭터별 숙제 화면은 다음 업데이트에서 만나보실 수 있어요.
      </p>
      <Link href="/" className="text-sm font-bold text-maple-text-link">
        랜딩으로 돌아가기
      </Link>
    </div>
  );
}
