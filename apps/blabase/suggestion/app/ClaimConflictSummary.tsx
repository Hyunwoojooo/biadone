"use client";

import { useId } from "react";

import type { ManagedCodexArtifactRelation } from "../src/artifacts/contracts";
import type {
  ClaimAuthorityProjection,
  ClaimConflict,
  ClaimField,
  ClaimSource,
  ClaimSourceCoverage,
  ClaimTargetKind
} from "../src/claims/contracts";
import type { ManagedCodexWorkRelation } from "../src/relations";

const MAX_VISIBLE_CONFLICTS = 5;
const COVERAGE_SOURCE_ORDER: ClaimSource[] = [
  "github",
  "codex_managed",
  "codex_inventory",
  "notion",
  "google_calendar",
  "explicit_user"
];

export function ClaimConflictSummary({
  projection,
  workRelations = [],
  artifactRelations = [],
  readState,
  notice
}: {
  projection: ClaimAuthorityProjection | undefined;
  workRelations?: ManagedCodexWorkRelation[];
  artifactRelations?: ManagedCodexArtifactRelation[];
  readState: "loading" | "ready" | "unavailable";
  notice: string | null;
}) {
  const titleId = useId();

  if (readState !== "ready" || !projection) {
    return (
      <section
        className={`claimConflictSummary ${
          readState === "loading" ? "isLoading" : "isUnavailable"
        }`}
        aria-labelledby={titleId}
        aria-busy={readState === "loading"}
      >
        <div className="claimConflictHeader">
          <h4 id={titleId}>Cross-source 상태 판정</h4>
          <span>관찰 전용</span>
        </div>
        <p role="status">
          {readState === "loading"
            ? "연결된 source의 상태 판정 근거를 확인하고 있습니다."
            : notice ?? "연결된 source의 상태 판정 근거를 확인할 수 없습니다."}
        </p>
      </section>
    );
  }

  const conflicts = [...projection.conflicts].sort(compareConflicts);
  const visibleConflicts = conflicts.slice(0, MAX_VISIBLE_CONFLICTS);
  const hiddenConflicts = conflicts.slice(MAX_VISIBLE_CONFLICTS);
  const coverage = [...projection.sourceCoverage].sort(
    (left, right) =>
      COVERAGE_SOURCE_ORDER.indexOf(left.source) -
      COVERAGE_SOURCE_ORDER.indexOf(right.source)
  );
  const evaluatedClaimCount = projection.fieldResolutions.length;
  const resolvedClaimCount = projection.fieldResolutions.filter(
    (resolution) => resolution.status === "resolved"
  ).length;

  return (
    <section
      className={`claimConflictSummary ${
        projection.unresolvedCriticalConflictCount > 0 ? "hasConflict" : ""
      }`}
      aria-labelledby={titleId}
      aria-busy={false}
    >
      <div className="claimConflictHeader">
        <h4 id={titleId}>Cross-source 상태 판정</h4>
        <span aria-live="polite" aria-atomic="true">
          미해결 {projection.unresolvedCriticalConflictCount}개 · 기록{" "}
          {projection.conflicts.length}개
        </span>
      </div>
      <p className="claimConflictBoundary">
        claim과 충돌 자체는 후보가 아님 · 관련 작업의 상태 검증과 확인
        필요 경로에 반영
      </p>
      <p className="claimConflictAsOf">
        마지막 판정{" "}
        <time dateTime={projection.asOf}>
          {formatTimestamp(projection.asOf)}
        </time>
      </p>

      {conflicts.length === 0 ? (
        <p className="claimConflictEmpty">
          {evaluatedClaimCount > 0
            ? resolvedClaimCount > 0
              ? "현재 평가 가능한 범위에서 확인된 충돌이 없습니다."
              : "직접 claim은 있지만 근거가 오래되었거나 부족해 현재 충돌 여부를 판정하지 않았습니다."
            : "현재 비교 가능한 직접 claim이 없어 충돌 여부를 판정하지 않았습니다."}
        </p>
      ) : (
        <ul className="claimConflictList">
          {visibleConflicts.map((conflict) => (
            <ClaimConflictRow
              key={conflict.conflictId}
              conflict={conflict}
              projection={projection}
              workRelations={workRelations}
              artifactRelations={artifactRelations}
            />
          ))}
        </ul>
      )}

      {hiddenConflicts.length > 0 ? (
        <details className="claimConflictMore">
          <summary>나머지 {hiddenConflicts.length}개 모두 보기</summary>
          <ul className="claimConflictList">
            {hiddenConflicts.map((conflict) => (
              <ClaimConflictRow
                key={conflict.conflictId}
                conflict={conflict}
                projection={projection}
                workRelations={workRelations}
                artifactRelations={artifactRelations}
              />
            ))}
          </ul>
        </details>
      ) : null}

      <details className="claimCoverageDetails">
        <summary>source별 평가 범위</summary>
        <ul>
          {coverage.map((item) => (
            <li key={item.source}>
              <strong>{sourceLabel(item.source)}</strong>
              <span>{coverageLabel(item)}</span>
            </li>
          ))}
        </ul>
        <p>
          Source마다 평가 가능한 field가 다릅니다. 같은 프로젝트라는 이유만으로
          서로 다른 작업을 합치지 않습니다.
        </p>
      </details>
    </section>
  );
}

function ClaimConflictRow({
  conflict,
  projection,
  workRelations,
  artifactRelations
}: {
  conflict: ClaimConflict;
  projection: ClaimAuthorityProjection;
  workRelations: ManagedCodexWorkRelation[];
  artifactRelations: ManagedCodexArtifactRelation[];
}) {
  const presentation = conflictPresentation(conflict);
  const sources = conflictSources(conflict, projection);
  const winningSource = conflict.winningClaimId
    ? projection.claims.find(
        (claim) => claim.claimId === conflict.winningClaimId
      )?.source
    : undefined;
  const sourceContext =
    sources.length > 0
      ? sources.map(sourceLabel).join(" ↔ ")
      : "source 확인 불가";
  const decisionContext = winningSource
    ? ` · ${sourceLabel(winningSource)} 기준 판정`
    : "";

  return (
    <li>
      <span>
        <strong>{claimFieldLabel(conflict.field)}</strong>
        <small className="claimConflictContext">
          {targetContextLabel(
            conflict,
            workRelations,
            artifactRelations
          )}{" "}
          · {sourceContext}
          {decisionContext}
        </small>
        <small>{presentation.detail}</small>
      </span>
      <span className={presentation.className}>{presentation.badge}</span>
    </li>
  );
}

function compareConflicts(left: ClaimConflict, right: ClaimConflict): number {
  return (
    conflictPriority(left) - conflictPriority(right) ||
    left.conflictId.localeCompare(right.conflictId)
  );
}

function conflictPriority(conflict: ClaimConflict): number {
  if (
    conflict.status === "review_required" &&
    conflict.nextAction === "user_review"
  ) {
    return 0;
  }
  if (
    conflict.status === "review_required" &&
    conflict.nextAction === "refresh_sources"
  ) {
    return 1;
  }
  return conflict.status === "resolved_by_freshness" ? 2 : 3;
}

function conflictSources(
  conflict: ClaimConflict,
  projection: ClaimAuthorityProjection
): ClaimSource[] {
  const claimIds = new Set(conflict.claimIds);
  const sources = new Set(
    projection.claims
      .filter((claim) => claimIds.has(claim.claimId))
      .map((claim) => claim.source)
  );
  return COVERAGE_SOURCE_ORDER.filter((source) => sources.has(source));
}

function targetContextLabel(
  conflict: ClaimConflict,
  workRelations: ManagedCodexWorkRelation[],
  artifactRelations: ManagedCodexArtifactRelation[]
): string {
  const relationRefs = new Set(conflict.relationRefs);
  const workRelation = workRelations.find((relation) =>
    relationRefs.has(relation.relationId)
  );
  const artifactRelation = artifactRelations.find((relation) =>
    relationRefs.has(relation.relationId)
  );

  if (artifactRelation) {
    return artifactRelation.artifact.kind === "github_pull_request"
      ? `GitHub PR #${artifactRelation.artifact.number}`
      : `GitHub commit ${artifactRelation.artifact.oid.slice(0, 8)}`;
  }

  if (workRelation) {
    const githubTarget = githubWorkItemLabel(workRelation);
    if (conflict.target.kind === "codex_execution") {
      return `${githubTarget}에 연결된 Codex 실행`;
    }
    if (conflict.target.kind === "project_relation") {
      return `${githubTarget}의 프로젝트 연결`;
    }
    return githubTarget;
  }

  return fallbackTargetLabel(conflict.target.kind);
}

function githubWorkItemLabel(relation: ManagedCodexWorkRelation): string {
  const number = relation.githubObservation.number;
  if (number === null) return "연결된 GitHub 작업";
  return relation.githubObservation.objectType === "pull_request"
    ? `GitHub PR #${number}`
    : `GitHub 이슈 #${number}`;
}

function fallbackTargetLabel(kind: ClaimTargetKind): string {
  switch (kind) {
    case "github_work_item":
      return "GitHub 작업";
    case "codex_execution":
      return "관리 중인 Codex 실행";
    case "project_relation":
      return "프로젝트 연결";
    case "notion_task":
      return "Notion 작업";
    case "calendar_event":
      return "Calendar 일정";
    case "user_work_item":
      return "사용자 작업";
  }
}

function conflictPresentation(conflict: ClaimConflict): {
  badge: string;
  detail: string;
  className: "isError" | "isWarning" | "isResolved";
} {
  switch (conflict.status) {
    case "review_required":
      return conflict.nextAction === "refresh_sources"
        ? {
            badge: "source 갱신 필요",
            detail:
              "권위 있는 근거가 오래되어 source 갱신 전에는 판정하지 않습니다.",
            className: "isWarning"
          }
        : {
            badge: "판정 보류",
            detail: "동등한 직접 근거가 달라 자동으로 선택하지 않습니다.",
            className: "isError"
          };
    case "resolved_by_freshness":
      return {
        badge: "최신 직접 근거 적용",
        detail:
          "오래된 직접 근거는 보존하고 더 최신인 직접 관찰을 적용했습니다.",
        className: "isResolved"
      };
    case "resolved_by_authority":
      return {
        badge: "source 권위 적용",
        detail:
          "원본 해석은 모두 보존하고 해당 field의 authoritative source를 적용했습니다.",
        className: "isResolved"
      };
  }
}

function claimFieldLabel(field: ClaimField): string {
  switch (field) {
    case "github_native_identity":
      return "GitHub native identity";
    case "github_work_item_state":
      return "GitHub 작업 상태";
    case "github_user_relationship":
      return "GitHub 사용자 관계";
    case "github_milestone_due_at":
      return "GitHub milestone";
    case "managed_codex_execution_state":
      return "Codex 실행 상태";
    case "project_alignment_identity":
      return "프로젝트 연결";
    case "notion_task_state":
      return "Notion 작업 상태";
    case "notion_internal_priority":
      return "Notion 내부 우선순위";
    case "calendar_event_state":
      return "Calendar 일정 상태";
    case "calendar_event_time":
      return "Calendar 일정 시간";
    case "user_disposition":
      return "사용자 판단";
  }
}

function sourceLabel(source: ClaimSource): string {
  switch (source) {
    case "github":
      return "GitHub";
    case "codex_managed":
      return "Managed Codex";
    case "codex_inventory":
      return "기존 Codex 기록";
    case "notion":
      return "Notion";
    case "google_calendar":
      return "Google Calendar";
    case "explicit_user":
      return "사용자 설정";
  }
}

function coverageLabel(coverage: ClaimSourceCoverage): string {
  switch (coverage.status) {
    case "evaluated":
      return "직접 field 평가 가능";
    case "stale":
      return "근거 오래됨 · 현재 판정 안 함";
    case "partial":
      return "일부 직접 field만 평가";
    case "context_only":
      return "맥락 전용 · 상태 충돌 미평가";
    case "unavailable":
      return "현재 데이터 확인 불가";
    case "unsupported":
      return "현재 계약에서 지원하지 않음";
  }
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
