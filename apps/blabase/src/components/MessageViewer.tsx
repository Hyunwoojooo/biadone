"use client";

import { useEffect, useState } from "react";

import type { CanonicalMessage, ConversationStats } from "@/core/types/conversation";

type MessagesResponse = {
  analysisId: string;
  status: "completed" | "failed";
  conversation?: {
    title: string | null;
    stats: ConversationStats;
  };
  messages?: Pick<
    CanonicalMessage,
    | "id"
    | "index"
    | "role"
    | "createdAt"
    | "updatedAt"
    | "text"
    | "blocks"
    | "sourceRef"
    | "metadata"
  >[];
  groups?: {
    cleanConversation: MessageItem[];
    contextSignals: MessageItem[];
    excludedInternal: MessageItem[];
  };
  error?: {
    code: string;
    message: string;
  };
};

type MessageItem = Pick<
  CanonicalMessage,
  | "id"
  | "index"
  | "role"
  | "createdAt"
  | "updatedAt"
  | "text"
  | "blocks"
  | "sourceRef"
  | "metadata"
>;

export function MessageViewer({ analysisId }: { analysisId: string }) {
  const [data, setData] = useState<MessagesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadMessages() {
      try {
        const response = await fetch(
          `/api/analyses/${analysisId}/messages`
        );
        const payload = (await response.json()) as MessagesResponse;

        if (cancelled) {
          return;
        }

        if (!response.ok || payload.status === "failed") {
          setError(payload.error?.message ?? "메시지를 불러오지 못했습니다.");
          return;
        }

        setData(payload);
      } catch {
        if (!cancelled) {
          setError("메시지를 불러오지 못했습니다.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadMessages();

    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  if (loading) {
    return <p>메시지를 불러오는 중...</p>;
  }

  if (error) {
    return (
      <p role="alert" style={{ color: "#b42318" }}>
        {error}
      </p>
    );
  }

  const cleanMessages =
    data?.groups?.cleanConversation ??
    (data?.messages ?? []).filter(
      (message) => message.metadata.messageCategory === "clean_conversation"
    );
  const contextSignals =
    data?.groups?.contextSignals ??
    (data?.messages ?? []).filter(
      (message) => message.metadata.messageCategory === "context_signal"
    );
  const excludedInternal =
    data?.groups?.excludedInternal ??
    (data?.messages ?? []).filter(
      (message) => message.metadata.messageCategory === "excluded_internal"
    );
  const totalMessages =
    data?.conversation?.stats.totalMessages ??
    cleanMessages.length + contextSignals.length + excludedInternal.length;

  return (
    <section>
      <header style={{ marginBottom: 24 }}>
        <h1>Clean Conversation</h1>
        <p style={{ color: "#555" }}>
          실제 대화 {cleanMessages.length}개 표시 중. Context Signals{" "}
          {contextSignals.length}개, 내부 메시지 {excludedInternal.length}개는 접어뒀습니다.
        </p>
        <p style={{ color: "#777", fontSize: 14 }}>전체 복원 메시지 {totalMessages}개</p>
        <p style={{ color: "#777", fontSize: 14 }}>
          대화 시간: {formatKstTimestamp(data?.conversation?.stats.startedAt)} →{" "}
          {formatKstTimestamp(data?.conversation?.stats.endedAt)} ·{" "}
          {formatElapsedSeconds(data?.conversation?.stats.durationSeconds)}
        </p>
      </header>

      <MessageList messages={cleanMessages} />

      <details style={{ marginTop: 32 }}>
        <summary>Context Signals {contextSignals.length}개</summary>
        <p style={{ color: "#666" }}>
          검색어, 열린 출처, 클릭/찾기 같은 맥락 분석용 보조 신호입니다.
        </p>
        <MessageList messages={contextSignals} compact />
      </details>

      <details style={{ marginTop: 24 }}>
        <summary>Excluded/Internal {excludedInternal.length}개</summary>
        <p style={{ color: "#666" }}>
          thoughts, reasoning recap, model context 같은 내부 메시지입니다.
        </p>
        <MessageList messages={excludedInternal} compact />
      </details>
    </section>
  );
}

function MessageList({
  messages,
  compact = false
}: {
  messages: MessageItem[];
  compact?: boolean;
}) {
  if (messages.length === 0) {
    return <p style={{ color: "#777" }}>표시할 메시지가 없습니다.</p>;
  }

  return (
    <div style={{ display: "grid", gap: compact ? 10 : 16, marginTop: 16 }}>
      {messages.map((message) => (
        <article
          key={message.id}
          style={{
            border: "1px solid #d4d4d4",
            borderRadius: 8,
            padding: compact ? 12 : 16,
            background: message.role === "user" ? "#f7fafc" : "#fff"
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 12,
              color: "#555",
              fontSize: 14
            }}
          >
            <strong>
              {message.role}
              {message.metadata.contextSignalType
                ? ` · ${message.metadata.contextSignalType}`
                : ""}
              {message.metadata.internalContentType
                ? ` · ${message.metadata.internalContentType}`
                : ""}
            </strong>
            <span title={message.createdAt ?? undefined}>
              #{message.index} · {formatKstTimestamp(message.createdAt)}
            </span>
          </div>
          {message.blocks.map((block, index) => {
            if (block.type === "code") {
              return (
                <pre
                  key={`${message.id}-block-${index}`}
                  style={{
                    overflowX: "auto",
                    padding: 12,
                    background: "#111827",
                    color: "#f9fafb",
                    borderRadius: 6
                  }}
                >
                  <code>{block.text}</code>
                </pre>
              );
            }

            if (block.type === "list") {
              const ListTag = block.ordered ? "ol" : "ul";
              return (
                <ListTag
                  key={`${message.id}-block-${index}`}
                  style={{ lineHeight: 1.6 }}
                >
                  {block.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ListTag>
              );
            }

            return (
              <p
                key={`${message.id}-block-${index}`}
                style={{
                  color: block.type === "unsupported" ? "#666" : undefined,
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.6
                }}
              >
                {block.text}
              </p>
            );
          })}
        </article>
      ))}
    </div>
  );
}

function formatKstTimestamp(value: string | null | undefined): string {
  if (!value) return "시간 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "시간 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function formatElapsedSeconds(value: number | null | undefined): string {
  if (value === null || value === undefined) return "경과시간 없음";
  const days = Math.floor(value / 86_400);
  const hours = Math.floor((value % 86_400) / 3_600);
  const minutes = Math.floor((value % 3_600) / 60);
  return [days ? `${days}일` : "", hours ? `${hours}시간` : "", `${minutes}분`]
    .filter(Boolean)
    .join(" ");
}
