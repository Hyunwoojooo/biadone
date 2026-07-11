import type { Metadata } from "next";

import { AtlasDashboard } from "@/components/atlas/AtlasDashboard";

export const metadata: Metadata = {
  title: "Conversation Atlas · T.I.V",
  description:
    "Explore conversations as connected territories, topics, decisions, and evidence."
};

export default function AtlasPage() {
  return <AtlasDashboard />;
}
