import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  publishPrivateEvaluationArtifactSetNoClobber,
  rawSha256,
  verifyPrivateEvaluationArtifactSetReadback,
  writePrivateEvaluationArtifact
} from "../src/evaluation/privateArtifactStore";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("private evaluation artifact store", () => {
  it("publishes complete bytes with owner-only file and directory modes", async () => {
    const root = await temporaryRoot();
    const relativePath = ".local/evaluations/recent-work-projection/run.json";
    const stored = await writePrivateEvaluationArtifact({
      dataRoot: root,
      relativePath,
      contents: "complete artifact\n"
    });
    const target = join(root, relativePath);
    expect(await readFile(target, "utf8")).toBe("complete artifact\n");
    expect((await stat(target)).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, ".local"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, ".local", "evaluations"))).mode & 0o777).toBe(0o700);
    expect(stored).toMatchObject({ relativePath, byteLength: 18, mode: 0o600 });
  });

  it("never clobbers an existing final artifact", async () => {
    const root = await temporaryRoot();
    const relativePath = ".local/evaluations/recent-work-projection/run.json";
    await writePrivateEvaluationArtifact({ dataRoot: root, relativePath, contents: "winner" });
    await expect(
      writePrivateEvaluationArtifact({ dataRoot: root, relativePath, contents: "loser" })
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(join(root, relativePath), "utf8")).toBe("winner");
    expect(await temporaryEntries(root)).toEqual([]);
  });

  it("lets exactly one concurrent complete writer win", async () => {
    const root = await temporaryRoot();
    const relativePath = ".local/evaluations/recent-work-projection/run.json";
    const outcomes = await Promise.allSettled([
      writePrivateEvaluationArtifact({ dataRoot: root, relativePath, contents: "first-complete" }),
      writePrivateEvaluationArtifact({ dataRoot: root, relativePath, contents: "second-complete" })
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(["first-complete", "second-complete"]).toContain(
      await readFile(join(root, relativePath), "utf8")
    );
    expect(await temporaryEntries(root)).toEqual([]);
  });

  it("cleans a synced temporary file when publication is interrupted", async () => {
    const root = await temporaryRoot();
    const relativePath = ".local/evaluations/recent-work-projection/run.json";
    await expect(
      writePrivateEvaluationArtifact({
        dataRoot: root,
        relativePath,
        contents: "complete-before-interruption",
        hooks: {
          beforePublish: () => {
            throw new Error("simulated interruption");
          }
        }
      })
    ).rejects.toThrow("simulated interruption");
    await expect(stat(join(root, relativePath))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await temporaryEntries(root)).toEqual([]);
  });

  it("rejects a changed temporary inode before commit and permits a clean retry", async () => {
    const root = await temporaryRoot();
    const relativePath = ".local/evaluations/recent-work-projection/run.json";
    await expect(
      writePrivateEvaluationArtifact({
        dataRoot: root,
        relativePath,
        contents: "complete-before-validation",
        hooks: {
          beforePublish: async (temporaryPath) => {
            await chmod(temporaryPath, 0o644);
          }
        }
      })
    ).rejects.toThrow("temporary artifact validation failed");
    await expect(stat(join(root, relativePath))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await temporaryEntries(root)).toEqual([]);

    await writePrivateEvaluationArtifact({
      dataRoot: root,
      relativePath,
      contents: "clean-retry"
    });
    expect(await readFile(join(root, relativePath), "utf8")).toBe("clean-retry");
  });

  it("publishes and reads back a complete owner-only artifact set", async () => {
    const root = await temporaryRoot();
    const pathComponents = artifactSetPath("complete-set");
    const files = artifactSetFiles("complete");
    const published = await publishPrivateEvaluationArtifactSetNoClobber({
      dataRoot: root,
      pathComponents,
      files
    });
    expect(published.relativeDirectory).toBe(pathComponents.join("/"));
    expect(published.directoryMode).toBe(0o700);
    expect(published.files.map((file) => file.mode)).toEqual([
      0o600,
      0o600,
      0o600,
      0o600
    ]);
    const runDirectory = join(root, ...pathComponents);
    expect((await stat(runDirectory)).mode & 0o777).toBe(0o700);
    for (const file of files) {
      expect(await readFile(join(runDirectory, file.relativePath))).toEqual(
        Buffer.from(file.bytes)
      );
      expect((await stat(join(runDirectory, file.relativePath))).mode & 0o777).toBe(
        0o600
      );
    }
    await expect(
      verifyPrivateEvaluationArtifactSetReadback({
        dataRoot: root,
        pathComponents,
        expectedFiles: files
      })
    ).resolves.toEqual(published);
  });

  it("allows at most one same-label publisher and never changes the winner", async () => {
    const root = await temporaryRoot();
    const pathComponents = artifactSetPath("one-winner");
    const first = artifactSetFiles("first");
    const second = artifactSetFiles("second");
    const outcomes = await Promise.allSettled([
      publishPrivateEvaluationArtifactSetNoClobber({
        dataRoot: root,
        pathComponents,
        files: first
      }),
      publishPrivateEvaluationArtifactSetNoClobber({
        dataRoot: root,
        pathComponents,
        files: second
      })
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const firstBytes = await readFile(
      join(root, ...pathComponents, "experiment-manifest.json"),
      "utf8"
    );
    expect(["first:experiment-manifest.json\n", "second:experiment-manifest.json\n"]).toContain(
      firstBytes
    );
    await expect(
      publishPrivateEvaluationArtifactSetNoClobber({
        dataRoot: root,
        pathComponents,
        files: artifactSetFiles("third")
      })
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(
      await readFile(join(root, ...pathComponents, "experiment-manifest.json"), "utf8")
    ).toBe(firstBytes);
  });

  it("rejects unsafe paths, symlinked or weak parents, and bad metadata", async () => {
    const invalidRoot = await temporaryRoot();
    await expect(
      publishPrivateEvaluationArtifactSetNoClobber({
        dataRoot: invalidRoot,
        pathComponents: [".local", "evaluations", "dayflow-ablation", "..", "run"],
        files: artifactSetFiles("invalid")
      })
    ).rejects.toThrow(/component is unsafe/u);
    const metadataRoot = await temporaryRoot();
    const badMetadata = artifactSetFiles("metadata");
    badMetadata[0] = { ...badMetadata[0]!, rawSha256: "f".repeat(64) };
    await expect(
      publishPrivateEvaluationArtifactSetNoClobber({
        dataRoot: metadataRoot,
        pathComponents: artifactSetPath("bad-metadata"),
        files: badMetadata
      })
    ).rejects.toThrow(/bytes do not match metadata/u);
    await expect(stat(join(metadataRoot, ".local"))).rejects.toMatchObject({
      code: "ENOENT"
    });

    const symlinkRoot = await temporaryRoot();
    const symlinkTarget = await temporaryRoot();
    await symlink(symlinkTarget, join(symlinkRoot, ".local"));
    await expect(
      publishPrivateEvaluationArtifactSetNoClobber({
        dataRoot: symlinkRoot,
        pathComponents: artifactSetPath("symlink"),
        files: artifactSetFiles("symlink")
      })
    ).rejects.toThrow();

    const weakRoot = await temporaryRoot();
    await mkdir(join(weakRoot, ".local"), { mode: 0o700 });
    await chmod(join(weakRoot, ".local"), 0o755);
    await expect(
      publishPrivateEvaluationArtifactSetNoClobber({
        dataRoot: weakRoot,
        pathComponents: artifactSetPath("weak"),
        files: artifactSetFiles("weak")
      })
    ).rejects.toThrow(/unsafe/u);
  });

  it("treats every partial known-file set as invalid and preserves it", async () => {
    const allFiles = artifactSetFiles("partial");
    for (let missingIndex = 0; missingIndex < allFiles.length; missingIndex += 1) {
      const root = await temporaryRoot();
      const pathComponents = artifactSetPath(`partial-${missingIndex}`);
      const partialFiles = allFiles.filter((_, index) => index !== missingIndex);
      await publishPrivateEvaluationArtifactSetNoClobber({
        dataRoot: root,
        pathComponents,
        files: partialFiles
      });
      await expect(
        verifyPrivateEvaluationArtifactSetReadback({
          dataRoot: root,
          pathComponents,
          expectedFiles: allFiles
        })
      ).rejects.toMatchObject({ code: "ENOENT" });
      for (const file of partialFiles) {
        expect(await readFile(join(root, ...pathComponents, file.relativePath))).toEqual(
          Buffer.from(file.bytes)
        );
      }
      await expect(
        publishPrivateEvaluationArtifactSetNoClobber({
          dataRoot: root,
          pathComponents,
          files: allFiles
        })
      ).rejects.toMatchObject({ code: "EEXIST" });
    }
  });
});

describe("readPrivateEvaluationArtifactSetExact", () => {
  it("returns a frozen exact-entry snapshot and fresh owned copies", async () => {
    const { realpath } = await import("node:fs/promises");
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "private-artifact-exact-read-")),
    );
    const pathComponents = artifactSetPath("exact-reader-owned-copy");
    const files = artifactSetFiles("exact-reader-owned-copy");
    const fileSpecs = files.map((file) => ({
      relativePath: file.relativePath,
      mediaType: file.mediaType,
      maxBytes: file.bytes.byteLength,
    }));
    const { readPrivateEvaluationArtifactSetExact } = await import(
      "../src/evaluation/privateArtifactStore"
    );

    try {
      await chmod(root, 0o755);
      await publishPrivateEvaluationArtifactSetNoClobber({
        dataRoot: root,
        pathComponents,
        files,
      });
      expect((await stat(root)).mode & 0o777).toBe(0o755);
      expect((await stat(join(root, ".local"))).mode & 0o777).toBe(0o700);
      const result = await readPrivateEvaluationArtifactSetExact({
        dataRoot: root,
        pathComponents,
        fileSpecs,
      });

      expect(result.relativeDirectory).toBe(pathComponents.join("/"));
      expect(result.directoryMode).toBe(0o700);
      expect(result.files.map((file) => file.relativePath)).toEqual(
        files.map((file) => file.relativePath),
      );
      expect(result.files.every((file) => file.mode === 0o600)).toBe(true);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.files)).toBe(true);
      expect(result.files.every((file) => Object.isFrozen(file))).toBe(true);

      const first = result.copyFiles();
      const second = result.copyFiles();
      expect(first).not.toBe(second);
      expect(first[0]).not.toBe(second[0]);
      expect(first[0]?.bytes).not.toBe(second[0]?.bytes);
      if (result.files[0] !== undefined && result.files[0].bytes.length > 0) {
        result.files[0].bytes[0] ^= 0xff;
      }
      expect(Array.from(second[0]?.bytes ?? [])).toEqual(
        Array.from(files[0]?.bytes ?? []),
      );

      await chmod(root, 0o775);
      await expect(
        readPrivateEvaluationArtifactSetExact({
          dataRoot: root,
          pathComponents,
          fileSpecs,
        }),
      ).rejects.toMatchObject({ issueCode: "DIRECTORY_UNSAFE" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects resource overflow and an unexpected directory entry", async () => {
    const { realpath } = await import("node:fs/promises");
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "private-artifact-exact-set-")),
    );
    const pathComponents = artifactSetPath("exact-reader-rejections");
    const files = artifactSetFiles("exact-reader-rejections");
    const { readPrivateEvaluationArtifactSetExact } = await import(
      "../src/evaluation/privateArtifactStore"
    );
    const fileSpecs = files.map((file, index) => ({
      relativePath: file.relativePath,
      mediaType: file.mediaType,
      maxBytes:
        index === 0 ? Math.max(0, file.bytes.byteLength - 1) : file.bytes.byteLength,
    }));

    try {
      await publishPrivateEvaluationArtifactSetNoClobber({
        dataRoot: root,
        pathComponents,
        files,
      });
      await expect(
        readPrivateEvaluationArtifactSetExact({
          dataRoot: root,
          pathComponents,
          fileSpecs,
        }),
      ).rejects.toMatchObject({ issueCode: "RESOURCE_LIMIT_EXCEEDED" });

      const { writeFile } = await import("node:fs/promises");
      await writeFile(
        join(root, ...pathComponents, "unexpected.txt"),
        "unexpected",
        { mode: 0o600 },
      );
      await expect(
        readPrivateEvaluationArtifactSetExact({
          dataRoot: root,
          pathComponents,
          fileSpecs: files.map((file) => ({
            relativePath: file.relativePath,
            mediaType: file.mediaType,
            maxBytes: file.bytes.byteLength,
          })),
        }),
      ).rejects.toMatchObject({ issueCode: "ENTRY_SET_MISMATCH" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "blabase-private-artifact-"));
  roots.push(root);
  return root;
}

describe("Task 1C private evaluation-input namespace", () => {
  it("publishes only to the approved content-addressed pilot path", async () => {
    const root = await temporaryRoot();
    const runHash = "a".repeat(64);
    const pathComponents = [
      ".local",
      "dayflow-ablation",
      "inputs",
      "dayflow-ablation-private-pilot-v0.1",
      "runs",
      runHash
    ];

    const result = await publishPrivateEvaluationArtifactSetNoClobber({
      dataRoot: root,
      pathComponents,
      files: artifactSetFiles("task1c")
    });

    expect(result.relativeDirectory).toBe(pathComponents.join("/"));
    expect(result.directoryMode).toBe(0o700);
  });

  it("publishes only to the exact private-pilot authorization namespace", async () => {
    const root = await temporaryRoot();
    const authorizationHash = "b".repeat(64);
    const pathComponents = [
      ".local",
      "dayflow-ablation",
      "inputs",
      "dayflow-ablation-private-pilot-v0.1",
      "authorizations",
      authorizationHash
    ];

    const result = await publishPrivateEvaluationArtifactSetNoClobber({
      dataRoot: root,
      pathComponents,
      files: artifactSetFiles("task1d-authorization")
    });

    expect(result.relativeDirectory).toBe(pathComponents.join("/"));
    expect(result.directoryMode).toBe(0o700);

    const invalidPaths = [
      [...pathComponents.slice(0, 4), "authorization", authorizationHash],
      [
        ".local",
        "dayflow-ablation",
        "inputs",
        "alternate-policy",
        "authorizations",
        authorizationHash
      ],
      [...pathComponents.slice(0, 5), authorizationHash.toUpperCase()],
      [...pathComponents, "extra"]
    ];
    for (const invalidPath of invalidPaths) {
      await expect(
        publishPrivateEvaluationArtifactSetNoClobber({
          dataRoot: root,
          pathComponents: invalidPath,
          files: artifactSetFiles("invalid-task1d-authorization")
        })
      ).rejects.toThrow(TypeError);
    }
  });

  it("rejects alternate Task 1C namespaces, policies, and run identities", async () => {
    const root = await temporaryRoot();
    const runHash = "a".repeat(64);
    const invalidPaths = [
      [
        ".local",
        "dayflow-ablation",
        "input",
        "dayflow-ablation-private-pilot-v0.1",
        "runs",
        runHash
      ],
      [
        ".local",
        "dayflow-ablation",
        "inputs",
        "alternate-policy",
        "runs",
        runHash
      ],
      [
        ".local",
        "dayflow-ablation",
        "inputs",
        "dayflow-ablation-private-pilot-v0.1",
        "runs",
        "not-a-content-hash"
      ],
      [
        ".local",
        "dayflow-ablation",
        "inputs",
        "..",
        "runs",
        runHash
      ]
    ];

    for (const pathComponents of invalidPaths) {
      await expect(
        publishPrivateEvaluationArtifactSetNoClobber({
          dataRoot: root,
          pathComponents,
          files: artifactSetFiles("invalid-task1c")
        })
      ).rejects.toThrow(TypeError);
    }
  });
});

async function temporaryEntries(root: string): Promise<string[]> {
  const directory = join(root, ".local", "evaluations", "recent-work-projection");
  return (await readdir(directory)).filter((name) => name.endsWith(".tmp"));
}

function artifactSetPath(runLabel: string): string[] {
  return [
    ".local",
    "evaluations",
    "dayflow-ablation",
    "synthetic-dry-runs",
    runLabel
  ];
}

function artifactSetFiles(label: string) {
  return [
    "experiment-manifest.json",
    "run-results.json",
    "comparison-report.md",
    "colin-decision.md"
  ].map((relativePath) => {
    const bytes = new TextEncoder().encode(`${label}:${relativePath}\n`);
    return {
      relativePath,
      mediaType: relativePath.endsWith(".json")
        ? "application/json"
        : "text/markdown; charset=utf-8",
      byteLength: bytes.byteLength,
      rawSha256: rawSha256(bytes),
      bytes
    };
  });
}
