import {
  managedCodexPublicProjectionDependencySha256,
  managedCodexRunStartTimesSha256,
  resolveActiveAttention,
  type ActiveAttentionCandidate,
  type ActiveAttentionInput,
  type ActiveAttentionResult
} from "../../src/attentionDecision";
import type { ManagedCodexArtifactRelationProjection } from "../../src/artifacts";
import type { ClaimAuthorityProjection } from "../../src/claims";
import {
  compareRuntimeStrings,
  runtimeSha256
} from "../../src/crossSource/canonicalHash";
import {
  RECENT_MEANINGFUL_EVENT_ID_POLICY_VERSION,
  RECENT_MEANINGFUL_EVENT_PROJECTION_CONTRACT,
  RECENT_MEANINGFUL_EVENT_RULE_VERSION,
  RECENT_MEANINGFUL_EVENT_SCHEMA_VERSION
} from "../../src/crossSource/versions";
import {
  createFocusEvidenceRef,
  createFocusIdentityRef,
  createFocusSubjectRef,
  createRecentEventDiagnosticId,
  createRecentMeaningfulEventId,
  projectRecentMeaningfulEvents,
  sealRecentMeaningfulEvent,
  sealRecentMeaningfulEventProjection,
  type RecentEventDiagnostic,
  type RecentMeaningfulEvent,
  type RecentMeaningfulEventProjection
} from "../../src/recentEvents";
import type { ManagedCodexPublicProjection } from "../../src/managedCodex";
import type { ManagedCodexWorkRelationProjection } from "../../src/relations";
import {
  ACTIVE_FIXTURE_AS_OF,
  ACTIVE_FIXTURE_PROJECT_ID,
  activeAttentionFixture,
  type ActiveAttentionFixtureOptions
} from "../../tests/fixtures/activeAttentionFixture";

export const CURRENT_FOCUS_EVALUATION_SCENARIOS = [
  "codex_push_ci_failure",
  "push_then_pr_merged",
  "many_old_one_new",
  "heartbeat_after_meaningful",
  "same_title_distinct_identity",
  "healthy_managed_run",
  "stale_partial_source",
  "out_of_order_duplicate_equal_time",
  "context_only_sources_recent",
  "focus_cannot_override_gates",
  "input_permutation",
  "dependency_hash_tamper",
  "public_projection_privacy"
] as const;

export type CurrentFocusEvaluationScenario =
  (typeof CURRENT_FOCUS_EVALUATION_SCENARIOS)[number];

type RecentMeaningfulEventKind = RecentMeaningfulEvent["kind"];

export const CURRENT_FOCUS_PRIVATE_SENTINELS = [
  "token_SYNTHETIC_CURRENT_FOCUS_PRIVATE",
  "/Users/synthetic/private/project/secret.ts",
  "raw-thread-current-focus-private",
  "rm -rf synthetic-private-command",
  "synthetic private full conversation body",
  "0123456789abcdef0123456789abcdef01234567"
] as const;

export type CurrentFocusEvaluationExpectation = {
  focusDisposition: "selected" | "abstained" | "rejected";
  selectedIdentityRef: string | null;
  latestEventId: string | null;
  latestEventKind: RecentMeaningfulEventKind | null;
  workstreamCount: number | null;
  completionState:
    | "active"
    | "completed"
    | "cancelled"
    | "execution_completed"
    | "unknown"
    | null;
  wouldSwitch: boolean;
  activeCandidateCount: number | null;
  duplicateCount: number | null;
  requiresHeartbeatExclusion: boolean;
  requiresDistinctIdentityStreams: boolean;
  requiresContextOnlyIsolation: boolean;
  requiresCurrentnessAbstention: boolean;
  requiresPermutationDeterminism: boolean;
  requiresDependencyRejection: boolean;
  requiresPrivacyIsolation: boolean;
};

export type CurrentFocusEvaluationInput = {
  asOf: string;
  recentEventProjection: RecentMeaningfulEventProjection;
  activeAttentionInput: ActiveAttentionInput;
  activeAttentionResult: ActiveAttentionResult;
  managedPublicProjection: ManagedCodexPublicProjection;
  workRelationProjection: ManagedCodexWorkRelationProjection;
  artifactRelationProjection: ManagedCodexArtifactRelationProjection;
  claimAuthorityProjection: ClaimAuthorityProjection;
  eligibilityProjectionSha256: string;
};

export type CurrentFocusEvaluationFixture = {
  scenario: CurrentFocusEvaluationScenario;
  input: CurrentFocusEvaluationInput;
  permutedRecentEventProjection: RecentMeaningfulEventProjection | null;
  tamperedWorkRelationProjectionSha256: string | null;
  expectation: CurrentFocusEvaluationExpectation;
  privateSourceContext: Record<string, string> | null;
  privateSentinels: readonly string[];
};

type ActiveFixture = ReturnType<typeof activeAttentionFixture>;

type BaseFixture = ActiveFixture & {
  activeInput: ActiveAttentionInput;
  activeResult: ActiveAttentionResult;
};

type EventOptions = {
  key: string;
  candidate?: ActiveAttentionCandidate | null;
  source?: RecentMeaningfulEvent["source"];
  kind: RecentMeaningfulEventKind;
  occurredAt: string;
  identityRef?: string;
  identityRefs?: string[];
  claimTargetRefs?: string[];
  relationRefs?: string[];
  projectId?: string | null;
  identityScope?: RecentMeaningfulEvent["identityScope"];
  currentness?: RecentMeaningfulEvent["currentness"];
  completeness?: RecentMeaningfulEvent["completeness"];
  semanticRole?: RecentMeaningfulEvent["semanticRole"];
  attentionCapability?: RecentMeaningfulEvent["attentionCapability"];
  timeBasis?: RecentMeaningfulEvent["timeBasis"];
  sourceUpdatedAt?: string | null;
  observedAt?: string;
  displayLabel?: string;
};

/**
 * Builds bounded synthetic inputs for the mutable Current Focus Dev Candidate.
 * Raw source payloads are intentionally not returned to the evaluator record;
 * only their canonical materialized-input hash is retained.
 */
export function buildCurrentFocusEvaluationFixture(
  scenario: CurrentFocusEvaluationScenario
): CurrentFocusEvaluationFixture {
  switch (scenario) {
    case "codex_push_ci_failure":
      return exactFocusSwitchFixture(scenario);
    case "push_then_pr_merged":
      return terminalHistoryFixture(scenario);
    case "many_old_one_new":
      return manyOldOneNewFixture(scenario);
    case "heartbeat_after_meaningful":
      return managedDirectFixture(scenario, true);
    case "same_title_distinct_identity":
      return distinctIdentityFixture(scenario);
    case "healthy_managed_run":
      return managedDirectFixture(scenario, false);
    case "stale_partial_source":
      return stalePartialFixture(scenario);
    case "out_of_order_duplicate_equal_time":
      return duplicatePermutationFixture(scenario);
    case "context_only_sources_recent":
      return contextOnlyFixture(scenario);
    case "focus_cannot_override_gates":
      return hardGateFixture(scenario);
    case "input_permutation":
      return inputPermutationFixture(scenario);
    case "dependency_hash_tamper":
      return dependencyTamperFixture(scenario);
    case "public_projection_privacy":
      return privacyFixture(scenario);
  }
}

function exactFocusSwitchFixture(
  scenario: CurrentFocusEvaluationScenario
): CurrentFocusEvaluationFixture {
  const base = baseFixture({
    githubKind: "authored_pull_request",
    githubTitle: "Synthetic authored pull request",
    githubActionability: failingActionability(),
    githubPushOccurredAt: "2026-08-02T02:57:00.000Z",
    managedScenario: "running",
    artifactKind: "github_commit"
  });
  const target = requireCandidate(base.activeResult, 0);
  const relation = base.workRelations.relations[0];
  const artifactRelation = base.artifacts.relations[0];
  if (!relation || !artifactRelation) {
    throw new TypeError(
      "Synthetic managed Focus case requires verified work and artifact relations."
    );
  }
  if (target.githubSubjectId !== relation.to.subjectId) {
    throw new TypeError(
      "Synthetic managed Focus target must match the authored pull request."
    );
  }
  const managedProjection = sourceProjection(base);
  const managedEvent = managedProjection.events.find(
    (event) =>
      event.source === "codex_managed" &&
      event.relationRefs.includes(relation.relationId) &&
      event.relationRefs.includes(artifactRelation.relationId)
  );
  if (!managedEvent) {
    throw new TypeError(
      "Synthetic managed Focus event is missing its verified evidence graph."
    );
  }
  const ciFailure = managedProjection.events.find(
    (event) =>
      event.kind === "github_ci_failed" &&
      event.claimTargetRefs.includes(target.targetRef)
  );
  if (!ciFailure) {
    throw new TypeError(
      "Synthetic authored pull request requires a current CI failure observation."
    );
  }
  const push = managedProjection.events.find(
    (event) =>
      event.kind === "github_push" &&
      event.identityScope === "exact_task" &&
      event.relationRefs.includes(relation.relationId) &&
      event.relationRefs.includes(artifactRelation.relationId) &&
      event.claimTargetRefs.includes(target.targetRef)
  );
  if (!push) {
    throw new TypeError(
      "Synthetic v4 GitHub push was not projected through verified production artifact evidence."
    );
  }
  return fixture(base, scenario, managedProjection, {
    focusDisposition: "selected",
    selectedIdentityRef: managedEvent.identityRefs[0]!,
    latestEventId: ciFailure.eventId,
    latestEventKind: ciFailure.kind,
    workstreamCount: 1,
    completionState: "active",
    wouldSwitch: false,
    activeCandidateCount: 1,
    duplicateCount: managedProjection.counts.duplicate
  });
}

function terminalHistoryFixture(
  scenario: CurrentFocusEvaluationScenario
): CurrentFocusEvaluationFixture {
  const base = baseFixture({ githubKind: "none" });
  const identityRef = createFocusIdentityRef({
    scenario,
    source: "github",
    object: "merged-pr"
  });
  const push = eventFor(base, {
    key: `${scenario}-push`,
    kind: "github_push",
    occurredAt: "2026-08-02T02:57:00.000Z",
    identityRef,
    projectId: ACTIVE_FIXTURE_PROJECT_ID,
    displayLabel: "Pushed synthetic pull request commit"
  });
  const event = eventFor(base, {
    key: scenario,
    kind: "github_pull_request_merged",
    occurredAt: "2026-08-02T02:59:00.000Z",
    identityRef,
    projectId: ACTIVE_FIXTURE_PROJECT_ID,
    semanticRole: "completion",
    displayLabel: "Merged synthetic pull request"
  });
  const projection = manualProjection(base, [push, event]);
  return fixture(base, scenario, projection, {
    focusDisposition: "selected",
    selectedIdentityRef: identityRef,
    latestEventId: event.eventId,
    latestEventKind: event.kind,
    workstreamCount: 1,
    completionState: "completed",
    wouldSwitch: false,
    activeCandidateCount: 0,
    duplicateCount: 0
  });
}

function manyOldOneNewFixture(
  scenario: CurrentFocusEvaluationScenario
): CurrentFocusEvaluationFixture {
  const base = baseFixture({ githubKind: "assigned_issue" });
  const candidate = requireCandidate(base.activeResult, 0);
  const events = Array.from({ length: 13 }, (_, index) =>
    eventFor(base, {
      key: `${scenario}-${index}`,
      candidate,
      kind: index === 12 ? "github_issue_reopened" : "github_push",
      occurredAt:
        index === 12
          ? "2026-08-02T02:59:00.000Z"
          : new Date(
              Date.parse("2026-07-20T00:00:00.000Z") +
                index * 60_000
            ).toISOString()
    })
  );
  const latest = events.at(-1)!;
  const projection = manualProjection(base, events);
  return fixture(base, scenario, projection, {
    focusDisposition: "selected",
    selectedIdentityRef: latest.identityRefs[0]!,
    latestEventId: latest.eventId,
    latestEventKind: latest.kind,
    workstreamCount: 1,
    completionState: "active",
    wouldSwitch: false,
    activeCandidateCount: 1,
    duplicateCount: 0
  });
}

function managedDirectFixture(
  scenario: CurrentFocusEvaluationScenario,
  requireHeartbeatExclusion: boolean
): CurrentFocusEvaluationFixture {
  const base = baseFixture({
    githubKind: "assigned_issue",
    managedScenario: "running"
  });
  const projection = sourceProjection(base);
  const latestDirect = projection.events.find(
    (event) =>
      event.source === "codex_managed" &&
      event.attentionCapability === "focus_selector"
  );
  if (!latestDirect) {
    throw new TypeError("Synthetic managed Focus event was not projected.");
  }
  return fixture(base, scenario, projection, {
    focusDisposition: "selected",
    selectedIdentityRef: latestDirect.identityRefs[0]!,
    latestEventId: latestDirect.eventId,
    latestEventKind: latestDirect.kind,
    workstreamCount: null,
    completionState: null,
    wouldSwitch: false,
    activeCandidateCount: 1,
    duplicateCount: projection.counts.duplicate,
    requiresHeartbeatExclusion: requireHeartbeatExclusion
  });
}

function distinctIdentityFixture(
  scenario: CurrentFocusEvaluationScenario
): CurrentFocusEvaluationFixture {
  const base = baseFixture({
    githubKind: "assigned_issue",
    githubTitle: "Identical synthetic title",
    additionalGitHubTasks: [
      {
        id: 502,
        kind: "assigned_issue",
        number: 43,
        title: "Identical synthetic title"
      }
    ]
  });
  const first = requireCandidate(base.activeResult, 0);
  const second = requireCandidate(base.activeResult, 1);
  const firstEvent = eventFor(base, {
    key: `${scenario}-first`,
    candidate: first,
    kind: "github_issue_reopened",
    occurredAt: "2026-08-02T02:58:00.000Z",
    displayLabel: "Identical synthetic title"
  });
  const secondEvent = eventFor(base, {
    key: `${scenario}-second`,
    candidate: second,
    kind: "github_issue_reopened",
    occurredAt: "2026-08-02T02:59:00.000Z",
    displayLabel: "Identical synthetic title"
  });
  const projection = manualProjection(base, [secondEvent, firstEvent]);
  return fixture(base, scenario, projection, {
    focusDisposition: "selected",
    selectedIdentityRef: secondEvent.identityRefs[0]!,
    latestEventId: secondEvent.eventId,
    latestEventKind: secondEvent.kind,
    workstreamCount: 2,
    completionState: "active",
    wouldSwitch: true,
    activeCandidateCount: 2,
    duplicateCount: 0,
    requiresDistinctIdentityStreams: true
  });
}

function stalePartialFixture(
  scenario: CurrentFocusEvaluationScenario
): CurrentFocusEvaluationFixture {
  const base = baseFixture({ githubKind: "assigned_issue" });
  const candidate = requireCandidate(base.activeResult, 0);
  const event = eventFor(base, {
    key: scenario,
    candidate,
    kind: "github_issue_reopened",
    occurredAt: "2026-08-02T02:59:00.000Z",
    currentness: "partial",
    completeness: "partial",
    attentionCapability: "historical_context_only"
  });
  const projection = manualProjection(base, [event]);
  return fixture(base, scenario, projection, {
    focusDisposition: "abstained",
    selectedIdentityRef: null,
    latestEventId: null,
    latestEventKind: null,
    workstreamCount: 1,
    completionState: null,
    wouldSwitch: false,
    activeCandidateCount: 1,
    duplicateCount: 0,
    requiresCurrentnessAbstention: true
  });
}

function duplicatePermutationFixture(
  scenario: CurrentFocusEvaluationScenario
): CurrentFocusEvaluationFixture {
  const base = baseFixture({ githubKind: "assigned_issue" });
  const candidate = requireCandidate(base.activeResult, 0);
  const first = eventFor(base, {
    key: `${scenario}-a`,
    candidate,
    kind: "github_push",
    occurredAt: "2026-08-02T02:59:00.000Z"
  });
  const second = eventFor(base, {
    key: `${scenario}-b`,
    candidate,
    kind: "github_issue_reopened",
    occurredAt: "2026-08-02T02:59:00.000Z"
  });
  const projection = manualProjection(base, [second, first, first]);
  const permuted = manualProjection(base, [first, first, second]);
  const expectedLatest = projection.events[0]!;
  return fixture(
    base,
    scenario,
    projection,
    {
      focusDisposition: "selected",
      selectedIdentityRef: expectedLatest.identityRefs[0]!,
      latestEventId: expectedLatest.eventId,
      latestEventKind: expectedLatest.kind,
      workstreamCount: 1,
      completionState: "active",
      wouldSwitch: false,
      activeCandidateCount: 1,
      duplicateCount: 1,
      requiresPermutationDeterminism: true
    },
    { permutedRecentEventProjection: permuted }
  );
}

function contextOnlyFixture(
  scenario: CurrentFocusEvaluationScenario
): CurrentFocusEvaluationFixture {
  const base = baseFixture({ githubKind: "none" });
  const identityRef = createFocusIdentityRef({
    scenario,
    source: "codex_inventory",
    projectId: ACTIVE_FIXTURE_PROJECT_ID
  });
  const event = eventFor(base, {
    key: scenario,
    source: "codex_inventory",
    kind: "codex_project_activity",
    occurredAt: "2026-08-02T02:59:30.000Z",
    identityRef,
    projectId: ACTIVE_FIXTURE_PROJECT_ID,
    identityScope: "project",
    currentness: "historical_only",
    semanticRole: "historical_context",
    attentionCapability: "historical_context_only",
    displayLabel: "Historical Codex inventory"
  });
  const projection = manualProjection(base, [event]);
  return fixture(
    base,
    scenario,
    projection,
    {
      focusDisposition: "abstained",
      selectedIdentityRef: null,
      latestEventId: null,
      latestEventKind: null,
      workstreamCount: 1,
      completionState: null,
      wouldSwitch: false,
      activeCandidateCount: 0,
      duplicateCount: 0,
      requiresContextOnlyIsolation: true,
      requiresPrivacyIsolation: true
    },
    {
      privateSourceContext: {
        notion: "NOTION_CONTEXT_ONLY_SENTINEL",
        googleCalendar: "CALENDAR_CONTEXT_ONLY_SENTINEL"
      },
      privateSentinels: [
        "NOTION_CONTEXT_ONLY_SENTINEL",
        "CALENDAR_CONTEXT_ONLY_SENTINEL"
      ]
    }
  );
}

function hardGateFixture(
  scenario: CurrentFocusEvaluationScenario
): CurrentFocusEvaluationFixture {
  const base = baseFixture({ githubKind: "authored_pull_request" });
  const targetRef = base.claims.claims.find(
    (claim) => claim.target.kind === "github_work_item"
  )?.target.ref;
  if (!targetRef) {
    throw new TypeError("Synthetic authored PR claim target is missing.");
  }
  const identityRef = createFocusIdentityRef({ scenario, targetRef });
  const event = eventFor(base, {
    key: scenario,
    kind: "github_pull_request_opened",
    occurredAt: "2026-08-02T02:59:00.000Z",
    identityRef,
    projectId: ACTIVE_FIXTURE_PROJECT_ID,
    displayLabel: "Ineligible authored pull request"
  }, [targetRef]);
  const projection = manualProjection(base, [event]);
  return fixture(base, scenario, projection, {
    focusDisposition: "selected",
    selectedIdentityRef: identityRef,
    latestEventId: event.eventId,
    latestEventKind: event.kind,
    workstreamCount: 1,
    completionState: "active",
    wouldSwitch: false,
    activeCandidateCount: 0,
    duplicateCount: 0
  });
}

function inputPermutationFixture(
  scenario: CurrentFocusEvaluationScenario
): CurrentFocusEvaluationFixture {
  const base = baseFixture({ githubKind: "assigned_issue" });
  const candidate = requireCandidate(base.activeResult, 0);
  const events = [
    eventFor(base, {
      key: `${scenario}-old`,
      candidate,
      kind: "github_push",
      occurredAt: "2026-08-02T02:57:00.000Z"
    }),
    eventFor(base, {
      key: `${scenario}-new`,
      candidate,
      kind: "github_issue_reopened",
      occurredAt: "2026-08-02T02:59:00.000Z"
    })
  ];
  const projection = manualProjection(base, events);
  const permuted = manualProjection(base, [...events].reverse());
  return fixture(
    base,
    scenario,
    projection,
    {
      focusDisposition: "selected",
      selectedIdentityRef: events[1]!.identityRefs[0]!,
      latestEventId: events[1]!.eventId,
      latestEventKind: events[1]!.kind,
      workstreamCount: 1,
      completionState: "active",
      wouldSwitch: false,
      activeCandidateCount: 1,
      duplicateCount: 0,
      requiresPermutationDeterminism: true
    },
    { permutedRecentEventProjection: permuted }
  );
}

function dependencyTamperFixture(
  scenario: CurrentFocusEvaluationScenario
): CurrentFocusEvaluationFixture {
  const base = baseFixture({ githubKind: "assigned_issue" });
  const candidate = requireCandidate(base.activeResult, 0);
  const event = eventFor(base, {
    key: scenario,
    candidate,
    kind: "github_issue_reopened",
    occurredAt: "2026-08-02T02:59:00.000Z"
  });
  const projection = manualProjection(base, [event]);
  return fixture(
    base,
    scenario,
    projection,
    {
      focusDisposition: "rejected",
      selectedIdentityRef: null,
      latestEventId: null,
      latestEventKind: null,
      workstreamCount: 1,
      completionState: null,
      wouldSwitch: false,
      activeCandidateCount: 1,
      duplicateCount: 0,
      requiresDependencyRejection: true
    },
    { tamperedWorkRelationProjectionSha256: "0".repeat(64) }
  );
}

function privacyFixture(
  scenario: CurrentFocusEvaluationScenario
): CurrentFocusEvaluationFixture {
  const base = baseFixture({
    githubKind: "assigned_issue",
    githubTitle: CURRENT_FOCUS_PRIVATE_SENTINELS.join(" "),
    managedScenario: "running",
    artifactKind: "github_commit"
  });
  const projection = sourceProjection(base);
  const latestDirect = projection.events.find(
    (event) => event.source === "codex_managed"
  );
  if (!latestDirect) {
    throw new TypeError("Synthetic privacy Focus event was not projected.");
  }
  const privateSourceContext = {
    token: CURRENT_FOCUS_PRIVATE_SENTINELS[0],
    localPath: CURRENT_FOCUS_PRIVATE_SENTINELS[1],
    rawThreadId: CURRENT_FOCUS_PRIVATE_SENTINELS[2],
    commandText: CURRENT_FOCUS_PRIVATE_SENTINELS[3],
    fullConversation: CURRENT_FOCUS_PRIVATE_SENTINELS[4],
    fullCommitSha: CURRENT_FOCUS_PRIVATE_SENTINELS[5]
  };
  return fixture(
    base,
    scenario,
    projection,
    {
      focusDisposition: "selected",
      selectedIdentityRef: latestDirect.identityRefs[0]!,
      latestEventId: latestDirect.eventId,
      latestEventKind: latestDirect.kind,
      workstreamCount: null,
      completionState: null,
      wouldSwitch: false,
      activeCandidateCount: 1,
      duplicateCount: projection.counts.duplicate,
      requiresPrivacyIsolation: true
    },
    {
      privateSourceContext,
      privateSentinels: CURRENT_FOCUS_PRIVATE_SENTINELS
    }
  );
}

function baseFixture(options: ActiveAttentionFixtureOptions): BaseFixture {
  const base = activeAttentionFixture(options);
  const activeInput = base.input;
  const activeResult = resolveActiveAttention(activeInput);
  return { ...base, activeInput, activeResult };
}

function sourceProjection(base: BaseFixture): RecentMeaningfulEventProjection {
  const codexSource = base.activeInput.baseAttentionInput.sources.codex;
  return projectRecentMeaningfulEvents({
    asOf: ACTIVE_FIXTURE_AS_OF,
    githubBatch: base.githubBatch,
    codexInventoryBatch:
      codexSource.status === "available" ? codexSource.batch : null,
    managedPublicProjection: base.managedPublicProjection,
    managedSemanticProjection: base.managedSemanticProjection,
    managedRunStartedAtById: base.activeInput.managedRunStartedAtById,
    workRelationProjection: base.workRelations,
    artifactRelationProjection: base.artifacts,
    claimAuthorityProjection: base.claims,
    contextRegistrySha256: base.workRelations.contextRegistrySha256
  });
}

function eventFor(
  base: BaseFixture,
  options: EventOptions,
  explicitClaimTargetRefs?: string[]
): RecentMeaningfulEvent {
  const source = options.source ?? "github";
  const candidate = options.candidate ?? null;
  const identityRef =
    options.identityRef ??
    createFocusIdentityRef({
      source,
      targetRef: candidate?.targetRef ?? null
    });
  const relationRefs =
    options.relationRefs ??
    (candidate?.relationRef ? [candidate.relationRef] : []);
  const claimTargetRefs =
    options.claimTargetRefs ??
    explicitClaimTargetRefs ??
    (candidate ? [candidate.targetRef] : []);
  const currentness = options.currentness ??
    (source === "codex_inventory" ? "historical_only" : "current");
  const completeness = options.completeness ?? "complete";
  const attentionCapability = options.attentionCapability ??
    (source === "codex_inventory" || currentness !== "current"
      ? "historical_context_only"
      : "focus_selector");
  const observedAt =
    options.observedAt ??
    (source === "codex_managed" ? options.occurredAt : ACTIVE_FIXTURE_AS_OF);
  const nativeSubjectRef = createFocusSubjectRef({
    scenarioKey: options.key,
    source,
    targetRef: candidate?.targetRef ?? null,
    identityRef
  });
  const eventId = createRecentMeaningfulEventId({
    scenarioKey: options.key,
    source,
    kind: options.kind,
    identityRef,
    occurredAt: options.occurredAt
  });
  const sourceSnapshotSha256 =
    source === "github"
      ? base.githubBatch?.sourceSnapshotSha256 ?? "a".repeat(64)
      : source === "codex_managed"
        ? base.managedSemanticProjection.projectionSha256
        : "c".repeat(64);
  const sourceBatchSha256 =
    source === "github" ? base.githubBatch?.batchSha256 ?? null : null;
  return sealRecentMeaningfulEvent({
    contract: RECENT_MEANINGFUL_EVENT_SCHEMA_VERSION,
    ruleVersion: RECENT_MEANINGFUL_EVENT_RULE_VERSION,
    idPolicyVersion: RECENT_MEANINGFUL_EVENT_ID_POLICY_VERSION,
    eventId,
    source,
    nativeSubjectRef,
    projectId: options.projectId ?? candidate?.projectId ?? null,
    identityScope: options.identityScope ?? "exact_task",
    identityRefs: canonical(options.identityRefs ?? [identityRef]),
    claimTargetRefs: canonical(claimTargetRefs),
    relationRefs: canonical(relationRefs),
    kind: options.kind,
    occurredAt: options.occurredAt,
    observedAt,
    sourceUpdatedAt:
      options.sourceUpdatedAt === undefined
        ? source === "codex_managed"
          ? null
          : options.occurredAt
        : options.sourceUpdatedAt,
    timeBasis:
      options.timeBasis ??
      (source === "codex_managed"
        ? "collector_observed_at"
        : source === "codex_inventory"
          ? "inventory_updated_at"
          : "source_occurred_at"),
    freshness: currentness === "stale" ? "stale" : "current",
    completeness,
    currentness,
    semanticRole: options.semanticRole ??
      (source === "codex_inventory"
        ? "historical_context"
        : "meaningful_progress"),
    attentionCapability,
    displayLabel: options.displayLabel ?? "Synthetic current work",
    evidenceRef: createFocusEvidenceRef({ eventId, sourceSnapshotSha256 }),
    sourceSnapshotSha256,
    sourceBatchSha256,
    normalizerVersion:
      source === "github"
        ? base.githubBatch?.normalizerVersion ?? "synthetic-github-v0.1"
        : source === "codex_managed"
          ? base.managedSemanticProjection.ruleVersion
          : "codex-historical-context-normalizer-v0.3",
    reasonCodes: [
      source === "codex_inventory"
        ? "CONTEXT_ONLY_CODEX_INVENTORY"
        : "INCLUDED_MEANINGFUL_DIRECT_EVENT"
    ]
  });
}

function manualProjection(
  base: BaseFixture,
  eventInputs: RecentMeaningfulEvent[],
  diagnosticInputs: RecentEventDiagnostic[] = []
): RecentMeaningfulEventProjection {
  const unique = new Map<string, RecentMeaningfulEvent>();
  const diagnostics: RecentEventDiagnostic[] = [...diagnosticInputs];
  let duplicateCount = 0;
  for (const event of eventInputs) {
    const previous = unique.get(event.eventId);
    if (!previous) {
      unique.set(event.eventId, event);
      continue;
    }
    if (previous.eventSha256 !== event.eventSha256) {
      throw new TypeError("Synthetic duplicate event content conflicts.");
    }
    duplicateCount += 1;
    diagnostics.push({
      diagnosticId: createRecentEventDiagnosticId({
        eventId: event.eventId,
        duplicateIndex: duplicateCount
      }),
      source: event.source,
      observationRef: event.nativeSubjectRef,
      eventId: event.eventId,
      disposition: "excluded",
      reasonCode: "EXCLUDED_DUPLICATE_EVENT"
    });
  }
  const events = [...unique.values()].sort((left, right) =>
    Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
    compareRuntimeStrings(left.source, right.source) ||
    compareRuntimeStrings(left.kind, right.kind) ||
    compareRuntimeStrings(left.eventId, right.eventId)
  );
  diagnostics.sort((left, right) =>
    compareRuntimeStrings(left.diagnosticId, right.diagnosticId)
  );
  const dependencies = recentDependencies(base);
  const inputSha256 = runtimeSha256({
    domain: "current-focus-evaluation-materialized-events-v0.1",
    asOf: ACTIVE_FIXTURE_AS_OF,
    dependencies,
    eventSha256s: events.map((event) => event.eventSha256),
    diagnostics
  });
  return sealRecentMeaningfulEventProjection({
    contract: RECENT_MEANINGFUL_EVENT_PROJECTION_CONTRACT,
    schemaVersion: RECENT_MEANINGFUL_EVENT_SCHEMA_VERSION,
    ruleVersion: RECENT_MEANINGFUL_EVENT_RULE_VERSION,
    idPolicyVersion: RECENT_MEANINGFUL_EVENT_ID_POLICY_VERSION,
    asOf: ACTIVE_FIXTURE_AS_OF,
    dependencies,
    inputSha256,
    coverage: {
      github: base.githubBatch === null ? "unavailable" : "complete",
      codexManaged:
        base.managedPublicProjection.runs.every((run) => {
          const semantic = base.managedSemanticProjection.runs[run.managedRunId];
          return (
            semantic?.window.historyCompleteness === "complete" &&
            semantic.window.continuity === "continuous" &&
            semantic.window.clockQuality === "monotonic"
          );
        })
          ? "complete"
          : "partial",
      codexInventory: events.some(
        (event) => event.source === "codex_inventory"
      )
        ? "historical_complete"
        : "unavailable"
    },
    events,
    diagnostics,
    counts: {
      included: events.filter(
        (event) => event.attentionCapability === "focus_selector"
      ).length,
      contextOnly: events.filter(
        (event) => event.attentionCapability === "historical_context_only"
      ).length,
      excluded: diagnostics.filter(
        (diagnostic) => diagnostic.disposition === "excluded"
      ).length,
      duplicate:
        duplicateCount +
        diagnosticInputs.filter(
          (diagnostic) =>
            diagnostic.reasonCode === "EXCLUDED_DUPLICATE_EVENT"
        ).length,
      omittedMeaningfulEventCount: 0,
      omittedDiagnosticCount: 0
    },
    attentionDisposition: "not_connected",
    forbiddenAsAttentionCandidate: true
  });
}

function recentDependencies(base: BaseFixture) {
  return {
    githubBatchSha256: base.githubBatch?.batchSha256 ?? null,
    githubSourceSnapshotSha256:
      base.githubBatch?.sourceSnapshotSha256 ?? null,
    codexInventoryBatchSha256: null,
    codexInventorySourceSnapshotSha256: null,
    managedPublicProjectionSha256:
      managedCodexPublicProjectionDependencySha256(
        base.managedPublicProjection
      ),
    managedRunStartedAtByIdSha256: managedCodexRunStartTimesSha256(
      base.activeInput.managedRunStartedAtById
    ),
    managedSourceRevision: base.managedPublicProjection.revision,
    managedGeneratedAt: base.managedPublicProjection.generatedAt,
    managedSemanticProjectionSha256:
      base.managedSemanticProjection.projectionSha256,
    workRelationProjectionSha256: base.workRelations.projectionSha256,
    artifactRelationProjectionSha256: base.artifacts.projectionSha256,
    claimAuthorityProjectionSha256: base.claims.projectionSha256,
    contextRegistrySha256: base.workRelations.contextRegistrySha256
  };
}

function fixture(
  base: BaseFixture,
  scenario: CurrentFocusEvaluationScenario,
  recentEventProjection: RecentMeaningfulEventProjection,
  expectationInput: Partial<CurrentFocusEvaluationExpectation> &
    Pick<
      CurrentFocusEvaluationExpectation,
      | "focusDisposition"
      | "selectedIdentityRef"
      | "latestEventId"
      | "latestEventKind"
      | "workstreamCount"
      | "completionState"
      | "wouldSwitch"
      | "activeCandidateCount"
      | "duplicateCount"
    >,
  overrides?: {
    permutedRecentEventProjection?: RecentMeaningfulEventProjection;
    tamperedWorkRelationProjectionSha256?: string;
    privateSourceContext?: Record<string, string>;
    privateSentinels?: readonly string[];
  }
): CurrentFocusEvaluationFixture {
  return {
    scenario,
    input: {
      asOf: ACTIVE_FIXTURE_AS_OF,
      recentEventProjection,
      activeAttentionInput: base.activeInput,
      activeAttentionResult: base.activeResult,
      managedPublicProjection: base.managedPublicProjection,
      workRelationProjection: base.workRelations,
      artifactRelationProjection: base.artifacts,
      claimAuthorityProjection: base.claims,
      eligibilityProjectionSha256:
        base.eligibilityProjection.projectionSha256
    },
    permutedRecentEventProjection:
      overrides?.permutedRecentEventProjection ?? null,
    tamperedWorkRelationProjectionSha256:
      overrides?.tamperedWorkRelationProjectionSha256 ?? null,
    expectation: {
      requiresHeartbeatExclusion: false,
      requiresDistinctIdentityStreams: false,
      requiresContextOnlyIsolation: false,
      requiresCurrentnessAbstention: false,
      requiresPermutationDeterminism: false,
      requiresDependencyRejection: false,
      requiresPrivacyIsolation: false,
      ...expectationInput
    },
    privateSourceContext: overrides?.privateSourceContext ?? null,
    privateSentinels: overrides?.privateSentinels ?? []
  };
}

function requireCandidate(
  result: ActiveAttentionResult,
  index: number
): ActiveAttentionCandidate {
  const candidate = result.rankedCandidates[index];
  if (!candidate) {
    throw new TypeError(`Synthetic active candidate ${index} is missing.`);
  }
  return candidate;
}

function canonical(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareRuntimeStrings);
}

function failingActionability() {
  return {
    collectionState: "complete" as const,
    draft: false,
    reviewDecision: "none" as const,
    checksSummary: {
      collectionState: "complete" as const,
      state: "failing" as const,
      totalCount: 1,
      completedCount: 1,
      failedCount: 1,
      pendingCount: 0,
      truncated: false
    },
    mergeable: true,
    mergeConflict: false,
    unresolvedChangeRequestCount: 0,
    requestedReviewerCount: 0,
    actionRequired: true,
    actionRequiredReasons: ["checks_failed" as const]
  };
}
