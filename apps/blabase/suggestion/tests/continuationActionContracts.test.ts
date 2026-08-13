import { describe, expect, it } from "vitest";

import {
  appendContinuationSetupActionEvent,
  compactContinuationSetupActionStore,
  CONTINUATION_SETUP_ACTION_AUTHORITY_CONTRACT,
  CONTINUATION_SETUP_ACTION_AUTHORITY_POLICY_VERSION,
  CONTINUATION_SETUP_ACTION_AUTHORITY_SCHEMA_VERSION,
  CONTINUATION_SETUP_ACTION_CAPABILITY,
  CONTINUATION_SETUP_ACTION_DESTINATION,
  CONTINUATION_SETUP_ACTION_NAMESPACE_VERSION,
  CONTINUATION_SETUP_ACTION_NAVIGATE_TO,
  continuationSetupActionAuthKeyId,
  continuationSetupActionAuthoritySha256,
  continuationSetupActionBindingSchema,
  continuationSetupActionIssueInputSchema,
  continuationSetupActionOpenInputSchema,
  createContinuationSetupActionOffer,
  createEmptyContinuationSetupActionStore,
  continuationSetupActionStableTargetRef,
  type ContinuationSetupActionAuthorityContent,
  type ContinuationSetupActionIssuanceAudit,
  verifyContinuationSetupActionStore
} from "../src/continuation/actions";

const SECRET = "a".repeat(64);
const OTHER_SECRET = "b".repeat(64);
const AS_OF = "2026-08-13T12:00:00.000Z";

describe("Continuation Setup action v0.2 contracts", () => {
  it("seals an exact 256-bit offer and bounds it by 30 seconds or candidate expiry", () => {
    const fullTtl = createContinuationSetupActionOffer({
      binding: binding(),
      issuedAt: AS_OF
    });
    expect(fullTtl.offerId).toMatch(
      /^continuation_setup_offer_[a-f0-9]{64}$/u
    );
    expect(fullTtl.expiresAt).toBe("2026-08-13T12:00:30.000Z");
    expect(fullTtl).toMatchObject({
      capability: "open_setup_surface",
      destination: "project_mappings",
      navigateTo: "/projects",
      explicitUserActionRequired: true,
      automaticExecutionAllowed: false,
      externalMutationAllowed: false,
      oneTimeUse: true
    });

    const candidateBound = createContinuationSetupActionOffer({
      binding: binding({
        authority: {
          candidateExpiresAt: "2026-08-13T12:00:12.000Z"
        }
      }),
      issuedAt: AS_OF
    });
    expect(candidateBound.expiresAt).toBe(
      "2026-08-13T12:00:12.000Z"
    );
  });

  it("authenticates the append chain and rejects wrong-secret/content/hash tamper", () => {
    const offer = createContinuationSetupActionOffer({
      binding: binding(),
      issuedAt: AS_OF,
      offerId: `continuation_setup_offer_${"1".repeat(64)}`
    });
    const empty = createEmptyContinuationSetupActionStore({
      createdAt: AS_OF,
      installationSecret: SECRET,
      authKeyId: continuationSetupActionAuthKeyId(SECRET)
    });
    const issued = appendContinuationSetupActionEvent({
      store: empty,
      installationSecret: SECRET,
      event: { eventType: "issued", occurredAt: AS_OF, offer }
    });
    const consumed = appendContinuationSetupActionEvent({
      store: issued,
      installationSecret: SECRET,
      event: {
        eventType: "terminal",
        occurredAt: "2026-08-13T12:00:05.000Z",
        offerId: offer.offerId,
        itemRef: offer.binding.authority.itemRef,
        terminalReason: "consumed"
      }
    });

    expect(verifyContinuationSetupActionStore(consumed, SECRET)).toEqual(
      consumed
    );
    expect(
      verifyContinuationSetupActionStore(consumed, OTHER_SECRET)
    ).toBeNull();
    for (const mutate of [
      (value: Record<string, unknown>) => {
        value.updatedAt = "2026-08-13T12:00:06.000Z";
      },
      (value: Record<string, unknown>) => {
        const events = value.events as Array<Record<string, unknown>>;
        events[0]!.eventSha256 = "f".repeat(64);
      },
      (value: Record<string, unknown>) => {
        const events = value.events as Array<Record<string, unknown>>;
        events[1]!.eventHmac = "e".repeat(64);
      }
    ]) {
      const tampered = JSON.parse(JSON.stringify(consumed)) as Record<
        string,
        unknown
      >;
      mutate(tampered);
      expect(
        verifyContinuationSetupActionStore(tampered, SECRET)
      ).toBeNull();
    }
  });

  it("drops only a fully terminal prefix at expiresAt plus 24 hours", () => {
    const offer = createContinuationSetupActionOffer({
      binding: binding(),
      issuedAt: AS_OF,
      offerId: `continuation_setup_offer_${"2".repeat(64)}`
    });
    let store = createEmptyContinuationSetupActionStore({
      createdAt: AS_OF,
      installationSecret: SECRET,
      authKeyId: continuationSetupActionAuthKeyId(SECRET)
    });
    store = appendContinuationSetupActionEvent({
      store,
      installationSecret: SECRET,
      event: { eventType: "issued", occurredAt: AS_OF, offer }
    });
    store = appendContinuationSetupActionEvent({
      store,
      installationSecret: SECRET,
      event: {
        eventType: "terminal",
        occurredAt: "2026-08-13T12:00:35.000Z",
        offerId: offer.offerId,
        itemRef: offer.binding.authority.itemRef,
        terminalReason: "expired"
      }
    });
    expect(store.events[1]!.retainedUntil).toBe(
      "2026-08-14T12:00:30.000Z"
    );

    const beforeDeadline = compactContinuationSetupActionStore({
      store,
      installationSecret: SECRET,
      asOf: "2026-08-14T12:00:29.999Z"
    });
    expect(beforeDeadline.events).toHaveLength(2);

    const atDeadline = compactContinuationSetupActionStore({
      store,
      installationSecret: SECRET,
      asOf: "2026-08-14T12:00:30.000Z"
    });
    expect(atDeadline).toMatchObject({
      revision: 2,
      anchorSequence: 2
    });
    expect(atDeadline.anchorEventSha256).toBe(
      store.events[1]!.eventSha256
    );
    expect(atDeadline.events).toEqual([]);
    expect(verifyContinuationSetupActionStore(atDeadline, SECRET)).toEqual(
      atDeadline
    );
  });

  it("accepts only strict explicit user-action wire bodies", () => {
    expect(
      continuationSetupActionIssueInputSchema.safeParse({
        itemRef: binding().authority.itemRef,
        explicitUserAction: true
      }).success
    ).toBe(true);
    expect(
      continuationSetupActionIssueInputSchema.safeParse({
        itemRef: binding().authority.itemRef,
        explicitUserAction: true,
        target: "/projects"
      }).success
    ).toBe(false);
    expect(
      continuationSetupActionOpenInputSchema.safeParse({
        offerId: `continuation_setup_offer_${"3".repeat(64)}`,
        explicitUserAction: false
      }).success
    ).toBe(false);
  });
});

function binding(input: {
  installationSecret?: string;
  authority?: Partial<ContinuationSetupActionAuthorityContent>;
  issuanceAudit?: Partial<ContinuationSetupActionIssuanceAudit>;
} = {}) {
  const installationSecret = input.installationSecret ?? SECRET;
  const authorityValue = {
    ...baseAuthority(installationSecret),
    ...input.authority
  };
  const authorityContent: ContinuationSetupActionAuthorityContent = {
    ...authorityValue,
    authKeyId: continuationSetupActionAuthKeyId(installationSecret),
    stableTargetRef: continuationSetupActionStableTargetRef({
      installationSecret,
      itemRef: authorityValue.itemRef,
      candidateId: authorityValue.candidateId,
      setupReason: authorityValue.setupReason
    })
  };
  return continuationSetupActionBindingSchema.parse({
    authority: {
      ...authorityContent,
      authoritySha256:
        continuationSetupActionAuthoritySha256(authorityContent)
    },
    issuanceAudit: {
      ...baseIssuanceAudit(),
      ...input.issuanceAudit
    }
  });
}

function baseAuthority(
  installationSecret: string
): ContinuationSetupActionAuthorityContent {
  const itemRef = `item_ref_${"a".repeat(43)}`;
  const candidateId = `continuation_candidate_${"1".repeat(32)}`;
  const setupReason = "IDENTITY_MAPPING_NOT_CONFIRMED" as const;
  return {
    contract: CONTINUATION_SETUP_ACTION_AUTHORITY_CONTRACT,
    schemaVersion: CONTINUATION_SETUP_ACTION_AUTHORITY_SCHEMA_VERSION,
    policyVersion: CONTINUATION_SETUP_ACTION_AUTHORITY_POLICY_VERSION,
    namespaceVersion: CONTINUATION_SETUP_ACTION_NAMESPACE_VERSION,
    authKeyId: continuationSetupActionAuthKeyId(installationSecret),
    capability: CONTINUATION_SETUP_ACTION_CAPABILITY,
    destination: CONTINUATION_SETUP_ACTION_DESTINATION,
    navigateTo: CONTINUATION_SETUP_ACTION_NAVIGATE_TO,
    itemRef,
    candidateKind: "workspace_mapping",
    candidateId,
    workContextSha256: null,
    sourceObservationSetSha256: "0".repeat(64),
    observedAt: AS_OF,
    candidateExpiresAt: "2026-08-13T12:05:00.000Z",
    setupReason,
    stableTargetRef: continuationSetupActionStableTargetRef({
      installationSecret,
      itemRef,
      candidateId,
      setupReason
    }),
    source: "codex",
    registryContract: "work-context-registry-v1",
    registrySchemaVersion: "work-context-registry-schema-v1",
    identityContract: "continuation-identity-result-v0.4",
    identitySchemaVersion: "continuation-identity-schema-v0.4",
    identityPolicyVersion: "continuation-identity-policy-v0.4",
    derivationContract: "continuation-candidate-derivation-result-v0.4",
    derivationSchemaVersion: "continuation-candidate-derivation-schema-v0.4",
    derivationRuleVersion: "continuation-candidate-rule-v0.4",
    derivationConfigSha256: "1".repeat(64),
    sourceIdentitySha256: "2".repeat(64),
    identityResolutionSha256: "3".repeat(64),
    identityBindingSetSha256: "4".repeat(64),
    mappingStateSha256: "5".repeat(64),
    codeCommitSha: "c".repeat(40),
    codeState: "declared_commit",
    codeFingerprintSha256: null
  };
}

function baseIssuanceAudit(): ContinuationSetupActionIssuanceAudit {
  return {
    candidateSha256: "2".repeat(64),
    privateTargetRef: `private_target_${"3".repeat(32)}`,
    generatedAt: AS_OF,
    continuationResolvedResultSha256: "4".repeat(64),
    continuationDecisionResultSha256: "5".repeat(64),
    continuationDecisionSemanticResultSha256: "6".repeat(64),
    continuationResolutionInputSha256: "7".repeat(64),
    identityResultSha256: "8".repeat(64),
    derivationResultSha256: "9".repeat(64),
    scoringResultSha256: "a".repeat(64),
    registrySha256: "b".repeat(64),
    sourceBatches: [
      {
        source: "codex" as const,
        batchSha256: "d".repeat(64),
        snapshotSha256: "e".repeat(64)
      },
      {
        source: "github" as const,
        batchSha256: "f".repeat(64),
        snapshotSha256: null
      }
    ]
  };
}
