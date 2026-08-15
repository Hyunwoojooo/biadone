import type { Metadata } from "next";

import { AttentionLab } from "./AttentionLab";

export const metadata: Metadata = {
  title: "Attention Lab · blabase",
  description:
    "blabase Attention Router의 실행 상태, 근거, coverage와 피드백을 확인합니다."
};

export default function AttentionLabPage() {
  return (
    <AttentionLab
      semanticWriteEnabled={
        process.env.BLABASE_SEMANTIC_CONTINUATION_WRITE_ENABLED === "true"
      }
    />
  );
}
