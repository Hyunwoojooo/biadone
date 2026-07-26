import { loadVerifiedCrossSourceEvaluationDataset } from "../../src/evaluation/loadCrossSourceEvaluationDataset";
import { syntheticCrossSourceIntegrityOptions } from "./codexDetectorConfig";
import {
  buildSyntheticCase,
  codexExpectation,
  completeCoverage,
  eligibleAnnotation,
  excludedAnnotation,
  insufficientCoverage,
  insufficientDecision,
  limitedPositiveCoverage,
  noActionDecision,
  reviewAnnotation,
  scopedNoActionCoverage,
  signal,
  source,
  suggestedDecision,
  weeklyFocus
} from "./devCaseBuilder";

const EARLY_SNAPSHOT = "2026-07-25T08:00:00.000Z";
const MIDDLE_SNAPSHOT = "2026-07-25T18:00:00.000Z";
const LATEST_SNAPSHOT = "2026-07-26T02:55:00.000Z";

function currentCodexV2() {
  return source("codex", "overview_only", {
    candidateSetComplete: false,
    schemaVersion: "codex-snapshot-v2",
    normalizerVersion: "codex-v2-safe-overview-normalizer-v0.1"
  });
}

function enhancedCodex(
  snapshotTimes: string[] = [LATEST_SNAPSHOT],
  candidateSetComplete = true
) {
  return source("codex", "candidate_capable", {
    candidateSetComplete,
    snapshotTimes,
    schemaVersion: "synthetic-codex-observation-v0.2",
    normalizerVersion: "synthetic-codex-exception-normalizer-v0.1"
  });
}

function githubSource() {
  return source("github", "candidate_capable");
}

function mappedNotionSource() {
  return source("notion", "candidate_capable");
}

const cases = [
  buildSyntheticCase({
    caseId: "AD-DEV-CV2-001",
    title: "현재 Codex v2 active는 activity overview만 허용",
    summary:
      "active session은 보이지만 progress, failure, completion 정보를 확인할 수 없다.",
    tags: [
      "current_codex_v2",
      "overview_only",
      "insufficient_evidence"
    ],
    sources: [currentCodexV2()],
    signals: [
      signal(
        "sig-cv2-active",
        "codex",
        "exec-cv2-active",
        "activity",
        {
          nativeState: "active",
          meaningfulProgressKnown: false,
          exceptionLifecycleKnown: false
        }
      )
    ],
    annotations: [
      excludedAnnotation({
        itemId: "item-cv2-active",
        subjectIds: ["exec-cv2-active"],
        overview: ["OVERVIEW_CODEX_ACTIVITY_OBSERVED"],
        overviewStates: ["unknown"],
        gateReasons: ["GATE_CODEX_EXCEPTION_UNVERIFIED"],
        forbiddenInterventions: ["inspect", "resume"],
        notes: "active를 running, healthy 또는 stalled로 확정하지 않는다."
      })
    ],
    expectedCodexExecutions: [
      codexExpectation({
        executionId: "exec-cv2-active",
        states: ["unknown"]
      })
    ],
    expectedCoverage: insufficientCoverage(["codex"]),
    expectedDecision: insufficientDecision(["item-cv2-active"]),
    hardFailureRisks: [
      "false_stall",
      "healthy_execution_recommended",
      "wrong_execution_state"
    ]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-CV2-002",
    title: "request ID 없는 Codex approval badge",
    summary:
      "waiting_on_approval 표시는 있지만 안정적인 request ID와 lifecycle이 없다.",
    tags: [
      "current_codex_v2",
      "transient_request",
      "insufficient_evidence"
    ],
    sources: [currentCodexV2()],
    signals: [
      signal(
        "sig-cv2-approval",
        "codex",
        "exec-cv2-approval",
        "activity",
        {
          nativeState: "active",
          attentionState: "waiting_on_approval",
          requestId: null,
          lifecycleKnown: false
        }
      )
    ],
    annotations: [
      excludedAnnotation({
        itemId: "item-cv2-approval",
        subjectIds: ["exec-cv2-approval"],
        overview: ["OVERVIEW_CODEX_REQUEST_STATUS_ONLY"],
        overviewStates: ["waiting"],
        gateReasons: ["GATE_TRANSIENT_REQUEST_ID_MISSING"],
        forbiddenInterventions: ["approve", "decide"],
        notes: "badge는 Cockpit에 남지만 escalation candidate는 만들지 않는다."
      })
    ],
    expectedCodexExecutions: [
      codexExpectation({
        executionId: "exec-cv2-approval",
        states: ["waiting"]
      })
    ],
    expectedCoverage: insufficientCoverage(["codex"]),
    expectedDecision: insufficientDecision(["item-cv2-approval"]),
    hardFailureRisks: [
      "transient_request_escalated_too_early",
      "stale_ephemeral_attention"
    ]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-CV2-003",
    title: "Codex system_error badge는 active failure가 아님",
    summary:
      "native system_error 상태만 있고 execution failure lifecycle과 사용자 개입 근거는 없다.",
    tags: [
      "current_codex_v2",
      "system_error",
      "insufficient_evidence"
    ],
    sources: [currentCodexV2()],
    signals: [
      signal(
        "sig-cv2-system-error",
        "codex",
        "exec-cv2-system-error",
        "execution_state",
        {
          nativeState: "system_error",
          failureLifecycleKnown: false
        }
      )
    ],
    annotations: [
      excludedAnnotation({
        itemId: "item-cv2-system-error",
        subjectIds: ["exec-cv2-system-error"],
        overview: ["OVERVIEW_CODEX_SYSTEM_ERROR_STATUS"],
        overviewStates: ["unknown"],
        gateReasons: ["GATE_CODEX_EXCEPTION_UNVERIFIED"],
        forbiddenInterventions: ["inspect", "resume"],
        notes: "system_error badge를 execution failure로 승격하지 않는다."
      })
    ],
    expectedCodexExecutions: [
      codexExpectation({
        executionId: "exec-cv2-system-error",
        states: ["unknown"]
      })
    ],
    expectedCoverage: insufficientCoverage(["codex"]),
    expectedDecision: insufficientDecision(["item-cv2-system-error"]),
    hardFailureRisks: ["false_failure", "wrong_execution_state"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-CX-001",
    title: "최근 meaningful progress가 있는 정상 실행",
    summary:
      "ordered window에서 phase가 전진했고 최신 snapshot에도 정상 running 상태다.",
    tags: [
      "future_candidate_capable_codex",
      "meaningful_progress",
      "no_action"
    ],
    sources: [enhancedCodex([EARLY_SNAPSHOT, LATEST_SNAPSHOT])],
    signals: [
      signal(
        "sig-cx1-state",
        "codex",
        "exec-cx1",
        "execution_state",
        {
          state: "running"
        },
        { snapshotIndex: 0 }
      ),
      signal(
        "sig-cx1-progress",
        "codex",
        "exec-cx1",
        "execution_progress",
        {
          markerType: "phase_transition",
          fromPhase: "test",
          toPhase: "build"
        },
        { snapshotIndex: 1, evidenceLevel: "derived" }
      )
    ],
    useCodexDetector: true,
    annotations: [
      excludedAnnotation({
        itemId: "item-cx1-healthy",
        subjectIds: ["exec-cx1"],
        overview: ["OVERVIEW_CODEX_EXECUTION_RECENT_PROGRESS"],
        overviewStates: ["running"],
        gateReasons: ["GATE_HEALTHY_CODEX_EXECUTION"],
        forbiddenInterventions: ["inspect", "resume"],
        notes: "정상 execution은 Work Cockpit에만 보인다."
      })
    ],
    expectedCodexExecutions: [
      codexExpectation({
        executionId: "exec-cx1",
        states: ["running"]
      })
    ],
    expectedCoverage: completeCoverage(),
    expectedDecision: noActionDecision(
      ["item-cx1-healthy"],
      "DECISION_ALL_OBSERVED_WORK_HEALTHY"
    ),
    hardFailureRisks: [
      "healthy_execution_recommended",
      "unsupported_progress_summary"
    ]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-CX-002",
    title: "heartbeat만 있고 비교 history가 부족한 실행",
    summary:
      "heartbeat는 반복되지만 stall threshold를 평가할 이전 ordered window가 없다.",
    tags: [
      "future_candidate_capable_codex",
      "history_missing",
      "insufficient_evidence"
    ],
    sources: [enhancedCodex([LATEST_SNAPSHOT], false)],
    signals: [
      signal(
        "sig-cx2-heartbeat",
        "codex",
        "exec-cx2",
        "activity",
        {
          markerType: "heartbeat",
          priorWindowAvailable: false
        }
      )
    ],
    annotations: [
      reviewAnnotation({
        itemId: "item-cx2-possible-stall",
        subjectIds: ["exec-cx2"],
        overview: ["OVERVIEW_CODEX_ACTIVITY_OBSERVED"],
        overviewStates: ["running"],
        gateReasons: ["GATE_CODEX_EXCEPTION_UNVERIFIED"],
        reviewReasons: ["REVIEW_CODEX_HISTORY_INSUFFICIENT"],
        notes: "사용자에게 멈췄는지 묻지 않고 history 보강을 요구한다."
      })
    ],
    expectedCodexExecutions: [
      codexExpectation({
        executionId: "exec-cx2",
        states: ["running"]
      })
    ],
    expectedCoverage: insufficientCoverage(["codex"]),
    expectedDecision: insufficientDecision(["item-cx2-possible-stall"]),
    hardFailureRisks: ["false_stall", "unnecessary_clarification"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-CX-003",
    title: "release block과 연결된 verified stall",
    summary:
      "phase threshold 동안 진전이 없고 execution이 shared release outcome을 막는다.",
    tags: [
      "future_candidate_capable_codex",
      "verified_stall",
      "unblock"
    ],
    sources: [
      enhancedCodex([
        EARLY_SNAPSHOT,
        MIDDLE_SNAPSHOT,
        LATEST_SNAPSHOT
      ]),
      source("conversation", "candidate_capable")
    ],
    signals: [
      signal(
        "sig-cx3-start",
        "codex",
        "exec-cx3",
        "execution_state",
        {
          state: "running",
          expectedToContinue: true
        },
        { snapshotIndex: 0 }
      ),
      signal(
        "sig-cx3-stall",
        "codex",
        "exec-cx3",
        "execution_exception",
        {
          exception: "verified_stall",
          thresholdExceeded: true,
          meaningfulProgressObserved: false,
          latestUnresolved: true
        },
        {
          snapshotIndex: 2,
          evidenceLevel: "derived",
          destinationRef: "codex://executions/exec-cx3"
        }
      ),
      signal(
        "sig-cx3-release-block",
        "conversation",
        "release-cx3",
        "task_state",
        {
          state: "blocked",
          owner: "shared",
          obligation: "release"
        }
      )
    ],
    relations: [
      {
        relationId: "rel-cx3-blocks-release",
        fromSubjectId: "exec-cx3",
        toSubjectId: "release-cx3",
        type: "blocks",
        authority: "deterministic_policy",
        evidenceSignalIds: ["sig-cx3-stall", "sig-cx3-release-block"]
      }
    ],
    useCodexDetector: true,
    annotations: [
      eligibleAnnotation({
        itemId: "item-cx3-unblock-stall",
        subjectIds: ["exec-cx3", "release-cx3"],
        intervention: "inspect",
        acceptableInterventions: ["resume"],
        lane: "unblock",
        candidateReasons: ["CANDIDATE_CODEX_STALL_VERIFIED"],
        whyNow: ["WHY_NOW_EXPLICIT_BLOCKER"],
        overview: ["OVERVIEW_CODEX_EXECUTION_STALLED"],
        overviewStates: ["stalled"],
        evidenceSignalIds: ["sig-cx3-stall", "sig-cx3-release-block"],
        notes: "stall duration이 아니라 verified block이 unblock lane을 만든다."
      })
    ],
    expectedCodexExecutions: [
      codexExpectation({
        executionId: "exec-cx3",
        states: ["stalled"]
      })
    ],
    expectedCoverage: completeCoverage(),
    expectedDecision: suggestedDecision(["item-cx3-unblock-stall"]),
    hardFailureRisks: ["false_stall", "false_urgency", "wrong_lane"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-CX-004",
    title: "material link가 없는 verified stall",
    summary:
      "stall state는 확인됐지만 goal, obligation 또는 downstream block과 연결되지 않는다.",
    tags: [
      "future_candidate_capable_codex",
      "verified_stall",
      "overview_only",
      "no_action"
    ],
    sources: [
      enhancedCodex([
        EARLY_SNAPSHOT,
        MIDDLE_SNAPSHOT,
        LATEST_SNAPSHOT
      ])
    ],
    signals: [
      signal(
        "sig-cx4-stall",
        "codex",
        "exec-cx4",
        "execution_exception",
        {
          exception: "verified_stall",
          thresholdExceeded: true,
          materialLink: null
        },
        {
          snapshotIndex: 2,
          evidenceLevel: "derived",
          destinationRef: "codex://executions/exec-cx4"
        }
      )
    ],
    useCodexDetector: true,
    annotations: [
      excludedAnnotation({
        itemId: "item-cx4-unlinked-stall",
        subjectIds: ["exec-cx4"],
        overview: ["OVERVIEW_CODEX_STALL_NO_MATERIAL_LINK"],
        overviewStates: ["stalled"],
        gateReasons: ["GATE_NO_USER_INTERVENTION"],
        forbiddenInterventions: ["inspect", "resume"],
        notes: "verified stall 자체만으로 AttentionItem을 만들지 않는다."
      })
    ],
    expectedCodexExecutions: [
      codexExpectation({
        executionId: "exec-cx4",
        states: ["stalled"]
      })
    ],
    expectedCoverage: completeCoverage(),
    expectedDecision: noActionDecision(["item-cx4-unlinked-stall"]),
    hardFailureRisks: ["false_candidate", "false_stall"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-CX-005",
    title: "expected-next-event를 기다리는 정상 장기 build",
    summary:
      "build phase가 길지만 정책상 정상 범위이고 expected-next-event가 아직 유효하다.",
    tags: [
      "future_candidate_capable_codex",
      "long_running_phase",
      "no_action"
    ],
    sources: [enhancedCodex([EARLY_SNAPSHOT, LATEST_SNAPSHOT])],
    signals: [
      signal(
        "sig-cx5-phase",
        "codex",
        "exec-cx5",
        "execution_phase",
        {
          phase: "build",
          normalLongRunningPhase: true,
          expectedNextEvent: "build_complete",
          expectedEventOverdue: false
        },
        { snapshotIndex: 1, evidenceLevel: "derived" }
      )
    ],
    useCodexDetector: true,
    annotations: [
      excludedAnnotation({
        itemId: "item-cx5-healthy-build",
        subjectIds: ["exec-cx5"],
        overview: ["OVERVIEW_CODEX_EXECUTION_HEALTHY"],
        overviewStates: ["waiting"],
        gateReasons: ["GATE_HEALTHY_CODEX_EXECUTION"],
        forbiddenInterventions: ["inspect", "resume"],
        notes: "elapsed time 하나로 stall을 생성하지 않는다."
      })
    ],
    expectedCodexExecutions: [
      codexExpectation({
        executionId: "exec-cx5",
        states: ["waiting"]
      })
    ],
    expectedCoverage: completeCoverage(),
    expectedDecision: noActionDecision(
      ["item-cx5-healthy-build"],
      "DECISION_ALL_OBSERVED_WORK_HEALTHY"
    ),
    hardFailureRisks: ["false_stall", "healthy_execution_recommended"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-CX-006",
    title: "release를 막는 active Codex failure",
    summary:
      "failure가 최신 window에서도 active이고 shared release outcome을 막으며 안전한 destination이 있다.",
    tags: [
      "future_candidate_capable_codex",
      "active_failure",
      "unblock"
    ],
    sources: [
      enhancedCodex([EARLY_SNAPSHOT, LATEST_SNAPSHOT]),
      source("conversation", "candidate_capable")
    ],
    signals: [
      signal(
        "sig-cx6-failure",
        "codex",
        "exec-cx6",
        "execution_exception",
        {
          exception: "active_failure",
          recovered: false,
          latestUnresolved: true
        },
        {
          snapshotIndex: 1,
          evidenceLevel: "derived",
          destinationRef: "codex://executions/exec-cx6"
        }
      ),
      signal(
        "sig-cx6-release-block",
        "conversation",
        "release-cx6",
        "task_state",
        {
          state: "blocked",
          owner: "shared"
        }
      )
    ],
    relations: [
      {
        relationId: "rel-cx6-blocks-release",
        fromSubjectId: "exec-cx6",
        toSubjectId: "release-cx6",
        type: "blocks",
        authority: "deterministic_policy",
        evidenceSignalIds: ["sig-cx6-failure", "sig-cx6-release-block"]
      }
    ],
    useCodexDetector: true,
    annotations: [
      eligibleAnnotation({
        itemId: "item-cx6-inspect-failure",
        subjectIds: ["exec-cx6", "release-cx6"],
        intervention: "inspect",
        acceptableInterventions: ["resume"],
        lane: "unblock",
        candidateReasons: ["CANDIDATE_CODEX_FAILURE_ACTIVE"],
        whyNow: ["WHY_NOW_EXPLICIT_BLOCKER"],
        overview: ["OVERVIEW_CODEX_FAILURE_ACTIVE"],
        overviewStates: ["failed"],
        evidenceSignalIds: ["sig-cx6-failure", "sig-cx6-release-block"],
        notes: "failure라는 이유만으로 deadline 또는 must_now를 만들지 않는다."
      })
    ],
    expectedCodexExecutions: [
      codexExpectation({
        executionId: "exec-cx6",
        states: ["failed"]
      })
    ],
    expectedCoverage: completeCoverage(),
    expectedDecision: suggestedDecision(["item-cx6-inspect-failure"]),
    hardFailureRisks: ["false_failure", "false_urgency", "wrong_lane"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-CX-007",
    title: "최신 snapshot에서 복구된 failure",
    summary:
      "이전 failure가 있었지만 최신 snapshot에서 failure가 clear되고 progress가 재개됐다.",
    tags: [
      "future_candidate_capable_codex",
      "recovered_failure",
      "no_action"
    ],
    sources: [enhancedCodex([EARLY_SNAPSHOT, LATEST_SNAPSHOT])],
    signals: [
      signal(
        "sig-cx7-failure",
        "codex",
        "exec-cx7",
        "execution_exception",
        {
          exception: "failure",
          activeAtSnapshot: true
        },
        { snapshotIndex: 0, evidenceLevel: "derived" }
      ),
      signal(
        "sig-cx7-recovery",
        "codex",
        "exec-cx7",
        "execution_progress",
        {
          markerType: "failure_cleared",
          currentState: "running"
        },
        { snapshotIndex: 1, evidenceLevel: "derived" }
      )
    ],
    useCodexDetector: true,
    annotations: [
      excludedAnnotation({
        itemId: "item-cx7-recovered",
        subjectIds: ["exec-cx7"],
        overview: ["OVERVIEW_CODEX_FAILURE_RECOVERED"],
        overviewStates: ["running"],
        gateReasons: ["GATE_FAILURE_RECOVERED"],
        forbiddenInterventions: ["inspect", "resume"],
        notes: "과거 failure를 현재 Attention으로 누출하지 않는다."
      })
    ],
    expectedCodexExecutions: [
      codexExpectation({
        executionId: "exec-cx7",
        states: ["running"]
      })
    ],
    expectedCoverage: completeCoverage(),
    expectedDecision: noActionDecision(["item-cx7-recovered"]),
    hardFailureRisks: ["false_failure", "stale_ephemeral_attention"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-CX-008",
    title: "후속 workflow가 없는 completed execution",
    summary:
      "execution completion은 확인되지만 project workflow나 explicit handoff가 설정되지 않았다.",
    tags: [
      "future_candidate_capable_codex",
      "completed",
      "workflow_not_configured",
      "no_action"
    ],
    sources: [enhancedCodex()],
    signals: [
      signal(
        "sig-cx8-completed",
        "codex",
        "exec-cx8",
        "execution_completion",
        {
          state: "completed",
          expectedFollowThrough: null,
          workflowConfigured: false
        }
      )
    ],
    annotations: [
      excludedAnnotation({
        itemId: "item-cx8-no-follow-through",
        subjectIds: ["exec-cx8"],
        overview: ["OVERVIEW_CODEX_EXECUTION_COMPLETED"],
        overviewStates: ["completed"],
        gateReasons: ["GATE_FOLLOW_THROUGH_NOT_CONFIGURED"],
        forbiddenInterventions: ["close_loop"],
        notes: "commit, PR, review 후속 작업을 추정하지 않는다."
      })
    ],
    expectedCodexExecutions: [
      codexExpectation({
        executionId: "exec-cx8",
        states: ["completed"]
      })
    ],
    expectedCoverage: completeCoverage(),
    expectedDecision: noActionDecision(["item-cx8-no-follow-through"]),
    hardFailureRisks: ["false_follow_through", "unsafe_first_step"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-CX-009",
    title: "configured PR handoff가 열린 completed execution",
    summary:
      "execution은 완료됐고 사용자가 설정한 PR handoff가 grace period 이후에도 open이다.",
    tags: [
      "future_candidate_capable_codex",
      "configured_follow_through",
      "close_loop"
    ],
    sources: [enhancedCodex(), githubSource()],
    signals: [
      signal(
        "sig-cx9-completed",
        "codex",
        "exec-cx9",
        "execution_completion",
        {
          state: "completed"
        }
      ),
      signal(
        "sig-cx9-handoff",
        "codex",
        "exec-cx9",
        "handoff_state",
        {
          workflowId: "project-pr-handoff-v1",
          handoffState: "open",
          gracePeriodElapsed: true
        },
        {
          evidenceLevel: "derived",
          destinationRef: "github://demo/repo/pull/19"
        }
      ),
      signal(
        "sig-cx9-pr-open",
        "github",
        "pr-cx9",
        "task_state",
        {
          state: "open",
          handoffExpected: true
        },
        { destinationRef: "github://demo/repo/pull/19" }
      )
    ],
    relations: [
      {
        relationId: "rel-cx9-follow-through",
        fromSubjectId: "exec-cx9",
        toSubjectId: "pr-cx9",
        type: "requires_follow_through",
        authority: "user_configured",
        evidenceSignalIds: ["sig-cx9-handoff", "sig-cx9-pr-open"]
      }
    ],
    useCodexDetector: true,
    annotations: [
      eligibleAnnotation({
        itemId: "item-cx9-close-loop",
        subjectIds: ["exec-cx9", "pr-cx9"],
        intervention: "close_loop",
        lane: "close_loop",
        candidateReasons: ["CANDIDATE_CODEX_FOLLOW_THROUGH_OPEN"],
        whyNow: ["WHY_NOW_CONFIGURED_LOOP_OPEN"],
        overview: ["OVERVIEW_CODEX_EXECUTION_COMPLETED"],
        overviewStates: ["completed"],
        evidenceSignalIds: ["sig-cx9-handoff", "sig-cx9-pr-open"],
        notes: "완료 execution과 열린 AttentionItem 상태를 분리한다."
      })
    ],
    expectedCodexExecutions: [
      codexExpectation({
        executionId: "exec-cx9",
        states: ["completed"]
      })
    ],
    expectedCoverage: completeCoverage(),
    expectedDecision: suggestedDecision(["item-cx9-close-loop"]),
    hardFailureRisks: ["missed_follow_through", "unsafe_first_step"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-CX-010",
    title: "expected scope baseline이 없는 변경 관찰",
    summary:
      "changed-file summary는 있지만 비교할 expected scope baseline이 없다.",
    tags: [
      "future_candidate_capable_codex",
      "scope_baseline_missing",
      "insufficient_evidence"
    ],
    sources: [enhancedCodex([LATEST_SNAPSHOT], false)],
    signals: [
      signal(
        "sig-cx10-scope",
        "codex",
        "exec-cx10",
        "scope_observation",
        {
          observedScopeSummary: "src_and_ops",
          expectedScopeBaseline: null
        },
        { evidenceLevel: "derived" }
      )
    ],
    useCodexDetector: true,
    annotations: [
      reviewAnnotation({
        itemId: "item-cx10-scope-review",
        subjectIds: ["exec-cx10"],
        overview: ["OVERVIEW_SOURCE_CONTEXT_ONLY"],
        overviewStates: ["running"],
        gateReasons: ["GATE_DIRECT_EVIDENCE_MISSING"],
        reviewReasons: ["REVIEW_SCOPE_BASELINE_MISSING"],
        notes: "변경량만으로 scope drift를 생성하지 않는다."
      })
    ],
    expectedCodexExecutions: [
      codexExpectation({
        executionId: "exec-cx10",
        states: ["running"]
      })
    ],
    expectedCoverage: insufficientCoverage(["codex"]),
    expectedDecision: insufficientDecision(["item-cx10-scope-review"]),
    hardFailureRisks: ["false_scope_drift", "unsupported_progress_summary"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-CX-011",
    title: "baseline과 policy로 검증된 scope drift",
    summary:
      "expected baseline, observed scope, deterministic policy가 모두 있고 weekly outcome과 연결된다.",
    tags: [
      "future_candidate_capable_codex",
      "scope_drift_policy_enabled",
      "focus"
    ],
    focus: weeklyFocus("결제 출시 범위를 안정적으로 마무리", [
      "project-payments"
    ]),
    sources: [enhancedCodex()],
    signals: [
      signal(
        "sig-cx11-scope-drift",
        "codex",
        "exec-cx11",
        "scope_observation",
        {
          expectedScopeBaselineHash: "a".repeat(64),
          observedScopeHash: "b".repeat(64),
          deterministicDriftVerified: true,
          policyEnabledForEvaluation: true
        },
        {
          projectId: "project-payments",
          evidenceLevel: "derived",
          destinationRef: "codex://executions/exec-cx11"
        }
      )
    ],
    useCodexDetector: true,
    annotations: [
      eligibleAnnotation({
        itemId: "item-cx11-review-scope",
        subjectIds: ["exec-cx11"],
        intervention: "review",
        lane: "focus",
        candidateReasons: ["CANDIDATE_CODEX_SCOPE_DRIFT_VERIFIED"],
        whyNow: ["WHY_NOW_PRIMARY_OUTCOME_ALIGNED"],
        overview: ["OVERVIEW_SOURCE_CONTEXT_ONLY"],
        overviewStates: ["running"],
        evidenceSignalIds: ["sig-cx11-scope-drift"],
        notes: "이 사례는 scope-drift policy를 명시적으로 켠 평가 전용 사례다."
      })
    ],
    expectedCodexExecutions: [
      codexExpectation({
        executionId: "exec-cx11",
        states: ["running"]
      })
    ],
    expectedCoverage: completeCoverage(),
    expectedDecision: suggestedDecision(["item-cx11-review-scope"]),
    hardFailureRisks: ["missed_scope_drift", "false_scope_drift"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-CX-012",
    title: "escalation threshold 전의 pending request",
    summary:
      "stable request ID와 pending 상태는 있지만 configured escalation threshold 전이다.",
    tags: [
      "future_candidate_capable_codex",
      "transient_request",
      "below_threshold",
      "no_action"
    ],
    sources: [
      enhancedCodex([
        "2026-07-26T02:40:00.000Z",
        LATEST_SNAPSHOT
      ])
    ],
    signals: [
      signal(
        "sig-cx12-execution",
        "codex",
        "exec-cx12",
        "execution_state",
        {
          state: "waiting"
        },
        { snapshotIndex: 1 }
      ),
      signal(
        "sig-cx12-request-initial",
        "codex",
        "request-cx12",
        "transient_attention_lifecycle",
        {
          requestId: "request-cx12",
          requestKind: "approval",
          lifecycle: "pending",
          requestedAt: "2026-07-26T02:40:00.000Z",
          resolvedAt: null,
          expiredAt: null,
          validUntil: "2026-07-26T03:30:00.000Z",
          thresholdExceeded: false,
          blocksExecution: true
        },
        {
          snapshotIndex: 0,
          evidenceLevel: "derived",
          validUntil: "2026-07-26T03:30:00.000Z",
          destinationRef: "codex://requests/request-cx12"
        }
      ),
      signal(
        "sig-cx12-request-latest",
        "codex",
        "request-cx12",
        "transient_attention_lifecycle",
        {
          requestId: "request-cx12",
          requestKind: "approval",
          lifecycle: "pending",
          requestedAt: "2026-07-26T02:40:00.000Z",
          resolvedAt: null,
          expiredAt: null,
          validUntil: "2026-07-26T03:30:00.000Z",
          thresholdExceeded: false,
          blocksExecution: true
        },
        {
          snapshotIndex: 1,
          evidenceLevel: "derived",
          validUntil: "2026-07-26T03:30:00.000Z",
          destinationRef: "codex://requests/request-cx12"
        }
      )
    ],
    relations: [
      {
        relationId: "rel-cx12-request-blocks-execution",
        fromSubjectId: "request-cx12",
        toSubjectId: "exec-cx12",
        type: "blocks",
        authority: "deterministic_policy",
        evidenceSignalIds: [
          "sig-cx12-execution",
          "sig-cx12-request-latest"
        ]
      }
    ],
    useCodexDetector: true,
    annotations: [
      excludedAnnotation({
        itemId: "item-cx12-request",
        subjectIds: ["request-cx12", "exec-cx12"],
        overview: ["OVERVIEW_CODEX_REQUEST_BELOW_THRESHOLD"],
        overviewStates: ["waiting"],
        gateReasons: ["GATE_TRANSIENT_REQUEST_NOT_ESCALATED"],
        forbiddenInterventions: ["approve", "decide"],
        notes: "request age는 threshold gate일 뿐 urgency가 아니다."
      })
    ],
    expectedCodexExecutions: [
      codexExpectation({
        executionId: "exec-cx12",
        states: ["waiting"]
      })
    ],
    expectedCoverage: completeCoverage(),
    expectedDecision: noActionDecision(["item-cx12-request"]),
    hardFailureRisks: ["transient_request_escalated_too_early"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-CX-013",
    title: "이미 resolved된 Codex request",
    summary:
      "stable request lifecycle의 최신 상태가 resolved이므로 overview와 candidate에서 제거한다.",
    tags: [
      "future_candidate_capable_codex",
      "transient_request",
      "resolved",
      "no_action"
    ],
    sources: [enhancedCodex([EARLY_SNAPSHOT, LATEST_SNAPSHOT])],
    signals: [
      signal(
        "sig-cx13-request-pending",
        "codex",
        "request-cx13",
        "transient_attention_lifecycle",
        {
          requestId: "request-cx13",
          requestKind: "approval",
          lifecycle: "pending",
          requestedAt: EARLY_SNAPSHOT,
          resolvedAt: null,
          expiredAt: null,
          validUntil: "2026-07-26T03:30:00.000Z",
          thresholdExceeded: true,
          blocksExecution: true
        },
        {
          snapshotIndex: 0,
          evidenceLevel: "derived",
          validUntil: "2026-07-26T03:30:00.000Z"
        }
      ),
      signal(
        "sig-cx13-request-resolved",
        "codex",
        "request-cx13",
        "transient_attention_lifecycle",
        {
          requestId: "request-cx13",
          requestKind: "approval",
          lifecycle: "resolved",
          requestedAt: EARLY_SNAPSHOT,
          resolvedAt: "2026-07-26T02:50:00.000Z",
          expiredAt: null,
          validUntil: "2026-07-26T03:30:00.000Z",
          thresholdExceeded: true,
          blocksExecution: false
        },
        { snapshotIndex: 1, evidenceLevel: "derived" }
      ),
      signal(
        "sig-cx13-execution",
        "codex",
        "exec-cx13",
        "execution_state",
        {
          state: "running"
        },
        { snapshotIndex: 1 }
      )
    ],
    relations: [
      {
        relationId: "rel-cx13-request-execution",
        fromSubjectId: "request-cx13",
        toSubjectId: "exec-cx13",
        type: "related_to",
        authority: "deterministic_policy",
        evidenceSignalIds: [
          "sig-cx13-request-resolved",
          "sig-cx13-execution"
        ]
      }
    ],
    useCodexDetector: true,
    annotations: [
      excludedAnnotation({
        itemId: "item-cx13-resolved-request",
        subjectIds: ["request-cx13"],
        gateReasons: ["GATE_TRANSIENT_REQUEST_RESOLVED"],
        forbiddenInterventions: ["approve", "decide"],
        notes: "해결된 request는 현재 attention에 남지 않는다."
      }),
      excludedAnnotation({
        itemId: "item-cx13-execution",
        subjectIds: ["exec-cx13"],
        overview: ["OVERVIEW_CODEX_EXECUTION_HEALTHY"],
        overviewStates: ["running"],
        gateReasons: ["GATE_HEALTHY_CODEX_EXECUTION"],
        forbiddenInterventions: ["inspect", "resume"],
        notes: "request 해결 후 execution은 정상 overview로 돌아간다."
      })
    ],
    expectedCodexExecutions: [
      codexExpectation({
        executionId: "exec-cx13",
        states: ["running"]
      })
    ],
    expectedCoverage: completeCoverage(),
    expectedDecision: noActionDecision([
      "item-cx13-resolved-request",
      "item-cx13-execution"
    ]),
    hardFailureRisks: [
      "stale_ephemeral_attention",
      "transient_request_escalated_too_early"
    ]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-CX-014",
    title: "threshold를 넘고 execution을 막는 pending request",
    summary:
      "stable request가 pending 상태로 threshold를 넘었고 execution을 실제로 block한다.",
    tags: [
      "future_candidate_capable_codex",
      "transient_request",
      "escalated",
      "unblock"
    ],
    sources: [enhancedCodex([EARLY_SNAPSHOT, LATEST_SNAPSHOT])],
    signals: [
      signal(
        "sig-cx14-execution",
        "codex",
        "exec-cx14",
        "execution_state",
        {
          state: "waiting"
        },
        { snapshotIndex: 1 }
      ),
      signal(
        "sig-cx14-request-initial",
        "codex",
        "request-cx14",
        "transient_attention_lifecycle",
        {
          requestId: "request-cx14",
          requestKind: "approval",
          lifecycle: "pending",
          requestedAt: EARLY_SNAPSHOT,
          resolvedAt: null,
          expiredAt: null,
          validUntil: "2026-07-26T03:30:00.000Z",
          thresholdExceeded: false,
          blocksExecution: true
        },
        {
          snapshotIndex: 0,
          evidenceLevel: "derived",
          validUntil: "2026-07-26T03:30:00.000Z",
          destinationRef: "codex://requests/request-cx14"
        }
      ),
      signal(
        "sig-cx14-request-latest",
        "codex",
        "request-cx14",
        "transient_attention_lifecycle",
        {
          requestId: "request-cx14",
          requestKind: "approval",
          lifecycle: "pending",
          requestedAt: EARLY_SNAPSHOT,
          resolvedAt: null,
          expiredAt: null,
          validUntil: "2026-07-26T03:30:00.000Z",
          thresholdExceeded: true,
          blocksExecution: true
        },
        {
          snapshotIndex: 1,
          evidenceLevel: "derived",
          validUntil: "2026-07-26T03:30:00.000Z",
          destinationRef: "codex://requests/request-cx14"
        }
      )
    ],
    relations: [
      {
        relationId: "rel-cx14-request-blocks-execution",
        fromSubjectId: "request-cx14",
        toSubjectId: "exec-cx14",
        type: "blocks",
        authority: "deterministic_policy",
        evidenceSignalIds: [
          "sig-cx14-execution",
          "sig-cx14-request-latest"
        ]
      }
    ],
    useCodexDetector: true,
    annotations: [
      eligibleAnnotation({
        itemId: "item-cx14-approve",
        subjectIds: ["request-cx14", "exec-cx14"],
        intervention: "approve",
        lane: "unblock",
        candidateReasons: ["CANDIDATE_CODEX_REQUEST_ESCALATED"],
        whyNow: ["WHY_NOW_EXPLICIT_BLOCKER"],
        overview: ["OVERVIEW_CODEX_REQUEST_STATUS_ONLY"],
        overviewStates: ["waiting"],
        evidenceSignalIds: [
          "sig-cx14-request-latest",
          "sig-cx14-execution"
        ],
        notes: "request age만으로 must_now 또는 consequence를 만들지 않는다."
      })
    ],
    expectedCodexExecutions: [
      codexExpectation({
        executionId: "exec-cx14",
        states: ["waiting"]
      })
    ],
    expectedCoverage: completeCoverage(),
    expectedDecision: suggestedDecision(["item-cx14-approve"]),
    hardFailureRisks: [
      "transient_request_escalated_too_early",
      "false_urgency",
      "wrong_lane"
    ]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-GH-001",
    title: "weekly outcome과 연결된 assigned GitHub issue",
    summary:
      "fresh open issue가 사용자에게 배정돼 있고 ready 상태이며 weekly outcome과 연결된다.",
    tags: ["github", "assigned_issue", "focus"],
    focus: weeklyFocus("결제 출시 준비 완료", ["project-payments"]),
    sources: [githubSource()],
    signals: [
      signal(
        "sig-gh1-issue",
        "github",
        "issue-gh1",
        "task_exists",
        {
          state: "open",
          assignee: "user",
          ready: true
        },
        {
          projectId: "project-payments",
          destinationRef: "github://demo/payments/issues/42"
        }
      )
    ],
    annotations: [
      eligibleAnnotation({
        itemId: "item-gh1-do-issue",
        subjectIds: ["issue-gh1"],
        intervention: "do",
        lane: "focus",
        candidateReasons: ["CANDIDATE_GITHUB_ISSUE_ASSIGNED"],
        whyNow: ["WHY_NOW_PRIMARY_OUTCOME_ALIGNED"],
        evidenceSignalIds: ["sig-gh1-issue"]
      })
    ],
    expectedCoverage: completeCoverage(),
    expectedDecision: suggestedDecision(["item-gh1-do-issue"]),
    hardFailureRisks: ["false_deadline", "false_urgency"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-GH-002",
    title: "현재 사용자 review가 요청된 pull request",
    summary:
      "fresh non-draft open PR에 사용자의 review request가 현재도 유효하다.",
    tags: ["github", "review_request", "unblock"],
    sources: [githubSource()],
    signals: [
      signal(
        "sig-gh2-review",
        "github",
        "pr-gh2",
        "review_requested",
        {
          state: "open",
          draft: false,
          reviewer: "user",
          requestCurrent: true
        },
        { destinationRef: "github://demo/core/pull/17" }
      )
    ],
    annotations: [
      eligibleAnnotation({
        itemId: "item-gh2-review-pr",
        subjectIds: ["pr-gh2"],
        intervention: "review",
        lane: "unblock",
        candidateReasons: ["CANDIDATE_GITHUB_REVIEW_REQUESTED"],
        whyNow: ["WHY_NOW_PERSON_WAITING"],
        evidenceSignalIds: ["sig-gh2-review"]
      })
    ],
    expectedCoverage: completeCoverage(),
    expectedDecision: suggestedDecision(["item-gh2-review-pr"]),
    hardFailureRisks: ["unsafe_first_step", "wrong_owner"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-GH-003",
    title: "행동 필요 field가 없는 authored open PR",
    summary:
      "사용자가 작성한 PR이 open이지만 requested changes, failed checks, conflict가 없다.",
    tags: [
      "github",
      "authored_pr",
      "overview_only",
      "scoped_no_action"
    ],
    sources: [
      githubSource(),
      source("notion", "unsupported", {
        status: "failed",
        candidateSetComplete: false,
        materialToDecision: false
      })
    ],
    signals: [
      signal(
        "sig-gh3-authored-pr",
        "github",
        "pr-gh3",
        "activity",
        {
          state: "open",
          authoredByUser: true,
          requestedChanges: false,
          failedChecks: false,
          mergeConflict: false
        },
        { destinationRef: "github://demo/core/pull/23" }
      )
    ],
    annotations: [
      excludedAnnotation({
        itemId: "item-gh3-authored-pr",
        subjectIds: ["pr-gh3"],
        overview: ["OVERVIEW_SOURCE_CONTEXT_ONLY"],
        gateReasons: ["GATE_NO_USER_INTERVENTION"],
        forbiddenInterventions: ["review", "follow_up"],
        notes: "authored와 최근 activity만으로 후보를 만들지 않는다."
      })
    ],
    expectedCoverage: scopedNoActionCoverage(["notion"]),
    expectedDecision: noActionDecision(["item-gh3-authored-pr"]),
    hardFailureRisks: ["false_candidate", "false_urgency"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-CA-001",
    title: "연결 task가 없는 Calendar-only 일정",
    summary:
      "20분 뒤 event가 있지만 다른 source와 연결된 preparation task는 없다.",
    tags: [
      "google_calendar",
      "calendar_only",
      "overview_only",
      "insufficient_evidence"
    ],
    sources: [
      source("google_calendar", "overview_only", {
        candidateSetComplete: false
      })
    ],
    signals: [
      signal(
        "sig-ca1-event",
        "google_calendar",
        "event-ca1",
        "scheduled_commitment",
        {
          startsAt: "2026-07-26T03:20:00.000Z",
          cancelled: false,
          linkedTaskId: null
        },
        { destinationRef: "gcal://events/event-ca1" }
      )
    ],
    annotations: [
      excludedAnnotation({
        itemId: "item-ca1-event",
        subjectIds: ["event-ca1"],
        overview: ["OVERVIEW_CALENDAR_CONSTRAINT"],
        gateReasons: ["GATE_NO_USER_INTERVENTION"],
        forbiddenInterventions: ["prepare"],
        notes: "event title이나 proximity만으로 preparation task를 만들지 않는다."
      })
    ],
    expectedCoverage: insufficientCoverage(["google_calendar"]),
    expectedDecision: insufficientDecision(["item-ca1-event"]),
    hardFailureRisks: ["false_candidate", "false_urgency"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-CA-002",
    title: "곧 시작할 event와 명시적으로 연결된 준비 task",
    summary:
      "mapped Notion review-prep task와 Calendar event가 explicit relation으로 연결돼 있다.",
    tags: ["google_calendar", "linked_preparation", "must_now"],
    sources: [
      source("google_calendar", "candidate_capable"),
      mappedNotionSource()
    ],
    signals: [
      signal(
        "sig-ca2-event",
        "google_calendar",
        "event-ca2",
        "scheduled_commitment",
        {
          startsAt: "2026-07-26T03:20:00.000Z",
          cancelled: false
        },
        { destinationRef: "gcal://events/event-ca2" }
      ),
      signal(
        "sig-ca2-prep-task",
        "notion",
        "prep-ca2",
        "task_exists",
        {
          mappedTaskDatabase: true,
          state: "open",
          owner: "user",
          taskType: "review_preparation"
        },
        { destinationRef: "notion://tasks/prep-ca2" }
      )
    ],
    relations: [
      {
        relationId: "rel-ca2-prepares-for",
        fromSubjectId: "prep-ca2",
        toSubjectId: "event-ca2",
        type: "prepares_for",
        authority: "explicit_native",
        evidenceSignalIds: ["sig-ca2-event", "sig-ca2-prep-task"]
      }
    ],
    annotations: [
      eligibleAnnotation({
        itemId: "item-ca2-prepare",
        subjectIds: ["prep-ca2", "event-ca2"],
        intervention: "prepare",
        lane: "must_now",
        candidateReasons: ["CANDIDATE_CALENDAR_LINKED_PREPARATION"],
        whyNow: ["WHY_NOW_LINKED_COMMITMENT_IMMINENT"],
        overview: ["OVERVIEW_CALENDAR_CONSTRAINT"],
        evidenceSignalIds: ["sig-ca2-event", "sig-ca2-prep-task"]
      })
    ],
    expectedCoverage: completeCoverage(),
    expectedDecision: suggestedDecision(["item-ca2-prepare"]),
    hardFailureRisks: ["false_candidate", "false_deadline"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-NO-001",
    title: "task mapping이 없는 일반 Notion page",
    summary:
      "일반 page가 최근 수정됐지만 mapped task database의 상태나 담당자 field가 없다.",
    tags: [
      "notion",
      "general_page",
      "overview_only",
      "insufficient_evidence"
    ],
    sources: [
      source("notion", "overview_only", {
        candidateSetComplete: false
      })
    ],
    signals: [
      signal(
        "sig-no1-page",
        "notion",
        "page-no1",
        "activity",
        {
          mappedTaskDatabase: false,
          recentlyEdited: true
        },
        { destinationRef: "notion://pages/page-no1" }
      )
    ],
    annotations: [
      excludedAnnotation({
        itemId: "item-no1-page",
        subjectIds: ["page-no1"],
        overview: ["OVERVIEW_SOURCE_CONTEXT_ONLY"],
        gateReasons: ["GATE_NO_USER_INTERVENTION"],
        forbiddenInterventions: ["do", "review"],
        notes: "page title과 edited time은 task evidence가 아니다."
      })
    ],
    expectedCoverage: insufficientCoverage(["notion"]),
    expectedDecision: insufficientDecision(["item-no1-page"]),
    hardFailureRisks: ["false_candidate", "wrong_owner"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-NO-002",
    title: "weekly outcome과 연결된 mapped Notion task",
    summary:
      "선택된 task database에서 open, user owner, project mapping이 모두 확인된다.",
    tags: ["notion", "mapped_task", "focus"],
    focus: weeklyFocus("온보딩 개선 실험 시작", ["project-onboarding"]),
    sources: [mappedNotionSource()],
    signals: [
      signal(
        "sig-no2-task",
        "notion",
        "task-no2",
        "task_exists",
        {
          mappedTaskDatabase: true,
          state: "open",
          owner: "user",
          internalPriority: "high"
        },
        {
          projectId: "project-onboarding",
          destinationRef: "notion://tasks/task-no2"
        }
      )
    ],
    annotations: [
      eligibleAnnotation({
        itemId: "item-no2-do-task",
        subjectIds: ["task-no2"],
        intervention: "do",
        lane: "focus",
        candidateReasons: ["CANDIDATE_NOTION_MAPPED_TASK_OPEN"],
        whyNow: ["WHY_NOW_PRIMARY_OUTCOME_ALIGNED"],
        evidenceSignalIds: ["sig-no2-task"]
      })
    ],
    expectedCoverage: completeCoverage(),
    expectedDecision: suggestedDecision(["item-no2-do-task"]),
    hardFailureRisks: ["false_deadline", "false_urgency"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-NO-003",
    title: "completed 상태의 mapped Notion task",
    summary:
      "mapped task database scope는 complete하지만 대상 task의 authoritative state가 completed다.",
    tags: ["notion", "mapped_task", "completed", "no_action"],
    sources: [mappedNotionSource()],
    signals: [
      signal(
        "sig-no3-task",
        "notion",
        "task-no3",
        "task_state",
        {
          mappedTaskDatabase: true,
          state: "completed",
          owner: "user"
        },
        { destinationRef: "notion://tasks/task-no3" }
      )
    ],
    annotations: [
      excludedAnnotation({
        itemId: "item-no3-completed",
        subjectIds: ["task-no3"],
        gateReasons: ["GATE_FINAL_STATE"],
        forbiddenInterventions: ["do", "review"],
        notes: "completed task를 candidate나 alternative로 반환하지 않는다."
      })
    ],
    expectedCoverage: completeCoverage(),
    expectedDecision: noActionDecision(["item-no3-completed"]),
    hardFailureRisks: ["wrong_state", "false_candidate"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-DS-001",
    title: "weekly outcome이 두 eligible item의 top을 가름",
    summary:
      "GitHub issue와 Notion task 모두 eligible이지만 GitHub item만 이번 주 primary outcome과 직접 연결된다.",
    tags: ["cross_source", "weekly_outcome", "pairwise_preference"],
    focus: weeklyFocus("결제 출시 준비 완료", ["project-payments"]),
    sources: [githubSource(), mappedNotionSource()],
    signals: [
      signal(
        "sig-ds1-github",
        "github",
        "issue-ds1",
        "task_exists",
        {
          state: "open",
          assignee: "user",
          ready: true
        },
        {
          projectId: "project-payments",
          destinationRef: "github://demo/payments/issues/51"
        }
      ),
      signal(
        "sig-ds1-notion",
        "notion",
        "task-ds1",
        "task_exists",
        {
          mappedTaskDatabase: true,
          state: "open",
          owner: "user"
        },
        {
          projectId: "project-onboarding",
          destinationRef: "notion://tasks/task-ds1"
        }
      )
    ],
    annotations: [
      eligibleAnnotation({
        itemId: "item-ds1-github",
        subjectIds: ["issue-ds1"],
        intervention: "do",
        lane: "focus",
        candidateReasons: ["CANDIDATE_GITHUB_ISSUE_ASSIGNED"],
        whyNow: ["WHY_NOW_PRIMARY_OUTCOME_ALIGNED"],
        evidenceSignalIds: ["sig-ds1-github"]
      }),
      eligibleAnnotation({
        itemId: "item-ds1-notion",
        subjectIds: ["task-ds1"],
        intervention: "do",
        lane: "focus",
        candidateReasons: ["CANDIDATE_NOTION_MAPPED_TASK_OPEN"],
        evidenceSignalIds: ["sig-ds1-notion"]
      })
    ],
    expectedCoverage: completeCoverage(),
    expectedDecision: suggestedDecision(["item-ds1-github"]),
    pairwisePreferences: [
      {
        preferredItemId: "item-ds1-github",
        overItemId: "item-ds1-notion",
        reasonCode: "WHY_NOW_PRIMARY_OUTCOME_ALIGNED"
      }
    ],
    hardFailureRisks: ["wrong_ranking", "false_urgency"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-DS-002",
    title: "동등한 두 review request에서도 기본 후보 하나를 제안",
    summary:
      "서로 다른 project의 eligible review request 두 개가 같은 lane과 근거를 가지며 primary outcome 입력이 없어도 적극 정책은 결정적인 기본 후보를 고른다.",
    tags: ["cross_source", "tie", "aggressive_default_pick"],
    sources: [githubSource()],
    signals: [
      signal(
        "sig-ds2-review-a",
        "github",
        "pr-ds2-a",
        "review_requested",
        {
          state: "open",
          draft: false,
          reviewer: "user",
          requestCurrent: true
        },
        {
          projectId: "project-payments",
          destinationRef: "github://demo/payments/pull/31"
        }
      ),
      signal(
        "sig-ds2-review-b",
        "github",
        "pr-ds2-b",
        "review_requested",
        {
          state: "open",
          draft: false,
          reviewer: "user",
          requestCurrent: true
        },
        {
          projectId: "project-onboarding",
          destinationRef: "github://demo/onboarding/pull/8"
        }
      )
    ],
    annotations: [
      eligibleAnnotation({
        itemId: "item-ds2-review-a",
        subjectIds: ["pr-ds2-a"],
        intervention: "review",
        lane: "unblock",
        candidateReasons: ["CANDIDATE_GITHUB_REVIEW_REQUESTED"],
        whyNow: ["WHY_NOW_PERSON_WAITING"],
        evidenceSignalIds: ["sig-ds2-review-a"]
      }),
      eligibleAnnotation({
        itemId: "item-ds2-review-b",
        subjectIds: ["pr-ds2-b"],
        intervention: "review",
        lane: "unblock",
        candidateReasons: ["CANDIDATE_GITHUB_REVIEW_REQUESTED"],
        whyNow: ["WHY_NOW_PERSON_WAITING"],
        evidenceSignalIds: ["sig-ds2-review-b"]
      })
    ],
    expectedCoverage: completeCoverage(),
    expectedDecision: suggestedDecision([
      "item-ds2-review-a",
      "item-ds2-review-b"
    ]),
    hardFailureRisks: ["unnecessary_clarification", "wrong_ranking"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-DS-003",
    title: "Notion 실패와 독립적인 fresh GitHub review",
    summary:
      "Notion fetch는 실패했지만 GitHub review request의 state, owner, destination은 독립적으로 완결돼 있다.",
    tags: [
      "cross_source",
      "partial_coverage",
      "independent_positive_candidate"
    ],
    sources: [
      githubSource(),
      source("notion", "unsupported", {
        status: "failed",
        candidateSetComplete: false,
        materialToDecision: false
      })
    ],
    signals: [
      signal(
        "sig-ds3-review",
        "github",
        "pr-ds3",
        "review_requested",
        {
          state: "open",
          draft: false,
          reviewer: "user",
          requestCurrent: true
        },
        { destinationRef: "github://demo/core/pull/44" }
      )
    ],
    annotations: [
      eligibleAnnotation({
        itemId: "item-ds3-review",
        subjectIds: ["pr-ds3"],
        intervention: "review",
        lane: "unblock",
        candidateReasons: ["CANDIDATE_GITHUB_REVIEW_REQUESTED"],
        whyNow: ["WHY_NOW_PERSON_WAITING"],
        evidenceSignalIds: ["sig-ds3-review"],
        notes: "추천 문구에는 Notion 미평가 범위를 함께 표시해야 한다."
      })
    ],
    expectedCoverage: limitedPositiveCoverage(["notion"]),
    expectedDecision: suggestedDecision(["item-ds3-review"]),
    hardFailureRisks: ["stale_source_used", "missing_candidate"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-DS-004",
    title: "누락 후보가 top을 바꿀 수 있는 truncated GitHub snapshot",
    summary:
      "GitHub snapshot이 truncated이고 현재 positive candidate가 없어 no-action을 주장할 수 없다.",
    tags: [
      "cross_source",
      "truncated",
      "insufficient_evidence",
      "source_refresh"
    ],
    sources: [
      source("github", "candidate_capable", {
        status: "partial",
        candidateSetComplete: false,
        truncated: true
      })
    ],
    signals: [
      signal(
        "sig-ds4-repo-scope",
        "github",
        "repo-ds4",
        "activity",
        {
          fetchedItemCount: 100,
          nextPageAvailable: true,
          candidateSetMayBeIncomplete: true
        }
      )
    ],
    annotations: [
      reviewAnnotation({
        itemId: "item-ds4-unknown-scope",
        subjectIds: ["repo-ds4"],
        overview: ["OVERVIEW_SOURCE_CONTEXT_ONLY"],
        gateReasons: ["GATE_DIRECT_EVIDENCE_MISSING"],
        reviewReasons: ["REVIEW_SOURCE_TRUNCATED"],
        notes: "refresh 또는 다음 page 없이 no_action을 반환하지 않는다."
      })
    ],
    expectedCoverage: insufficientCoverage(["github"]),
    expectedDecision: insufficientDecision(
      ["item-ds4-unknown-scope"],
      true
    ),
    hardFailureRisks: ["stale_source_used", "false_no_action"]
  }),
  buildSyntheticCase({
    caseId: "AD-DEV-DS-005",
    title: "candidate-capable 범위가 모두 final 또는 healthy",
    summary:
      "GitHub, mapped Notion, enhanced Codex가 모두 fresh하고 complete이며 열린 사용자 개입이 없다.",
    tags: ["cross_source", "complete_negative_coverage", "no_action"],
    sources: [
      githubSource(),
      mappedNotionSource(),
      enhancedCodex([EARLY_SNAPSHOT, LATEST_SNAPSHOT])
    ],
    signals: [
      signal(
        "sig-ds5-pr",
        "github",
        "pr-ds5",
        "activity",
        {
          state: "open",
          authoredByUser: true,
          requestedChanges: false,
          failedChecks: false
        },
        { destinationRef: "github://demo/core/pull/52" }
      ),
      signal(
        "sig-ds5-task",
        "notion",
        "task-ds5",
        "task_state",
        {
          mappedTaskDatabase: true,
          state: "completed",
          owner: "user"
        },
        { destinationRef: "notion://tasks/task-ds5" }
      ),
      signal(
        "sig-ds5-progress",
        "codex",
        "exec-ds5",
        "execution_progress",
        {
          markerType: "phase_transition",
          fromPhase: "test",
          toPhase: "build"
        },
        { snapshotIndex: 1, evidenceLevel: "derived" }
      )
    ],
    useCodexDetector: true,
    annotations: [
      excludedAnnotation({
        itemId: "item-ds5-pr",
        subjectIds: ["pr-ds5"],
        overview: ["OVERVIEW_SOURCE_CONTEXT_ONLY"],
        gateReasons: ["GATE_NO_USER_INTERVENTION"],
        forbiddenInterventions: ["review", "follow_up"]
      }),
      excludedAnnotation({
        itemId: "item-ds5-task",
        subjectIds: ["task-ds5"],
        gateReasons: ["GATE_FINAL_STATE"],
        forbiddenInterventions: ["do"]
      }),
      excludedAnnotation({
        itemId: "item-ds5-codex",
        subjectIds: ["exec-ds5"],
        overview: ["OVERVIEW_CODEX_EXECUTION_RECENT_PROGRESS"],
        overviewStates: ["running"],
        gateReasons: ["GATE_HEALTHY_CODEX_EXECUTION"],
        forbiddenInterventions: ["inspect", "resume"]
      })
    ],
    expectedCodexExecutions: [
      codexExpectation({
        executionId: "exec-ds5",
        states: ["running"]
      })
    ],
    expectedCoverage: completeCoverage(),
    expectedDecision: noActionDecision(
      ["item-ds5-pr", "item-ds5-task", "item-ds5-codex"]
    ),
    hardFailureRisks: [
      "false_candidate",
      "healthy_execution_recommended",
      "missed_no_action"
    ]
  })
];

export const crossSourceDevDatasetInput = {
  datasetFamily: "suggestion-cross-source",
  datasetVersion: "suggestion-cross-source-dev-v0.1",
  datasetRevision: 2,
  schemaVersion: "cross-source-evaluation-case-v0.1",
  reasonCodeVersion: "cross-source-reason-codes-v0.1",
  definitionVersion: "cross-source-attention-definition-v0.2",
  datasetClass: "dev_candidate",
  lifecycle: {
    state: "mutable",
    datasetSha256: null,
    immutableRef: null,
    frozenAt: null
  },
  dataOrigin: "synthetic",
  containsProductionData: false,
  inputBoundary: "normalized_work_signals_and_relations",
  createdAt: "2026-07-26T03:00:00.000Z",
  updatedAt: "2026-07-26T12:00:00.000Z",
  cases
};

export const crossSourceDevDataset = loadVerifiedCrossSourceEvaluationDataset(
  crossSourceDevDatasetInput,
  syntheticCrossSourceIntegrityOptions
);
