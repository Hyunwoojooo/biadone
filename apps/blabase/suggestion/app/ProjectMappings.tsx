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
import { syncInvalidationBus } from "./sync/invalidationBus";
import { useSyncInvalidation } from "./sync/useSourceSync";

type ProjectContextResponse =
  | {
      status: "ready";
      discovery: SourceScopeDiscovery;
    }
  | {
      status: "error" | "unavailable";
      code?: string;
    };

type ScopeDrafts = Record<string, string>;

const SOURCE_ORDER = [
  "github",
  "codex",
  "notion",
  "google_calendar"
] as const;

export function ProjectMappings() {
  const [discovery, setDiscovery] =
    useState<SourceScopeDiscovery | null>(null);
  const [drafts, setDrafts] = useState<ScopeDrafts>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [savingScope, setSavingScope] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const sequenceRef = useRef(0);

  const acceptDiscovery = useCallback((next: SourceScopeDiscovery) => {
    setDiscovery(next);
    setDrafts((current) =>
      scopeDrafts(next.scopes, next.projects, current)
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
        acceptDiscovery(payload.discovery);
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
    [acceptDiscovery]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useSyncInvalidation(
    ["github", "codex", "notion", "google_calendar"],
    () => {
      if (!isCreating && savingScope === null) void load(true);
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
    if (isCreating || savingScope !== null || isLoading) return;
    const sequence = ++sequenceRef.current;
    setIsCreating(true);
    setMessage(null);
    try {
      const next = await mutateProjectContext({
        action: "create_project"
      });
      if (sequence !== sequenceRef.current) return;
      acceptDiscovery(next);
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
    if (savingScope !== null) return;
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
      acceptDiscovery(next);
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

  const activeProjects =
    discovery?.projects.filter((project) => !project.archived) ?? [];
  const mappedCount =
    discovery?.scopes.filter((scope) => scope.projectId !== null)
      .length ?? 0;

  return (
    <details className="projectMappings">
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
              isCreating || savingScope !== null || isLoading
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
                          savingScope !== null || isCreating
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
): Promise<SourceScopeDiscovery> {
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
  return payload.discovery;
}
