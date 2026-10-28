import { describe, expect, it, vi } from "vitest";

const stableIdTestControl = vi.hoisted(() => ({
  forceRecordIdCollision: false,
}));

vi.mock("../src/crossSource/canonicalHash", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/crossSource/canonicalHash")>();
  return {
    ...actual,
    runtimeStableId(prefix: string, domain: string, value: unknown): string {
      if (
        stableIdTestControl.forceRecordIdCollision &&
        prefix === "evidence_record"
      ) {
        return "evidence_record_ffffffffffffffffffffffffffffffff";
      }
      return actual.runtimeStableId(prefix, domain, value);
    },
  };
});

import { runtimeStableId } from "../src/crossSource/canonicalHash";
import {
  domainSeparatedSha256,
  jcsCanonicalize,
  sha256HexSchema,
  utcTimestampSchema,
} from "../src/dayflowEvidence/contracts";
import {
  COMMON_SUGGESTION_EVIDENCE_BUDGET_VERSION_V0_1,
  COMMON_SUGGESTION_EVIDENCE_RECORD_SET_HASH_DOMAIN_V0_1,
  COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1,
  COMMON_SUGGESTION_EVIDENCE_RECORD_SET_SCHEMA_VERSION_V0_1,
  CommonSuggestionEvidenceRecordSetError,
  buildAndSealCommonSuggestionEvidenceRecordSetV0_1,
  commonSuggestionEvidenceRecordSetStructuralSchemaV0_1,
  serializeCommonSuggestionEvidenceRecordSetV0_1,
  verifyCommonSuggestionEvidenceRecordSetV0_1,
  type CommonSuggestionEvidenceBuildInputV0_1,
  type CommonSuggestionEvidenceBuildRecordV0_1,
  type CommonSuggestionEvidenceRecordSetV0_1,
} from "../src/evaluation/dayflowAblation/commonSuggestionEvidenceV0_1";

const AS_OF = "2026-08-18T00:00:00.000Z";
const START = "2026-08-17T00:00:00.000Z";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function hash(index: number): string {
  return index.toString(16).padStart(64, "0");
}

function rehashRecordSet(
  recordSet: CommonSuggestionEvidenceRecordSetV0_1,
): CommonSuggestionEvidenceRecordSetV0_1 {
  recordSet.commonSuggestionEvidenceRecordSetSha256 = domainSeparatedSha256(
    COMMON_SUGGESTION_EVIDENCE_RECORD_SET_HASH_DOMAIN_V0_1,
    {
      schemaVersion: recordSet.schemaVersion,
      asOf: recordSet.asOf,
      records: recordSet.records,
      truncation: recordSet.truncation,
    },
  );
  return recordSet;
}

function commonFields(observedAt = START) {
  return {
    projectRef: "project_fictional_alpha",
    observedAt,
    sourceUpdatedAt: observedAt,
    validUntil: null,
    completeness: "complete" as const,
  };
}

function workItem(
  index = 1,
  observedAt = START,
): Extract<
  CommonSuggestionEvidenceBuildRecordV0_1,
  { kind: "github_work_item" }
> {
  return {
    kind: "github_work_item",
    identity: { signalHash: hash(index) },
    ...commonFields(observedAt),
    facts: {
      attentionCapability: "candidate_input",
      nativeTitle: `Fictional work item ${index}`,
      repositoryFullName: "fictional-org/fictional-repo",
      number: index,
      objectType: "issue",
      taskKind: "assigned_issue",
      state: "open",
      relationship: "assigned_to_user",
      semanticRole: "direct_work_item",
      eligibilityLimit: "none",
      draftState: "not_applicable",
    },
  };
}

function dayflowFrame(
  totalTextCharacters = 21,
  spanCount = 1,
): Extract<
  CommonSuggestionEvidenceBuildRecordV0_1,
  { kind: "dayflow_frame" }
> {
  const spans: Extract<
    CommonSuggestionEvidenceBuildRecordV0_1,
    { kind: "dayflow_frame" }
  >["facts"]["spans"] = [];
  let remaining = totalTextCharacters;
  for (let index = 0; index < spanCount; index += 1) {
    const remainingSpans = spanCount - index - 1;
    const length = Math.min(2_048, remaining - remainingSpans);
    spans.push({
      spanOrdinal: index,
      textKind: "privacy_filtered_ocr",
      text: "x".repeat(length),
      confidence: { status: "unavailable", basisPoints: null },
      redaction: { status: "none_detected", categories: [] },
    });
    remaining -= length;
  }
  if (remaining !== 0) throw new Error("Invalid fictional text allocation");
  return {
    kind: "dayflow_frame",
    identity: {
      dayflowPreprocessedEvidenceSha256: hash(70),
      frameOrdinal: 0,
    },
    ...commonFields(START),
    facts: {
      capturedAt: START,
      processingStatus: "text",
      spans,
      omissionCode: null,
      errorCode: null,
      retryability: null,
    },
  };
}

function allKindsInput(): CommonSuggestionEvidenceBuildInputV0_1 {
  return {
    asOf: AS_OF,
    availableRecords: {
      structured: [
        workItem(),
        {
          kind: "github_deadline",
          identity: { signalHash: hash(2) },
          ...commonFields("2026-08-17T00:01:00.000Z"),
          facts: {
            attentionCapability: "overview_only",
            deadlineAt: "2026-08-20T00:00:00.000Z",
            deadlineKind: "milestone_due_at",
            taskKind: "assigned_issue",
            semanticRole: "context_only",
            eligibilityLimit: "not_actionable_by_source_kind",
          },
        },
        {
          kind: "github_activity",
          identity: { signalHash: hash(3) },
          ...commonFields("2026-08-17T00:02:00.000Z"),
          facts: {
            activityKind: "push",
            repositoryFullName: "fictional-org/fictional-repo",
            activityAt: null,
          },
        },
        {
          kind: "codex_overview",
          identity: { signalHash: hash(4) },
          ...commonFields("2026-08-17T00:03:00.000Z"),
          facts: {
            nativeProjectLabel: "Fictional project",
            taskSummary: null,
            taskSummarySource: null,
            nativeActivityState: "idle",
            semanticState: "idle",
            nativeAttentionState: null,
            contentMode: "metadata_only",
            conversationCollectionState: "not_collected",
            historicalTurnStatus: "completed",
            latestTurnCompletedAt: null,
            turnCount: 0,
            commandExecutionCount: 0,
            failedCommandCount: 0,
            fileChangeCount: 0,
            toolCallCount: 0,
          },
        },
        {
          kind: "calendar_constraint",
          identity: {
            sourceBindingSha256: hash(5),
            eventId: "fictional-event-private-id",
          },
          ...commonFields("2026-08-17T00:04:00.000Z"),
          facts: {
            nativeTitle: "Fictional planning block",
            startAt: "2026-08-17T09:00:00.000Z",
            endAt: "2026-08-17T10:00:00.000Z",
            allDay: false,
            tentative: false,
          },
        },
        {
          kind: "notion_resource",
          identity: {
            sourceBindingSha256: hash(6),
            resourceId: "fictional-resource-private-id",
          },
          ...commonFields("2026-08-17T00:05:00.000Z"),
          facts: {
            nativeTitle: "Fictional reference page",
            resourceKind: "page",
            lastEditedAt: "2026-08-17T00:05:00.000Z",
          },
        },
      ],
      dayflow: [dayflowFrame()],
    },
  };
}

function cloneInput(
  input: CommonSuggestionEvidenceBuildInputV0_1,
): CommonSuggestionEvidenceBuildInputV0_1 {
  return JSON.parse(JSON.stringify(input)) as CommonSuggestionEvidenceBuildInputV0_1;
}

function requireRecordSet(
  input: unknown,
): CommonSuggestionEvidenceRecordSetV0_1 {
  const result = buildAndSealCommonSuggestionEvidenceRecordSetV0_1(input);
  expect(result.valid).toBe(true);
  if (!result.valid) throw new Error("Expected fictional fixture to build");
  return result.recordSet;
}

function recordIdFor(
  kind: CommonSuggestionEvidenceBuildRecordV0_1["kind"],
  identity: object,
): string {
  return runtimeStableId(
    "evidence_record",
    "common-suggestion-evidence-record-id-v0.1",
    {
      kind,
      identitySha256: domainSeparatedSha256(
        "blabase.common-suggestion-evidence.private-record-identity.v0.1",
        identity,
      ),
    },
  );
}

function factIdFor(recordId: string, factKey: string, value: unknown): string {
  return runtimeStableId(
    "evidence_fact",
    "common-suggestion-evidence-fact-id-v0.1",
    {
      recordId,
      factKey,
      valueSha256: domainSeparatedSha256(
        "blabase.common-suggestion-evidence.fact-value.v0.1",
        value,
      ),
    },
  );
}

function utf8Length(value: unknown): number {
  return encoder.encode(jcsCanonicalize(value)).byteLength;
}

function collectKeys(value: unknown, output = new Set<string>()): Set<string> {
  if (value === null || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, output);
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    output.add(key);
    collectKeys(child, output);
  }
  return output;
}

describe("common suggestion evidence record set v0.1", () => {
  it("builds all seven kinds with derived authority, private IDs, and typed fact IDs", () => {
    const input = allKindsInput();
    const result = buildAndSealCommonSuggestionEvidenceRecordSetV0_1(input);
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("Expected build success");

    const recordSet = result.recordSet;
    expect(recordSet.schemaVersion).toBe(
      "blabase-common-suggestion-evidence-record-set-v0.1",
    );
    expect(recordSet.records.structured).toHaveLength(6);
    expect(recordSet.records.dayflow).toHaveLength(1);
    expect(
      recordSet.records.structured.map((record) => record.kind).sort(),
    ).toEqual(
      [
        "github_work_item",
        "github_deadline",
        "github_activity",
        "codex_overview",
        "calendar_constraint",
        "notion_resource",
      ].sort(),
    );

    const work = recordSet.records.structured.find(
      (record) => record.kind === "github_work_item",
    );
    expect(work?.authority).toBe("primary_task_fact");
    if (work?.kind !== "github_work_item") throw new Error("Missing work item");
    const expectedWorkId = recordIdFor(
      "github_work_item",
      input.availableRecords.structured[0]!.identity,
    );
    expect(work.recordId).toBe(expectedWorkId);
    expect(work.factIds.nativeTitle).toBe(
      factIdFor(work.recordId, "nativeTitle", work.facts.nativeTitle),
    );

    const deadline = recordSet.records.structured.find(
      (record) => record.kind === "github_deadline",
    );
    expect(deadline?.authority).toBe("structured_supporting_context");
    const activity = recordSet.records.structured.find(
      (record) => record.kind === "github_activity",
    );
    expect(activity?.kind === "github_activity" && activity.factIds.activityAt).toBe(
      null,
    );

    const frame = recordSet.records.dayflow[0]!;
    expect(frame.authority).toBe("screen_observation");
    expect(frame.source).toBe("dayflow");
    expect(frame.factIds.spans[0]).toEqual({
      text: factIdFor(frame.recordId, "spans.0.text", frame.facts.spans[0]!.text),
      confidenceStatus: factIdFor(
        frame.recordId,
        "spans.0.confidence.status",
        "unavailable",
      ),
      confidenceBasisPoints: null,
      redactionStatus: factIdFor(
        frame.recordId,
        "spans.0.redaction.status",
        "none_detected",
      ),
      redactionCategories: factIdFor(
        frame.recordId,
        "spans.0.redaction.categories",
        [],
      ),
    });
    expect(frame.factIds.errorCode).toBeNull();
    expect(result.issueCodes).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.issueCodes)).toBe(true);
    expect(Object.isFrozen(recordSet)).toBe(true);
    expect(Object.isFrozen(recordSet.records)).toBe(true);
    expect(Object.isFrozen(recordSet.records.dayflow)).toBe(true);
    expect(Object.isFrozen(frame.facts.spans[0])).toBe(true);
  });

  it("rejects unknown fields, cross-partition kinds, accessors, proxies, and caps", () => {
    const unknownRoot = { ...allKindsInput(), unexpected: true };
    expect(buildAndSealCommonSuggestionEvidenceRecordSetV0_1(unknownRoot)).toEqual({
      valid: false,
      issueCodes: ["INPUT_INVALID"],
    });

    const crossPartition = allKindsInput();
    crossPartition.availableRecords.dayflow = [
      crossPartition.availableRecords.structured[0] as never,
    ];
    expect(
      buildAndSealCommonSuggestionEvidenceRecordSetV0_1(crossPartition),
    ).toEqual({ valid: false, issueCodes: ["INPUT_INVALID"] });

    let getterCalls = 0;
    const accessorRoot = Object.defineProperty({}, "asOf", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return AS_OF;
      },
    });
    Object.defineProperty(accessorRoot, "availableRecords", {
      enumerable: true,
      value: { structured: [], dayflow: [] },
    });
    expect(buildAndSealCommonSuggestionEvidenceRecordSetV0_1(accessorRoot)).toEqual({
      valid: false,
      issueCodes: ["INPUT_INVALID"],
    });
    expect(getterCalls).toBe(0);

    let proxyTrapCalls = 0;
    const proxied = new Proxy(allKindsInput(), {
      ownKeys() {
        proxyTrapCalls += 1;
        throw new Error("must not run");
      },
    });
    expect(buildAndSealCommonSuggestionEvidenceRecordSetV0_1(proxied)).toEqual({
      valid: false,
      issueCodes: ["INPUT_INVALID"],
    });
    expect(proxyTrapCalls).toBe(0);

    const sharedReference = allKindsInput();
    const sharedIdentity = sharedReference.availableRecords.structured[0]!.identity;
    (
      sharedReference.availableRecords.structured[1] as {
        identity: unknown;
      }
    ).identity = sharedIdentity;
    expect(
      buildAndSealCommonSuggestionEvidenceRecordSetV0_1(sharedReference),
    ).toEqual({ valid: false, issueCodes: ["INPUT_INVALID"] });

    const overCap = allKindsInput();
    overCap.availableRecords.structured = new Array(
      COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.structuredInputRecordCount +
        1,
    ).fill(workItem());
    const capped = buildAndSealCommonSuggestionEvidenceRecordSetV0_1(overCap);
    expect(capped).toEqual({
      valid: false,
      issueCodes: ["RESOURCE_LIMIT_EXCEEDED"],
    });
    expect(Object.isFrozen(capped)).toBe(true);
    expect(Object.isFrozen(capped.issueCodes)).toBe(true);
  });

  it("uses module-captured input inspection intrinsics", () => {
    const input = allKindsInput();
    const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const originalGetPrototypeOf = Object.getPrototypeOf;
    const originalReflectOwnKeys = Reflect.ownKeys;
    const originalNumberIsFinite = Number.isFinite;
    let hookCalls = 0;
    let result:
      | ReturnType<
          typeof buildAndSealCommonSuggestionEvidenceRecordSetV0_1
        >
      | undefined;

    try {
      Object.getOwnPropertyDescriptor = (() => {
        hookCalls += 1;
        throw new Error("hostile getOwnPropertyDescriptor");
      }) as typeof Object.getOwnPropertyDescriptor;
      Object.getPrototypeOf = (() => {
        hookCalls += 1;
        throw new Error("hostile getPrototypeOf");
      }) as typeof Object.getPrototypeOf;
      Reflect.ownKeys = (() => {
        hookCalls += 1;
        throw new Error("hostile ownKeys");
      }) as typeof Reflect.ownKeys;
      Number.isFinite = (() => {
        hookCalls += 1;
        throw new Error("hostile isFinite");
      }) as typeof Number.isFinite;

      result = buildAndSealCommonSuggestionEvidenceRecordSetV0_1(input);
    } finally {
      Object.getOwnPropertyDescriptor = originalGetOwnPropertyDescriptor;
      Object.getPrototypeOf = originalGetPrototypeOf;
      Reflect.ownKeys = originalReflectOwnKeys;
      Number.isFinite = originalNumberIsFinite;
    }

    expect(hookCalls).toBe(0);
    expect(result?.valid).toBe(true);
  });

  it("collapses byte-identical duplicates and rejects same identity with different records", () => {
    const duplicateInput: CommonSuggestionEvidenceBuildInputV0_1 = {
      asOf: AS_OF,
      availableRecords: {
        structured: [workItem(), workItem()],
        dayflow: [],
      },
    };
    const duplicateSet = requireRecordSet(duplicateInput);
    expect(duplicateSet.records.structured).toHaveLength(1);
    expect(duplicateSet.truncation.structured).toMatchObject({
      inputRecordCount: 2,
      availableRecordCount: 1,
      duplicateRecordCount: 1,
      includedRecordCount: 1,
    });

    const conflict = workItem();
    conflict.facts.nativeTitle = "Different fictional prompt fact";
    const collision = buildAndSealCommonSuggestionEvidenceRecordSetV0_1({
      asOf: AS_OF,
      availableRecords: {
        structured: [workItem(), conflict],
        dayflow: [],
      },
    });
    expect(collision).toEqual({
      valid: false,
      issueCodes: ["RECORD_ID_COLLISION"],
    });
  });

  it("rejects a record ID collision across structured and Dayflow partitions", () => {
    let collision:
      | ReturnType<
          typeof buildAndSealCommonSuggestionEvidenceRecordSetV0_1
        >
      | undefined;
    stableIdTestControl.forceRecordIdCollision = true;
    try {
      collision = buildAndSealCommonSuggestionEvidenceRecordSetV0_1({
        asOf: AS_OF,
        availableRecords: {
          structured: [workItem()],
          dayflow: [dayflowFrame()],
        },
      });
    } finally {
      stableIdTestControl.forceRecordIdCollision = false;
    }
    expect(collision).toEqual({
      valid: false,
      issueCodes: ["RECORD_ID_COLLISION"],
    });
  });

  it("is permutation-stable while selection and serialization use independent orders", () => {
    const first = allKindsInput();
    const second = cloneInput(first);
    second.availableRecords.structured.reverse();
    second.availableRecords.dayflow.reverse();
    expect(
      serializeCommonSuggestionEvidenceRecordSetV0_1(requireRecordSet(first)),
    ).toEqual(
      serializeCommonSuggestionEvidenceRecordSetV0_1(requireRecordSet(second)),
    );

    const records: Extract<
      CommonSuggestionEvidenceBuildRecordV0_1,
      { kind: "github_work_item" }
    >[] = [];
    for (let index = 0; index < 80; index += 1) {
      const record = workItem(
        100 + index,
        new Date(Date.parse(START) + index * 1_000).toISOString(),
      );
      record.facts.nativeTitle = `${index}-${"f".repeat(220)}`;
      records.push(record);
    }
    const recordSet = requireRecordSet({
      asOf: AS_OF,
      availableRecords: { structured: records, dayflow: [] },
    });
    expect(recordSet.truncation.structured.reason).toBe("byte_budget");
    expect(recordSet.truncation.structured.omittedRecordCount).toBeGreaterThan(0);
    const observed = recordSet.records.structured.map((record) => record.observedAt);
    expect(observed).toEqual([...observed].sort());
    expect(observed).toContain(records[records.length - 1]!.observedAt);
    expect(observed).not.toContain(records[0]!.observedAt);

    const includedIds = new Set(
      recordSet.records.structured.map((record) => record.recordId),
    );
    const omittedIds = records
      .map((record) => recordIdFor(record.kind, record.identity))
      .filter((recordId) => !includedIds.has(recordId))
      .sort();
    expect(recordSet.truncation.structured.omittedRecordIdsSha256).toBe(
      domainSeparatedSha256(
        "blabase.common-suggestion-evidence.omitted-record-ids.v0.1",
        {
          schemaVersion:
            COMMON_SUGGESTION_EVIDENCE_RECORD_SET_SCHEMA_VERSION_V0_1,
          budgetVersion: COMMON_SUGGESTION_EVIDENCE_BUDGET_VERSION_V0_1,
          partition: "structured",
          limitUtf8Bytes:
            COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.structuredUtf8Bytes,
          omittedRecordIds: omittedIds,
        },
      ),
    );
  });

  it("accounts exact array bytes and omits a record at exactly one byte over budget", () => {
    const empty = requireRecordSet({
      asOf: AS_OF,
      availableRecords: { structured: [], dayflow: [] },
    });
    expect(empty.truncation.structured.selectedUtf8Bytes).toBe(2);
    expect(empty.truncation.dayflow.selectedUtf8Bytes).toBe(2);
    expect(
      COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.structuredUtf8Bytes +
        COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.dayflowUtf8Bytes +
        COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.promptEnvelopeReserveUtf8Bytes,
    ).toBe(
      COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.totalPromptUtf8Bytes,
    );

    const minimum = requireRecordSet({
      asOf: AS_OF,
      availableRecords: {
        structured: [],
        dayflow: [dayflowFrame(32, 32)],
      },
    });
    const minimumLength = utf8Length(minimum.records.dayflow[0]!);
    const targetCharacters =
      32 +
      (COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.dayflowUtf8Bytes -
        2 -
        minimumLength);
    expect(targetCharacters).toBeGreaterThanOrEqual(32);
    expect(targetCharacters).toBeLessThanOrEqual(32 * 2_048);

    const exact = requireRecordSet({
      asOf: AS_OF,
      availableRecords: {
        structured: [],
        dayflow: [dayflowFrame(targetCharacters, 32)],
      },
    });
    expect(exact.truncation.dayflow.selectedUtf8Bytes).toBe(
      COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.dayflowUtf8Bytes,
    );
    expect(exact.truncation.dayflow.reason).toBe("none");

    const oneByteOver = requireRecordSet({
      asOf: AS_OF,
      availableRecords: {
        structured: [],
        dayflow: [dayflowFrame(targetCharacters + 1, 32)],
      },
    });
    expect(oneByteOver.records.dayflow).toEqual([]);
    expect(oneByteOver.truncation.dayflow).toMatchObject({
      availableUtf8Bytes:
        COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.dayflowUtf8Bytes + 1,
      selectedUtf8Bytes: 2,
      omittedRecordCount: 1,
      reason: "byte_budget",
    });
  });

  it("strips private build identities and rejects Dayflow suggestion-shaped fields", () => {
    const input = allKindsInput();
    const firstStructuredRecord = input.availableRecords.structured[0];
    if (firstStructuredRecord?.kind !== "github_work_item") {
      throw new Error("Expected the first fixture to be a GitHub work item");
    }
    firstStructuredRecord.facts.nativeTitle = "A native title is allowed";
    const recordSet = requireRecordSet(input);
    const serialized = decoder.decode(
      serializeCommonSuggestionEvidenceRecordSetV0_1(recordSet),
    );
    const keys = collectKeys(recordSet);
    for (const privateKey of [
      "identity",
      "signalHash",
      "sourceBindingSha256",
      "eventId",
      "resourceId",
      "dayflowPreprocessedEvidenceSha256",
      "partition",
      "coverage",
      "provenance",
      "model",
      "prompt",
      "arm",
      "suggestion",
      "semanticOutput",
      "title",
      "summary",
    ]) {
      expect(keys.has(privateKey)).toBe(false);
    }
    expect(serialized).not.toContain("fictional-event-private-id");
    expect(serialized).not.toContain("fictional-resource-private-id");

    const invalid = cloneInput(input);
    const dayflowFacts = invalid.availableRecords.dayflow[0]!.facts as unknown as Record<
      string,
      unknown
    >;
    dayflowFacts.title = "Forbidden final suggestion field";
    dayflowFacts.summary = "Forbidden final suggestion summary";
    expect(buildAndSealCommonSuggestionEvidenceRecordSetV0_1(invalid)).toEqual({
      valid: false,
      issueCodes: ["INPUT_INVALID"],
    });

    const allowedWords = allKindsInput();
    allowedWords.availableRecords.dayflow[0]!.facts.spans[0]!.text =
      "semanticOutput title RECENT_FOCUS summary";
    expect(
      buildAndSealCommonSuggestionEvidenceRecordSetV0_1(allowedWords).valid,
    ).toBe(true);
  });

  it("serializes strict JCS plus LF and throws only a sanitized error on tampering", () => {
    const recordSet = requireRecordSet(allKindsInput());
    expect(
      commonSuggestionEvidenceRecordSetStructuralSchemaV0_1.safeParse(recordSet)
        .success,
    ).toBe(true);
    expect(
      Object.isFrozen(
        commonSuggestionEvidenceRecordSetStructuralSchemaV0_1,
      ),
    ).toBe(true);
    expect(
      "_def" in commonSuggestionEvidenceRecordSetStructuralSchemaV0_1,
    ).toBe(false);
    expect(verifyCommonSuggestionEvidenceRecordSetV0_1(recordSet)).toEqual({
      valid: true,
      recordSet,
      issueCodes: [],
    });
    const bytes = serializeCommonSuggestionEvidenceRecordSetV0_1(recordSet);
    const text = decoder.decode(bytes);
    expect(text).toBe(`${jcsCanonicalize(recordSet)}\n`);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    expect(recordSet.commonSuggestionEvidenceRecordSetSha256).toBe(
      domainSeparatedSha256(
        COMMON_SUGGESTION_EVIDENCE_RECORD_SET_HASH_DOMAIN_V0_1,
        {
          schemaVersion: recordSet.schemaVersion,
          asOf: recordSet.asOf,
          records: recordSet.records,
          truncation: recordSet.truncation,
        },
      ),
    );

    const tampered = JSON.parse(JSON.stringify(recordSet)) as CommonSuggestionEvidenceRecordSetV0_1;
    tampered.commonSuggestionEvidenceRecordSetSha256 = hash(0);
    expect(verifyCommonSuggestionEvidenceRecordSetV0_1(tampered)).toEqual({
      valid: false,
      issueCodes: ["INPUT_INVALID"],
    });
    let thrown: unknown;
    try {
      serializeCommonSuggestionEvidenceRecordSetV0_1(tampered);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CommonSuggestionEvidenceRecordSetError);
    expect(thrown).toMatchObject({ issueCode: "INPUT_INVALID" });
    expect(JSON.stringify(thrown)).toBe('{"issueCode":"INPUT_INVALID"}');
    expect(Object.isFrozen(thrown)).toBe(true);
  });

  it("hardens public structural parsing before invoking Zod", () => {
    let getterCalls = 0;
    const accessorInput = Object.defineProperty({}, "schemaVersion", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("hostile structural getter");
      },
    });
    expect(
      commonSuggestionEvidenceRecordSetStructuralSchemaV0_1.safeParse(
        accessorInput,
      ).success,
    ).toBe(false);
    expect(getterCalls).toBe(0);

    let proxyTrapCalls = 0;
    const proxiedInput = new Proxy(
      {},
      {
        ownKeys() {
          proxyTrapCalls += 1;
          throw new Error("hostile structural proxy");
        },
      },
    );
    expect(
      commonSuggestionEvidenceRecordSetStructuralSchemaV0_1.safeParse(
        proxiedInput,
      ).success,
    ).toBe(false);
    expect(proxyTrapCalls).toBe(0);

    const shared = { value: "shared" };
    expect(
      commonSuggestionEvidenceRecordSetStructuralSchemaV0_1.safeParse({
        first: shared,
        second: shared,
      }).success,
    ).toBe(false);

    expect(
      commonSuggestionEvidenceRecordSetStructuralSchemaV0_1.safeParse({
        records: {
          structured: new Array(2_049).fill(null),
        },
      }).success,
    ).toBe(false);
  });

  it("isolates private validation from exported child schema mutation", () => {
    type MutableStringSchemaDefinition = { checks: unknown[] };
    const sha256Definition = (
      sha256HexSchema as unknown as {
        _def: MutableStringSchemaDefinition;
      }
    )._def;
    const utcDefinition = (
      utcTimestampSchema as unknown as {
        _def: { schema: { _def: MutableStringSchemaDefinition } };
      }
    )._def.schema._def;
    const originalSha256Checks = sha256Definition.checks;
    const originalUtcChecks = utcDefinition.checks;
    let buildResult:
      | ReturnType<
          typeof buildAndSealCommonSuggestionEvidenceRecordSetV0_1
        >
      | undefined;
    let verifyValid = false;
    let serialized = false;

    try {
      sha256Definition.checks = [{ kind: "regex", regex: /^never$/u }];
      utcDefinition.checks = [{ kind: "regex", regex: /^never$/u }];
      buildResult = buildAndSealCommonSuggestionEvidenceRecordSetV0_1(
        allKindsInput(),
      );
      if (buildResult.valid) {
        verifyValid = verifyCommonSuggestionEvidenceRecordSetV0_1(
          buildResult.recordSet,
        ).valid;
        serialized =
          serializeCommonSuggestionEvidenceRecordSetV0_1(
            buildResult.recordSet,
          ).byteLength > 0;
      }
    } finally {
      sha256Definition.checks = originalSha256Checks;
      utcDefinition.checks = originalUtcChecks;
    }

    expect(buildResult?.valid).toBe(true);
    expect(verifyValid).toBe(true);
    expect(serialized).toBe(true);
  });

  it("rejects rehashed over-cap and impossible byte-budget metadata", () => {
    const structuredOverCap = JSON.parse(
      JSON.stringify(requireRecordSet(allKindsInput())),
    ) as CommonSuggestionEvidenceRecordSetV0_1;
    structuredOverCap.truncation.structured.inputRecordCount =
      COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.structuredInputRecordCount +
      1;
    structuredOverCap.truncation.structured.duplicateRecordCount =
      structuredOverCap.truncation.structured.inputRecordCount -
      structuredOverCap.truncation.structured.availableRecordCount;
    expect(
      verifyCommonSuggestionEvidenceRecordSetV0_1(
        rehashRecordSet(structuredOverCap),
      ),
    ).toEqual({ valid: false, issueCodes: ["INPUT_INVALID"] });

    const dayflowOverCap = JSON.parse(
      JSON.stringify(requireRecordSet(allKindsInput())),
    ) as CommonSuggestionEvidenceRecordSetV0_1;
    dayflowOverCap.truncation.dayflow.inputRecordCount =
      COMMON_SUGGESTION_EVIDENCE_RECORD_SET_LIMITS_V0_1.dayflowInputRecordCount +
      1;
    dayflowOverCap.truncation.dayflow.duplicateRecordCount =
      dayflowOverCap.truncation.dayflow.inputRecordCount -
      dayflowOverCap.truncation.dayflow.availableRecordCount;
    expect(
      verifyCommonSuggestionEvidenceRecordSetV0_1(
        rehashRecordSet(dayflowOverCap),
      ),
    ).toEqual({ valid: false, issueCodes: ["INPUT_INVALID"] });

    const impossibleByteBudget = JSON.parse(
      JSON.stringify(requireRecordSet(allKindsInput())),
    ) as CommonSuggestionEvidenceRecordSetV0_1;
    const metadata = impossibleByteBudget.truncation.dayflow;
    metadata.availableRecordCount += 1;
    metadata.inputRecordCount += 1;
    metadata.omittedRecordCount = 1;
    metadata.reason = "byte_budget";
    metadata.omittedRecordIdsSha256 = hash(99);
    metadata.availableUtf8Bytes = metadata.selectedUtf8Bytes;
    expect(
      verifyCommonSuggestionEvidenceRecordSetV0_1(
        rehashRecordSet(impossibleByteBudget),
      ),
    ).toEqual({ valid: false, issueCodes: ["INPUT_INVALID"] });
  });

  it("rejects a rehashed record ID outside the builder grammar", () => {
    const forged = JSON.parse(
      JSON.stringify(
        requireRecordSet({
          asOf: AS_OF,
          availableRecords: {
            structured: [workItem()],
            dayflow: [],
          },
        }),
      ),
    ) as CommonSuggestionEvidenceRecordSetV0_1;
    const record = forged.records.structured[0];
    if (record?.kind !== "github_work_item") {
      throw new Error("Expected a GitHub work item fixture");
    }
    record.recordId =
      "evidence_record_gggggggggggggggggggggggggggggggg";
    const facts = record.facts as unknown as Record<string, unknown>;
    const factIds = record.factIds as unknown as Record<string, string>;
    for (const factKey of Object.keys(facts)) {
      factIds[factKey] = factIdFor(
        record.recordId,
        factKey,
        facts[factKey],
      );
    }

    expect(
      verifyCommonSuggestionEvidenceRecordSetV0_1(
        rehashRecordSet(forged),
      ),
    ).toEqual({ valid: false, issueCodes: ["INPUT_INVALID"] });
  });
});
