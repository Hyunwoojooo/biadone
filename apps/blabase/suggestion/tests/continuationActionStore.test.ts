import { lstat, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  consumeStoredContinuationSetupOffer,
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
  continuationSetupActionLocalDirectory,
  continuationSetupActionLocalRoot,
  continuationSetupActionStableTargetRef,
  issueStoredContinuationSetupOffer,
  readContinuationSetupActionStore,
  type ContinuationSetupActionAuthorityContent,
  type ContinuationSetupActionBinding,
  type ContinuationSetupActionIssuanceAudit
} from "../src/continuation/actions";

const SECRET = "a".repeat(64);
const OTHER_SECRET = "b".repeat(64);
const AS_OF = "2026-08-13T12:00:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Continuation Setup action private store", () => {
  it("persists one private HMAC offer with exact modes and idempotent issue", async () => {
    const cwd = await fixture();
    const current = binding();
    let captures = 0;
    const input = {
      cwd,
      clock: () => new Date(AS_OF),
      resolveCurrent: async (lockedNow: Date) => {
        captures += 1;
        expect(lockedNow.toISOString()).toBe(AS_OF);
        expect(
          (
            await stat(
              join(
                continuationSetupActionLocalRoot(cwd),
                "locks",
                "state.lock"
              )
            )
          ).mode & 0o777
        ).toBe(0o600);
        return { installationSecret: SECRET, binding: current };
      }
    };
    const first = await issueStoredContinuationSetupOffer(input);
    const second = await issueStoredContinuationSetupOffer(input);

    expect(second).toEqual(first);
    expect(captures).toBe(2);
    expect(Object.keys(first).sort()).toEqual([
      "contract",
      "expiresAt",
      "offerId",
      "status"
    ]);
    expect(first.expiresAt).toBe("2026-08-13T12:00:30.000Z");
    const root = continuationSetupActionLocalRoot(cwd);
    const directory = continuationSetupActionLocalDirectory(cwd, SECRET);
    expect((await stat(join(cwd, ".local"))).mode & 0o777).toBe(0o700);
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, "locks"))).mode & 0o777).toBe(
      0o700
    );
    expect((await stat(join(directory, "events.json"))).mode & 0o777).toBe(
      0o600
    );
    await expect(lstat(join(root, "locks", "state.lock"))).rejects.toMatchObject(
      { code: "ENOENT" }
    );
    const read = await readContinuationSetupActionStore({
      cwd,
      installationSecret: SECRET
    });
    expect(read.status).toBe("available");
    if (read.status === "available") expect(read.value.events).toHaveLength(1);
  });

  it("durably consumes before return and rejects replay", async () => {
    const cwd = await fixture();
    const current = binding();
    const issued = await issueStoredContinuationSetupOffer(
      issueInput(cwd, current)
    );
    const opened = await consume(cwd, issued.offerId, current, 5_000);

    expect(opened).toEqual({
      contract: "continuation-setup-action-api-v0.1",
      status: "opened",
      destination: "project_mappings",
      navigateTo: "/projects"
    });
    await expect(
      consume(cwd, issued.offerId, current, 6_000)
    ).rejects.toMatchObject({ code: "OFFER_NOT_CURRENT" });
    const read = await readContinuationSetupActionStore({
      cwd,
      installationSecret: SECRET
    });
    if (read.status !== "available") throw new TypeError("fixture");
    expect(read.value.events.at(-1)).toMatchObject({
      eventType: "terminal",
      terminalReason: "consumed",
      occurredAt: "2026-08-13T12:00:05.000Z"
    });
  });

  it("reopens and consumes authenticated state after a module restart", async () => {
    const cwd = await fixture();
    const current = binding();
    const issued = await issueStoredContinuationSetupOffer(
      issueInput(cwd, current)
    );
    await vi.resetModules();
    const restarted = await import("../src/continuation/actions/store");

    const opened = await restarted.consumeStoredContinuationSetupOffer({
      cwd,
      offerId: issued.offerId,
      clock: () => new Date("2026-08-13T12:00:01.000Z"),
      revalidate: () => ({
        installationSecret: SECRET,
        currentBindings: [current]
      })
    });
    expect(opened.status).toBe("opened");
  });

  it("linearizes parallel consume so exactly one caller succeeds", async () => {
    const cwd = await fixture();
    const current = binding();
    const issued = await issueStoredContinuationSetupOffer(
      issueInput(cwd, current)
    );
    const results = await Promise.allSettled([
      consume(cwd, issued.offerId, current, 1_000),
      consume(cwd, issued.offerId, current, 1_000)
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1
    );
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "OFFER_NOT_CURRENT" }
    });
  });

  it("uses the under-lock wall clock for expiry and retains the tombstone", async () => {
    const cwd = await fixture();
    const current = binding();
    const issued = await issueStoredContinuationSetupOffer(
      issueInput(cwd, current)
    );
    await expect(
      consume(cwd, issued.offerId, current, 30_000)
    ).rejects.toMatchObject({ code: "OFFER_NOT_CURRENT" });
    const read = await readContinuationSetupActionStore({
      cwd,
      installationSecret: SECRET
    });
    if (read.status !== "available") throw new TypeError("fixture");
    expect(read.value.events.at(-1)).toMatchObject({
      terminalReason: "expired",
      occurredAt: "2026-08-13T12:00:30.000Z",
      retainedUntil: "2026-08-14T12:00:30.000Z"
    });
  });

  it("rejects when the single fresh revalidation crosses the 30-second TTL", async () => {
    const cwd = await fixture();
    const current = binding();
    const issued = await issueStoredContinuationSetupOffer(
      issueInput(cwd, current)
    );
    const samples = [
      new Date("2026-08-13T12:00:29.900Z"),
      new Date("2026-08-13T12:00:30.100Z")
    ];
    let captures = 0;

    await expect(
      consumeStoredContinuationSetupOffer({
        cwd,
        offerId: issued.offerId,
        clock: () => samples.shift()!,
        revalidate: (asOf) => {
          captures += 1;
          expect(asOf.toISOString()).toBe("2026-08-13T12:00:29.900Z");
          return {
            installationSecret: SECRET,
            currentBindings: [current]
          };
        }
      })
    ).rejects.toMatchObject({ code: "OFFER_NOT_CURRENT" });
    expect(captures).toBe(1);
    const read = await readContinuationSetupActionStore({
      cwd,
      installationSecret: SECRET
    });
    if (read.status !== "available") throw new TypeError("fixture");
    expect(read.value.events.at(-1)).toMatchObject({
      terminalReason: "expired",
      occurredAt: "2026-08-13T12:00:30.100Z"
    });
  });

  it("supersedes a logically changed authority and rejects the stale offer", async () => {
    const cwd = await fixture();
    const firstBinding = binding();
    const first = await issueStoredContinuationSetupOffer(
      issueInput(cwd, firstBinding)
    );
    expect(first.expiresAt).toBe("2026-08-13T12:00:30.000Z");
    const rebound = binding({
      authority: { mappingStateSha256: "0".repeat(64) }
    });
    const second = await issueStoredContinuationSetupOffer(
      issueInput(cwd, rebound, SECRET, "2026-08-13T12:00:01.000Z")
    );
    expect(second.offerId).not.toBe(first.offerId);
    await expect(
      consume(cwd, first.offerId, firstBinding, 2_000)
    ).rejects.toMatchObject({ code: "OFFER_NOT_CURRENT" });
    await expect(
      consume(cwd, second.offerId, rebound, 3_000)
    ).resolves.toMatchObject({ status: "opened" });
  });

  it.each([
    ["logical observation", { sourceObservationSetSha256: "6".repeat(64) }],
    ["source identity", { sourceIdentitySha256: "6".repeat(64) }],
    ["identity resolution", { identityResolutionSha256: "6".repeat(64) }],
    ["relevant mapping state", { mappingStateSha256: "6".repeat(64) }],
    ["candidate expiry", { candidateExpiresAt: "2026-08-13T12:06:00.000Z" }],
    ["code provenance", { codeCommitSha: "d".repeat(40) }],
    ["derivation policy", { derivationConfigSha256: "6".repeat(64) }],
    ["setup reason", { setupReason: "IDENTITY_BINDING_CONFLICT" as const }]
  ])("invalidates an offer when %s changes", async (_label, authority) => {
    const cwd = await fixture();
    const firstBinding = binding();
    const first = await issueStoredContinuationSetupOffer(
      issueInput(cwd, firstBinding)
    );
    const changed = binding({ authority });
    const second = await issueStoredContinuationSetupOffer(
      issueInput(cwd, changed, SECRET, "2026-08-13T12:00:01.000Z")
    );

    expect(second.offerId).not.toBe(first.offerId);
    await expect(
      consume(cwd, first.offerId, firstBinding, 2_000)
    ).rejects.toMatchObject({ code: "OFFER_NOT_CURRENT" });
  });

  it("keeps issue idempotent and opens when only issuance audit fields drift", async () => {
    const cwd = await fixture();
    const issuedBinding = binding();
    const issued = await issueStoredContinuationSetupOffer(
      issueInput(cwd, issuedBinding)
    );
    const recaptured = binding({
      issuanceAudit: {
        generatedAt: "2026-08-13T12:00:01.000Z",
        candidateSha256: "7".repeat(64),
        privateTargetRef: `private_target_${"8".repeat(32)}`,
        continuationResolvedResultSha256: "0".repeat(64),
        continuationDecisionResultSha256: "1".repeat(64),
        continuationDecisionSemanticResultSha256: "2".repeat(64),
        continuationResolutionInputSha256: "3".repeat(64),
        identityResultSha256: "4".repeat(64),
        derivationResultSha256: "5".repeat(64),
        scoringResultSha256: "6".repeat(64),
        registrySha256: "7".repeat(64),
        sourceBatches: [
          {
            source: "codex",
            batchSha256: "8".repeat(64),
            snapshotSha256: "9".repeat(64)
          },
          {
            source: "github",
            batchSha256: "a".repeat(64),
            snapshotSha256: null
          }
        ]
      }
    });
    const reissued = await issueStoredContinuationSetupOffer(
      issueInput(cwd, recaptured, SECRET, "2026-08-13T12:00:01.000Z")
    );
    expect(reissued).toEqual(issued);

    await expect(
      consume(cwd, issued.offerId, recaptured, 2_000)
    ).resolves.toMatchObject({ status: "opened" });
  });

  it("fails closed for wrong secret, corrupt bytes, and pending settlement without deleting them", async () => {
    const cwd = await fixture();
    const current = binding();
    const issued = await issueStoredContinuationSetupOffer(
      issueInput(cwd, current)
    );
    await expect(
      consumeStoredContinuationSetupOffer({
        cwd,
        offerId: issued.offerId,
        clock: () => new Date("2026-08-13T12:00:01.000Z"),
        revalidate: () => ({
          installationSecret: "f".repeat(64),
          currentBindings: [current]
        })
      })
    ).rejects.toMatchObject({ code: "OFFER_NOT_CURRENT" });

    const target = join(
      continuationSetupActionLocalDirectory(cwd, SECRET),
      "events.json"
    );
    await writeFile(target, "{corrupt", { mode: 0o600 });
    const corruptBytes = await readFile(target, "utf8");
    await expect(
      consume(cwd, issued.offerId, current, 2_000)
    ).rejects.toMatchObject({ code: "OFFER_NOT_CURRENT" });
    expect(await readFile(target, "utf8")).toBe(corruptBytes);

    const pending = `${target}.${"1".repeat(32)}.tmp`;
    await writeFile(pending, "pending", { mode: 0o600 });
    await expect(
      issueStoredContinuationSetupOffer(issueInput(cwd, current))
    ).rejects.toMatchObject({ code: "STORE_UNAVAILABLE" });
    expect(await readFile(pending, "utf8")).toBe("pending");
  });

  it("lazily compacts an expired prefix at offer expiresAt plus 24 hours", async () => {
    const cwd = await fixture();
    const firstBinding = binding();
    const first = await issueStoredContinuationSetupOffer(
      issueInput(cwd, firstBinding)
    );
    const nextAt = "2026-08-14T12:00:30.000Z";
    const nextBinding = binding({
      authority: {
        itemRef: `item_ref_${"z".repeat(43)}`,
        candidateId: `continuation_candidate_${"7".repeat(32)}`,
        sourceObservationSetSha256: "7".repeat(64),
        observedAt: nextAt,
        candidateExpiresAt: "2026-08-14T12:05:00.000Z"
      },
      issuanceAudit: { generatedAt: nextAt }
    });
    await issueStoredContinuationSetupOffer(
      issueInput(cwd, nextBinding, SECRET, nextAt)
    );
    const read = await readContinuationSetupActionStore({
      cwd,
      installationSecret: SECRET
    });
    if (read.status !== "available") throw new TypeError("fixture");
    expect(read.value).toMatchObject({ revision: 3, anchorSequence: 2 });
    expect(read.value.events).toHaveLength(1);
    expect(read.value.events[0]!.sequence).toBe(3);
  });

  it("isolates persisted stores by the secret-derived key namespace", async () => {
    const cwd = await fixture();
    const first = await issueStoredContinuationSetupOffer(
      issueInput(cwd, binding())
    );
    const rotated = binding({ installationSecret: OTHER_SECRET });
    const second = await issueStoredContinuationSetupOffer(
      issueInput(
        cwd,
        rotated,
        OTHER_SECRET,
        "2026-08-13T12:00:01.000Z"
      )
    );

    expect(second.offerId).not.toBe(first.offerId);
    const firstDirectory = continuationSetupActionLocalDirectory(cwd, SECRET);
    const secondDirectory = continuationSetupActionLocalDirectory(
      cwd,
      OTHER_SECRET
    );
    expect(firstDirectory).not.toBe(secondDirectory);
    await expect(
      stat(join(firstDirectory, "events.json"))
    ).resolves.toBeDefined();
    await expect(
      stat(join(secondDirectory, "events.json"))
    ).resolves.toBeDefined();
    const firstRead = await readContinuationSetupActionStore({
      cwd,
      installationSecret: SECRET
    });
    const secondRead = await readContinuationSetupActionStore({
      cwd,
      installationSecret: OTHER_SECRET
    });
    expect(firstRead.status).toBe("available");
    expect(secondRead.status).toBe("available");
  });

  it("rejects an unsafe symlink ancestor without reading another store", async () => {
    const cwd = await fixture();
    const source = await fixture();
    await rm(join(cwd, ".local"), { recursive: true, force: true });
    const { symlink } = await import("node:fs/promises");
    await symlink(join(source, ".local"), join(cwd, ".local"));
    await expect(
      issueStoredContinuationSetupOffer(issueInput(cwd, binding()))
    ).rejects.toMatchObject({ code: "STORE_UNAVAILABLE" });
  });

  it("reserves terminal capacity for every issued offer at the event cap", async () => {
    vi.resetModules();
    vi.doMock("../src/continuation/actions/versions", async (importOriginal) => ({
      ...(await importOriginal<
        typeof import("../src/continuation/actions/versions")
      >()),
      CONTINUATION_SETUP_ACTION_MAX_RETAINED_EVENTS: 4
    }));
    try {
      const bounded = await import("../src/continuation/actions/store");
      const cwd = await fixture();
      const firstBinding = binding();
      const secondBinding = binding({
        authority: {
          itemRef: `item_ref_${"z".repeat(43)}`,
          candidateId: `continuation_candidate_${"7".repeat(32)}`,
          sourceObservationSetSha256: "7".repeat(64)
        },
        issuanceAudit: { generatedAt: "2026-08-13T12:00:01.000Z" }
      });
      const thirdBinding = binding({
        authority: {
          itemRef: `item_ref_${"y".repeat(43)}`,
          candidateId: `continuation_candidate_${"8".repeat(32)}`,
          sourceObservationSetSha256: "8".repeat(64)
        },
        issuanceAudit: { generatedAt: "2026-08-13T12:00:02.000Z" }
      });
      const first = await bounded.issueStoredContinuationSetupOffer(
        issueInput(cwd, firstBinding)
      );
      await bounded.issueStoredContinuationSetupOffer(
        issueInput(
          cwd,
          secondBinding,
          SECRET,
          "2026-08-13T12:00:01.000Z"
        )
      );

      await expect(
        bounded.issueStoredContinuationSetupOffer(
          issueInput(
            cwd,
            thirdBinding,
            SECRET,
            "2026-08-13T12:00:02.000Z"
          )
        )
      ).rejects.toMatchObject({ code: "STORE_UNAVAILABLE" });
      await expect(
        bounded.consumeStoredContinuationSetupOffer({
          cwd,
          offerId: first.offerId,
          clock: () => new Date("2026-08-13T12:00:03.000Z"),
          revalidate: () => ({
            installationSecret: SECRET,
            currentBindings: [firstBinding, secondBinding]
          })
        })
      ).resolves.toMatchObject({ status: "opened" });
    } finally {
      vi.doUnmock("../src/continuation/actions/versions");
      vi.resetModules();
    }
  });
});

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "continuation-action-"));
  temporaryDirectories.push(directory);
  return directory;
}

function issueInput(
  cwd: string,
  current: ContinuationSetupActionBinding,
  installationSecret = SECRET,
  asOf = AS_OF
) {
  return {
    cwd,
    clock: () => new Date(asOf),
    resolveCurrent: () => ({ installationSecret, binding: current })
  };
}

function consume(
  cwd: string,
  offerId: string,
  current: ContinuationSetupActionBinding,
  offsetMs: number
) {
  return consumeStoredContinuationSetupOffer({
    cwd,
    offerId,
    clock: () => new Date(Date.parse(AS_OF) + offsetMs),
    revalidate: () => ({
      installationSecret: SECRET,
      currentBindings: [current]
    })
  });
}

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
