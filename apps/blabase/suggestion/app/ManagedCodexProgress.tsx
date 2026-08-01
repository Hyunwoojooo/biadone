"use client";

import { useCallback, useRef, useState } from "react";

import {
  fetchManagedCodexRuns,
  type ManagedCodexContinuity,
  type ManagedCodexExecutionState,
  type ManagedCodexItemType,
  type ManagedCodexPublicRun,
  type ManagedCodexRunsReadyResponse,
  type ManagedCodexSemanticRunResult,
  type ManagedCodexSourceEvent,
  type ManagedCodexStreamState
} from "./managedCodexRunsClient";
import { ManagedCodexArtifacts } from "./ManagedCodexArtifacts";
import {
  useSyncInvalidation,
  useVisiblePolling
} from "./sync/useSourceSync";
import {
  fetchWorkRelations,
  type WorkRelationsReadyResponse
} from "./workRelationsClient";
import type {
  ManagedCodexWorkRelation,
  ManagedCodexWorkRelationRunResolution
} from "../src/relations";

const MANAGED_RUN_POLL_INTERVAL_MS = 2_000;
const MANAGED_RUN_MAX_BACKOFF_MS = 30_000;
const WORK_RELATION_POLL_INTERVAL_MS = 15_000;
const WORK_RELATION_MAX_BACKOFF_MS = 120_000;
const MAX_VISIBLE_MANAGED_RUNS = 8;

export function ManagedCodexProgress() {
  const [payload, setPayload] =
    useState<ManagedCodexRunsReadyResponse | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [relationPayload, setRelationPayload] =
    useState<WorkRelationsReadyResponse | null>(null);
  const [isRelationLoading, setIsRelationLoading] = useState(true);
  const [relationNotice, setRelationNotice] = useState<string | null>(
    null
  );
  const relationRequestSequence = useRef(0);

  const load = useCallback(async () => {
    try {
      const response = await fetchManagedCodexRuns();
      if (response.status !== "ready") {
        setNotice(
          response.message ??
            "Blabase가 관리하는 Codex 실행 상태를 확인할 수 없습니다."
        );
        return;
      }
      // Liveness is also derived from the current Companion owner heartbeat.
      // It can safely degrade while the persisted event revision stays the
      // same, so every no-store projection must replace the previous view.
      setPayload(response);
      setNotice(null);
    } catch (error) {
      setNotice(
        "Codex 실시간 관찰 상태를 갱신하지 못했습니다. 마지막으로 검증된 상태만 표시합니다."
      );
      throw error;
    } finally {
      setIsInitialLoading(false);
    }
  }, []);

  useVisiblePolling(load, {
    intervalMs: MANAGED_RUN_POLL_INTERVAL_MS,
    maxBackoffMs: MANAGED_RUN_MAX_BACKOFF_MS
  });

  const loadRelations = useCallback(async () => {
    const sequence = ++relationRequestSequence.current;
    try {
      const response = await fetchWorkRelations();
      if (sequence !== relationRequestSequence.current) return;
      if (response.status !== "ready") {
        setRelationPayload(null);
        setRelationNotice(
          response.message ?? "연결 근거 확인 불가"
        );
        return;
      }
      setRelationPayload(response);
      setRelationNotice(null);
    } catch (error) {
      if (sequence !== relationRequestSequence.current) return;
      setRelationPayload(null);
      setRelationNotice("연결 근거 확인 불가");
      throw error;
    } finally {
      if (sequence === relationRequestSequence.current) {
        setIsRelationLoading(false);
      }
    }
  }, []);

  useVisiblePolling(loadRelations, {
    intervalMs: WORK_RELATION_POLL_INTERVAL_MS,
    maxBackoffMs: WORK_RELATION_MAX_BACKOFF_MS
  });

  useSyncInvalidation(["github", "codex", "attention"], () => {
    void loadRelations().catch(() => undefined);
  });

  const visibleRuns = payload?.runs.slice(0, MAX_VISIBLE_MANAGED_RUNS) ?? [];
  const relationById = new Map(
    relationPayload?.relations.map((relation) => [
      relation.relationId,
      relation
    ]) ?? []
  );
  const resolutionByManagedRunId = new Map(
    relationPayload?.runResolutions.map((resolution) => [
      resolution.managedRunId,
      resolution
    ]) ?? []
  );

  return (
    <section
      className="managedCodexProgress attentionSubsection"
      aria-labelledby="managed-codex-progress-title"
      aria-busy={isInitialLoading}
    >
      <div className="attentionSubsectionHeader">
        <div>
          <p className="eyebrow">Managed execution</p>
          <h3 id="managed-codex-progress-title">Codex 실시간 진행</h3>
        </div>
        <span>{payload ? `${payload.runs.length}개` : "관찰 전용"}</span>
      </div>

      <p className="managedCodexBoundary">
        관찰 전용 · 추천 우선순위에 반영하지 않음
      </p>

      <div aria-live="polite" aria-atomic="false">
        {isInitialLoading && payload === null ? (
          <p className="managedCodexEmpty" role="status">
            Blabase가 직접 관리하는 Codex 실행을 확인하고 있습니다.
          </p>
        ) : payload === null ? (
          <p className="managedCodexEmpty">
            {notice ??
              "Blabase가 관리하는 Codex 실행 상태를 확인할 수 없습니다."}
          </p>
        ) : payload.runs.length === 0 ? (
          <p className="managedCodexEmpty">
            현재 Blabase가 직접 관리하며 실시간으로 관찰하는 Codex run이
            없습니다. 과거 Codex 세션 기록은 아래의 과거 작업 맥락에서
            별도로 확인할 수 있습니다.
          </p>
        ) : (
          <>
            {notice ? (
              <p className="managedCodexNotice" role="status">
                {notice}
              </p>
            ) : null}
            <ul className="managedCodexRunList">
              {visibleRuns.map((run) => {
                const resolution = resolutionByManagedRunId.get(
                  run.managedRunId
                );
                const relation = resolution?.relationId
                  ? relationById.get(resolution.relationId)
                  : undefined;
                const exactRelation = exactManagedRunRelation(
                  run,
                  resolution,
                  relation
                );
                return (
                  <ManagedCodexRunItem
                    key={run.managedRunId}
                    run={run}
                    semantic={payload.semantics.runs[run.managedRunId]}
                    relation={exactRelation}
                    relationResolution={resolution}
                    relationReadState={
                      relationPayload
                        ? "ready"
                        : isRelationLoading
                          ? "loading"
                          : "unavailable"
                    }
                    relationNotice={relationNotice}
                    artifactProjection={relationPayload?.artifacts}
                    onArtifactChanged={loadRelations}
                  />
                );
              })}
            </ul>
            {payload.runs.length > MAX_VISIBLE_MANAGED_RUNS ? (
              <p className="managedCodexRemainder">
                이외 {payload.runs.length - MAX_VISIBLE_MANAGED_RUNS}개 run은
                현재 목록에서 접었습니다.
              </p>
            ) : null}
          </>
        )}
      </div>

      {payload ? (
        <p className="managedCodexAsOf">
          마지막 projection{" "}
          <time dateTime={payload.generatedAt}>
            {formatTimestamp(payload.generatedAt)}
          </time>
        </p>
      ) : null}
    </section>
  );
}

function exactManagedRunRelation(
  run: ManagedCodexPublicRun,
  resolution: ManagedCodexWorkRelationRunResolution | undefined,
  relation: ManagedCodexWorkRelation | undefined
): ManagedCodexWorkRelation | undefined {
  if (
    resolution?.status !== "resolved" ||
    resolution.managedRunId !== run.managedRunId ||
    resolution.bindingId !== run.bindingId ||
    resolution.executionId !== run.executionId ||
    resolution.relationId === null ||
    relation?.relationId !== resolution.relationId ||
    relation.bindingId !== run.bindingId ||
    relation.from.kind !== "execution" ||
    relation.from.source !== "codex" ||
    relation.from.subjectId !== run.executionId ||
    !relation.managedRunIds.includes(run.managedRunId)
  ) {
    return undefined;
  }
  return relation;
}

function ManagedCodexRunItem({
  run,
  semantic,
  relation,
  relationResolution,
  relationReadState,
  relationNotice,
  artifactProjection,
  onArtifactChanged
}: {
  run: ManagedCodexPublicRun;
  semantic: ManagedCodexSemanticRunResult | undefined;
  relation: ManagedCodexWorkRelation | undefined;
  relationResolution:
    | ManagedCodexWorkRelationRunResolution
    | undefined;
  relationReadState: "loading" | "ready" | "unavailable";
  relationNotice: string | null;
  artifactProjection: WorkRelationsReadyResponse["artifacts"] | undefined;
  onArtifactChanged: () => Promise<void>;
}) {
  const tone = managedRunTone(run);
  const currentWaitingState =
    run.liveObservationAvailable &&
    run.streamState === "connected" &&
    run.continuity === "continuous"
      ? run.waitingState
      : null;

  return (
    <li className={`is${capitalize(tone)}`}>
      <div className="managedCodexRunMain">
        <div className="managedCodexRunTitle">
          <strong>Codex managed run</strong>
          <span className="monoValue">{shortManagedRunId(run.managedRunId)}</span>
        </div>
        <div className="managedCodexRunState">
          <span>{effectiveExecutionLabel(run)}</span>
          {currentWaitingState ? (
            <span className="managedCodexWaiting">
              {currentWaitingState === "waiting_on_user_input"
                ? "사용자 입력 대기"
                : "승인 대기"}
            </span>
          ) : null}
        </div>
        <p>
          최근 관찰: {sourceEventLabel(run.sourceEvent, run.itemType)} ·{" "}
          <time dateTime={run.lastObservedAt}>
            {formatTimestamp(run.lastObservedAt)}
          </time>
        </p>
      </div>
      <dl className="managedCodexRunMeta">
        <div>
          <dt>연결</dt>
          <dd>{streamStateLabel(run.streamState)}</dd>
        </div>
        <div>
          <dt>연속성</dt>
          <dd>{continuityLabel(run.continuity)}</dd>
        </div>
        <div>
          <dt>마지막 검증 상태</dt>
          <dd>{executionStateLabel(run.lastVerifiedExecutionState)}</dd>
        </div>
      </dl>
      <ManagedCodexRelationSummary
        relation={relation}
        resolution={relationResolution}
        readState={relationReadState}
        notice={relationNotice}
      />
      {relation && artifactProjection ? (
        <ManagedCodexArtifacts
          run={run}
          executesRelation={relation}
          projection={artifactProjection}
          onChanged={onArtifactChanged}
        />
      ) : null}
      {semantic ? (
        <ManagedCodexSemanticSummary semantic={semantic} />
      ) : (
        <p className="managedCodexSemanticUnavailable">
          직접 이벤트 해석을 확인할 수 없습니다. 작업 진전은 판단 불가하며
          정체도 평가하지 않습니다.
        </p>
      )}
    </li>
  );
}

function ManagedCodexRelationSummary({
  relation,
  resolution,
  readState,
  notice
}: {
  relation: ManagedCodexWorkRelation | undefined;
  resolution: ManagedCodexWorkRelationRunResolution | undefined;
  readState: "loading" | "ready" | "unavailable";
  notice: string | null;
}) {
  if (readState !== "ready") {
    return (
      <p className="managedCodexRelationUnavailable" role="status">
        {readState === "loading"
          ? "연결 근거 확인 중"
          : notice ?? "연결 근거 확인 불가"}
      </p>
    );
  }
  if (!relation) {
    return (
      <p className="managedCodexRelationUnavailable">
        {relationResolutionLabel(resolution)}
      </p>
    );
  }

  const presentation = relationPresentation(relation);
  const targetLabel = githubRelationTargetLabel(relation);
  const active = relation.bindingEvidence.bindingState === "active";
  const canOpenTarget =
    active && relation.githubObservation.destinationUrl !== null;

  return (
    <div className="managedCodexRelation">
      <div className="managedCodexRelationHeader">
        <span>연결된 작업</span>
        <span
          className={`managedCodexRelationBadge ${presentation.className}`}
        >
          {presentation.badge}
        </span>
      </div>
      <div className="managedCodexRelationTarget">
        {canOpenTarget ? (
          <a
            href={relation.githubObservation.destinationUrl as string}
            target="_blank"
            rel="noreferrer"
          >
            {targetLabel}
            <span className="srOnly"> (새 탭)</span>
          </a>
        ) : (
          <strong>{targetLabel}</strong>
        )}
        <span>executes · 사용자가 직접 연결</span>
      </div>
      <p className={presentation.detailClassName}>
        {presentation.detail}
      </p>
    </div>
  );
}

function relationPresentation(relation: ManagedCodexWorkRelation): {
  badge: string;
  className: "" | "isWarning" | "isError";
  detail: string;
  detailClassName: "" | "isWarning" | "isError";
} {
  if (relation.identityStatus === "conflict") {
    return {
      badge: "GitHub 정보 충돌",
      className: "isError",
      detail:
        "동일 GitHub 작업에 서로 다른 native 관찰이 있어 현재 작업으로 사용하지 않습니다.",
      detailClassName: "isError"
    };
  }
  if (relation.projectAlignment.status === "conflict") {
    return {
      badge: "프로젝트 충돌",
      className: "isError",
      detail:
        "Codex scope와 GitHub 저장소가 서로 다른 프로젝트에 연결되어 있습니다. 추천에는 사용하지 않습니다.",
      detailClassName: "isError"
    };
  }
  if (relation.bindingEvidence.bindingState === "superseded_by_unbind") {
    return {
      badge: "연결 해제됨",
      className: "isWarning",
      detail:
        "실행 당시 사용자가 연결한 관계입니다. 현재 작업 연결이나 실행 대상으로 사용하지 않습니다.",
      detailClassName: "isWarning"
    };
  }
  if (relation.bindingEvidence.bindingState === "superseded_by_rebind") {
    return {
      badge: "다른 세션으로 변경됨",
      className: "isWarning",
      detail:
        "실행 당시 사용자가 연결한 관계입니다. 현재는 다른 Codex 세션에 연결되어 있습니다.",
      detailClassName: "isWarning"
    };
  }

  switch (relation.githubObservation.status) {
    case "current":
      return {
        badge: "사용자 직접 연결",
        className: "",
        detail:
          relation.projectAlignment.status === "aligned"
            ? "GitHub native ID와 명시적 프로젝트 연결이 확인되었습니다. 관찰 전용이며 추천에는 아직 사용하지 않습니다."
            : "GitHub native ID가 확인되었습니다. 프로젝트 연결은 아직 모두 확인되지 않았으며 추천에는 사용하지 않습니다.",
        detailClassName: ""
      };
    case "stale":
      return {
        badge: "GitHub 데이터 오래됨",
        className: "isWarning",
        detail:
          "사용자 연결은 보존하지만 GitHub 상태가 오래되어 현재 작업 상태로 단정하지 않습니다.",
        detailClassName: "isWarning"
      };
    case "not_observed":
      return {
        badge: "최신 데이터에서 미확인",
        className: "isWarning",
        detail:
          "사용자 연결은 보존하지만 최신 GitHub snapshot에 보이지 않습니다. 완료로 해석하지 않습니다.",
        detailClassName: "isWarning"
      };
    case "unavailable":
      return {
        badge: "GitHub 확인 불가",
        className: "isWarning",
        detail:
          "사용자 연결은 보존하지만 현재 GitHub 관찰 근거를 확인할 수 없습니다.",
        detailClassName: "isWarning"
      };
    case "conflict":
      return {
        badge: "GitHub 정보 충돌",
        className: "isError",
        detail:
          "GitHub native 관찰이 충돌해 현재 작업으로 사용하지 않습니다.",
        detailClassName: "isError"
      };
  }
}

function githubRelationTargetLabel(
  relation: ManagedCodexWorkRelation
): string {
  const objectLabel =
    relation.githubObservation.objectType === "pull_request"
      ? "GitHub PR"
      : relation.githubObservation.objectType === "issue"
        ? "GitHub 이슈"
        : "GitHub 작업";
  const number = relation.githubObservation.number;
  if (number !== null) return `${objectLabel} #${number}`;
  const nativeId = /^github:object:([1-9][0-9]*)$/.exec(
    relation.to.subjectId
  )?.[1];
  return nativeId ? `${objectLabel} ID ${nativeId}` : objectLabel;
}

function relationResolutionLabel(
  resolution: ManagedCodexWorkRelationRunResolution | undefined
): string {
  switch (resolution?.status) {
    case "binding_not_found":
      return "이 실행의 사용자 연결 결정을 찾지 못했습니다.";
    case "binding_not_bind":
      return "이 실행의 연결 결정이 유효한 bind 기록이 아닙니다.";
    case "execution_mismatch":
      return "Codex 실행과 연결된 작업의 execution ID가 일치하지 않습니다.";
    case "unsupported_task_source":
      return "현재 Phase 3A 범위의 GitHub 작업 연결이 아닙니다.";
    case "invalid_github_subject":
      return "연결된 GitHub 작업의 native ID를 확인하지 못했습니다.";
    default:
      return "이 실행의 연결 근거를 현재 projection에서 확인하지 못했습니다.";
  }
}

function ManagedCodexSemanticSummary({
  semantic
}: {
  semantic: ManagedCodexSemanticRunResult;
}) {
  const recentEvents = semantic.timeline.entries.slice(-8).reverse();
  const hiddenEventCount = Math.max(
    0,
    semantic.timeline.totalEntryCount - recentEvents.length
  );
  const assessment =
    semantic.detector.failureLifecycle ===
    "latest_direct_managed_run_failure"
      ? "관리 실행 실패가 직접 관찰됨"
      : semanticAssessmentLabel(semantic.detector.assessment);

  return (
    <div className="managedCodexSemantic">
      <div className="managedCodexSemanticStatus">
        <span>
          직접 이벤트 해석 <strong>{assessment}</strong>
        </span>
        <span>
          작업 진전 <strong>판단 불가</strong>
        </span>
        <span>
          정체 <strong>평가 불가</strong>
        </span>
      </div>
      <p>
        {semantic.window.historyCompleteness === "complete" &&
        semantic.window.continuity === "continuous"
          ? "보존된 이벤트 순서가 연속 검증되었습니다."
          : "보존 이력이나 연속 근거가 부족해 현재 상태를 단정하지 않습니다."}{" "}
        이 해석은 관찰 전용이며 Attention 추천 입력이 아닙니다.
      </p>
      <details className="managedCodexTimeline">
        <summary>
          최근 직접 관찰 타임라인 ({recentEvents.length}개)
        </summary>
        {hiddenEventCount > 0 ? (
          <p>
            앞선 {hiddenEventCount}개 이벤트는 이 목록에서 생략했습니다.
          </p>
        ) : null}
        {recentEvents.length === 0 ? (
          <p>아직 직접 관찰된 이벤트가 없습니다.</p>
        ) : (
          <ol>
            {recentEvents.map((entry) => (
              <li key={entry.entryId}>
                <span>
                  <span className="monoValue">
                    #{entry.evidence.sequence}
                  </span>{" "}
                  {sourceEventLabel(
                    entry.evidence.sourceEvent,
                    entry.evidence.itemType
                  )}
                </span>
                <time dateTime={entry.evidence.observedAt}>
                  {formatTimestamp(entry.evidence.observedAt)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </details>
    </div>
  );
}

function semanticAssessmentLabel(
  assessment: ManagedCodexSemanticRunResult["detector"]["assessment"]
): string {
  switch (assessment) {
    case "turn_running":
      return "turn 진행 관찰됨";
    case "activity_observed":
      return "활동 관찰됨";
    case "thread_idle":
      return "현재 turn 없음";
    case "turn_completed":
      return "turn 완료 관찰됨";
    case "turn_failed":
      return "turn 실패 관찰됨";
    case "turn_interrupted":
      return "turn 중단 관찰됨";
    case "managed_run_failed":
      return "관리 실행 실패 관찰됨";
    case "managed_run_closed":
      return "관리 관찰 종료됨";
    case "observation_gap":
      return "이벤트 누락으로 평가 불가";
    case "observation_unavailable":
      return "실시간 관찰 불가";
    default:
      return "근거 부족";
  }
}

function effectiveExecutionLabel(run: ManagedCodexPublicRun): string {
  if (run.streamState === "disconnected") {
    return "연결 끊김 · 현재 상태 미확인";
  }
  if (run.streamState === "connecting") {
    return "실시간 연결 확인 중";
  }
  if (run.streamState === "closed") {
    return run.effectiveExecutionState === "unknown"
      ? "관찰 종료 · 현재 상태 미확인"
      : `관찰 종료 · ${executionStateLabel(
          run.effectiveExecutionState
        )}`;
  }
  if (
    run.continuity === "gap_detected" &&
    run.effectiveExecutionState === "unknown"
  ) {
    return "이벤트 누락 · 현재 상태 미확인";
  }
  if (!run.liveObservationAvailable) return "실시간 검증 없음";
  return executionStateLabel(run.effectiveExecutionState);
}

function executionStateLabel(state: ManagedCodexExecutionState): string {
  switch (state) {
    case "running":
      return "진행 중";
    case "idle":
      return "현재 turn 없음";
    case "completed":
      return "최근 turn 완료";
    case "failed":
      return "최근 turn 실패";
    case "interrupted":
      return "최근 turn 중단";
    default:
      return "현재 상태 미확인";
  }
}

function streamStateLabel(state: ManagedCodexStreamState): string {
  switch (state) {
    case "connecting":
      return "연결 중";
    case "connected":
      return "실시간 연결됨";
    case "disconnected":
      return "재연결 필요";
    case "closed":
      return "관찰 종료";
  }
}

function continuityLabel(continuity: ManagedCodexContinuity): string {
  switch (continuity) {
    case "continuous":
      return "연속 검증됨";
    case "gap_detected":
      return "이벤트 누락 감지";
    case "unverified":
      return "연속성 미확인";
  }
}

function sourceEventLabel(
  event: ManagedCodexSourceEvent,
  itemType: ManagedCodexItemType
): string {
  switch (event) {
    case "run_started":
      return "관리 시작";
    case "stream_connected":
      return "실시간 stream 연결";
    case "stream_reconnected":
      return "실시간 stream 재연결";
    case "stream_disconnected":
      return "실시간 stream 연결 끊김";
    case "thread_status_changed":
      return "thread 상태 변경";
    case "turn_started":
      return "turn 시작";
    case "turn_completed":
      return "turn 종료";
    case "item_started":
      return `${itemTypeLabel(itemType)} 시작`;
    case "item_completed":
      return `${itemTypeLabel(itemType)} 완료`;
    case "run_failed":
      return "관리 run 실패";
    case "run_closed":
      return "관리 run 종료";
  }
}

function itemTypeLabel(type: ManagedCodexItemType): string {
  switch (type) {
    case "user_message":
      return "사용자 메시지";
    case "agent_message":
      return "Codex 응답";
    case "command_execution":
      return "명령 실행";
    case "file_change":
      return "파일 변경";
    case "tool_call":
      return "도구 호출";
    case "collaboration":
      return "협업 작업";
    case "web_search":
      return "웹 검색";
    case "context_compaction":
      return "맥락 정리";
    case "reasoning":
      return "추론 단계";
    case "other":
    case null:
      return "작업 단계";
  }
}

function managedRunTone(
  run: ManagedCodexPublicRun
): "active" | "complete" | "warning" | "error" | "neutral" {
  if (
    run.lifecycle === "failed" ||
    run.effectiveExecutionState === "failed"
  ) {
    return "error";
  }
  if (
    !run.liveObservationAvailable ||
    run.streamState === "disconnected" ||
    run.continuity !== "continuous"
  ) {
    return "warning";
  }
  if (
    run.effectiveExecutionState === "completed" ||
    run.lifecycle === "ended"
  ) {
    return "complete";
  }
  if (
    run.streamState === "connected" &&
    run.effectiveExecutionState === "running"
  ) {
    return "active";
  }
  return "neutral";
}

function shortManagedRunId(value: string): string {
  const opaque = value.startsWith("managed_run_")
    ? value.slice("managed_run_".length)
    : value;
  return opaque.length > 8 ? `${opaque.slice(0, 8)}…` : opaque;
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}
