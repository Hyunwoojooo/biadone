import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { writePrivateEvaluationArtifact } from "../src/evaluation/privateArtifactStore";

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
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "blabase-private-artifact-"));
  roots.push(root);
  return root;
}

async function temporaryEntries(root: string): Promise<string[]> {
  const directory = join(root, ".local", "evaluations", "recent-work-projection");
  return (await readdir(directory)).filter((name) => name.endsWith(".tmp"));
}
