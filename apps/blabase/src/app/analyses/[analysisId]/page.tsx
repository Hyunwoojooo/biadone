import { ExtractionMonitor } from "@/components/extraction-monitor/ExtractionMonitor";

type AnalysisMessagesPageProps = {
  params: Promise<{
    analysisId: string;
  }>;
  searchParams: Promise<{
    tab?: string | string[];
    turn?: string | string[];
  }>;
};

export default async function AnalysisMessagesPage({
  params,
  searchParams
}: AnalysisMessagesPageProps) {
  const { analysisId } = await params;
  const query = await searchParams;
  const initialTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const rawTurn = Array.isArray(query.turn) ? query.turn[0] : query.turn;
  const parsedTurn = Number.parseInt(rawTurn ?? "", 10);

  return (
    <ExtractionMonitor
      analysisId={analysisId}
      initialTab={initialTab}
      initialTurnId={Number.isFinite(parsedTurn) ? parsedTurn : undefined}
    />
  );
}
