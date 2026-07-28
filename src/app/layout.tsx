import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppDialogProvider } from "@/components/AppDialogProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "메이플 숙제 헌터",
  description: "메이플스토리 일일·주간·보스 숙제를 한 눈에 체크하는 트래커",
  // 아이콘을 명시하지 않으면 브라우저가 /favicon.ico 를 요청하고, 그 파일이 없어 콘솔에
  // 404 가 남는다(public/ 에는 icon.svg 만 있다). manifest.ts 와 같은 파일을 가리킨다.
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5851f",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* Pretendard 웹폰트 — 새 npm 의존성 없이 CDN link 로 로드 */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css"
        />
      </head>
      <body className="min-h-screen bg-maple-surface-app font-sans text-maple-text-primary antialiased">
        {/* 에러/안내를 인라인 배너가 아니라 모달로 띄우기 위한 전역 제공자.
            처리되지 않은 런타임 오류도 여기서 잡아 모달로 알려준다. */}
        <AppDialogProvider>{children}</AppDialogProvider>
      </body>
    </html>
  );
}
