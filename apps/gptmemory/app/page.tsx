import type { Metadata } from "next";
import { GPTMemoryApp } from "@/components/GPTMemoryApp";

export const metadata: Metadata = {
  title: "대화를 다시 읽는 노트",
  description:
    "ChatGPT 공유 대화의 흐름과 맥락을 읽기 좋은 개인 노트로 정리합니다.",
};

export default function Home() {
  return <GPTMemoryApp />;
}
