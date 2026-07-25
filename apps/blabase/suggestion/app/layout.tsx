import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "blabase suggestion",
  description: "여러 대화를 읽고 지금 가장 먼저 할 일을 제안합니다."
};

export const dynamic = "force-dynamic";

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
