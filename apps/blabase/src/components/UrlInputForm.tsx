"use client";

import {
  AlertTriangle,
  ArrowRight,
  Link2,
  LoaderCircle,
  ShieldCheck
} from "lucide-react";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import type { AnalysisMonitorPayload } from "@/core/transport/analysisMonitorPayload";

import { cacheAnalysisMonitorPayload } from "./extraction-monitor/analysisSessionCache";
import styles from "./UrlInputForm.module.css";

export function UrlInputForm() {
  const router = useRouter();
  const [shareUrl, setShareUrl] = useState("");
  const [error, setError] = useState<{
    message: string;
    code?: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    let navigationStarted = false;

    try {
      const response = await fetch("/api/analyses", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ shareUrl })
      });
      const responseText = await response.text();
      let data: {
        analysisId?: string;
        status?: string;
        monitorData?: AnalysisMonitorPayload | null;
        error?: { message?: string; code?: string; detail?: string };
      };

      try {
        data = JSON.parse(responseText) as typeof data;
      } catch {
        setError({
          message: response.ok
            ? "분석 서버 응답을 확인하지 못했습니다."
            : "분석 서버에서 오류가 발생했습니다.",
          code: `HTTP_${response.status}`
        });
        return;
      }

      if (!response.ok || !data.analysisId || data.status === "failed") {
        setError({
          message: data.error?.message ?? "분석을 시작하지 못했습니다.",
          code: data.error?.code
        });
        return;
      }

      if (data.monitorData) {
        cacheAnalysisMonitorPayload(data.analysisId, data.monitorData);
      }

      router.push(`/analyses/${encodeURIComponent(data.analysisId)}?tab=turns`);
      navigationStarted = true;
    } catch {
      setError({ message: "네트워크 오류로 분석을 시작하지 못했습니다." });
    } finally {
      if (!navigationStarted) setSubmitting(false);
    }
  }

  return (
    <form
      className={styles.form}
      onSubmit={handleSubmit}
      aria-busy={submitting}
    >
      <div className={styles.labelRow}>
        <label htmlFor="share-url">ChatGPT 공유 링크</label>
        <span>SUPPORTED SOURCE</span>
      </div>
      <p className={styles.description}>
        공개 공유 링크를 붙여 넣으면 대화를 복원하고, 메시지를 Turn 단위로
        정리해 원문과 추출 결과를 함께 보여줍니다.
      </p>

      <div className={styles.inputRow}>
        <span className={styles.inputIcon} aria-hidden="true">
          <Link2 size={17} />
        </span>
        <input
          id="share-url"
          name="shareUrl"
          type="url"
          value={shareUrl}
          onChange={(event) => setShareUrl(event.target.value)}
          placeholder="https://chatgpt.com/share/..."
          aria-describedby="share-url-help"
          autoComplete="url"
          disabled={submitting}
          required
        />
        <button type="submit" disabled={submitting}>
          {submitting ? (
            <LoaderCircle
              size={16}
              className={styles.spinning}
              aria-hidden="true"
            />
          ) : (
            <ArrowRight size={16} aria-hidden="true" />
          )}
          {submitting ? "분석 중" : "분석 시작"}
        </button>
      </div>

      <p id="share-url-help" className={styles.helperText}>
        chatgpt.com/share 형식의 공개 링크를 지원합니다.
      </p>

      {submitting ? (
        <div className={styles.progress} role="status" aria-live="polite">
          <span className={styles.progressTrack} aria-hidden="true">
            <i />
          </span>
          <span>
            <strong>공유 대화를 가져오고 있습니다</strong>
            <small>메시지 복원과 구조 추출이 끝나면 자동으로 이동합니다.</small>
          </span>
        </div>
      ) : null}

      {error ? (
        <div className={styles.error} role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <div>
            <strong>{error.message}</strong>
            <small>링크가 공개 상태인지 확인한 뒤 다시 시도해 주세요.</small>
            {error.code ? (
              <details>
                <summary>오류 정보</summary>
                <code>code: {error.code}</code>
              </details>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={styles.privacyNotice}>
        <ShieldCheck size={15} aria-hidden="true" />
        <span>
          <strong>Session-only analysis</strong>
          <small>
            분석 결과는 현재 브라우저 세션에서만 유지되며 영구 보관되지
            않습니다. 민감한 개인정보, 비밀번호, API 키가 포함된 링크는 입력하지
            마세요.
          </small>
        </span>
      </div>
    </form>
  );
}
