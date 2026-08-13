import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gitMock = vi.hoisted(() => {
  const calls: Array<{
    args: unknown;
    executable: unknown;
    options: unknown;
  }> = [];
  const outputs: Array<{ stdout: string; stderr: string }> = [];
  const execFile = () => {
    throw new Error("Unexpected callback-style Git invocation.");
  };
  Object.defineProperty(
    execFile,
    Symbol.for("nodejs.util.promisify.custom"),
    {
      value: async (
        executable: unknown,
        args: unknown,
        options: unknown
      ) => {
        calls.push({ executable, args, options });
        const output = outputs.shift();
        if (!output) throw new Error("Unexpected Git invocation.");
        return output;
      }
    }
  );
  return { calls, execFile, outputs };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: gitMock.execFile };
});

import {
  resolveAttentionCodeProvenance,
  unavailableCodeProvenance
} from "../src/attention/codeProvenance";
import {
  createSharedLocalEnvSnapshot,
  loadSharedLocalEnv
} from "../src/localEnv";

const temporaryDirectories: string[] = [];

beforeEach(() => {
  gitMock.calls.length = 0;
  gitMock.outputs.length = 0;
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("preserve code provenance", () => {
  it("accepts exact declared provenance without invoking Git", async () => {
    const commit = "a".repeat(40);

    await expect(
      resolveAttentionCodeProvenance(
        "/path-that-does-not-exist",
        {
          NODE_ENV: "test",
          BLABASE_CODE_COMMIT_SHA: commit.toUpperCase()
        },
        { mode: "preserve" }
      )
    ).resolves.toEqual({
      codeCommitSha: commit,
      codeState: "declared_commit",
      codeFingerprintSha256: null
    });
    expect(gitMock.calls).toEqual([]);
  });

  it("returns unavailable before reading a repository or invoking Git", async () => {
    const cwd = await temporaryRepository();

    await expect(
      resolveAttentionCodeProvenance(
        cwd,
        { NODE_ENV: "test" },
        { mode: "preserve" }
      )
    ).resolves.toEqual(unavailableCodeProvenance());
    expect(gitMock.calls).toEqual([]);
  });

  it("keeps maintain mode compatible while bounding the Git process", async () => {
    const cwd = await temporaryRepository();
    const head = "b".repeat(40);
    await writeFile(join(cwd, ".git", "HEAD"), `${head}\n`, "utf8");
    gitMock.outputs.push({ stdout: "", stderr: "" });

    await expect(
      resolveAttentionCodeProvenance(cwd, { NODE_ENV: "test" })
    ).resolves.toEqual({
      codeCommitSha: head,
      codeState: "clean_commit",
      codeFingerprintSha256: null
    });

    expect(gitMock.calls).toHaveLength(1);
    expect(gitMock.calls[0]).toMatchObject({
      executable: "/usr/bin/git",
      args: [
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--",
        "."
      ],
      options: {
        cwd,
        env: {
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_OPTIONAL_LOCKS: "0",
          GIT_TERMINAL_PROMPT: "0",
          LANG: "C",
          LC_ALL: "C",
          NODE_ENV: "production"
        },
        killSignal: "SIGKILL",
        maxBuffer: 32 * 1024 * 1024,
        timeout: 10_000
      }
    });
  });

  it("does not invoke a declared-provenance accessor", async () => {
    let getterCalls = 0;
    const env = Object.defineProperty(
      { NODE_ENV: "test" },
      "BLABASE_CODE_COMMIT_SHA",
      {
        enumerable: true,
        get() {
          getterCalls += 1;
          return "c".repeat(40);
        }
      }
    ) as NodeJS.ProcessEnv;

    await expect(
      resolveAttentionCodeProvenance("/private/tmp", env, {
        mode: "preserve"
      })
    ).resolves.toEqual(unavailableCodeProvenance());
    expect(getterCalls).toBe(0);
    expect(gitMock.calls).toEqual([]);
  });
});

describe("shared local environment snapshots", () => {
  it("copies only enumerable own string and undefined data", () => {
    const env = Object.assign(Object.create(null), {
      NODE_ENV: "test",
      PRESENT: "value",
      UNSET: undefined
    }) as NodeJS.ProcessEnv;

    const snapshot = createSharedLocalEnvSnapshot(env, {
      mode: "preserve"
    });

    expect(Object.getPrototypeOf(snapshot)).toBeNull();
    expect(Object.keys(snapshot).sort()).toEqual([
      "NODE_ENV",
      "PRESENT",
      "UNSET"
    ]);
    expect(snapshot).not.toBe(env);
    snapshot.PRESENT = "changed";
    expect(env.PRESENT).toBe("value");
  });

  it("rejects hostile descriptors and proxies without invoking them", () => {
    let getterCalls = 0;
    const accessor = Object.defineProperty(
      { NODE_ENV: "test" },
      "GITHUB_SHA",
      {
        enumerable: true,
        get() {
          getterCalls += 1;
          return "d".repeat(40);
        }
      }
    ) as NodeJS.ProcessEnv;
    expect(() =>
      createSharedLocalEnvSnapshot(accessor, { mode: "preserve" })
    ).toThrow(TypeError);
    expect(getterCalls).toBe(0);

    let ownKeysCalls = 0;
    const proxy = new Proxy(
      { NODE_ENV: "test" } as NodeJS.ProcessEnv,
      {
        ownKeys() {
          ownKeysCalls += 1;
          throw new Error("hostile ownKeys");
        }
      }
    );
    expect(() =>
      createSharedLocalEnvSnapshot(proxy, { mode: "preserve" })
    ).toThrow(TypeError);
    expect(ownKeysCalls).toBe(0);
  });

  it("rejects symbol, non-enumerable, non-string, and inherited data", () => {
    const withSymbol = { NODE_ENV: "test" } as NodeJS.ProcessEnv &
      Record<symbol, string>;
    Object.defineProperty(withSymbol, Symbol("private"), {
      enumerable: true,
      value: "secret"
    });
    const withHidden = Object.defineProperty(
      { NODE_ENV: "test" },
      "HIDDEN",
      { enumerable: false, value: "secret" }
    ) as NodeJS.ProcessEnv;
    const withNumber = {
      NODE_ENV: "test",
      INVALID: 1
    } as unknown as NodeJS.ProcessEnv;
    const withInherited = Object.assign(
      Object.create({ GITHUB_SHA: "e".repeat(40) }),
      { NODE_ENV: "test" }
    ) as NodeJS.ProcessEnv;

    for (const env of [
      withSymbol,
      withHidden,
      withNumber,
      withInherited
    ]) {
      expect(() =>
        createSharedLocalEnvSnapshot(env, { mode: "preserve" })
      ).toThrow(TypeError);
    }
  });

  it("never reads shared files or mutates caller/global state in preserve mode", async () => {
    const cwd = await temporaryDirectory();
    const sharedPath = join(cwd, "shared.env");
    await writeFile(sharedPath, "GEMINI_MODEL=from-file\n", "utf8");
    const env = {
      NODE_ENV: "test",
      BLABASE_SHARED_ENV_PATH: sharedPath
    } as NodeJS.ProcessEnv;
    const processSentinel = "BLABASE_PR002_ENV_SNAPSHOT_TEST";
    const processValueBefore = process.env[processSentinel];

    const snapshot = createSharedLocalEnvSnapshot(env, {
      cwd,
      mode: "preserve"
    });
    snapshot[processSentinel] = "snapshot-only";

    expect(snapshot.GEMINI_MODEL).toBeUndefined();
    expect(env.GEMINI_MODEL).toBeUndefined();
    expect(process.env[processSentinel]).toBe(processValueBefore);
  });

  it("loads maintain snapshots without changing the legacy module cache", async () => {
    const cwd = await temporaryDirectory();
    const sharedPath = join(cwd, "shared.env");
    await writeFile(sharedPath, "GEMINI_MODEL=first-value\n", "utf8");
    const env = {
      NODE_ENV: "test",
      BLABASE_SHARED_ENV_PATH: sharedPath
    } as NodeJS.ProcessEnv;

    const snapshot = createSharedLocalEnvSnapshot(env, {
      cwd,
      mode: "maintain"
    });
    expect(snapshot.GEMINI_MODEL).toBe("first-value");
    expect(env.GEMINI_MODEL).toBeUndefined();

    await writeFile(sharedPath, "GEMINI_MODEL=legacy-value\n", "utf8");
    loadSharedLocalEnv(env);
    expect(env.GEMINI_MODEL).toBe("legacy-value");
  });
});

async function temporaryRepository(): Promise<string> {
  const cwd = await temporaryDirectory();
  await mkdir(join(cwd, ".git"), { mode: 0o700 });
  await writeFile(
    join(cwd, ".git", "HEAD"),
    `${"f".repeat(40)}\n`,
    "utf8"
  );
  return cwd;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "blabase-preserve-provenance-")
  );
  temporaryDirectories.push(directory);
  return directory;
}
