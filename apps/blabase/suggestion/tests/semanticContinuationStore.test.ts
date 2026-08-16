import { createHmac } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { capturePreservingLocalState } from "../src/attention/preserveCapture";
import {
  runtimeCanonicalJson,
  runtimeSha256,
  runtimeStableId
} from "../src/crossSource/canonicalHash";
import {
  confirmStoredSemanticContinuationIntent,
  readSemanticContinuationIntentStore,
  semanticContinuationLocalDirectory,
  semanticContinuationLocalRoot,
  semanticContinuationIntentAuthKeyId,
  verifySemanticContinuationIntentStore
} from "../src/semanticContinuation";

const created: string[] = [];
const ITEM_REF = `item_ref_${"a".repeat(43)}`;
const CONTEXT_REF = `context_ref_${"b".repeat(43)}`;
const INSTALLATION_SECRET = "e".repeat(64);

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("Semantic Continuation private local store", () => {
  it("atomically appends explicit decisions and records supersession", async () => {
    const cwd = await temporaryWorkspace();
    const first = await confirm(cwd, "alpha", "2026-08-13T12:00:00.000Z");
    const second = await confirm(cwd, "blabase", "2026-08-13T12:01:00.000Z");
    const read = await readSemanticContinuationIntentStore(
      cwd,
      INSTALLATION_SECRET
    );

    expect(read.status).toBe("available");
    if (read.status !== "available") return;
    expect(read.value.revision).toBe(2);
    expect(read.value.contract).toBe(
      "semantic-continuation-intent-store-v0.3"
    );
    expect(read.value.schemaVersion).toBe(
      "semantic-continuation-intent-store-schema-v0.3"
    );
    expect(read.value.decisions).toHaveLength(2);
    expect(second.decision.supersedesDecisionId).toBe(
      first.decision.decisionId
    );
    const directoryMode = (await stat(
      semanticContinuationLocalDirectory(cwd, INSTALLATION_SECRET)
    )).mode & 0o777;
    const fileMode = (await stat(
      join(
        semanticContinuationLocalDirectory(cwd, INSTALLATION_SECRET),
        "intent-store.json"
      )
    )).mode & 0o777;
    expect(directoryMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
    await expect(
      readSemanticContinuationIntentStore(cwd, "d".repeat(64))
    ).resolves.toEqual({ status: "missing" });
    expect(read.value.storeHmac).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      verifySemanticContinuationIntentStore(read.value, "d".repeat(64))
    ).toBeNull();
  });

  it("pure-reads a legacy v0.2 store and upgrades it only on explicit confirmation", async () => {
    const cwd = await temporaryWorkspace();
    const directory = semanticContinuationLocalDirectory(
      cwd,
      INSTALLATION_SECRET
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(join(cwd, ".local"), 0o700);
    await chmod(join(cwd, ".local", "semantic-continuation"), 0o700);
    await chmod(directory, 0o700);
    const target = join(directory, "intent-store.json");
    const legacy = legacyIntentStore();
    const original = `${JSON.stringify(legacy, null, 2)}\n`;
    await writeFile(target, original, { encoding: "utf8", mode: 0o600 });

    const read = await readSemanticContinuationIntentStore(
      cwd,
      INSTALLATION_SECRET
    );
    expect(read.status).toBe("available");
    if (read.status !== "available") return;
    expect(read.value.contract).toBe(
      "semantic-continuation-intent-store-v0.2"
    );
    expect(await readFile(target, "utf8")).toBe(original);

    const confirmed = await confirm(
      cwd,
      "blabase",
      "2026-08-13T12:01:00.000Z"
    );
    expect(confirmed.store.contract).toBe(
      "semantic-continuation-intent-store-v0.3"
    );
    expect(confirmed.store.decisions.map((decision) => decision.contract)).toEqual([
      "semantic-continuation-intent-v0.1",
      "semantic-continuation-intent-v0.2"
    ]);
    expect(confirmed.decision.supersedesDecisionId).toBe(
      legacy.decisions[0]!.decisionId
    );
  });

  it("isolates current-secret state and recovers safe temps from rotated namespaces", async () => {
    const cwd = await temporaryWorkspace();
    const rotatedSecret = "d".repeat(64);
    await confirm(cwd, "alpha", "2026-08-13T12:00:00.000Z");
    const root = semanticContinuationLocalRoot(cwd);
    await writeFile(
      join(root, "intent-store.json"),
      `${JSON.stringify({
        contract: "semantic-continuation-intent-store-v0.1",
        privateLabelSentinel: "legacy-private-label"
      })}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
    const previousDirectory = semanticContinuationLocalDirectory(
      cwd,
      INSTALLATION_SECRET
    );
    const previousTemporary = join(
      previousDirectory,
      "intent-store.json.996.dddddddddddddddd.tmp"
    );
    await writeFile(previousTemporary, "rotated-private-label-sentinel", {
      encoding: "utf8",
      mode: 0o600
    });

    await confirm(
      cwd,
      "beta",
      "2026-08-13T12:01:00.000Z",
      rotatedSecret
    );
    expect(await readdir(previousDirectory)).toEqual(["intent-store.json"]);
    const current = await capturePreservingLocalState({
      cwd,
      scope: "semantic",
      read: () =>
        readSemanticContinuationIntentStore(cwd, rotatedSecret)
    });
    expect(current.status).toBe("available");
    if (current.status !== "available") return;
    expect(current.value.decisions.map((entry) => entry.subjectLabel)).toEqual([
      "beta"
    ]);
    expect(
      await readFile(
        join(
          semanticContinuationLocalDirectory(cwd, rotatedSecret),
          "intent-store.json"
        ),
        "utf8"
      )
    ).not.toContain("legacy-private-label");

    const previous = await readSemanticContinuationIntentStore(
      cwd,
      INSTALLATION_SECRET
    );
    expect(previous.status).toBe("available");
    if (previous.status !== "available") return;
    expect(previous.value.decisions[0]?.subjectLabel).toBe("alpha");
  });

  it("serializes concurrent confirmations without losing a revision", async () => {
    const cwd = await temporaryWorkspace();
    await Promise.all([
      confirm(cwd, "alpha", "2026-08-13T12:00:00.000Z"),
      confirm(cwd, "beta", "2026-08-13T12:00:00.000Z"),
      confirm(cwd, "gamma", "2026-08-13T12:00:00.000Z")
    ]);
    const read = await readSemanticContinuationIntentStore(
      cwd,
      INSTALLATION_SECRET
    );

    expect(read.status).toBe("available");
    if (read.status !== "available") return;
    expect(read.value.revision).toBe(3);
    expect(read.value.decisions).toHaveLength(3);
  });

  it("reads corrupt state without rewriting it", async () => {
    const cwd = await temporaryWorkspace();
    const directory = semanticContinuationLocalDirectory(
      cwd,
      INSTALLATION_SECRET
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(join(cwd, ".local"), 0o700);
    await chmod(directory, 0o700);
    const target = join(directory, "intent-store.json");
    await writeFile(target, "{private-corrupt-sentinel", {
      encoding: "utf8",
      mode: 0o600
    });

    await expect(
      readSemanticContinuationIntentStore(cwd, INSTALLATION_SECRET)
    ).resolves.toEqual({
      status: "invalid",
      reason: "PARSE_FAILED"
    });
    expect(await readFile(target, "utf8")).toBe(
      "{private-corrupt-sentinel"
    );

    const schemaCwd = await temporaryWorkspace();
    await confirm(schemaCwd, "blabase", "2026-08-13T12:00:00.000Z");
    const schemaTarget = join(
      semanticContinuationLocalDirectory(schemaCwd, INSTALLATION_SECRET),
      "intent-store.json"
    );
    const tampered = JSON.parse(await readFile(schemaTarget, "utf8")) as {
      revision: number;
    };
    tampered.revision += 1;
    const tamperedText = `${JSON.stringify(tampered)}\n`;
    await writeFile(schemaTarget, tamperedText, "utf8");

    await expect(
      readSemanticContinuationIntentStore(schemaCwd, INSTALLATION_SECRET)
    ).resolves.toEqual({ status: "invalid", reason: "SCHEMA_INVALID" });
    expect(await readFile(schemaTarget, "utf8")).toBe(tamperedText);
  });

  it("fails pure reads on orphan writes and recovers only safe temps on the next confirmation", async () => {
    const cwd = await temporaryWorkspace();
    await confirm(cwd, "alpha", "2026-08-13T12:00:00.000Z");
    const directory = semanticContinuationLocalDirectory(
      cwd,
      INSTALLATION_SECRET
    );
    const temporary = join(
      directory,
      "intent-store.json.999.aaaaaaaaaaaaaaaa.tmp"
    );
    await writeFile(temporary, "private-label-temp-sentinel", {
      encoding: "utf8",
      mode: 0o600
    });

    await expect(
      readSemanticContinuationIntentStore(cwd, INSTALLATION_SECRET)
    ).resolves.toEqual({ status: "invalid", reason: "READ_FAILED" });
    expect(await readFile(temporary, "utf8")).toBe(
      "private-label-temp-sentinel"
    );

    await confirm(cwd, "beta", "2026-08-13T12:01:00.000Z");
    expect(await readdir(directory)).toEqual(["intent-store.json"]);
    const recovered = await readSemanticContinuationIntentStore(
      cwd,
      INSTALLATION_SECRET
    );
    expect(recovered.status).toBe("available");
    if (recovered.status !== "available") return;
    expect(recovered.value.decisions.map((entry) => entry.subjectLabel)).toEqual([
      "alpha",
      "beta"
    ]);
  });

  it("does not delete hostile inactive-namespace symlinks or wrong-mode temps", async () => {
    const symlinkCwd = await temporaryWorkspace();
    const outside = await temporaryWorkspace();
    await confirm(symlinkCwd, "alpha", "2026-08-13T12:00:00.000Z");
    const symlinkDirectory = semanticContinuationLocalDirectory(
      symlinkCwd,
      INSTALLATION_SECRET
    );
    const outsideTarget = join(outside, "outside-private-sentinel");
    await writeFile(outsideTarget, "outside-private-sentinel", {
      encoding: "utf8",
      mode: 0o600
    });
    const hostileLink = join(
      symlinkDirectory,
      "intent-store.json.998.bbbbbbbbbbbbbbbb.tmp"
    );
    await symlink(outsideTarget, hostileLink);
    await expect(
      confirm(
        symlinkCwd,
        "beta",
        "2026-08-13T12:01:00.000Z",
        "d".repeat(64)
      )
    ).rejects.toBeDefined();
    expect(await readFile(outsideTarget, "utf8")).toBe(
      "outside-private-sentinel"
    );

    const wrongModeCwd = await temporaryWorkspace();
    await confirm(wrongModeCwd, "alpha", "2026-08-13T12:00:00.000Z");
    const wrongModeTemp = join(
      semanticContinuationLocalDirectory(
        wrongModeCwd,
        INSTALLATION_SECRET
      ),
      "intent-store.json.997.cccccccccccccccc.tmp"
    );
    await writeFile(wrongModeTemp, "private-label-temp-sentinel", {
      encoding: "utf8",
      mode: 0o644
    });
    await expect(
      confirm(
        wrongModeCwd,
        "beta",
        "2026-08-13T12:01:00.000Z",
        "d".repeat(64)
      )
    ).rejects.toBeDefined();
    expect((await stat(wrongModeTemp)).mode & 0o777).toBe(0o644);
  });

  it("fails closed on unsafe ancestor paths without writing outside the workspace", async () => {
    const cwd = await temporaryWorkspace();
    const outside = await temporaryWorkspace();
    await symlink(outside, join(cwd, ".local"));

    await expect(
      confirm(cwd, "blabase", "2026-08-13T12:00:00.000Z")
    ).rejects.toBeDefined();
    expect(await readdir(outside)).toEqual([]);

    const lockCwd = await temporaryWorkspace();
    const lockOutside = await temporaryWorkspace();
    await mkdir(join(lockCwd, ".local"), { mode: 0o700 });
    await symlink(
      lockOutside,
      join(lockCwd, ".local", "work-resumption")
    );
    await expect(
      confirm(lockCwd, "blabase", "2026-08-13T12:00:00.000Z")
    ).rejects.toBeDefined();
    expect(await readdir(lockOutside)).toEqual([]);

    const wrongMode = await temporaryWorkspace();
    await mkdir(join(wrongMode, ".local"), { mode: 0o700 });
    await chmod(join(wrongMode, ".local"), 0o755);
    await expect(
      confirm(wrongMode, "blabase", "2026-08-13T12:00:00.000Z")
    ).rejects.toBeDefined();
  });
});

async function temporaryWorkspace(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "semantic-continuation-"));
  created.push(cwd);
  return cwd;
}

function confirm(
  cwd: string,
  subjectLabel: string,
  confirmedAt: string,
  installationSecret = INSTALLATION_SECRET
) {
  return confirmStoredSemanticContinuationIntent(
    {
      confirmation: {
        intent: "QA_RUN",
        subjectLabel,
        itemRef: ITEM_REF,
        workContextRef: CONTEXT_REF,
        explicitUserConfirmation: true
      },
      target: {
        itemRef: ITEM_REF,
        workContextRef: CONTEXT_REF,
        candidateKind: "linked_workstream",
        evidenceBand: "corroborated",
        observedAt: "2026-08-13T10:00:00.000Z",
        candidateExpiresAt: "2026-08-15T12:00:00.000Z"
      },
      registrySha256: "f".repeat(64),
      confirmedAt,
      installationSecret
    },
    cwd
  );
}

function legacyIntentStore() {
  const stableDecision = {
    intent: "QA_RUN" as const,
    subjectLabel: "alpha",
    labelSource: "explicit_user" as const,
    explicitUserConfirmation: true as const,
    itemRef: ITEM_REF,
    workContextRef: CONTEXT_REF,
    registrySha256: "f".repeat(64),
    targetObservedAt: "2026-08-13T10:00:00.000Z",
    targetCandidateExpiresAt: "2026-08-15T12:00:00.000Z",
    confirmedAt: "2026-08-13T12:00:00.000Z",
    expiresAt: "2026-08-14T12:00:00.000Z",
    supersedesDecisionId: null,
    overlayPolicyVersion: "semantic-continuation-title-overlay-v0.1" as const,
    ttlPolicyVersion: "semantic-continuation-intent-ttl-24h-v0.1" as const
  };
  const decisionContent = {
    contract: "semantic-continuation-intent-v0.1" as const,
    schemaVersion: "semantic-continuation-schema-v0.1" as const,
    decisionId: runtimeStableId(
      "semantic_intent",
      "semantic-continuation-intent-v0.1",
      stableDecision
    ),
    ...stableDecision
  };
  const decision = {
    ...decisionContent,
    decisionSha256: runtimeSha256({
      domain: "semantic-continuation-intent-decision-hash-v0.1",
      decision: decisionContent
    })
  };
  const content = {
    contract: "semantic-continuation-intent-store-v0.2" as const,
    schemaVersion: "semantic-continuation-intent-store-schema-v0.2" as const,
    authKeyId: semanticContinuationIntentAuthKeyId(INSTALLATION_SECRET),
    revision: 1,
    updatedAt: decision.confirmedAt,
    decisions: [decision]
  };
  const withHash = {
    ...content,
    storeSha256: runtimeSha256({
      domain: "semantic-continuation-intent-store-hash-v0.2",
      store: content
    })
  };
  const key = createHmac(
    "sha256",
    Buffer.from(INSTALLATION_SECRET, "hex")
  )
    .update("semantic-continuation-intent-store-hmac-v0.2", "utf8")
    .digest();
  return {
    ...withHash,
    storeHmac: createHmac("sha256", key)
      .update(runtimeCanonicalJson(withHash), "utf8")
      .digest("hex")
  };
}
