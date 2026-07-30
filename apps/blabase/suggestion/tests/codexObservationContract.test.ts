import { describe, expect, it } from "vitest";

import {
  codexExecutionObservationSchema,
  observeCodexInventorySession,
  observeCodexManagedNotification,
  parseCodexObservationHistory
} from "../src/connectors/codex/observationContract";
import { emptyCodexContentManifest } from "../src/connectors/codex/conversationContract";
import type { CodexSessionSignal } from "../src/connectors/codex/types";

const EXECUTION_ID = "0123456789abcdef01234567";
const OBSERVED_AT = "2026-07-27T06:00:00.000Z";

describe("Codex execution observation contract", () => {
  it("never converts thread inventory load state into live execution state", () => {
    const observation = observeCodexInventorySession({
      session: session({ activityState: "not_loaded" }),
      observedAt: OBSERVED_AT,
      sequence: 3
    });

    expect(observation).toMatchObject({
      contract: "codex-execution-observation-v2",
      observationMode: "inventory_only",
      liveObservationAvailable: false,
      executionState: "unknown",
      inventoryActivityState: "not_loaded",
      waitingState: null,
      sourceEvent: "thread_inventory",
      reasonCode: "CODEX_INVENTORY_IS_NOT_LIVE_EXECUTION_STATE"
    });
  });

  it.each([
    [
      "approval waiting state",
      { waitingState: "waiting_on_approval" }
    ],
    [
      "user-input waiting state",
      { waitingState: "waiting_on_user_input" }
    ],
    [
      "managed-only reason",
      { reasonCode: "CODEX_MANAGED_THREAD_NOT_LOADED" }
    ],
    ["managed source timestamp semantics", { sourceUpdatedAt: null }]
  ])(
    "rejects inventory-only data carrying %s",
    (_label, override) => {
      const observation = observeCodexInventorySession({
        session: session(),
        observedAt: OBSERVED_AT,
        sequence: 3
      });

      expect(
        codexExecutionObservationSchema.safeParse({
          ...observation,
          ...override
        }).success
      ).toBe(false);
    }
  );

  it("normalizes a semantically valid v1 history to the exact v2 contract", () => {
    const observation = observeCodexInventorySession({
      session: session(),
      observedAt: OBSERVED_AT,
      sequence: 3
    });

    expect(
      parseCodexObservationHistory({
        contract: "codex-observation-history-v1",
        updatedAt: OBSERVED_AT,
        observations: [
          {
            ...observation,
            contract: "codex-execution-observation-v1"
          }
        ]
      })
    ).toMatchObject({
      contract: "codex-observation-history-v2",
      observations: [
        {
          contract: "codex-execution-observation-v2",
          observationMode: "inventory_only",
          executionState: "unknown",
          waitingState: null
        }
      ]
    });
  });

  it("rejects a malformed v1 history instead of migrating managed semantics into inventory", () => {
    const observation = observeCodexInventorySession({
      session: session(),
      observedAt: OBSERVED_AT,
      sequence: 3
    });

    expect(() =>
      parseCodexObservationHistory({
        contract: "codex-observation-history-v1",
        updatedAt: OBSERVED_AT,
        observations: [
          {
            ...observation,
            contract: "codex-execution-observation-v1",
            waitingState: "waiting_on_approval"
          }
        ]
      })
    ).toThrow();
  });

  it("derives running and waiting state only from an owned event stream", () => {
    const observation = observeCodexManagedNotification({
      notification: {
        method: "thread/status/changed",
        params: {
          threadId: "native-thread-a",
          status: {
            type: "active",
            activeFlags: ["waitingOnUserInput"]
          },
          ignoredContent: "must not be retained"
        }
      },
      executionId: EXECUTION_ID,
      expectedThreadId: "native-thread-a",
      observedAt: OBSERVED_AT,
      sequence: 4
    });

    expect(observation).toMatchObject({
      observationMode: "managed_event_stream",
      liveObservationAvailable: true,
      executionState: "running",
      waitingState: "waiting_on_user_input",
      sourceEvent: "thread_status_changed"
    });
    expect(JSON.stringify(observation)).not.toContain(
      "must not be retained"
    );
    expect(JSON.stringify(observation)).not.toContain(
      "native-thread-a"
    );
  });

  it.each([
    [
      "active",
      {
        method: "thread/status/changed",
        params: {
          threadId: "native-thread-a",
          status: { type: "active", activeFlags: [] }
        }
      },
      {
        executionState: "running",
        waitingState: null,
        sourceEvent: "thread_status_changed",
        reasonCode: "CODEX_MANAGED_THREAD_ACTIVE"
      }
    ],
    [
      "active waiting on approval",
      {
        method: "thread/status/changed",
        params: {
          threadId: "native-thread-a",
          status: {
            type: "active",
            activeFlags: ["waitingOnApproval"]
          }
        }
      },
      {
        executionState: "running",
        waitingState: "waiting_on_approval",
        sourceEvent: "thread_status_changed",
        reasonCode: "CODEX_MANAGED_THREAD_ACTIVE"
      }
    ],
    [
      "active waiting on user input",
      {
        method: "thread/status/changed",
        params: {
          threadId: "native-thread-a",
          status: {
            type: "active",
            activeFlags: ["waitingOnUserInput"]
          }
        }
      },
      {
        executionState: "running",
        waitingState: "waiting_on_user_input",
        sourceEvent: "thread_status_changed",
        reasonCode: "CODEX_MANAGED_THREAD_ACTIVE"
      }
    ],
    [
      "idle",
      {
        method: "thread/status/changed",
        params: {
          threadId: "native-thread-a",
          status: { type: "idle" }
        }
      },
      {
        executionState: "idle",
        waitingState: null,
        sourceEvent: "thread_status_changed",
        reasonCode: "CODEX_MANAGED_THREAD_IDLE"
      }
    ],
    [
      "not loaded",
      {
        method: "thread/status/changed",
        params: {
          threadId: "native-thread-a",
          status: { type: "notLoaded" }
        }
      },
      {
        executionState: "unknown",
        waitingState: null,
        sourceEvent: "thread_status_changed",
        reasonCode: "CODEX_MANAGED_THREAD_NOT_LOADED"
      }
    ],
    [
      "system error",
      {
        method: "thread/status/changed",
        params: {
          threadId: "native-thread-a",
          status: { type: "systemError" }
        }
      },
      {
        executionState: "unknown",
        waitingState: null,
        sourceEvent: "thread_status_changed",
        reasonCode: "CODEX_MANAGED_THREAD_SYSTEM_ERROR"
      }
    ],
    [
      "turn started",
      {
        method: "turn/started",
        params: {
          threadId: "native-thread-a",
          turn: { id: "turn-a", status: "inProgress" }
        }
      },
      {
        executionState: "running",
        waitingState: null,
        sourceEvent: "turn_started",
        reasonCode: "CODEX_MANAGED_TURN_STARTED"
      }
    ],
    [
      "item started",
      {
        method: "item/started",
        params: {
          threadId: "native-thread-a",
          turnId: "turn-a",
          item: { id: "item-a", type: "commandExecution" }
        }
      },
      {
        executionState: "running",
        waitingState: null,
        sourceEvent: "item_started",
        reasonCode: "CODEX_MANAGED_ITEM_ACTIVITY"
      }
    ],
    [
      "item completed",
      {
        method: "item/completed",
        params: {
          threadId: "native-thread-a",
          turnId: "turn-a",
          item: { id: "item-a", type: "commandExecution" }
        }
      },
      {
        executionState: "running",
        waitingState: null,
        sourceEvent: "item_completed",
        reasonCode: "CODEX_MANAGED_ITEM_ACTIVITY"
      }
    ]
  ])(
    "accepts the exact managed-event tuple for %s",
    (_label, notification, expected) => {
      expect(
        observeCodexManagedNotification({
          notification,
          executionId: EXECUTION_ID,
          expectedThreadId: "native-thread-a",
          observedAt: OBSERVED_AT,
          sequence: 8
        })
      ).toMatchObject({
        contract: "codex-execution-observation-v2",
        observationMode: "managed_event_stream",
        liveObservationAvailable: true,
        inventoryActivityState: null,
        sourceUpdatedAt: null,
        ...expected
      });
    }
  );

  it.each([
    [
      "reason for another thread state",
      { reasonCode: "CODEX_MANAGED_THREAD_IDLE" }
    ],
    ["inventory timestamp", { sourceUpdatedAt: OBSERVED_AT }],
    [
      "non-active waiting state",
      {
        executionState: "idle",
        waitingState: "waiting_on_approval",
        reasonCode: "CODEX_MANAGED_THREAD_IDLE"
      }
    ],
    [
      "turn-only completion semantics",
      {
        executionState: "completed",
        reasonCode: "CODEX_MANAGED_TURN_COMPLETED"
      }
    ]
  ])(
    "rejects a managed event carrying %s",
    (_label, override) => {
      const observation = observeCodexManagedNotification({
        notification: {
          method: "thread/status/changed",
          params: {
            threadId: "native-thread-a",
            status: { type: "active", activeFlags: [] }
          }
        },
        executionId: EXECUTION_ID,
        expectedThreadId: "native-thread-a",
        observedAt: OBSERVED_AT,
        sequence: 8
      });

      expect(
        codexExecutionObservationSchema.safeParse({
          ...observation,
          ...override
        }).success
      ).toBe(false);
    }
  );

  it.each([
    ["completed", "completed", "CODEX_MANAGED_TURN_COMPLETED"],
    ["failed", "failed", "CODEX_MANAGED_TURN_FAILED"],
    [
      "interrupted",
      "interrupted",
      "CODEX_MANAGED_TURN_INTERRUPTED"
    ]
  ] as const)(
    "maps an explicit %s turn completion without inference",
    (nativeStatus, executionState, reasonCode) => {
      const observation = observeCodexManagedNotification({
        notification: {
          method: "turn/completed",
          params: {
            threadId: "native-thread-a",
            turn: {
              id: "turn-a",
              status: nativeStatus,
              error: { message: "private error" },
              items: [{ text: "private content" }]
            }
          }
        },
        executionId: EXECUTION_ID,
        expectedThreadId: "native-thread-a",
        observedAt: OBSERVED_AT,
        sequence: 5
      });

      expect(observation).toMatchObject({
        executionState,
        reasonCode,
        sourceEvent: "turn_completed"
      });
      expect(JSON.stringify(observation)).not.toContain("private");
    }
  );

  it.each([
    ["turn/started", "completed"],
    ["turn/started", "failed"],
    ["turn/started", "interrupted"],
    ["turn/completed", "inProgress"]
  ] as const)(
    "rejects impossible managed notification combination %s + %s at parse time",
    (method, status) => {
      expect(() =>
        observeCodexManagedNotification({
          notification: {
            method,
            params: {
              threadId: "native-thread-a",
              turn: { id: "turn-a", status }
            }
          },
          executionId: EXECUTION_ID,
          expectedThreadId: "native-thread-a",
          observedAt: OBSERVED_AT,
          sequence: 6
        })
      ).toThrow();
    }
  );

  it("rejects an event from another thread", () => {
    expect(() =>
      observeCodexManagedNotification({
        notification: {
          method: "turn/started",
          params: {
            threadId: "native-thread-b",
            turn: { id: "turn-a", status: "inProgress" }
          }
        },
        executionId: EXECUTION_ID,
        expectedThreadId: "native-thread-a",
        observedAt: OBSERVED_AT,
        sequence: 0
      })
    ).toThrow("expected thread");
  });
});

function session(
  overrides: Partial<CodexSessionSignal> = {}
): CodexSessionSignal {
  return {
    id: EXECUTION_ID,
    source: "codex",
    kind: "coding_session",
    scopeId: "89abcdef0123456789abcdef",
    projectLabel: "blabase",
    taskSummary: null,
    taskSummarySource: null,
    createdAt: "2026-07-27T05:00:00.000Z",
    updatedAt: "2026-07-27T05:59:00.000Z",
    activityState: "unknown",
    attentionState: null,
    content: emptyCodexContentManifest(),
    ...overrides
  };
}
