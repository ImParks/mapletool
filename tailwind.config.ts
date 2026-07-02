import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        maple: {
          // 기존 4개(다크 테마 잔재) — 지우지 않고 유지. 현재 화면들은 아래 라이트 토큰을 쓴다.
          orange: "#f5851f",
          dark: "#1a1c2b",
          card: "#23263a",
          border: "#33374f",

          // Brand — Design Tokens > Color > Brand
          "orange-hover": "#e0741a",
          "orange-pressed": "#c5610f",
          "orange-soft": "rgba(245,133,31,.12)",
          "orange-300": "#d9711a",

          // Surfaces
          surface: {
            app: "#eef1f8",
            sunken: "#e3e7f1",
            card: "#ffffff",
            raised: "#f5f7fc",
            overlay: "#ffffff",
            inset: "#eef1f7",
            scrim: "rgba(38,42,66,.42)",
          },

          // Border (기존 maple.border 는 dark 테마 문자열이라 그대로 두고,
          // 라이트 토큰 스케일은 별도 네임스페이스 line 으로 분리)
          line: {
            subtle: "#ebedf5",
            DEFAULT: "#dfe3ee",
            strong: "#c8cedd",
          },

          // Text
          text: {
            primary: "#2b3243",
            secondary: "#5b647a",
            muted: "#8b93a6",
            disabled: "#b3bacb",
            onaccent: "#2a1705",
            link: "#d9711a",
          },

          // Semantic
          success: {
            DEFAULT: "#22a06b",
            soft: "rgba(34,160,107,.13)",
            text: "#1b8a5c",
          },
          danger: {
            DEFAULT: "#e0455f",
            soft: "rgba(224,69,95,.12)",
          },
          warning: {
            DEFAULT: "#e0991b",
            soft: "rgba(224,153,27,.13)",
          },
          info: "#3f7ae0",

          // Category (일일/주간/보스 — 메인 화면 단계에서 본격적으로 쓰임)
          category: {
            daily: "#1f9e86",
            weekly: "#4577e0",
            boss: "#9a55d6",
          },
        },
      },
      fontFamily: {
        sans: [
          "Pretendard",
          "-apple-system",
          "BlinkMacSystemFont",
          "Apple SD Gothic Neo",
          "Malgun Gothic",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "SF Mono", "Menlo", "Consolas", "monospace"],
      },
      borderRadius: {
        // 입력/칩/행=12(xl), 카드/패널/상태창=16(2xl) 은 Tailwind 기본 스케일과 일치해 그대로 사용.
        // 히어로/이미지 슬롯(20px)만 기본 스케일에 없어 별도 추가. pill 은 rounded-full 사용.
        hero: "20px",
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        "glow-orange": "var(--glow-orange)",
        "glow-success": "var(--glow-success)",
        "inner-highlight": "var(--inner-highlight)",
      },
      transitionDuration: {
        120: "120ms",
        180: "180ms",
        280: "280ms",
      },
      transitionTimingFunction: {
        standard: "cubic-bezier(.4,0,.2,1)",
        out: "cubic-bezier(.16,1,.3,1)",
      },
      keyframes: {
        "maple-float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        "maple-spin": {
          to: { transform: "rotate(360deg)" },
        },
        "maple-pop": {
          from: { transform: "translateY(6px) scale(.98)" },
          to: { transform: "none" },
        },
        "maple-fade": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        "maple-float": "maple-float 4s ease-in-out infinite",
        "maple-spin": "maple-spin 0.82s linear",
        "maple-pop": "maple-pop 160ms cubic-bezier(.16,1,.3,1)",
        "maple-fade": "maple-fade 180ms cubic-bezier(.4,0,.2,1)",
      },
    },
  },
  plugins: [],
};

export default config;
