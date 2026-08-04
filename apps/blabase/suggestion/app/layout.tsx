import type { Metadata } from "next";

import { DashboardShell } from "./DashboardShell";
import "./globals.css";
import "./v3.css";

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
        <DashboardShell>{children}</DashboardShell>
      </body>
    </html>
  );
}
