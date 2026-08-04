"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import type {
  PrioritySuggestionResult,
  SourceStatus
} from "../src/types";

const MIN_URLS = 3;
const MAX_URLS = 10;
const PROGRESS_MESSAGES = [
  "대화를 복원하고 있어요",
  "할 일을 찾고 있어요",
  "대화 사이의 반복 신호를 확인하고 있어요",
  "가장 먼저 할 일을 고르고 있어요"
];

type ApiError = {
  error: {
    code: string;
    message: string;
    details?: Array<{ inputIndex: number; code: string }>;
  };
  sources?: SourceStatus[];
};

export default function LegacySuggestion() {
  const [urls, setUrls] = useState(["", "", ""]);
  const [sameUserConfirmed, setSameUserConfirmed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);
  const [result, setResult] = useState<PrioritySuggestionResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const clientErrors = useMemo(() => validateUrls(urls), [urls]);
  const canSubmit =
    sameUserConfirmed &&
    clientErrors.every((message) => message === null) &&
    urls.filter((url) => url.trim()).length >= MIN_URLS &&
    !isSubmitting;

  useEffect(() => {
    if (!isSubmitting) {
      setProgressIndex(0);
      return;
    }
    const interval = window.setInterval(() => {
      setProgressIndex(
        (current) => (current + 1) % PROGRESS_MESSAGES.length
      );
    }, 2600);
    return () => window.clearInterval(interval);
  }, [isSubmitting]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setResult(null);
    setError(null);

    try {
      const response = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shareUrls: urls.map((url) => url.trim()).filter(Boolean),
          sameUserConfirmed
        })
      });
      const payload = (await response.json()) as
        | PrioritySuggestionResult
        | ApiError;
      if (!response.ok || "error" in payload) {
        setError(payload as ApiError);
        return;
      }
      setResult(payload);
    } catch {
      setError({
        error: {
          code: "NETWORK_ERROR",
          message: "로컬 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요."
        }
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function updateUrl(index: number, value: string) {
    setUrls((current) =>
      current.map((url, itemIndex) => (itemIndex === index ? value : url))
    );
  }

  return (
    <main className="shell" id="main-content">
      <header className="intro">
        <p className="eyebrow">Legacy prototype</p>
        <h1>기존 ChatGPT 대화 분석</h1>
        <p className="lead">
          conversation-only 제안 경로를 비교와 회귀 확인을 위해 별도
          화면에 보존합니다.
        </p>
      </header>

      <form className="inputSection" onSubmit={handleSubmit} noValidate>
        <div className="sectionHeading">
          <h2>대화 링크</h2>
          <span>
            {urls.length}/{MAX_URLS}
          </span>
        </div>

        <div className="urlList">
          {urls.map((url, index) => (
            <div className="urlField" key={index}>
              <label htmlFor={`share-url-${index}`}>
                ChatGPT URL {index + 1}
              </label>
              <input
                id={`share-url-${index}`}
                type="url"
                inputMode="url"
                placeholder="https://chatgpt.com/share/..."
                value={url}
                onChange={(event) => updateUrl(index, event.target.value)}
                disabled={isSubmitting}
                aria-describedby={
                  clientErrors[index] ? `url-error-${index}` : undefined
                }
                aria-invalid={Boolean(clientErrors[index])}
              />
              {clientErrors[index] ? (
                <p className="fieldError" id={`url-error-${index}`}>
                  {clientErrors[index]}
                </p>
              ) : null}
            </div>
          ))}
        </div>

        {urls.length < MAX_URLS ? (
          <button
            className="textButton"
            type="button"
            onClick={() => setUrls((current) => [...current, ""])}
            disabled={isSubmitting}
          >
            + URL 추가
          </button>
        ) : null}

        <label className="confirmation">
          <input
            type="checkbox"
            checked={sameUserConfirmed}
            onChange={(event) => setSameUserConfirmed(event.target.checked)}
            disabled={isSubmitting}
          />
          <span>모두 같은 사용자의 대화입니다.</span>
        </label>

        <button className="submitButton" type="submit" disabled={!canSubmit}>
          {isSubmitting ? PROGRESS_MESSAGES[progressIndex] : "제안 받기"}
        </button>
        <p className="privacyNote">
          이 프로토타입은 제안만 만들며, 어떤 일도 자동으로 실행하지 않습니다.
        </p>
      </form>

      {error ? <ErrorResult error={error} /> : null}
      {result ? <SuggestionResult result={result} /> : null}
    </main>
  );
}

function SuggestionResult({
  result
}: {
  result: PrioritySuggestionResult;
}) {
  if (result.status === "insufficient_evidence") {
    return (
      <section className="resultSection" aria-live="polite">
        <p className="eyebrow">분석 결과</p>
        <h2>아직 가장 먼저 할 일을 정하기 어려워요.</h2>
        <p>
          {insufficientEvidenceReason(result.decisionDiagnostics)}
        </p>
        <details className="decisionDiagnostics">
          <summary>판단 기준 보기</summary>
          <ul>
            <li>
              task 후보 {result.decisionDiagnostics.mergedCandidateCount}개
            </li>
            <li>
              추천 가능 {result.decisionDiagnostics.eligibleCount}개 · 검토
              필요 {result.decisionDiagnostics.reviewRequiredCount}개 · 제외{" "}
              {result.decisionDiagnostics.ineligibleCount}개
            </li>
            <li>
              최고 점수{" "}
              {result.decisionDiagnostics.highestEligibleScore ?? "없음"} ·
              추천 기준 {result.decisionDiagnostics.minimumSuggestionScore}
            </li>
          </ul>
        </details>
        <SourceSummary sources={result.sources} />
      </section>
    );
  }

  if (result.status === "needs_clarification") {
    return (
      <section className="resultSection" aria-live="polite">
        <p className="eyebrow">한 가지 확인이 필요해요</p>
        <h2>{result.clarificationQuestion}</h2>
        <AlternativeList alternatives={result.alternatives} />
        <SourceSummary sources={result.sources} />
      </section>
    );
  }

  const suggestion = result.topSuggestion;
  if (!suggestion) return null;

  return (
    <section className="resultSection" aria-live="polite">
      <p className="eyebrow">지금 가장 먼저 할 일</p>
      <h2 className="suggestionTitle">{suggestion.title}</h2>
      <p className="whyNow">{suggestion.whyNow}</p>

      <div className="firstStep">
        <span>첫 단계</span>
        <p>{suggestion.firstStep}</p>
      </div>

      <details className="evidence">
        <summary>
          근거 보기 · {suggestion.sourceConversationCount}개 대화
        </summary>
        <ul>
          {suggestion.evidence.slice(0, 8).map((item) => (
            <li
              key={`${item.conversationId}-${item.messageId}-${item.startChar}`}
            >
              “{item.quote}”
            </li>
          ))}
        </ul>
      </details>

      <AlternativeList alternatives={result.alternatives} />
      <SourceSummary sources={result.sources} />
    </section>
  );
}

function insufficientEvidenceReason(
  diagnostics: PrioritySuggestionResult["decisionDiagnostics"]
): string {
  if (diagnostics.mergedCandidateCount === 0) {
    return "세 대화에서 현재 사용자가 직접 처리해야 할 미완료 task를 찾지 못했습니다.";
  }
  if (diagnostics.eligibleCount === 0 && diagnostics.reviewRequiredCount > 0) {
    return "task 후보는 찾았지만 원문 근거 또는 상태가 충분히 확실하지 않아 추천을 보류했습니다.";
  }
  if (diagnostics.eligibleCount === 0) {
    return "찾은 task가 이미 완료·취소됐거나 사용자가 직접 처리할 일이 아니어서 추천에서 제외했습니다.";
  }
  if (
    diagnostics.highestEligibleScore !== null &&
    diagnostics.highestEligibleScore < diagnostics.minimumSuggestionScore
  ) {
    return `추천 가능한 후보는 있었지만 최고 우선순위 점수 ${diagnostics.highestEligibleScore}점이 기준 ${diagnostics.minimumSuggestionScore}점보다 낮았습니다.`;
  }
  return "현재 근거만으로는 한 가지 일을 안전하게 최우선으로 정하기 어려웠습니다.";
}

function AlternativeList({
  alternatives
}: {
  alternatives: PrioritySuggestionResult["alternatives"];
}) {
  if (alternatives.length === 0) return null;
  return (
    <div className="alternatives">
      <h3>다른 후보</h3>
      <ol>
        {alternatives.map((alternative) => (
          <li key={alternative.candidateId}>{alternative.title}</li>
        ))}
      </ol>
    </div>
  );
}

function SourceSummary({ sources }: { sources: SourceStatus[] }) {
  const restored = sources.filter((source) => source.status === "restored");
  const failed = sources.filter((source) => source.status === "failed");
  return (
    <details className="sourceSummary">
      <summary>
        대화 {restored.length}개 분석
        {failed.length > 0 ? ` · ${failed.length}개 실패` : ""}
      </summary>
      <ul>
        {sources.map((source) => (
          <li key={source.inputIndex}>
            URL {source.inputIndex + 1}:{" "}
            {source.status === "restored"
              ? `${source.messageCount ?? 0}개 메시지 복원`
              : source.errorMessage}
          </li>
        ))}
      </ul>
    </details>
  );
}

function ErrorResult({ error }: { error: ApiError }) {
  return (
    <section className="errorSection" role="alert">
      <p className="eyebrow">확인이 필요해요</p>
      <h2>{error.error.message}</h2>
      {error.error.details && error.error.details.length > 0 ? (
        <ul className="diagnosticList">
          {error.error.details.map((detail) => (
            <li key={`${detail.inputIndex}-${detail.code}`}>
              URL {detail.inputIndex + 1}: {diagnosticMessage(detail.code)}
            </li>
          ))}
        </ul>
      ) : null}
      {error.sources ? <SourceSummary sources={error.sources} /> : null}
    </section>
  );
}

function diagnosticMessage(code: string): string {
  switch (code) {
    case "LLM_SCHEMA_INVALID":
      return "Gemini 응답 형식이 예상한 구조와 달랐습니다.";
    case "PROVIDER_REQUEST_FAILED":
      return "Gemini API 요청이 실패했습니다.";
    case "PROVIDER_INVALID_RESPONSE":
      return "Gemini 응답 내용을 읽지 못했습니다.";
    default:
      return "대화의 task 신호를 추출하지 못했습니다.";
  }
}

function validateUrls(urls: string[]): Array<string | null> {
  const normalizedValues = new Map<string, number>();
  return urls.map((value, index) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return index < MIN_URLS ? "공유 URL을 입력해주세요." : null;
    }
    try {
      const url = new URL(trimmed);
      if (
        url.protocol !== "https:" ||
        !["chatgpt.com", "www.chatgpt.com"].includes(
          url.hostname.toLowerCase()
        ) ||
        !/^\/share\/[^/]+\/?$/.test(url.pathname)
      ) {
        return "https://chatgpt.com/share/... 형식이어야 합니다.";
      }
      const key = `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(
        /\/$/,
        ""
      )}`;
      if (normalizedValues.has(key)) return "이미 입력한 URL입니다.";
      normalizedValues.set(key, index);
      return null;
    } catch {
      return "올바른 URL을 입력해주세요.";
    }
  });
}
