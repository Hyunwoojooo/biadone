"use client";

import { useEffect, useState } from "react";

import type { CanonicalMessage, ConversationStats } from "@/core/types/conversation";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type MessagesResponse = {
  analysisId: string;
  status: "completed" | "failed";
  conversation?: {
    title: string | null;
    stats: ConversationStats;
  };
  messages?: Pick<
    CanonicalMessage,
    "id" | "index" | "role" | "text" | "blocks" | "sourceRef"
  >[];
  error?: {
    code: string;
    message: string;
  };
};

export function MessageViewer({ analysisId }: { analysisId: string }) {
  const [data, setData] = useState<MessagesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadMessages() {
      try {
        const response = await fetch(
          `${basePath}/api/analyses/${analysisId}/messages`
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

  const messages = data?.messages ?? [];

  return (
    <section>
      <header style={{ marginBottom: 24 }}>
        <h1>복원된 대화 메시지</h1>
        <p style={{ color: "#555" }}>
          총 {data?.conversation?.stats.totalMessages ?? messages.length}개 메시지
        </p>
      </header>

      <div style={{ display: "grid", gap: 16 }}>
        {messages.map((message) => (
          <article
            key={message.id}
            style={{
              border: "1px solid #d4d4d4",
              borderRadius: 8,
              padding: 16,
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
              <strong>{message.role}</strong>
              <span>#{message.index}</span>
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

              if (block.type === "unsupported") {
                return (
                  <p
                    key={`${message.id}-block-${index}`}
                    style={{ color: "#666", whiteSpace: "pre-wrap", lineHeight: 1.6 }}
                  >
                    {block.text}
                  </p>
                );
              }

              return (
                <p
                  key={`${message.id}-block-${index}`}
                  style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}
                >
                  {block.text}
                </p>
              );
            })}
          </article>
        ))}
      </div>
    </section>
  );
}
