import Link from "next/link";
import { Play } from "lucide-react";
import { buttonClassName } from "@/components/ui/Button";

export default function LandingPage() {
  return (
    <>
      <div className="flex w-full max-w-[440px] flex-col items-center gap-[22px] text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-[76px] w-[76px] animate-maple-float items-center justify-center rounded-[24px] bg-maple-orange shadow-glow-orange motion-reduce:animate-none">
            <svg
              width="42"
              height="42"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#2a1705"
              strokeWidth={3.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h1 className="mt-1.5 text-[40px] font-extrabold leading-[1.1] tracking-[-0.02em]">
            메이플 <span className="text-maple-orange">숙제</span> 헌터
          </h1>
          <p className="text-[15px] font-bold text-maple-text-secondary">매일 · 주간 · 보스 숙제를 한 눈에</p>
        </div>

        {/* 메인 비주얼(캐릭터 아트) 자리 — 넥슨 character_image 연동 전까지의 플레이스홀더 */}
        <div
          aria-hidden="true"
          className="flex h-[220px] w-full items-center justify-center rounded-hero border border-dashed border-maple-line bg-maple-surface-raised text-sm font-semibold text-maple-text-muted"
        >
          메인 비주얼 · 캐릭터 아트를 올려보세요
        </div>

        <div className="flex w-full flex-col gap-3">
          <Link href="/login" className={buttonClassName({ variant: "primary", size: "lg", block: true })}>
            <Play className="h-4 w-4" fill="currentColor" aria-hidden="true" />
            시작하기
          </Link>
          <p className="text-xs font-semibold text-maple-text-muted">로그인하고 내 캐릭터의 숙제를 관리하세요</p>
        </div>
      </div>

      <div className="fixed bottom-3.5 right-4 z-[2] font-mono text-[11px] text-maple-text-muted">
        v0.1 · KMS 기준
      </div>
    </>
  );
}
