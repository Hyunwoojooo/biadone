"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function UrlInputForm() {
  const router = useRouter();
  const [shareUrl, setShareUrl] = useState("");
  const [error, setError] = useState<{
    message: string;
    code?: string;
    detail?: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch(`${basePath}/api/analyses`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ shareUrl })
      });
      const data = (await response.json()) as {
        analysisId?: string;
        status?: string;
        error?: { message?: string; code?: string; detail?: string };
      };

      if (!response.ok || !data.analysisId || data.status === "failed") {
        setError({
          message: data.error?.message ?? "분석을 시작하지 못했습니다.",
          code: data.error?.code,
          detail: data.error?.detail
        });
        return;
      }

      router.push(`/analyses/${data.analysisId}`);
    } catch {
      setError({ message: "네트워크 오류로 분석을 시작하지 못했습니다." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="share-url">ChatGPT 공유 링크</label>
      <input
        id="share-url"
        name="shareUrl"
        type="url"
        value={shareUrl}
        onChange={(event) => setShareUrl(event.target.value)}
        placeholder="https://chatgpt.com/share/..."
        required
        style={{
          display: "block",
          width: "100%",
          marginTop: 8,
          padding: 12,
          border: "1px solid #d4d4d4",
          borderRadius: 6
        }}
      />
      <p style={{ color: "#555", lineHeight: 1.5 }}>
        공유 링크에 포함된 대화 내용을 분석합니다. 민감한 개인정보,
        비밀번호, API 키, 고객정보가 포함된 대화는 입력하지 마세요.
      </p>
      {error ? (
        <p role="alert" style={{ color: "#b42318" }}>
          {error.message}
          {error.code ? (
            <>
              <br />
              <small>code: {error.code}</small>
            </>
          ) : null}
          {error.detail ? (
            <>
              <br />
              <small>detail: {error.detail}</small>
            </>
          ) : null}
        </p>
      ) : null}
      <button type="submit" disabled={submitting}>
        {submitting ? "분석 중..." : "분석 시작"}
      </button>
    </form>
  );
}
