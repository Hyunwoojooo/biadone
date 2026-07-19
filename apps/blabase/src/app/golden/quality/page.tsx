import type { Metadata } from "next";

import { GoldenQualityDashboard } from "@/components/golden-quality/GoldenQualityDashboard";

export const metadata: Metadata = {
  title: "Golden Dataset Quality · blabase",
  description:
    "Inspect the latest sanitized Golden Dataset quality report and review targets."
};

export default function GoldenQualityPage() {
  return <GoldenQualityDashboard />;
}
