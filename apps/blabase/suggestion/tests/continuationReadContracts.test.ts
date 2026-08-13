import { describe, expect, it } from "vitest";

import {
  CONTINUATION_READ_API_CONTRACT,
  continuationReadDecisionSchema,
  createContinuationReadFallback,
  projectContinuationReadDecision
} from "../src/continuation/readApi";
import { continuationPublicDecisionSchema } from "../src/continuation/contracts";
import { authenticBoardFixture } from "./fixtures/suggestionBoardFixture";

describe("Continuation read API v0.1 contract", () => {
  it("projects the exact resolved top three as display-only public text", () => {
    const fixture = authenticBoardFixture({ continuationCount: 3 });
    const resolved = fixture.bundle.continuationResolvedDecision;
    const projected = projectContinuationReadDecision(resolved);
    const selected = [
      resolved.decision.primary,
      ...resolved.decision.alternatives
    ].filter((candidate) => candidate !== null);

    expect(projected).toEqual({
      contract: CONTINUATION_READ_API_CONTRACT,
      generatedAt: resolved.decision.asOf,
      status: resolved.decision.status,
      coverageCode: resolved.decision.coverageCode,
      items: selected.map((candidate) => ({
        title: candidate.localDisplayLabel,
        summary: candidate.localDisplayLabel,
        caveats: candidate.caveatCodes,
        capability: "display",
        action: null
      }))
    });
    expect(projected.items).toHaveLength(3);
    expect(continuationReadDecisionSchema.parse(projected)).toEqual(projected);

    const serialized = JSON.stringify(projected);
    const privateValues = [
      fixture.trustedOptions.installationSecret,
      fixture.trustedOptions.expectedRegistrySha256,
      fixture.trustedOptions.expectedCodeCommitSha,
      resolved.resultSha256,
      resolved.decision.resultSha256,
      resolved.decision.semanticResultSha256,
      resolved.decision.run.runId,
      resolved.decision.run.analysisId,
      resolved.decision.primary?.candidateId,
      resolved.decision.primary?.workContextId,
      resolved.decision.primary?.sourceObservationIds[0],
      resolved.decision.primary?.privateActionTarget?.targetRef
    ].filter((value): value is string => typeof value === "string");
    for (const privateValue of privateValues) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(serialized).not.toMatch(
      /(?:candidateId|workContext|sourceRef|sourceObservation|Sha256|proof|privateActionTarget|runId|analysisId|itemRef|actionRef)/u
    );
  });

  it("keeps setup display-only without weakening the existing action-aware schema", () => {
    const resolved = authenticBoardFixture({
      active: "no_action",
      continuationCount: 3,
      mapContinuation: false
    }).bundle.continuationResolvedDecision;
    expect(resolved.decision.status).toBe("setup_required");

    const projected = projectContinuationReadDecision(resolved);
    expect(projected).toMatchObject({
      status: "setup_required",
      coverageCode: "SOURCE_LOCAL_PARTIAL"
    });
    expect(projected.items).toHaveLength(3);
    expect(
      projected.items.every(
        (item) => item.capability === "display" && item.action === null
      )
    ).toBe(true);
    expect(
      continuationPublicDecisionSchema.safeParse({
        contract: "continuation-public-decision-v0.1",
        schemaVersion: "continuation-public-schema-v0.1",
        generatedAt: projected.generatedAt,
        status: projected.status,
        primary: null,
        alternatives: [],
        coverageCode: projected.coverageCode
      }).success
    ).toBe(false);
  });

  it("preserves proven empty, insufficient, and unavailable status/coverage tuples", () => {
    const empty = continuationReadDecisionSchema.parse({
      contract: CONTINUATION_READ_API_CONTRACT,
      generatedAt: "2026-08-13T12:00:00.000Z",
      status: "no_recent_context",
      coverageCode: "COMPLETE",
      items: []
    });
    expect(empty).toMatchObject({
      status: "no_recent_context",
      coverageCode: "COMPLETE",
      items: []
    });

    const insufficient = projectContinuationReadDecision(
      authenticBoardFixture({
        active: "no_action",
        activityAt: "2026-08-02T03:00:00.001Z"
      }).bundle.continuationResolvedDecision
    );
    expect(insufficient).toMatchObject({
      status: "insufficient_evidence",
      coverageCode: "INSUFFICIENT",
      items: []
    });

    expect(
      createContinuationReadFallback(
        "2026-08-13T12:00:00.000Z",
        "unavailable"
      )
    ).toEqual({
      contract: CONTINUATION_READ_API_CONTRACT,
      generatedAt: "2026-08-13T12:00:00.000Z",
      status: "unavailable",
      coverageCode: "UNAVAILABLE",
      items: []
    });
  });

  it("fails closed on extra private fields, unsafe text, and accessors without invoking them", () => {
    const valid = createContinuationReadFallback(
      "2026-08-13T12:00:00.000Z",
      "unavailable"
    );
    expect(
      continuationReadDecisionSchema.safeParse({
        ...valid,
        generatedAt: "2026-08-13T21:00:00+09:00"
      }).success
    ).toBe(false);
    expect(
      continuationReadDecisionSchema.safeParse({
        ...valid,
        privateTarget: `private_target_${"a".repeat(32)}`
      }).success
    ).toBe(false);
    expect(
      continuationReadDecisionSchema.safeParse({
        contract: CONTINUATION_READ_API_CONTRACT,
        generatedAt: "2026-08-13T12:00:00.000Z",
        status: "setup_required",
        coverageCode: "SOURCE_LOCAL_PARTIAL",
        items: [
          {
            title: "작업공간 연결하기",
            summary: "작업공간 연결하기",
            caveats: ["PRIVATE_RUN_DETAIL"],
            capability: "display",
            action: null
          }
        ]
      }).success
    ).toBe(false);
    expect(
      continuationReadDecisionSchema.safeParse({
        contract: CONTINUATION_READ_API_CONTRACT,
        generatedAt: "2026-08-13T12:00:00.000Z",
        status: "offers_available",
        coverageCode: "COMPLETE",
        items: [
          {
            title: "session_private123 이어가기",
            summary: "session_private123 이어가기",
            caveats: [],
            capability: "display",
            action: null
          }
        ]
      }).success
    ).toBe(false);
    expect(
      continuationReadDecisionSchema.safeParse({
        contract: CONTINUATION_READ_API_CONTRACT,
        generatedAt: "2026-08-13T12:00:00.000Z",
        status: "offers_available",
        coverageCode: "COMPLETE",
        items: [
          {
            title: "/Users/private/project",
            summary: "/Users/private/project",
            caveats: [],
            capability: "display",
            action: null
          }
        ]
      }).success
    ).toBe(false);

    let getterCalls = 0;
    const hostile = Object.defineProperty({}, "contract", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return CONTINUATION_READ_API_CONTRACT;
      }
    });
    expect(continuationReadDecisionSchema.safeParse(hostile).success).toBe(
      false
    );
    expect(getterCalls).toBe(0);

    const hostileProxy = new Proxy(valid, {
      getPrototypeOf() {
        return Object.prototype;
      },
      ownKeys() {
        return [];
      }
    });
    expect(
      continuationReadDecisionSchema.safeParse(hostileProxy).success
    ).toBe(false);

    let proxyTrapCalls = 0;
    const hostileArrayProxy = new Proxy([], {
      ownKeys() {
        proxyTrapCalls += 1;
        return [];
      },
      getOwnPropertyDescriptor() {
        proxyTrapCalls += 1;
        return undefined;
      }
    });
    expect(
      continuationReadDecisionSchema.safeParse({
        ...valid,
        items: hostileArrayProxy
      }).success
    ).toBe(false);
    expect(proxyTrapCalls).toBe(0);
  });
});
