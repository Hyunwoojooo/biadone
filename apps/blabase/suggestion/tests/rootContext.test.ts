import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  launcherStatusProjectionSchema
} from "../src/launcher/contracts";
import {
  ROOT_CONTEXT_CONTRACT,
  ROOT_MARKER_CONTRACT,
  readPersistedSyncRevision,
  readRootMarker,
  resolveDashboardRootContext,
  resolveRootMarker,
  rootContextSchema,
  rootMarkerPath,
  rootMarkerSchema
} from "../src/rootContext";
import {
  createInitialSourceSyncStore
} from "../src/sync/coordinator";
import { runtimeStatusResponse } from "../src/sync/runtime";
import {
  SOURCE_SYNC_ATTEMPT_CONTRACT,
  sourceSyncLatestStoreSchema
} from "../src/sync/schema";

const NOW = "2026-08-05T04:00:00.000Z";

describe("root context marker", () => {
  it("publishes one stable random identity per root under concurrent owners", async () => {
    const parent = await mkdtemp(join(tmpdir(), "blabase-root-context-"));
    const firstRoot = join(parent, "first");
    const secondRoot = join(parent, "second");
    await Promise.all([
      mkdir(firstRoot, { mode: 0o700 }),
      mkdir(secondRoot, { mode: 0o700 })
    ]);

    try {
      const firstMarkers = await Promise.all(
        Array.from({ length: 12 }, () =>
          resolveRootMarker(firstRoot, "owner")
        )
      );
      const repeated = await resolveRootMarker(firstRoot, "owner");
      const second = await resolveRootMarker(secondRoot, "owner");

      expect(firstMarkers.every((marker) => marker !== null)).toBe(true);
      expect(
        new Set(firstMarkers.map((marker) => marker?.rootId))
      ).toEqual(new Set([repeated?.rootId]));
      expect(repeated?.rootId).toMatch(/^root_[a-f0-9]{32}$/);
      expect(second?.rootId).toMatch(/^root_[a-f0-9]{32}$/);
      expect(second?.rootId).not.toBe(repeated?.rootId);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("keeps read-only lookup non-creating and non-repairing", async () => {
    const root = await mkdtemp(join(tmpdir(), "blabase-root-read-only-"));

    try {
      await expect(
        resolveRootMarker(root, "read_only")
      ).resolves.toBeNull();
      await expect(stat(join(root, ".local"))).rejects.toMatchObject({
        code: "ENOENT"
      });

      const created = await resolveRootMarker(root, "owner");
      await chmod(join(root, ".local"), 0o755);
      await chmod(rootMarkerPath(root), 0o644);

      await expect(
        resolveRootMarker(root, "read_only")
      ).resolves.toBeNull();
      expect((await stat(join(root, ".local"))).mode & 0o777).toBe(
        0o755
      );
      expect((await stat(rootMarkerPath(root))).mode & 0o777).toBe(
        0o644
      );
      expect(
        rootMarkerSchema.parse(
          JSON.parse(await readFile(rootMarkerPath(root), "utf8"))
        ).rootId
      ).toBe(created?.rootId);

      await chmod(join(root, ".local"), 0o700);
      await chmod(rootMarkerPath(root), 0o600);
      await writeFile(rootMarkerPath(root), "{invalid-private-marker\n", {
        encoding: "utf8",
        mode: 0o600
      });
      await expect(
        resolveRootMarker(root, "read_only")
      ).resolves.toBeNull();
      await expect(readFile(rootMarkerPath(root), "utf8")).resolves.toBe(
        "{invalid-private-marker\n"
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("safely tightens an existing owner directory and marker", async () => {
    const root = await mkdtemp(join(tmpdir(), "blabase-root-migrate-"));
    const localDirectory = join(root, ".local");
    const markerPath = rootMarkerPath(root);
    const rootId = `root_${"a".repeat(32)}`;
    await mkdir(localDirectory, { mode: 0o755 });
    await chmod(localDirectory, 0o755);
    await writeFile(
      markerPath,
      `${JSON.stringify({
        contract: ROOT_MARKER_CONTRACT,
        rootId
      })}\n`,
      { encoding: "utf8", mode: 0o644 }
    );
    await chmod(markerPath, 0o644);

    try {
      await expect(resolveRootMarker(root, "owner")).resolves.toEqual({
        contract: ROOT_MARKER_CONTRACT,
        rootId
      });
      expect((await stat(localDirectory)).mode & 0o777).toBe(0o700);
      expect((await stat(markerPath)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a marker that is not owned by the current user", async () => {
    if (!process.getuid) return;
    const root = await mkdtemp(join(tmpdir(), "blabase-root-owner-"));

    try {
      await resolveRootMarker(root, "owner");
      const actualUid = process.getuid();
      vi.spyOn(
        process as unknown as { getuid: () => number },
        "getuid"
      ).mockReturnValue(actualUid + 1);

      await expect(readRootMarker(root)).resolves.toBeNull();
      await expect(
        resolveRootMarker(root, "owner")
      ).rejects.toMatchObject({ code: "ROOT_MARKER_WRITE_FAILED" });
    } finally {
      vi.restoreAllMocks();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns only the strict public dashboard fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "blabase-root-public-"));
    const privateText = "connector-secret-that-must-not-leak";

    try {
      const context = await resolveDashboardRootContext(root);
      expect(context).toEqual({
        contract: ROOT_CONTEXT_CONTRACT,
        rootId: expect.stringMatching(/^root_[a-f0-9]{32}$/),
        mutationAuthority: "dashboard",
        syncRevision: null
      });
      expect(Object.keys(context).sort()).toEqual([
        "contract",
        "mutationAuthority",
        "rootId",
        "syncRevision"
      ]);
      expect(JSON.stringify(context)).not.toContain(root);
      expect(JSON.stringify(context)).not.toContain(privateText);
      expect(() =>
        rootContextSchema.parse({ ...context, dataRoot: root })
      ).toThrow();
      expect(() =>
        rootMarkerSchema.parse({
          contract: ROOT_MARKER_CONTRACT,
          rootId: context.rootId,
          secret: privateText
        })
      ).toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads the exact stable persisted overall sync revision", async () => {
    const root = await mkdtemp(join(tmpdir(), "blabase-root-revision-"));
    const latest = syncedLatestStore();
    await writePrivateSyncLatest(root, latest);

    try {
      const expected = runtimeStatusResponse(latest).revision;
      await expect(readPersistedSyncRevision(root)).resolves.toBe(
        expected
      );
      await expect(readPersistedSyncRevision(root)).resolves.toBe(
        expected
      );

      await writePrivateSyncLatest(
        root,
        createInitialSourceSyncStore(NOW)
      );
      await expect(readPersistedSyncRevision(root)).resolves.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("strictly parses launcher mode, authority, identity, and revision", () => {
    const valid = {
      contract: "blabase-launcher-status-v1",
      rootId: `root_${"b".repeat(32)}`,
      sourceMode: "managed",
      mutationAuthority: "launcher_agent",
      syncRevision: "pipeline:0123456789abcdef0123456789abcdef"
    };

    expect(launcherStatusProjectionSchema.parse(valid)).toEqual(valid);
    expect(() =>
      launcherStatusProjectionSchema.parse({
        ...valid,
        mutationAuthority: "none"
      })
    ).toThrow();
    expect(() =>
      launcherStatusProjectionSchema.parse({ ...valid, rootId: null })
    ).toThrow();
    expect(() =>
      launcherStatusProjectionSchema.parse({ ...valid, dataRoot: "/tmp" })
    ).toThrow();
  });
});

function syncedLatestStore() {
  const initial = createInitialSourceSyncStore(NOW);
  const attemptId = `sync_${"1".repeat(32)}`;
  const hash = "2".repeat(64);
  const attempt = {
    contract: SOURCE_SYNC_ATTEMPT_CONTRACT,
    attemptId,
    source: "github" as const,
    trigger: "manual" as const,
    startedAt: NOW,
    completedAt: NOW,
    outcome: "success" as const,
    retryCount: 0,
    latencyMs: 0,
    snapshotRevision: "github:revision-1",
    snapshotHash: hash,
    itemCount: 1,
    errorCode: null
  };
  return sourceSyncLatestStoreSchema.parse({
    ...initial,
    sources: {
      ...initial.sources,
      github: {
        ...initial.sources.github,
        status: "ready",
        lastAttempt: attempt,
        lastSuccess: attempt,
        latestSnapshot: {
          revision: attempt.snapshotRevision,
          hash,
          itemCount: 1,
          syncedAt: NOW,
          attemptId
        }
      }
    }
  });
}

async function writePrivateSyncLatest(
  root: string,
  value: unknown
): Promise<void> {
  const localDirectory = join(root, ".local");
  const syncDirectory = join(localDirectory, "sync");
  await mkdir(syncDirectory, { recursive: true, mode: 0o700 });
  await chmod(localDirectory, 0o700);
  await chmod(syncDirectory, 0o700);
  const target = join(syncDirectory, "latest.json");
  await writeFile(target, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await chmod(target, 0o600);
}
