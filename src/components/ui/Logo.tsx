import { cn } from "@/lib/cn";

interface LogoProps {
  size?: "sm" | "lg";
  className?: string;
}

const SIZE = {
  sm: { tile: "h-6 w-6 rounded-lg", icon: 14, text: "text-sm" },
  lg: { tile: "h-11 w-11 rounded-xl", icon: 22, text: "text-xl" },
} as const;

/**
 * 이미지 파일 없는 타입 기반 워드마크(오렌지 체크 타일 + "메이플 숙제"). 체크 글리프는
 * 브랜드 일관성을 위해 손으로 그린 인라인 SVG를 유지한다(lucide 아이콘으로 대체하지 않음).
 */
export function Logo({ size = "lg", className }: LogoProps) {
  const s = SIZE[size];
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className={cn(s.tile, "flex items-center justify-center bg-maple-orange shadow-glow-orange")}>
        <svg
          width={s.icon}
          height={s.icon}
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
      </span>
      <span className={cn(s.text, "font-extrabold tracking-tight text-maple-text-primary")}>메이플 숙제</span>
    </span>
  );
}
