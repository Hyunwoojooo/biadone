import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const origin = requestOrigin(requestHeaders);
  const socialImage = new URL("/og.png", origin).toString();

  return {
    metadataBase: new URL(origin),
    title: {
      default: "GPTMemory — 대화가 도달한 상태를 10초 안에",
      template: "%s · GPTMemory",
    },
    description:
      "ChatGPT 공유 대화의 현재 상태, 확정된 결정, 완료된 결과와 남은 판단을 근거가 연결된 노트로 복원합니다.",
    openGraph: {
      title: "GPTMemory — 대화가 도달한 상태를 10초 안에",
      description:
        "긴 대화가 도달한 현재 상태와 다음 판단을 빠르게 복원하는 상태 노트.",
      type: "website",
      locale: "ko_KR",
      images: [
        {
          url: socialImage,
          width: 1731,
          height: 909,
          alt: "GPTMemory 대화 노트 인터페이스",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "GPTMemory — 대화가 도달한 상태를 10초 안에",
      description:
        "긴 대화가 도달한 현재 상태와 다음 판단을 빠르게 복원하는 상태 노트.",
      images: [socialImage],
    },
  };
}

function requestOrigin(requestHeaders: Headers): string {
  const forwardedHost = requestHeaders
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const host = forwardedHost ?? requestHeaders.get("host")?.trim();
  const forwardedProtocol = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : host?.startsWith("localhost")
        ? "http"
        : "https";

  if (!host || !/^[A-Za-z0-9.:[\]-]+$/.test(host)) {
    return "https://gptmemory.openai.site";
  }

  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return "https://gptmemory.openai.site";
  }
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
