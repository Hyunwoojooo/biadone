import type { Metadata } from "next";
import { GPTMemoryApp } from "@/components/GPTMemoryApp";

export const metadata: Metadata = {
  title: "대화가 도달한 상태를 10초 안에",
  description:
    "ChatGPT 공유 대화의 현재 상태, 확정된 결정, 완료된 결과와 남은 판단을 근거가 연결된 노트로 복원합니다.",
};

export default function Home() {
  return <GPTMemoryApp />;
}
