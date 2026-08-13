import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evaluate: vi.fn(),
  issue: vi.fn(),
  consume: vi.fn()
}));

vi.mock("../src/suggestionBoard/liveShadow", () => ({
  evaluateLiveContinuationSetupActionAuthority: mocks.evaluate
}));

vi.mock("../src/continuation/actions/store", () => ({
  issueStoredContinuationSetupOffer: mocks.issue,
  consumeStoredContinuationSetupOffer: mocks.consume
}));

import {
  CONTINUATION_SETUP_ACTION_AUTHORITY_CONTRACT,
  CONTINUATION_SETUP_ACTION_AUTHORITY_POLICY_VERSION,
  CONTINUATION_SETUP_ACTION_AUTHORITY_SCHEMA_VERSION,
  CONTINUATION_SETUP_ACTION_NAMESPACE_VERSION,
  ContinuationSetupActionGatewayError,
  continuationSetupActionAuthKeyId,
  continuationSetupActionAuthoritySha256,
  continuationSetupActionBindingSchema,
  continuationSetupActionStableTargetRef,
  issueLiveContinuationSetupOffer,
  openLiveContinuationSetupOffer,
  type ContinuationSetupActionAuthorityContent,
  type ContinuationSetupActionBinding
} from "../src/continuation/actions";

const ITEM_REF = `item_ref_${"a".repeat(43)}`;
const OTHER_ITEM_REF = `item_ref_${"b".repeat(43)}`;
const OFFER_ID = `continuation_setup_offer_${"c".repeat(64)}`;
const INSTALLATION_SECRET = "d".repeat(64);
const REQUEST_TIME = new Date("2026-08-13T12:00:00.000Z");
const LOCKED_TIME = new Date("2026-08-13T12:00:01.000Z");

afterEach(() => {
  vi.clearAllMocks();
});

describe("Continuation Setup action live gateway", () => {
  it("captures one exact public-item authority inside the issue lock", async () => {
    const binding = setupBinding(ITEM_REF, {
      generatedAt: LOCKED_TIME.toISOString()
    });
    mocks.evaluate.mockResolvedValue(
      liveAuthority(binding, LOCKED_TIME.toISOString())
    );
    const clock = vi.fn(() => new Date(REQUEST_TIME));
    mocks.issue.mockImplementation(
      async (input: {
        cwd: string;
        clock: () => Date;
        resolveCurrent: (lockedNow: Date) => Promise<unknown>;
      }) => {
        expect(await input.resolveCurrent(LOCKED_TIME)).toEqual({
          installationSecret: INSTALLATION_SECRET,
          binding
        });
        return {
          contract: "continuation-setup-action-api-v0.1",
          status: "issued",
          offerId: OFFER_ID,
          expiresAt: "2026-08-13T12:00:31.000Z"
        };
      }
    );

    const result = await issueLiveContinuationSetupOffer({
      itemRef: ITEM_REF,
      cwd: "/synthetic/workspace",
      clock,
      env: { NODE_ENV: "test" }
    });

    expect(result.offerId).toBe(OFFER_ID);
    expect(mocks.evaluate).toHaveBeenCalledOnce();
    expect(mocks.evaluate).toHaveBeenCalledWith({
      cwd: "/synthetic/workspace",
      now: LOCKED_TIME,
      env: { NODE_ENV: "test" }
    });
    expect(mocks.issue).toHaveBeenCalledOnce();
    expect(mocks.issue).toHaveBeenCalledWith({
      cwd: "/synthetic/workspace",
      clock,
      resolveCurrent: expect.any(Function)
    });
  });

  it("does not mint an offer when the exact current public ref is absent", async () => {
    const binding = setupBinding(OTHER_ITEM_REF, {
      generatedAt: LOCKED_TIME.toISOString()
    });
    mocks.evaluate.mockResolvedValue(
      liveAuthority(binding, LOCKED_TIME.toISOString())
    );
    mocks.issue.mockImplementation(
      async (input: {
        resolveCurrent: (lockedNow: Date) => Promise<unknown>;
      }) => input.resolveCurrent(LOCKED_TIME)
    );

    await expect(
      issueLiveContinuationSetupOffer({
        itemRef: ITEM_REF
      })
    ).rejects.toEqual(
      new ContinuationSetupActionGatewayError("OFFER_NOT_CURRENT")
    );
    expect(mocks.evaluate).toHaveBeenCalledOnce();
    expect(mocks.evaluate).toHaveBeenCalledWith({
      cwd: process.cwd(),
      now: LOCKED_TIME
    });
    expect(mocks.issue).toHaveBeenCalledOnce();
  });

  it("revalidates exactly once at the authoritative under-lock time", async () => {
    const binding = setupBinding(ITEM_REF);
    mocks.evaluate.mockResolvedValue(liveAuthority(binding));
    mocks.consume.mockImplementation(
      async (input: { revalidate: (now: Date) => Promise<unknown> }) => {
        const current = await input.revalidate(LOCKED_TIME);
        expect(current).toEqual({
          installationSecret: INSTALLATION_SECRET,
          currentBindings: [binding]
        });
        return {
          contract: "continuation-setup-action-api-v0.1",
          status: "opened",
          destination: "project_mappings",
          navigateTo: "/projects"
        };
      }
    );
    const clock = vi.fn(() => new Date(LOCKED_TIME));

    const result = await openLiveContinuationSetupOffer({
      offerId: OFFER_ID,
      cwd: "/synthetic/workspace",
      clock,
      env: { NODE_ENV: "test" }
    });

    expect(result.navigateTo).toBe("/projects");
    expect(mocks.consume).toHaveBeenCalledOnce();
    expect(mocks.evaluate).toHaveBeenCalledOnce();
    expect(mocks.evaluate).toHaveBeenCalledWith({
      cwd: "/synthetic/workspace",
      now: LOCKED_TIME,
      env: { NODE_ENV: "test" }
    });
  });

  it("fails currentness when the under-lock recapture is unavailable", async () => {
    mocks.evaluate.mockResolvedValue(null);
    mocks.consume.mockImplementation(
      async (input: { revalidate: (now: Date) => Promise<unknown> }) =>
        input.revalidate(LOCKED_TIME)
    );

    await expect(
      openLiveContinuationSetupOffer({ offerId: OFFER_ID })
    ).rejects.toEqual(
      new ContinuationSetupActionGatewayError("OFFER_NOT_CURRENT")
    );
    expect(mocks.evaluate).toHaveBeenCalledOnce();
  });
});

function liveAuthority(
  binding: ContinuationSetupActionBinding,
  asOf = REQUEST_TIME.toISOString(),
  installationSecret = INSTALLATION_SECRET
) {
  return {
    asOf,
    installationSecret,
    setupActionAuthorities: [
      {
        capability: "open_setup_surface",
        destination: "project_mappings",
        binding
      }
    ]
  };
}

function setupBinding(
  itemRef: string,
  options: {
    generatedAt?: string;
    installationSecret?: string;
  } = {}
): ContinuationSetupActionBinding {
  const installationSecret = options.installationSecret ?? INSTALLATION_SECRET;
  const candidateId = `continuation_candidate_${"1".repeat(32)}`;
  const setupReason = "IDENTITY_MAPPING_NOT_CONFIRMED" as const;
  const authorityContent: ContinuationSetupActionAuthorityContent = {
    contract: CONTINUATION_SETUP_ACTION_AUTHORITY_CONTRACT,
    schemaVersion: CONTINUATION_SETUP_ACTION_AUTHORITY_SCHEMA_VERSION,
    policyVersion: CONTINUATION_SETUP_ACTION_AUTHORITY_POLICY_VERSION,
    namespaceVersion: CONTINUATION_SETUP_ACTION_NAMESPACE_VERSION,
    authKeyId: continuationSetupActionAuthKeyId(installationSecret),
    capability: "open_setup_surface",
    destination: "project_mappings",
    navigateTo: "/projects",
    itemRef,
    candidateKind: "workspace_mapping",
    candidateId,
    workContextSha256: null,
    sourceObservationSetSha256: "2".repeat(64),
    observedAt: "2026-08-13T11:55:00.000Z",
    candidateExpiresAt: "2026-08-13T12:05:00.000Z",
    setupReason,
    stableTargetRef: continuationSetupActionStableTargetRef({
      installationSecret,
      itemRef,
      candidateId,
      setupReason
    }),
    source: "github",
    registryContract: "work-context-registry-v1",
    registrySchemaVersion: "work-context-registry-schema-v1",
    identityContract: "continuation-identity-result-v0.4",
    identitySchemaVersion: "continuation-identity-schema-v0.4",
    identityPolicyVersion: "continuation-id-policy-v0.1",
    derivationContract: "continuation-candidate-derivation-result-v0.3",
    derivationSchemaVersion: "continuation-candidate-derivation-schema-v0.3",
    derivationRuleVersion: "continuation-candidate-rule-v0.2",
    derivationConfigSha256: "3".repeat(64),
    sourceIdentitySha256: "4".repeat(64),
    identityResolutionSha256: "5".repeat(64),
    identityBindingSetSha256: "6".repeat(64),
    mappingStateSha256: "7".repeat(64),
    codeCommitSha: "c".repeat(40),
    codeState: "declared_commit",
    codeFingerprintSha256: null
  };
  return continuationSetupActionBindingSchema.parse({
    authority: {
      ...authorityContent,
      authoritySha256: continuationSetupActionAuthoritySha256(authorityContent)
    },
    issuanceAudit: {
      candidateSha256: "8".repeat(64),
      privateTargetRef: `private_target_${"9".repeat(32)}`,
      generatedAt: options.generatedAt ?? REQUEST_TIME.toISOString(),
      continuationResolvedResultSha256: "a".repeat(64),
      continuationDecisionResultSha256: "b".repeat(64),
      continuationDecisionSemanticResultSha256: "c".repeat(64),
      continuationResolutionInputSha256: "d".repeat(64),
      identityResultSha256: "e".repeat(64),
      derivationResultSha256: "f".repeat(64),
      scoringResultSha256: "0".repeat(64),
      registrySha256: "1".repeat(64),
      sourceBatches: [
        {
          source: "codex",
          batchSha256: "2".repeat(64),
          snapshotSha256: "3".repeat(64)
        },
        {
          source: "github",
          batchSha256: "4".repeat(64),
          snapshotSha256: null
        }
      ]
    }
  });
}
