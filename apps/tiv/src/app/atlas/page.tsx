import type { Metadata } from "next";

import { AtlasStructurePage } from "@/components/atlas/AtlasStructurePage";

export const metadata: Metadata = {
  title: "Thread Structure Atlas · T.I.V",
  description:
    "Explore a ChatGPT conversation as connected concepts, evidence, and turns."
};

type AtlasPageProps = {
  searchParams: Promise<{
    analysisId?: string | string[];
  }>;
};

export default async function AtlasPage({ searchParams }: AtlasPageProps) {
  const query = await searchParams;
  const analysisId = Array.isArray(query.analysisId)
    ? (query.analysisId[0] ?? null)
    : (query.analysisId ?? null);

  return <AtlasStructurePage initialAnalysisId={analysisId} />;
}
