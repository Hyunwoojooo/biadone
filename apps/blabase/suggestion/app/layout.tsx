import type { Metadata } from "next";

import { AppHeader } from "./AppHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "blabase Work Cockpit",
  description:
    "연결된 GitHub 작업과 Codex 실행 현황에서 지금 개입할 한 가지를 제안합니다."
};

export const dynamic = "force-dynamic";

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
