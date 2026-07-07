import Link from "next/link";

import { MessageViewer } from "@/components/MessageViewer";
import { StructureResultViewer } from "@/components/StructureResultViewer";

type AnalysisMessagesPageProps = {
  params: Promise<{
    analysisId: string;
  }>;
};

export default async function AnalysisMessagesPage({
  params
}: AnalysisMessagesPageProps) {
  const { analysisId } = await params;

  return (
    <main style={{ maxWidth: 960, margin: "48px auto", padding: 24 }}>
      <p>
        <Link href="/">새 링크 분석</Link>
      </p>
      <StructureResultViewer analysisId={analysisId} />
      <MessageViewer analysisId={analysisId} />
    </main>
  );
}
