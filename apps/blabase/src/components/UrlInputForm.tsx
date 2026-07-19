"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function UrlInputForm() {
  const router = useRouter();
  const [shareUrl, setShareUrl] = useState("");
  const [error, setError] = useState<{
    message: string;
    code?: string;
    detail?: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<"idle" | "analysis" | "sheet">("idle");
  const [completedAnalysisId, setCompletedAnalysisId] = useState<string | null>(
    null
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCompletedAnalysisId(null);
    setSubmitting(true);
    setPhase("analysis");

    try {
      const response = await fetch("/api/analyses", {
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

      setPhase("sheet");
      const sheetResponse = await fetch(
        `/api/analyses/${data.analysisId}/golden-sheet`,
        { method: "POST" }
      );
      const sheetData = (await sheetResponse.json()) as {
        status?: "created" | "duplicate";
        error?: { message?: string; code?: string };
      };
      if (!sheetResponse.ok || !sheetData.status) {
        setCompletedAnalysisId(data.analysisId);
        setError({
          message: `분석은 완료됐지만 Sheet 자동 등록에 실패했습니다. ${sheetData.error?.message ?? "분석 결과 화면에서 다시 시도해주세요."}`,
          code: sheetData.error?.code
        });
        return;
      }

      router.push(`/atlas?analysisId=${encodeURIComponent(data.analysisId)}`);
    } catch {
      setError({ message: "네트워크 오류로 분석을 시작하지 못했습니다." });
    } finally {
      setSubmitting(false);
      setPhase("idle");
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
        공유 링크의 대화를 분석한 뒤 Golden Dataset Sheet에 세션과 빈 판정 행을
        자동 등록합니다. 민감한 개인정보, 비밀번호, API 키, 고객정보가 포함된
        대화는 입력하지 마세요.
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
          {completedAnalysisId ? (
            <>
              <br />
              <a
                href={`/atlas?analysisId=${encodeURIComponent(completedAnalysisId)}`}
              >
                완료된 Structure Map에서 다시 시도
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      <button type="submit" disabled={submitting}>
        {phase === "analysis"
          ? "대화 분석 중..."
          : phase === "sheet"
            ? "Sheet 등록 중..."
            : "분석 및 Sheet 등록"}
      </button>
    </form>
  );
}
