"use client";

import { CircleX, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { ThreadStructure } from "@/components/extraction-monitor/ThreadStructure";
import {
  buildMonitorTurns,
  type MonitorMessage
} from "@/components/extraction-monitor/monitorModel";
import type {
  ConversationSource,
  ConversationStats
} from "@/core/types/conversation";
import type { HybridExtractionResult } from "@/core/types/semantic";

import { ATLAS_DEMO_STRUCTURE } from "./atlasDemoStructure";
import styles from "./AtlasStructurePage.module.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const LAST_ANALYSIS_KEY = "blabase:last-atlas-analysis";

type ResultResponse = {
  analysisId: string;
  status: "completed" | "failed";
  sprint5?: HybridExtractionResult | null;
  error?: { message?: string };
};

type MessagesResponse = {
  analysisId: string;
  status: "completed" | "failed";
  conversation?: {
    title?: string | null;
    stats?: ConversationStats;
    source?: ConversationSource;
  };
  messages?: MonitorMessage[];
  error?: { message?: string };
};

type AtlasData = {
  result: ResultResponse;
  messages: MessagesResponse;
};

export function AtlasStructurePage({
  initialAnalysisId
}: {
  initialAnalysisId: string | null;
}) {
  const router = useRouter();
  const [analysisId, setAnalysisId] = useState(initialAnalysisId);
  const [manualId, setManualId] = useState(initialAnalysisId ?? "");
  const [data, setData] = useState<AtlasData | null>(null);
  const [loading, setLoading] = useState(Boolean(initialAnalysisId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialAnalysisId) {
      setAnalysisId(initialAnalysisId);
      setManualId(initialAnalysisId);
      return;
    }

    const savedId = window.localStorage.getItem(LAST_ANALYSIS_KEY);
    if (savedId) {
      setAnalysisId(savedId);
      setManualId(savedId);
      setLoading(true);
      router.replace(`/atlas?analysisId=${encodeURIComponent(savedId)}`);
    } else {
      setLoading(false);
    }
  }, [initialAnalysisId, router]);

  useEffect(() => {
    if (!analysisId) return;
    const requestedAnalysisId = analysisId;
    let cancelled = false;

    async function loadAtlas() {
      setLoading(true);
      setError(null);
      setData(null);

      try {
        const [resultResponse, messagesResponse] = await Promise.all([
          fetch(`${basePath}/api/analyses/${requestedAnalysisId}/result`),
          fetch(`${basePath}/api/analyses/${requestedAnalysisId}/messages`)
        ]);
        const [resultPayload, messagesPayload] = (await Promise.all([
          resultResponse.json(),
          messagesResponse.json()
        ])) as [ResultResponse, MessagesResponse];

        if (!resultResponse.ok || resultPayload.status === "failed") {
          throw new Error(
            resultPayload.error?.message ?? "분석 결과를 불러오지 못했습니다."
          );
        }
        if (!messagesResponse.ok || messagesPayload.status === "failed") {
          throw new Error(
            messagesPayload.error?.message ?? "대화 원문을 불러오지 못했습니다."
          );
        }

        if (!cancelled) {
          window.localStorage.setItem(LAST_ANALYSIS_KEY, requestedAnalysisId);
          setData({ result: resultPayload, messages: messagesPayload });
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Structure Map을 불러오지 못했습니다."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadAtlas();
    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  const turns = useMemo(
    () => buildMonitorTurns(data?.messages.messages ?? []),
    [data?.messages.messages]
  );

  function openAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextId = manualId.trim();
    if (!nextId) return;
    setAnalysisId(nextId);
    router.push(`/atlas?analysisId=${encodeURIComponent(nextId)}`);
  }

  if (loading) {
    return (
      <AtlasState
        icon={<LoaderCircle size={24} className={styles.spinning} />}
        eyebrow="STRUCTURE MAP"
        title="대화 구조를 연결하는 중입니다"
        description="메시지와 검증된 의미 항목을 불러오고 있습니다."
      />
    );
  }

  if (!analysisId) {
    return (
      <ThreadStructure
        standalone
        demo
        actionHref={basePath || "/"}
        analysisId="demo"
        title="Demo · Codex CLI relay"
        turns={[]}
        sprint5={null}
        structureOverride={ATLAS_DEMO_STRUCTURE}
      />
    );
  }

  if (!data || error) {
    return (
      <AtlasState
        icon={<CircleX size={24} />}
        eyebrow="ATLAS UNAVAILABLE"
        title={error ?? "분석 결과가 없습니다"}
        description="서버가 재시작되면 메모리에 있던 분석이 만료될 수 있습니다. 새 링크를 분석하거나 다른 분석 ID를 입력하세요."
      >
        <form className={styles.inlineForm} onSubmit={openAnalysis}>
          <input
            value={manualId}
            onChange={(event) => setManualId(event.target.value)}
            aria-label="분석 ID"
            placeholder="ana_..."
          />
          <button type="submit">다시 열기</button>
        </form>
        <a href={basePath || "/"} className={styles.secondaryLink}>
          새 대화 분석
        </a>
      </AtlasState>
    );
  }

  return (
    <ThreadStructure
      standalone
      analysisId={analysisId}
      title={data.messages.conversation?.title ?? null}
      turns={turns}
      sprint5={data.result.sprint5 ?? null}
      onOpenTurn={(turnId) =>
        router.push(
          `/analyses/${analysisId}?tab=turns&turn=${encodeURIComponent(turnId)}`
        )
      }
    />
  );
}

function AtlasState({
  icon,
  eyebrow,
  title,
  description,
  children
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <main className={styles.statePage}>
      <div className={styles.ambient} />
      <section className={styles.stateCard}>
        <span className={styles.stateIcon}>{icon}</span>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p className={styles.description}>{description}</p>
        {children}
      </section>
    </main>
  );
}
