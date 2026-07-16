import { ExtractionMonitor } from "@/components/extraction-monitor/ExtractionMonitor";

type AnalysisMessagesPageProps = {
  params: Promise<{
    analysisId: string;
  }>;
};

export default async function AnalysisMessagesPage({
  params
}: AnalysisMessagesPageProps) {
  const { analysisId } = await params;

  return <ExtractionMonitor analysisId={analysisId} />;
}
