"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type {
  DiscoverableProject,
  DiscoverableSourceScope,
  SourceScopeDiscovery
} from "../src/context/sourceScopeDiscovery";
import type { RepositoryScopeProposalGroup } from "../src/context/repositoryScopeProposals";
import type {
  ProjectWorkflowActionKind,
  ProjectWorkflowProjection
} from "../src/workflows";
import {
  clearProjectWorkflow,
  configureProjectWorkflow,
  fetchProjectWorkflows
} from "./projectWorkflowsClient";
import { syncInvalidationBus } from "./sync/invalidationBus";
import { useSyncInvalidation } from "./sync/useSourceSync";

type ProjectContextResponse =
  | {
      status: "ready";
      discovery: SourceScopeDiscovery;
      repositoryScopeProposals: RepositoryScopeProposalGroup[];
    }
  | {
      status: "error" | "unavailable";
      code?: string;
    };

type ScopeDrafts = Record<string, string>;
type ProposalDrafts = Record<string, string>;
type WorkflowSelection = ProjectWorkflowActionKind | "unknown";
type WorkflowDrafts = Record<string, WorkflowSelection>;

const SOURCE_ORDER = [
  "github",
  "codex",
  "notion",
  "google_calendar"
] as const;

export function ProjectMappings({
  defaultOpen = false
}: {
  defaultOpen?: boolean;
} = {}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [discovery, setDiscovery] =
    useState<SourceScopeDiscovery | null>(null);
  const [drafts, setDrafts] = useState<ScopeDrafts>({});
  const [repositoryScopeProposals, setRepositoryScopeProposals] =
    useState<RepositoryScopeProposalGroup[]>([]);
  const [proposalDrafts, setProposalDrafts] =
    useState<ProposalDrafts>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [savingScope, setSavingScope] = useState<string | null>(null);
  const [savingProposalGroup, setSavingProposalGroup] = useState<
    string | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [workflowProjection, setWorkflowProjection] =
    useState<ProjectWorkflowProjection | null>(null);
  const [workflowDrafts, setWorkflowDrafts] =
    useState<WorkflowDrafts>({});
  const [isWorkflowLoading, setIsWorkflowLoading] = useState(true);
  const [savingWorkflowProjectId, setSavingWorkflowProjectId] =
    useState<string | null>(null);
  const [workflowMessage, setWorkflowMessage] = useState<string | null>(
    null
  );
  const sequenceRef = useRef(0);
  const workflowSequenceRef = useRef(0);
  const workflowMutationActiveRef = useRef(false);

  const acceptContext = useCallback((next: Extract<ProjectContextResponse, { status: "ready" }>) => {
    setDiscovery(next.discovery);
    setRepositoryScopeProposals(next.repositoryScopeProposals);
    setDrafts((current) =>
      scopeDrafts(next.discovery.scopes, next.discovery.projects, current)
    );
    setProposalDrafts((current) =>
      repositoryProposalDrafts(
        next.repositoryScopeProposals,
        next.discovery.projects,
        current
      )
    );
  }, []);

  const load = useCallback(
    async (silent = false) => {
      const sequence = ++sequenceRef.current;
      if (!silent) setIsLoading(true);
      try {
        const response = await fetch("/api/context/projects", {
          cache: "no-store"
        });
        if (!response.ok) throw new Error("project context read failed");
        const payload = (await response.json()) as ProjectContextResponse;
        if (
          sequence !== sequenceRef.current ||
          payload.status !== "ready"
        ) {
          return;
        }
        acceptContext(payload);
      } catch {
        if (sequence === sequenceRef.current && !silent) {
          setMessage("프로젝트 연결 정보를 불러오지 못했습니다.");
        }
      } finally {
        if (sequence === sequenceRef.current && !silent) {
          setIsLoading(false);
        }
      }
    },
    [acceptContext]
  );

  const loadProjectWorkflows = useCallback(async (silent = false) => {
    if (workflowMutationActiveRef.current) return;
    const sequence = ++workflowSequenceRef.current;
    if (!silent) setIsWorkflowLoading(true);
    try {
      const payload = await fetchProjectWorkflows();
      if (sequence !== workflowSequenceRef.current) return;
      if (payload.status !== "ready") {
        if (!silent) {
          setWorkflowMessage(
            payload.status === "error"
              ? payload.message
              : "프로젝트 workflow를 로컬에서 확인할 수 없습니다."
          );
        }
        return;
      }
      setWorkflowProjection(payload.projection);
      if (!silent) setWorkflowMessage(null);
    } catch {
      if (sequence === workflowSequenceRef.current && !silent) {
        setWorkflowMessage("프로젝트 workflow를 불러오지 못했습니다.");
      }
    } finally {
      if (sequence === workflowSequenceRef.current && !silent) {
        setIsWorkflowLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
    void loadProjectWorkflows();
  }, [load, loadProjectWorkflows]);

  useSyncInvalidation(
    ["github", "codex", "notion", "google_calendar"],
    () => {
      if (
        !isCreating &&
        savingScope === null &&
        savingProposalGroup === null &&
        savingWorkflowProjectId === null
      ) {
        void load(true);
        void loadProjectWorkflows(true);
      }
    }
  );

  const scopesBySource = useMemo(() => {
    const grouped = new Map<
      DiscoverableSourceScope["scope"]["source"],
      DiscoverableSourceScope[]
    >();
    for (const source of SOURCE_ORDER) grouped.set(source, []);
    for (const scope of discovery?.scopes ?? []) {
      grouped.get(scope.scope.source)?.push(scope);
    }
    return grouped;
  }, [discovery]);

  async function createProject() {
    if (
      isCreating ||
      savingScope !== null ||
      savingWorkflowProjectId !== null ||
      isLoading
    ) {
      return;
    }
    const sequence = ++sequenceRef.current;
    setIsCreating(true);
    setMessage(null);
    try {
      const next = await mutateProjectContext({
        action: "create_project"
      });
      if (sequence !== sequenceRef.current) return;
      acceptContext(next);
      setMessage(
        "프로젝트를 만들었습니다. 아래 source를 확인한 뒤 연결하세요."
      );
    } catch {
      if (sequence === sequenceRef.current) {
        setMessage("프로젝트를 만들지 못했습니다.");
      }
    } finally {
      if (sequence === sequenceRef.current) setIsCreating(false);
    }
  }

  async function applyMapping(scope: DiscoverableSourceScope) {
    if (savingScope !== null || savingWorkflowProjectId !== null) return;
    const selectedProjectId =
      drafts[scope.scopeFingerprint] ?? "";
    if ((scope.projectId ?? "") === selectedProjectId) return;

    const sequence = ++sequenceRef.current;
    setSavingScope(scope.scopeFingerprint);
    setMessage(null);
    try {
      const next = await mutateProjectContext(
        selectedProjectId
          ? {
              action: "confirm_mapping",
              projectId: selectedProjectId,
              scope: scope.scope,
              explicitUserConfirmation: true
            }
          : {
              action: "remove_mapping",
              scope: scope.scope,
              explicitUserConfirmation: true
            }
      );
      if (sequence !== sequenceRef.current) return;
      acceptContext(next);
      setMessage(
        selectedProjectId
          ? "사용자 확인으로 프로젝트 연결을 반영했습니다."
          : "사용자 확인으로 프로젝트 연결을 해제했습니다."
      );
      syncInvalidationBus.invalidate({
        reason: "context_changed",
        targets: ["attention"]
      });
    } catch {
      if (sequence === sequenceRef.current) {
        setMessage("프로젝트 연결을 변경하지 못했습니다.");
      }
    } finally {
      if (sequence === sequenceRef.current) setSavingScope(null);
    }
  }

  async function applyRepositoryScopeProposal(
    group: RepositoryScopeProposalGroup
  ) {
    if (
      savingProposalGroup !== null ||
      savingScope !== null ||
      savingWorkflowProjectId !== null ||
      isCreating
    ) {
      return;
    }
    const selectedProjectId =
      proposalDrafts[group.proposalGroupId] ?? "";
    if (!selectedProjectId) return;

    const sequence = ++sequenceRef.current;
    setSavingProposalGroup(group.proposalGroupId);
    setMessage(null);
    try {
      const next = await mutateProjectContext({
        action: "confirm_repository_scope_proposal",
        proposalGroupId: group.proposalGroupId,
        projectId: selectedProjectId,
        explicitUserConfirmation: true
      });
      if (sequence !== sequenceRef.current) return;
      acceptContext(next);
      setMessage(
        "사용자 확인으로 GitHub 저장소와 Codex 범위를 함께 연결했습니다."
      );
      syncInvalidationBus.invalidate({
        reason: "context_changed",
        targets: ["attention"]
      });
    } catch {
      if (sequence === sequenceRef.current) {
        setMessage(
          "범위 제안이 변경되었거나 연결을 반영하지 못했습니다. 다시 확인하세요."
        );
      }
    } finally {
      if (sequence === sequenceRef.current) setSavingProposalGroup(null);
    }
  }

  async function applyWorkflow(project: DiscoverableProject) {
    if (
      workflowProjection === null ||
      savingWorkflowProjectId !== null ||
      savingScope !== null ||
      isCreating
    ) {
      return;
    }
    const selected =
      workflowDrafts[project.projectId] ??
      currentWorkflowAction(workflowProjection, project.projectId);
    const current = currentWorkflowAction(
      workflowProjection,
      project.projectId
    );
    if (selected === current) return;

    workflowMutationActiveRef.current = true;
    workflowSequenceRef.current += 1;
    setSavingWorkflowProjectId(project.projectId);
    setWorkflowMessage(null);
    try {
      const next =
        selected === "unknown"
          ? await clearProjectWorkflow({ projectId: project.projectId })
          : await configureProjectWorkflow({
              projectId: project.projectId,
              actionKind: selected
            });
      setWorkflowProjection(next);
      setWorkflowDrafts((drafts) => {
        const nextDrafts = { ...drafts };
        delete nextDrafts[project.projectId];
        return nextDrafts;
      });
      setWorkflowMessage(
        selected === "unknown"
          ? `${project.label}의 완료 후속 workflow를 해제했습니다.`
          : `${project.label}의 완료 후속 workflow를 설정했습니다.`
      );
      syncInvalidationBus.invalidate({
        reason: "context_changed",
        targets: ["attention"]
      });
    } catch {
      setWorkflowMessage("프로젝트 workflow를 변경하지 못했습니다.");
    } finally {
      workflowMutationActiveRef.current = false;
      setSavingWorkflowProjectId(null);
    }
  }

  const activeProjects =
    discovery?.projects.filter((project) => !project.archived) ?? [];
  const mappedCount =
    discovery?.scopes.filter((scope) => scope.projectId !== null)
      .length ?? 0;

  return (
    <details
      className="projectMappings"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary>
        <span>
          <strong>프로젝트 연결</strong>
          <small>
            {isLoading
              ? "확인 중"
              : `${mappedCount}/${discovery?.scopes.length ?? 0} source scope 연결됨`}
          </small>
        </span>
        <span>설정</span>
      </summary>

      <div className="projectMappingsBody" aria-busy={isLoading}>
        <div className="projectMappingsIntro">
          <p>
            같은 프로젝트에 속한 source를 직접 묶으면 Work Cockpit이
            주간 결과와 작업 맥락을 함께 판단할 수 있습니다.
          </p>
          <button
            type="button"
            onClick={() => void createProject()}
            disabled={
              isCreating ||
              savingScope !== null ||
              savingProposalGroup !== null ||
              savingWorkflowProjectId !== null ||
              isLoading
            }
          >
            {isCreating
              ? "만드는 중"
              : activeProjects.length === 0
                ? "Project 1 만들기"
                : "프로젝트 추가"}
          </button>
        </div>

        {!isLoading && (discovery?.scopes.length ?? 0) === 0 ? (
          <p className="projectMappingsEmpty">
            source를 연결하고 첫 snapshot이 수집되면 여기에서 프로젝트를
            묶을 수 있습니다.
          </p>
        ) : null}

        {activeProjects.length === 0 &&
        (discovery?.scopes.length ?? 0) > 0 ? (
          <p className="projectMappingsEmpty">
            먼저 프로젝트를 하나 만든 뒤 연결할 source를 확인하세요.
          </p>
        ) : null}

        {repositoryScopeProposals.length > 0 ? (
          <section
            className="projectMappingGroup"
            aria-labelledby="repository-scope-proposals"
          >
            <div>
              <h3 id="repository-scope-proposals">정확히 확인된 범위 묶음</h3>
              <span>{repositoryScopeProposals.length}개</span>
            </div>
            <ul>
              {repositoryScopeProposals.map((group) => {
                const selectedProjectId =
                  proposalDrafts[group.proposalGroupId] ?? "";
                const isSaving =
                  savingProposalGroup === group.proposalGroupId;
                const isLocked =
                  savingProposalGroup !== null ||
                  savingScope !== null ||
                  savingWorkflowProjectId !== null ||
                  isCreating;
                return (
                  <li key={group.proposalGroupId}>
                    <div className="projectMappingScope">
                      <strong>GitHub 저장소 + Codex 선택 범위</strong>
                      <span>{repositoryProposalReasonLabel(group.reason)}</span>
                    </div>
                    <label>
                      <span className="srOnly">두 범위를 연결할 프로젝트</span>
                      <select
                        value={selectedProjectId}
                        disabled={
                          isLocked || group.suggestedProjectId !== null
                        }
                        onChange={(event) =>
                          setProposalDrafts((current) => ({
                            ...current,
                            [group.proposalGroupId]: event.target.value
                          }))
                        }
                      >
                        <option value="">프로젝트 선택</option>
                        {activeProjects.map((project) => (
                          <option
                            key={project.projectId}
                            value={project.projectId}
                          >
                            {project.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={!selectedProjectId || isLocked}
                      onClick={() =>
                        void applyRepositoryScopeProposal(group)
                      }
                    >
                      {isSaving ? "연결 중" : "두 범위 연결"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {activeProjects.length > 0
          ? SOURCE_ORDER.map((source) => {
              const scopes = scopesBySource.get(source) ?? [];
              if (scopes.length === 0) return null;
              return (
                <section
                  className="projectMappingGroup"
                  key={source}
                  aria-labelledby={`project-mapping-${source}`}
                >
                  <div>
                    <h3 id={`project-mapping-${source}`}>
                      {sourceLabel(source)}
                    </h3>
                    <span>{scopes.length}개</span>
                  </div>
                  <ul>
                    {scopes.map((scope) => (
                      <ProjectMappingRow
                        key={scope.scopeFingerprint}
                        scope={scope}
                        projects={discovery?.projects ?? []}
                        selectedProjectId={
                          drafts[scope.scopeFingerprint] ?? ""
                        }
                        isSaving={
                          savingScope === scope.scopeFingerprint
                        }
                        isLocked={
                          savingScope !== null ||
                          savingProposalGroup !== null ||
                          savingWorkflowProjectId !== null ||
                          isCreating
                        }
                        onSelect={(projectId) =>
                          setDrafts((current) => ({
                            ...current,
                            [scope.scopeFingerprint]: projectId
                          }))
                        }
                        onApply={() => void applyMapping(scope)}
                      />
                    ))}
                  </ul>
                </section>
              );
            })
          : null}

        {activeProjects.length > 0 ? (
          <section
            className="projectWorkflowSettings"
            aria-labelledby="project-workflow-settings"
            aria-busy={isWorkflowLoading}
          >
            <div className="projectWorkflowSettingsHeader">
              <div>
                <h3 id="project-workflow-settings">완료 후속 workflow</h3>
                <p>
                  Codex managed run이 끝난 뒤 어떤 후속 작업을 제안할지
                  프로젝트별로 정합니다.
                </p>
              </div>
              <span>
                {isWorkflowLoading
                  ? "확인 중"
                  : `${workflowProjection?.activeWorkflows.length ?? 0}개 설정됨`}
              </span>
            </div>
            <ul>
              {activeProjects.map((project) => {
                const current = currentWorkflowAction(
                  workflowProjection,
                  project.projectId
                );
                const selected =
                  workflowDrafts[project.projectId] ?? current;
                return (
                  <ProjectWorkflowRow
                    key={project.projectId}
                    project={project}
                    current={current}
                    selected={selected}
                    isSaving={
                      savingWorkflowProjectId === project.projectId
                    }
                    isLocked={
                      workflowProjection === null ||
                      isWorkflowLoading ||
                      savingWorkflowProjectId !== null ||
                      savingScope !== null ||
                      savingProposalGroup !== null ||
                      isCreating
                    }
                    onSelect={(actionKind) =>
                      setWorkflowDrafts((currentDrafts) => ({
                        ...currentDrafts,
                        [project.projectId]: actionKind
                      }))
                    }
                    onApply={() => void applyWorkflow(project)}
                  />
                );
              })}
            </ul>
            <p className="projectWorkflowPolicy">
              기본값은 unknown이며 자동 후속 작업을 만들지 않습니다. 저장한
              시점 이후 시작한 managed run에만 적용하고, 완료 뒤 2분의
              유예가 지난 후 평가합니다. 완료 또는 건너뜀은 명시적으로
              기록됩니다.
            </p>
            {workflowMessage ? (
              <p className="projectMappingsMessage" role="status">
                {workflowMessage}
              </p>
            ) : null}
          </section>
        ) : null}

        {(discovery?.truncatedSources.length ?? 0) > 0 ? (
          <p className="projectMappingsNotice">
            항목이 많은 source는 일부만 표시합니다.
          </p>
        ) : null}
        <p className="projectMappingsNotice">
          이름이 비슷해도 자동으로 연결하지 않습니다. “연결” 또는 “연결
          해제”를 눌렀을 때만 반영됩니다.
        </p>
        {message ? (
          <p className="projectMappingsMessage" role="status">
            {message}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function ProjectMappingRow({
  scope,
  projects,
  selectedProjectId,
  isSaving,
  isLocked,
  onSelect,
  onApply
}: {
  scope: DiscoverableSourceScope;
  projects: DiscoverableProject[];
  selectedProjectId: string;
  isSaving: boolean;
  isLocked: boolean;
  onSelect: (projectId: string) => void;
  onApply: () => void;
}) {
  const changed = selectedProjectId !== (scope.projectId ?? "");
  const selectedProject = projects.find(
    (project) => project.projectId === selectedProjectId
  );
  return (
    <li>
      <div className="projectMappingScope">
        <strong>{scope.label}</strong>
        <span>{scopeTypeLabel(scope)}</span>
      </div>
      <label>
        <span className="srOnly">{scope.label} 프로젝트</span>
        <select
          value={selectedProjectId}
          disabled={isLocked}
          onChange={(event) => onSelect(event.target.value)}
        >
          <option value="">연결 안 함</option>
          {projects.map((project) => (
            <option
              key={project.projectId}
              value={project.projectId}
              disabled={project.archived}
            >
              {project.label}
              {project.archived ? " (보관됨)" : ""}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={!changed || isLocked}
        onClick={onApply}
        aria-label={`${scope.label} ${mappingButtonLabel(
          selectedProject,
          selectedProjectId,
          changed,
          isSaving
        )}`}
      >
        {mappingButtonLabel(
          selectedProject,
          selectedProjectId,
          changed,
          isSaving
        )}
      </button>
    </li>
  );
}

function ProjectWorkflowRow({
  project,
  current,
  selected,
  isSaving,
  isLocked,
  onSelect,
  onApply
}: {
  project: DiscoverableProject;
  current: WorkflowSelection;
  selected: WorkflowSelection;
  isSaving: boolean;
  isLocked: boolean;
  onSelect: (actionKind: WorkflowSelection) => void;
  onApply: () => void;
}) {
  const changed = selected !== current;
  return (
    <li>
      <div className="projectWorkflowProject">
        <strong>{project.label}</strong>
        <span>
          {current === "unknown"
            ? "현재 unknown · 자동 후속 작업 없음"
            : `현재 ${workflowActionLabel(current)}`}
        </span>
      </div>
      <label>
        <span className="srOnly">{project.label} 완료 후속 workflow</span>
        <select
          value={selected}
          disabled={isLocked}
          onChange={(event) =>
            onSelect(event.target.value as WorkflowSelection)
          }
        >
          <option value="unknown">설정 안 함 (unknown)</option>
          <option value="review_changes">변경 검토</option>
          <option value="commit_changes">커밋</option>
          <option value="create_pull_request">PR 생성</option>
          <option value="request_review">리뷰 요청</option>
        </select>
      </label>
      <button
        type="button"
        disabled={!changed || isLocked}
        onClick={onApply}
      >
        {isSaving
          ? "반영 중"
          : !changed
            ? "반영됨"
            : selected === "unknown"
              ? "설정 해제"
              : "workflow 설정"}
      </button>
    </li>
  );
}

function scopeDrafts(
  scopes: DiscoverableSourceScope[],
  projects: DiscoverableProject[],
  current: ScopeDrafts
): ScopeDrafts {
  const defaultProjectId =
    projects.filter((project) => !project.archived).length === 1
      ? projects.find((project) => !project.archived)?.projectId ?? ""
      : "";
  return Object.fromEntries(
    scopes.map((scope) => [
      scope.scopeFingerprint,
      scope.projectId ??
        current[scope.scopeFingerprint] ??
        defaultProjectId
    ])
  );
}

function repositoryProposalDrafts(
  groups: RepositoryScopeProposalGroup[],
  projects: DiscoverableProject[],
  current: ProposalDrafts
): ProposalDrafts {
  const activeProjectIds = new Set(
    projects
      .filter((project) => !project.archived)
      .map((project) => project.projectId)
  );
  return Object.fromEntries(
    groups.map((group) => {
      const preserved = current[group.proposalGroupId];
      return [
        group.proposalGroupId,
        group.suggestedProjectId ??
          (preserved && activeProjectIds.has(preserved) ? preserved : "")
      ];
    })
  );
}

function repositoryProposalReasonLabel(
  reason: RepositoryScopeProposalGroup["reason"]
): string {
  switch (reason) {
    case "EXISTING_PROJECT_MAPPING":
      return "기존 연결과 일치";
    case "SOLE_ACTIVE_PROJECT":
      return "유일한 활성 프로젝트";
    case "USER_SELECTION_REQUIRED":
      return "프로젝트 선택 필요";
  }
}

function currentWorkflowAction(
  projection: ProjectWorkflowProjection | null,
  projectId: string
): WorkflowSelection {
  return (
    projection?.activeWorkflows.find(
      (workflow) => workflow.projectId === projectId
    )?.actionKind ?? "unknown"
  );
}

function workflowActionLabel(
  actionKind: ProjectWorkflowActionKind
): string {
  switch (actionKind) {
    case "review_changes":
      return "변경 검토";
    case "commit_changes":
      return "커밋";
    case "create_pull_request":
      return "PR 생성";
    case "request_review":
      return "리뷰 요청";
  }
}

function mappingButtonLabel(
  project: DiscoverableProject | undefined,
  projectId: string,
  changed: boolean,
  isSaving: boolean
): string {
  if (isSaving) return "반영 중";
  if (!changed) return "반영됨";
  if (!projectId) return "연결 해제";
  return `${project?.label ?? "프로젝트"}에 연결`;
}

function sourceLabel(
  source: DiscoverableSourceScope["scope"]["source"]
): string {
  switch (source) {
    case "github":
      return "GitHub";
    case "codex":
      return "Codex";
    case "notion":
      return "Notion";
    case "google_calendar":
      return "Google Calendar";
  }
}

function scopeTypeLabel(scope: DiscoverableSourceScope): string {
  switch (scope.scope.source) {
    case "github":
      return "Repository";
    case "codex":
      return "Selected scope";
    case "notion":
      return scope.scope.resourceType === "resource"
        ? "Resource"
        : "Scope";
    case "google_calendar":
      return "Primary scope";
  }
}

async function mutateProjectContext(
  body: Record<string, unknown>
): Promise<Extract<ProjectContextResponse, { status: "ready" }>> {
  const response = await fetch("/api/context/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error("project context mutation failed");
  const payload = (await response.json()) as ProjectContextResponse;
  if (payload.status !== "ready") {
    throw new Error("project context response was not ready");
  }
  return payload;
}
