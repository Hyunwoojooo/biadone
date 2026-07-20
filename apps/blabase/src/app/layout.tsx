import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./global.css";

export const metadata: Metadata = {
  title: "blabase — ChatGPT 대화 구조화",
  description:
    "ChatGPT 공유 링크의 대화를 복원하고 Turn, 구조, 근거로 정리합니다."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
