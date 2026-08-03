import type { Metadata } from "next";
import { GPTMemoryApp } from "@/components/GPTMemoryApp";

export const metadata: Metadata = {
  title: "대화의 핵심을 10초 안에",
  description:
    "ChatGPT 공유 대화의 핵심, 결정, 제안과 할 일을 근거가 연결된 개인 노트로 압축합니다.",
};

export default function Home() {
  return <GPTMemoryApp />;
}
