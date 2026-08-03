"use client";

import {
  type FormEvent,
  useId,
  useRef,
  useState
} from "react";

import type {
  ManagedCodexArtifactRelation,
  ManagedCodexArtifactRelationProjection
} from "../src/artifacts/contracts";
import type { ManagedCodexWorkRelation } from "../src/relations";
import type { ManagedCodexPublicRun } from "./managedCodexRunsClient";
import {
  attachWorkArtifact,
  detachWorkArtifact,
  WorkArtifactRequestError
} from "./workArtifactsClient";
import { syncInvalidationBus } from "./sync/invalidationBus";

export function ManagedCodexArtifacts({
  run,
  executesRelation,
  projection,
  onChanged
}: {
  run: ManagedCodexPublicRun;
  executesRelation: ManagedCodexWorkRelation;
  projection: ManagedCodexArtifactRelationProjection;
  onChanged: () => Promise<void>;
}) {
  const artifactUrlId = useId();
  const [artifactUrl, setArtifactUrl] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const mutationSequence = useRef(0);
  const activeArtifacts = exactActiveArtifacts(
    run,
    executesRelation,
    projection.relations
  );
  const isMutating = pendingKey !== null;

  async function attach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedUrl = artifactUrl.trim();
    if (!trimmedUrl || isMutating) return;
    const sequence = ++mutationSequence.current;
    setPendingKey("attach");
    setMessage(null);
    try {
      await attachWorkArtifact({
        managedRunId: run.managedRunId,
        bindingId: run.bindingId,
        executionId: run.executionId,
        artifactUrl: trimmedUrl
      });
      if (sequence !== mutationSequence.current) return;
      // The raw URL remains only in this input state and is discarded as soon
      // as the server accepts the exact native artifact identity.
      setArtifactUrl("");
      setMessage({
        tone: "success",
        text: "결과 연결을 저장했습니다. 완료된 후속 작업의 중복 추천을 막는 근거로 반영합니다."
      });
      invalidateAttentionAfterArtifactMutation();
      await refreshAfterMutation(onChanged, setMessage);
    } catch (error) {
      if (sequence !== mutationSequence.current) return;
      setMessage({
        tone: "error",
        text: workArtifactErrorMessage(
          error,
          "결과를 연결하지 못했습니다. 정확한 GitHub commit 또는 PR URL인지 확인해주세요."
        )
      });
    } finally {
      if (sequence === mutationSequence.current) setPendingKey(null);
    }
  }

  async function detach(artifact: ManagedCodexArtifactRelation) {
    if (isMutating) return;
    const sequence = ++mutationSequence.current;
    setPendingKey(artifact.attributionId);
    setMessage(null);
    try {
      await detachWorkArtifact({ attributionId: artifact.attributionId });
      if (sequence !== mutationSequence.current) return;
      setMessage({
        tone: "success",
        text: "결과 연결을 해제했습니다. 과거 연결 이력은 보존됩니다."
      });
      invalidateAttentionAfterArtifactMutation();
      await refreshAfterMutation(onChanged, setMessage);
    } catch (error) {
      if (sequence !== mutationSequence.current) return;
      setMessage({
        tone: "error",
        text: workArtifactErrorMessage(
          error,
          "결과 연결을 해제하지 못했습니다."
        )
      });
    } finally {
      if (sequence === mutationSequence.current) setPendingKey(null);
    }
  }

  return (
    <section
      className="managedCodexArtifacts"
      aria-labelledby={`${artifactUrlId}-title`}
      aria-busy={isMutating}
    >
      <div className="managedCodexArtifactsHeader">
        <strong id={`${artifactUrlId}-title`}>생성된 결과</strong>
        <span className="managedCodexArtifactsBoundary">
          결과 자체는 후보가 아님 · 후속 작업 완료 여부의 근거로 사용
        </span>
      </div>

      {activeArtifacts.length === 0 ? (
        <p className="managedCodexArtifactEmpty">
          이 실행에 직접 연결된 GitHub 결과가 없습니다.
        </p>
      ) : (
        <ul className="managedCodexArtifactList">
          {activeArtifacts.map((artifact) => {
            const label = artifactLabel(artifact);
            const observation = artifactObservationPresentation(artifact);
            return (
              <li key={artifact.relationId}>
                <span className="managedCodexArtifactIdentity">
                  <strong>{label}</strong>
                  <span>produces · 사용자가 직접 연결</span>
                </span>
                <span className="managedCodexArtifactActions">
                  <span
                    className={`managedCodexArtifactObservation ${observation.className}`}
                  >
                    {observation.label}
                  </span>
                  <button
                    type="button"
                    disabled={isMutating}
                    onClick={() => void detach(artifact)}
                    aria-label={`${label} 연결 해제`}
                  >
                    {pendingKey === artifact.attributionId
                      ? "해제 중"
                      : "연결 해제"}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <form className="managedCodexArtifactAttach" onSubmit={attach}>
        <label htmlFor={artifactUrlId}>
          정확한 GitHub commit 또는 PR URL
        </label>
        <input
          id={artifactUrlId}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://github.com/.../commit/... 또는 /pull/..."
          value={artifactUrl}
          disabled={isMutating}
          onChange={(event) => setArtifactUrl(event.target.value)}
        />
        <button
          type="submit"
          disabled={isMutating || artifactUrl.trim().length === 0}
        >
          {pendingKey === "attach" ? "연결 중" : "결과 연결"}
        </button>
      </form>

      {message ? (
        <p
          className={`managedCodexArtifactMessage ${
            message.tone === "error" ? "isError" : ""
          }`}
          role="status"
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}

export function invalidateAttentionAfterArtifactMutation(): void {
  syncInvalidationBus.invalidate({
    reason: "context_changed",
    targets: ["attention"]
  });
}

function exactActiveArtifacts(
  run: ManagedCodexPublicRun,
  executesRelation: ManagedCodexWorkRelation,
  artifacts: ManagedCodexArtifactRelation[]
): ManagedCodexArtifactRelation[] {
  return artifacts.filter(
    (artifact) =>
      artifact.attributionLifecycle.state === "active" &&
      artifact.managedRunId === run.managedRunId &&
      artifact.bindingId === run.bindingId &&
      artifact.executionId === run.executionId &&
      artifact.executesRelationId === executesRelation.relationId
  );
}

function artifactLabel(artifact: ManagedCodexArtifactRelation): string {
  if (artifact.artifact.kind === "github_pull_request") {
    return `GitHub PR #${artifact.artifact.number}`;
  }
  return `GitHub commit ${artifact.artifact.oid.slice(0, 8)}`;
}

function artifactObservationPresentation(
  artifact: ManagedCodexArtifactRelation
): {
  label: string;
  className: "" | "isWarning" | "isError";
} {
  switch (artifact.githubObservation.status) {
    case "current":
      return { label: "GitHub 데이터 최신", className: "" };
    case "stale":
      return { label: "GitHub 데이터 오래됨", className: "isWarning" };
    case "not_observed":
      return { label: "최신 데이터에서 미확인", className: "isWarning" };
    case "unavailable":
      return { label: "GitHub 확인 불가", className: "isWarning" };
    case "conflict":
      return { label: "GitHub 정보 충돌", className: "isError" };
  }
}

async function refreshAfterMutation(
  onChanged: () => Promise<void>,
  setMessage: (message: {
    tone: "success" | "error";
    text: string;
  }) => void
) {
  try {
    await onChanged();
  } catch {
    setMessage({
      tone: "success",
      text: "연결 변경은 저장했습니다. 화면 갱신이 지연되어 잠시 후 다시 확인합니다."
    });
  }
}

function workArtifactErrorMessage(error: unknown, fallback: string): string {
  if (
    error instanceof WorkArtifactRequestError &&
    error.message !== "Work artifact request failed."
  ) {
    return error.message;
  }
  return fallback;
}
