import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/context")>();
  return {
    ...actual,
    confirmStoredRepositoryScopeProposal: vi.fn(),
    confirmStoredProjectMapping: vi.fn(),
    readStoredRepositoryScopeProposals: vi.fn(),
    readStoredSourceScopeDiscovery: vi.fn(),
    readWorkContextRegistry: vi.fn()
  };
});

import {
  GET,
  POST
} from "../app/api/context/projects/route";
import {
  WorkContextStoreError,
  confirmStoredRepositoryScopeProposal,
  confirmStoredProjectMapping,
  createEmptyWorkContextRegistry,
  createProjectIdentity,
  readStoredRepositoryScopeProposals,
  readStoredSourceScopeDiscovery,
  readWorkContextRegistry
} from "../src/context";

const PROJECT_ID = `project_${"1".repeat(32)}`;
const discovery = {
  contract: "source-scope-discovery-v1" as const,
  projects: [
    {
      projectId: PROJECT_ID,
      label: "Project 1",
      archived: false
    }
  ],
  scopes: [
    {
      scopeFingerprint: "f".repeat(64),
      scope: {
        source: "github" as const,
        resourceType: "repository" as const,
        opaqueId: "101"
      },
      label: "owner/repository",
      projectId: null
    }
  ],
  truncatedSources: []
};
const registry = createProjectIdentity(
  createEmptyWorkContextRegistry("2026-08-09T00:00:00.000Z"),
  { projectId: PROJECT_ID, createdAt: "2026-08-09T00:00:00.000Z" }
).registry;
const repositoryScopeProposal = {
  proposalGroupId: `repository_scope_group_${"a".repeat(32)}`,
  scopes: {
    github: discovery.scopes[0].scope,
    codex: {
      source: "codex" as const,
      resourceType: "scope" as const,
      opaqueId: "b".repeat(24)
    }
  },
  suggestedProjectId: PROJECT_ID,
  reason: "SOLE_ACTIVE_PROJECT" as const
};

beforeEach(() => {
  vi.mocked(readStoredRepositoryScopeProposals).mockResolvedValue({
    status: "ready",
    groups: []
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("project mapping route discovery", () => {
  it("returns the safe discovery view from a local read", async () => {
    setDevelopment();
    vi.mocked(readWorkContextRegistry).mockResolvedValue({
      status: "missing"
    });
    vi.mocked(readStoredSourceScopeDiscovery).mockResolvedValue(
      discovery
    );

    const response = await GET(
      new Request("http://localhost:3102/api/context/projects")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      registry: null,
      discovery,
      repositoryScopeProposals: []
    });
    expect(readStoredSourceScopeDiscovery).toHaveBeenCalledWith({
      registry: null
    });
  });

  it("re-resolves an opaque group and confirms both scopes atomically", async () => {
    setDevelopment();
    vi.mocked(readWorkContextRegistry).mockResolvedValue({
      status: "available",
      value: registry
    });
    vi.mocked(readStoredSourceScopeDiscovery).mockResolvedValue(discovery);
    vi.mocked(readStoredRepositoryScopeProposals).mockResolvedValue({
      status: "ready",
      groups: [repositoryScopeProposal]
    });

    const response = await POST(
      mutationRequest({
        action: "confirm_repository_scope_proposal",
        proposalGroupId: repositoryScopeProposal.proposalGroupId,
        projectId: PROJECT_ID,
        explicitUserConfirmation: true
      })
    );

    expect(response.status).toBe(200);
    expect(confirmStoredRepositoryScopeProposal).toHaveBeenCalledOnce();
    expect(confirmStoredRepositoryScopeProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        githubScope: repositoryScopeProposal.scopes.github,
        codexScope: repositoryScopeProposal.scopes.codex,
        projectId: PROJECT_ID,
        expectedRegistrySha256: registry.registrySha256,
        explicitUserConfirmation: true
      })
    );
  });

  it("rejects missing confirmation, stale groups, conflicts, and stale registry races", async () => {
    setDevelopment();
    vi.mocked(readWorkContextRegistry).mockResolvedValue({
      status: "available",
      value: registry
    });
    vi.mocked(readStoredSourceScopeDiscovery).mockResolvedValue(discovery);

    const missingLiteral = await POST(
      mutationRequest({
        action: "confirm_repository_scope_proposal",
        proposalGroupId: repositoryScopeProposal.proposalGroupId,
        projectId: PROJECT_ID
      })
    );
    expect(missingLiteral.status).toBe(400);

    const stale = await POST(
      mutationRequest({
        action: "confirm_repository_scope_proposal",
        proposalGroupId: repositoryScopeProposal.proposalGroupId,
        projectId: PROJECT_ID,
        explicitUserConfirmation: true
      })
    );
    expect(stale.status).toBe(409);

    vi.mocked(readStoredRepositoryScopeProposals).mockResolvedValue({
      status: "conflict",
      groups: []
    });
    const conflicted = await POST(
      mutationRequest({
        action: "confirm_repository_scope_proposal",
        proposalGroupId: repositoryScopeProposal.proposalGroupId,
        projectId: PROJECT_ID,
        explicitUserConfirmation: true
      })
    );
    expect(conflicted.status).toBe(409);

    vi.mocked(readStoredRepositoryScopeProposals).mockResolvedValue({
      status: "ready",
      groups: [repositoryScopeProposal]
    });
    vi.mocked(confirmStoredRepositoryScopeProposal).mockRejectedValueOnce(
      new WorkContextStoreError("STALE_REGISTRY")
    );
    const raced = await POST(
      mutationRequest({
        action: "confirm_repository_scope_proposal",
        proposalGroupId: repositoryScopeProposal.proposalGroupId,
        projectId: PROJECT_ID,
        explicitUserConfirmation: true
      })
    );
    expect(raced.status).toBe(409);
  });

  it("keeps repository-scope confirmation same-origin", async () => {
    setDevelopment();
    const response = await POST(
      mutationRequest(
        {
          action: "confirm_repository_scope_proposal",
          proposalGroupId: repositoryScopeProposal.proposalGroupId,
          projectId: PROJECT_ID,
          explicitUserConfirmation: true
        },
        "https://untrusted.example"
      )
    );
    expect(response.status).toBe(403);
    expect(readStoredRepositoryScopeProposals).not.toHaveBeenCalled();
    expect(confirmStoredRepositoryScopeProposal).not.toHaveBeenCalled();
  });

  it("requires the explicit confirmation literal before mapping", async () => {
    setDevelopment();
    vi.mocked(readWorkContextRegistry).mockResolvedValue({
      status: "missing"
    });
    vi.mocked(readStoredSourceScopeDiscovery).mockResolvedValue(
      discovery
    );

    const rejected = await POST(
      mutationRequest({
        action: "confirm_mapping",
        projectId: PROJECT_ID,
        scope: discovery.scopes[0].scope
      })
    );
    const confirmed = await POST(
      mutationRequest({
        action: "confirm_mapping",
        projectId: PROJECT_ID,
        scope: discovery.scopes[0].scope,
        explicitUserConfirmation: true
      })
    );

    expect(rejected.status).toBe(400);
    expect(confirmed.status).toBe(200);
    expect(confirmStoredProjectMapping).toHaveBeenCalledOnce();
    expect(confirmStoredProjectMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        explicitUserConfirmation: true
      })
    );
  });
});

function setDevelopment() {
  vi.stubEnv("NODE_ENV", "development");
}

function mutationRequest(
  body: unknown,
  origin = "http://localhost:3102"
): Request {
  return new Request(
    "http://localhost:3102/api/context/projects",
    {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );
}
