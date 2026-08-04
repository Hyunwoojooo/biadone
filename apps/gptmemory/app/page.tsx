import type { Metadata } from "next";
import { GPTMemoryApp } from "@/components/GPTMemoryApp";

export const metadata: Metadata = {
  title: "긴 대화의 핵심을 10초 안에",
  description:
    "ChatGPT 공유 대화의 핵심 내용과 주제별 맥락을 먼저 보여주고, 결정·할 일·근거를 함께 보존하는 대화 노트입니다.",
};

export default function Home() {
  return <GPTMemoryApp />;
}
