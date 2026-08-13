import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evaluate: vi.fn()
}));

vi.mock("../src/suggestionBoard/liveShadow", () => ({
  evaluateLiveContinuationSetupActionAuthority: mocks.evaluate
}));

import { POST as issuePost } from "../app/api/continuation/offers/route";
import { POST as openPost } from "../app/api/continuation/open/route";
import {
  CONTINUATION_SETUP_ACTION_AUTHORITY_CONTRACT,
  CONTINUATION_SETUP_ACTION_AUTHORITY_POLICY_VERSION,
  CONTINUATION_SETUP_ACTION_AUTHORITY_SCHEMA_VERSION,
  CONTINUATION_SETUP_ACTION_NAMESPACE_VERSION,
  continuationSetupActionAuthKeyId,
  continuationSetupActionAuthoritySha256,
  continuationSetupActionBindingSchema,
  continuationSetupActionStableTargetRef,
  type ContinuationSetupActionAuthorityContent,
  type ContinuationSetupActionBinding
} from "../src/continuation/actions";

const AS_OF = "2026-08-13T12:00:00.000Z";
const ITEM_REF = `item_ref_${"a".repeat(43)}`;
const SECRET = "b".repeat(64);
const ROTATED_SECRET = "c".repeat(64);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("Continuation Setup action issue/open integration", () => {
  it("issues on explicit click and gives parallel open calls exactly one winner", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "continuation-action-route-"));
    temporaryDirectories.push(cwd);
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(AS_OF));
    enableRoute();
    const privateTargetRef = `private_target_${"3".repeat(32)}`;
    const candidateId = `continuation_candidate_${"1".repeat(32)}`;
    mocks.evaluate.mockReset();
    mocks.evaluate.mockResolvedValue(
      liveAuthority(binding(candidateId, privateTargetRef, SECRET), SECRET)
    );

    const issue = await issuePost(
      request("offers", {
        itemRef: ITEM_REF,
        explicitUserAction: true
      })
    );
    const issued = (await issue.json()) as Record<string, unknown>;
    expect(issue.status).toBe(201);
    expect(issued).toMatchObject({
      contract: "continuation-setup-action-api-v0.1",
      status: "issued",
      expiresAt: "2026-08-13T12:00:30.000Z"
    });
    expect(issued.offerId).toMatch(/^continuation_setup_offer_[a-f0-9]{64}$/u);
    expect(mocks.evaluate).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-08-13T12:00:01.000Z"));
    const body = {
      offerId: issued.offerId,
      explicitUserAction: true
    };
    const responses = await Promise.all([
      openPost(request("open", body)),
      openPost(request("open", body))
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409
    ]);
    const opened = responses.find((response) => response.status === 200)!;
    const openedBody = await opened.json();
    expect(openedBody).toEqual({
      contract: "continuation-setup-action-api-v0.1",
      status: "opened",
      destination: "project_mappings",
      navigateTo: "/projects"
    });
    const conflict = responses.find((response) => response.status === 409)!;
    const conflictBody = await conflict.json();
    expect(conflictBody).toEqual({
      contract: "continuation-setup-action-api-v0.1",
      status: "error",
      code: "OFFER_NOT_CURRENT"
    });
    expect(mocks.evaluate).toHaveBeenCalledTimes(3);

    const publicTransport = JSON.stringify([issued, openedBody, conflictBody]);
    expect(publicTransport).not.toContain(privateTargetRef);
    expect(publicTransport).not.toContain(candidateId);
    expect(publicTransport).not.toContain(SECRET);
  });

  it("returns 409 for an old offer after the current secret namespace rotates", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "continuation-action-rotation-"));
    temporaryDirectories.push(cwd);
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(AS_OF));
    enableRoute();
    const candidateId = `continuation_candidate_${"1".repeat(32)}`;
    const privateTargetRef = `private_target_${"3".repeat(32)}`;
    mocks.evaluate.mockReset();
    mocks.evaluate
      .mockResolvedValueOnce(
        liveAuthority(binding(candidateId, privateTargetRef, SECRET), SECRET)
      )
      .mockResolvedValueOnce(
        liveAuthority(
          binding(
            candidateId,
            privateTargetRef,
            ROTATED_SECRET,
            "2026-08-13T12:00:01.000Z"
          ),
          ROTATED_SECRET,
          "2026-08-13T12:00:01.000Z"
        )
      );

    const issue = await issuePost(
      request("offers", {
        itemRef: ITEM_REF,
        explicitUserAction: true
      })
    );
    const issued = (await issue.json()) as Record<string, unknown>;
    expect(issue.status).toBe(201);

    vi.setSystemTime(new Date("2026-08-13T12:00:01.000Z"));
    const opened = await openPost(
      request("open", {
        offerId: issued.offerId,
        explicitUserAction: true
      })
    );

    expect(opened.status).toBe(409);
    await expect(opened.json()).resolves.toEqual({
      contract: "continuation-setup-action-api-v0.1",
      status: "error",
      code: "OFFER_NOT_CURRENT"
    });
    expect(mocks.evaluate).toHaveBeenCalledTimes(2);
  });
});

function enableRoute() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("BLABASE_CONTINUATION_SETUP_ACTION_ENABLED", "true");
  vi.stubEnv("SUGGESTION_ACCESS_PASSWORD", "test-password");
}

function request(route: "offers" | "open", body: Record<string, unknown>) {
  const serialized = JSON.stringify(body);
  return new Request(`http://localhost:3102/api/continuation/${route}`, {
    method: "POST",
    headers: {
      origin: "http://localhost:3102",
      authorization: `Basic ${btoa("blabase:test-password")}`,
      "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(serialized).byteLength)
    },
    body: serialized
  });
}

function liveAuthority(
  setupBinding: ContinuationSetupActionBinding,
  installationSecret: string,
  asOf = AS_OF
) {
  return {
    asOf,
    installationSecret,
    setupActionAuthorities: [
      {
        capability: "open_setup_surface" as const,
        destination: "project_mappings" as const,
        binding: setupBinding
      }
    ]
  };
}

function binding(
  candidateId: string,
  privateTargetRef: string,
  installationSecret: string,
  generatedAt = AS_OF
): ContinuationSetupActionBinding {
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
    itemRef: ITEM_REF,
    candidateKind: "workspace_mapping",
    candidateId,
    workContextSha256: null,
    sourceObservationSetSha256: "2".repeat(64),
    observedAt: "2026-08-13T11:55:00.000Z",
    candidateExpiresAt: "2026-08-13T12:05:00.000Z",
    setupReason,
    stableTargetRef: continuationSetupActionStableTargetRef({
      installationSecret,
      itemRef: ITEM_REF,
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
      privateTargetRef,
      generatedAt,
      continuationResolvedResultSha256: "9".repeat(64),
      continuationDecisionResultSha256: "a".repeat(64),
      continuationDecisionSemanticResultSha256: "b".repeat(64),
      continuationResolutionInputSha256: "c".repeat(64),
      identityResultSha256: "d".repeat(64),
      derivationResultSha256: "e".repeat(64),
      scoringResultSha256: "f".repeat(64),
      registrySha256: "0".repeat(64),
      sourceBatches: [
        {
          source: "codex",
          batchSha256: "1".repeat(64),
          snapshotSha256: "2".repeat(64)
        },
        {
          source: "github",
          batchSha256: "3".repeat(64),
          snapshotSha256: null
        }
      ]
    }
  });
}
