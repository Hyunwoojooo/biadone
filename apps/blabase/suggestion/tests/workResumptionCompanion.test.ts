import { EventEmitter } from "node:events";
import type { ChildProcess, spawn } from "node:child_process";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  DryRunResumeValidator,
  MacOsTerminalResumeLauncher,
  quotePosixShellArgument,
  runAppleScriptWithSpawn
} from "../src/resumption/companion/terminal";
import {
  runCompanionCycle,
  runCompanionDaemon
} from "../src/resumption/companion/runtime";
import type {
  CompanionCommand,
  CompanionCommandCompletion,
  WorkResumptionQueueAdapter
} from "../src/resumption/companion/types";
import {
  CodexResumeTargetError
} from "../src/connectors/codex/resumeTarget";
import {
  WorkResumptionCompanionError
} from "../src/resumption/companion/types";

const BINDING_ID = `binding_${"a".repeat(32)}`;
const COMMAND_ID = `command_${"b".repeat(32)}`;
const CLAIM_TOKEN = "c".repeat(32);
const EXECUTION_ID = `codex:execution:${"d".repeat(24)}`;
const SCOPE_ID = "e".repeat(24);
const NATIVE_THREAD_ID = "019c1234-abcd-7000-8000-123456789abc";
const TERMINAL_MARKER = `blabase-resume-${"f".repeat(32)}`;
const INSTANCE_ID = `instance_${"9".repeat(32)}`;
const CONNECTION_GENERATION = `connection_${"8".repeat(32)}`;

describe("macOS Work Resumption Terminal launcher", () => {
  it("passes only a quoted fixed resume command as AppleScript argv", async () => {
    const calls: Array<{ script: string; argv: string[] }> = [];
    const runAppleScript = vi.fn(
      async (script: string, argv: string[]) => {
        calls.push({ script, argv });
        return "42";
      }
    );
    const launcher = new MacOsTerminalResumeLauncher({
      platform: "darwin",
      runAppleScript,
      validators: noOpValidators(),
      createMarker: () => TERMINAL_MARKER
    });
    const cwd = "/tmp/project's $(touch should-not-run)";
    const binaryPath =
      "/Applications/Codex's.app/Contents/Resources/codex";

    await expect(
      launcher.focusOrResume({
        bindingId: BINDING_ID,
        executionId: EXECUTION_ID,
        scopeId: SCOPE_ID,
        connectionGeneration: CONNECTION_GENERATION,
        codexBinaryPath: binaryPath,
        target: {
          nativeThreadId: NATIVE_THREAD_ID,
          cwd
        }
      })
    ).resolves.toBe("RESUMED_IN_TERMINAL");

    expect(calls).toHaveLength(1);
    expect(calls[0].script).not.toContain(cwd);
    expect(calls[0].script).not.toContain(NATIVE_THREAD_ID);
    expect(calls[0].argv).toEqual([
      [
        "cd",
        quotePosixShellArgument(cwd),
        "&&",
        "exec",
        quotePosixShellArgument(binaryPath),
        "resume",
        quotePosixShellArgument(NATIVE_THREAD_ID)
      ].join(" "),
      TERMINAL_MARKER
    ]);
  });

  it("connects a resumed TUI only to a validated local managed endpoint", async () => {
    const runAppleScript = vi.fn(
      async (_script: string, _argv: string[]) => "42"
    );
    const launcher = new MacOsTerminalResumeLauncher({
      platform: "darwin",
      runAppleScript,
      validators: noOpValidators(),
      createMarker: () => TERMINAL_MARKER
    });

    await launcher.focusOrResume({
      ...launchInput(),
      remoteEndpoint: "ws://127.0.0.1:4500"
    });

    expect(runAppleScript.mock.calls[0]?.[1]?.[0]).toBe(
      [
        "cd",
        quotePosixShellArgument("/tmp/project"),
        "&&",
        "exec",
        quotePosixShellArgument("/usr/local/bin/codex"),
        "resume",
        "--remote",
        quotePosixShellArgument("ws://127.0.0.1:4500"),
        quotePosixShellArgument(NATIVE_THREAD_ID)
      ].join(" ")
    );
  });

  it("rejects non-loopback managed endpoints before opening Terminal", async () => {
    const runAppleScript = vi.fn(
      async (_script: string, _argv: string[]) => "42"
    );
    const launcher = new MacOsTerminalResumeLauncher({
      platform: "darwin",
      runAppleScript,
      validators: noOpValidators()
    });

    await expect(
      launcher.focusOrResume({
        ...launchInput(),
        remoteEndpoint: "ws://0.0.0.0:4500"
      })
    ).rejects.toMatchObject({
      code: "INVALID_RESUME_INVOCATION"
    });
    expect(runAppleScript).not.toHaveBeenCalled();
  });

  it("focuses a verified busy Companion-owned Terminal window", async () => {
    const runAppleScript = vi
      .fn()
      .mockResolvedValueOnce("42")
      .mockResolvedValueOnce("focused");
    const launcher = new MacOsTerminalResumeLauncher({
      platform: "darwin",
      runAppleScript,
      validators: noOpValidators(),
      createMarker: () => TERMINAL_MARKER
    });

    await launcher.focusOrResume(launchInput());
    await expect(
      launcher.focusOrResume(launchInput())
    ).resolves.toBe("FOCUSED_EXISTING");

    expect(runAppleScript).toHaveBeenCalledTimes(2);
    expect(runAppleScript.mock.calls[1][0]).toContain(
      "busy of candidateTab"
    );
    expect(runAppleScript.mock.calls[1][0]).toContain(
      "custom title of candidateTab"
    );
    expect(runAppleScript.mock.calls[1][1]).toEqual([
      "42",
      TERMINAL_MARKER
    ]);
  });

  it("opens a fresh resume when the tracked window is no longer busy", async () => {
    const runAppleScript = vi
      .fn()
      .mockResolvedValueOnce("42")
      .mockResolvedValueOnce("missing")
      .mockResolvedValueOnce("43");
    const launcher = new MacOsTerminalResumeLauncher({
      platform: "darwin",
      runAppleScript,
      validators: noOpValidators(),
      createMarker: () => TERMINAL_MARKER
    });

    await launcher.focusOrResume(launchInput());
    await expect(
      launcher.focusOrResume(launchInput())
    ).resolves.toBe("RESUMED_IN_TERMINAL");
    expect(runAppleScript).toHaveBeenCalledTimes(3);
  });

  it("fails with a typed error on unsupported operating systems", async () => {
    const runAppleScript = vi.fn();
    const launcher = new MacOsTerminalResumeLauncher({
      platform: "linux",
      runAppleScript,
      validators: noOpValidators()
    });

    await expect(
      launcher.focusOrResume(launchInput())
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_PLATFORM"
    });
    expect(runAppleScript).not.toHaveBeenCalled();
  });

  it("rejects unsafe invocation fields before AppleScript runs", async () => {
    const runAppleScript = vi.fn();
    const launcher = new MacOsTerminalResumeLauncher({
      platform: "darwin",
      runAppleScript,
      validators: noOpValidators()
    });

    await expect(
      launcher.focusOrResume({
        ...launchInput(),
        target: {
          nativeThreadId: "thread\nid",
          cwd: "/tmp/project"
        }
      })
    ).rejects.toMatchObject({
      code: "INVALID_RESUME_INVOCATION"
    });
    expect(runAppleScript).not.toHaveBeenCalled();
  });

  it("supports standalone validation without opening Terminal", async () => {
    const assertDirectory = vi.fn(async () => undefined);
    const assertExecutable = vi.fn(async () => undefined);
    const validator = new DryRunResumeValidator({
      assertDirectory,
      assertExecutable
    });

    await expect(
      validator.validate(launchInput())
    ).resolves.toBeUndefined();
    expect(assertDirectory).toHaveBeenCalledWith("/tmp/project");
    expect(assertExecutable).toHaveBeenCalledWith(
      "/usr/local/bin/codex"
    );
  });

  it("spawns osascript with shell disabled and does not retain stderr", async () => {
    const fake = fakeChildProcess();
    const spawnProcess = vi.fn(
      () => fake.child
    ) as unknown as typeof spawn;
    const promise = runAppleScriptWithSpawn(
      "on run argv\nreturn item 1 of argv\nend run",
      ["safe-argv"],
      spawnProcess
    );
    fake.stdout.write("focused\n");
    fake.stdout.end();
    fake.stderr.write("private local detail");
    fake.stderr.end();
    fake.child.emit("close", 0);

    await expect(promise).resolves.toBe("focused");
    expect(spawnProcess).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      [
        "-e",
        "on run argv\nreturn item 1 of argv\nend run",
        "safe-argv"
      ],
      {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
  });
});

describe("Work Resumption Companion runtime", () => {
  it("resolves and launches a fixed command once, then records success", async () => {
    const queue = queueAdapter(command());
    const resolveTarget = vi.fn(async () => ({
      nativeThreadId: NATIVE_THREAD_ID,
      cwd: "/tmp/project"
    }));
    const launcher = {
      focusOrResume: vi.fn(
        async () => "RESUMED_IN_TERMINAL" as const
      )
    };

    await expect(
      runCompanionCycle({
        queue,
        launcher,
        resolveTarget,
        resolveBinary: async () => ({
          ok: true,
          binaryPath: "/usr/local/bin/codex"
        }),
        now: fixedClock("2026-07-30T05:00:01.000Z")
      })
    ).resolves.toEqual({
      kind: "handled",
      commandId: COMMAND_ID,
      resultCode: "RESUMED_IN_TERMINAL"
    });

    expect(resolveTarget).toHaveBeenCalledWith({
      executionId: EXECUTION_ID,
      scopeId: SCOPE_ID
    });
    expect(launcher.focusOrResume).toHaveBeenCalledOnce();
    expect(queue.launchIfCurrent).toHaveBeenCalledOnce();
    expect(queue.complete).not.toHaveBeenCalled();
  });

  it("maps a missing or stale native session to typed failure without launching", async () => {
    const queue = queueAdapter(command());
    const launcher = { focusOrResume: vi.fn() };

    await runCompanionCycle({
      queue,
      launcher,
      resolveTarget: async () => {
        throw new CodexResumeTargetError(
          "CODEX_EXECUTION_STALE",
          "sanitized"
        );
      },
      resolveBinary: async () => ({
        ok: true,
        binaryPath: "/usr/local/bin/codex"
      }),
      now: fixedClock("2026-07-30T05:00:01.000Z")
    });

    expect(launcher.focusOrResume).not.toHaveBeenCalled();
    expect(queue.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        completion: {
          status: "failed",
          resultCode: "EXECUTION_STALE"
        }
      })
    );
  });

  it("re-checks the claim after resolving and skips launch when unbound", async () => {
    const queue = queueAdapter(command(), { current: false });
    const launcher = { focusOrResume: vi.fn() };

    await expect(
      runCompanionCycle({
        queue,
        launcher,
        resolveTarget: async () => ({
          nativeThreadId: NATIVE_THREAD_ID,
          cwd: "/tmp/project"
        }),
        resolveBinary: async () => ({
          ok: true,
          binaryPath: "/usr/local/bin/codex"
        }),
        now: fixedClock("2026-07-30T05:00:01.000Z")
      })
    ).resolves.toEqual({ kind: "idle" });

    expect(queue.launchIfCurrent).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: COMMAND_ID,
        bindingId: BINDING_ID,
        claimToken: CLAIM_TOKEN
      }),
      expect.any(Function)
    );
    expect(launcher.focusOrResume).not.toHaveBeenCalled();
    expect(queue.complete).not.toHaveBeenCalled();
  });

  it("expires a claimed command if resolution crosses the fixed TTL", async () => {
    const queue = queueAdapter(command());
    const launcher = { focusOrResume: vi.fn() };
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(
        new Date("2026-07-30T05:00:01.000Z")
      )
      .mockReturnValue(
        new Date("2026-07-30T05:00:31.000Z")
      );

    await runCompanionCycle({
      queue,
      launcher,
      resolveTarget: async () => ({
        nativeThreadId: NATIVE_THREAD_ID,
        cwd: "/tmp/project"
      }),
      resolveBinary: async () => ({
        ok: true,
        binaryPath: "/usr/local/bin/codex"
      }),
      now
    });

    expect(launcher.focusOrResume).not.toHaveBeenCalled();
    expect(queue.complete).toHaveBeenCalledWith({
      commandId: COMMAND_ID,
      claimToken: CLAIM_TOKEN,
      completedAt: "2026-07-30T05:00:31.000Z",
      completion: {
        status: "expired",
        resultCode: "COMMAND_EXPIRED"
      }
    });
  });

  it("does not retry a failed Terminal launch", async () => {
    const queue = queueAdapter(command());
    const launcher = {
      focusOrResume: vi.fn(async () => {
        throw new WorkResumptionCompanionError(
          "TERMINAL_LAUNCH_FAILED",
          "sanitized"
        );
      })
    };

    await runCompanionCycle({
      queue,
      launcher,
      resolveTarget: async () => ({
        nativeThreadId: NATIVE_THREAD_ID,
        cwd: "/tmp/project"
      }),
      resolveBinary: async () => ({
        ok: true,
        binaryPath: "/usr/local/bin/codex"
      }),
      now: fixedClock("2026-07-30T05:00:01.000Z")
    });

    expect(launcher.focusOrResume).toHaveBeenCalledOnce();
    expect(queue.launchIfCurrent).toHaveBeenCalledOnce();
    expect(queue.complete).not.toHaveBeenCalled();
  });

  it("does not advertise a persistent heartbeat in one-cycle mode", async () => {
    const queue = queueAdapter(null);
    const controller = new AbortController();

    await expect(
      runCompanionDaemon({
        queue,
        launcher: { focusOrResume: vi.fn() },
        signal: controller.signal,
        once: true
      })
    ).resolves.toEqual({ kind: "idle" });
    expect(queue.writeHeartbeat).not.toHaveBeenCalled();
    expect(queue.clearHeartbeat).not.toHaveBeenCalled();
  });

  it("clears the online heartbeat when the daemon stops", async () => {
    const queue = queueAdapter(null);
    const controller = new AbortController();
    queue.writeHeartbeat.mockImplementationOnce(async () => {
      controller.abort();
    });

    await expect(
      runCompanionDaemon({
        queue,
        launcher: { focusOrResume: vi.fn() },
        signal: controller.signal,
        instanceId: INSTANCE_ID
      })
    ).resolves.toBeNull();
    expect(queue.writeHeartbeat).toHaveBeenCalledWith({
      instanceId: INSTANCE_ID,
      observedAt: expect.any(String)
    });
    expect(queue.clearHeartbeat).toHaveBeenCalledWith({
      instanceId: INSTANCE_ID
    });
  });

  it("does not claim or launch before heartbeat ownership is acquired", async () => {
    const queue = queueAdapter(command());
    const controller = new AbortController();
    const launcher = { focusOrResume: vi.fn() };
    queue.writeHeartbeat.mockRejectedValueOnce(
      new Error("COMPANION_ALREADY_RUNNING")
    );

    await expect(
      runCompanionDaemon({
        queue,
        launcher,
        signal: controller.signal,
        instanceId: INSTANCE_ID
      })
    ).rejects.toThrow("COMPANION_ALREADY_RUNNING");
    expect(queue.claimNext).not.toHaveBeenCalled();
    expect(queue.launchIfCurrent).not.toHaveBeenCalled();
    expect(launcher.focusOrResume).not.toHaveBeenCalled();
    expect(queue.clearHeartbeat).not.toHaveBeenCalled();
  });
});

function launchInput() {
  return {
    bindingId: BINDING_ID,
    executionId: EXECUTION_ID,
    scopeId: SCOPE_ID,
    connectionGeneration: CONNECTION_GENERATION,
    codexBinaryPath: "/usr/local/bin/codex",
    target: {
      nativeThreadId: NATIVE_THREAD_ID,
      cwd: "/tmp/project"
    }
  };
}

function noOpValidators() {
  return {
    assertDirectory: async () => undefined,
    assertExecutable: async () => undefined
  };
}

function command(
  overrides: Partial<CompanionCommand> = {}
): CompanionCommand {
  return {
    commandId: COMMAND_ID,
    claimToken: CLAIM_TOKEN,
    bindingId: BINDING_ID,
    operation: "focus_or_resume",
    executionId: EXECUTION_ID,
    scopeId: SCOPE_ID,
    connectionGeneration: CONNECTION_GENERATION,
    createdAt: "2026-07-30T05:00:00.000Z",
    expiresAt: "2026-07-30T05:00:30.000Z",
    ...overrides
  };
}

function queueAdapter(
  queuedCommand: CompanionCommand | null,
  options: { current?: boolean } = {}
): WorkResumptionQueueAdapter & {
  writeHeartbeat: ReturnType<typeof vi.fn>;
  clearHeartbeat: ReturnType<typeof vi.fn>;
  claimNext: ReturnType<typeof vi.fn>;
  isClaimCurrent: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
  launchIfCurrent: ReturnType<typeof vi.fn>;
} {
  return {
    writeHeartbeat: vi.fn(async () => undefined),
    clearHeartbeat: vi.fn(async () => undefined),
    claimNext: vi.fn(async () => queuedCommand),
    isClaimCurrent: vi.fn(
      async () => options.current ?? true
    ),
    complete: vi.fn(
      async (_input: {
        completion: CompanionCommandCompletion;
      }) => undefined
    ),
    launchIfCurrent: vi.fn(
      async (
        _input: unknown,
        launch: () => Promise<{
          completedAt: string;
          completion: CompanionCommandCompletion;
        }>
      ) => {
        if (options.current === false) {
          return { state: "not_current" as const };
        }
        const launched = await launch();
        return {
          state: "completed" as const,
          resultCode: launched.completion.resultCode
        };
      }
    )
  };
}

function fixedClock(value: string): () => Date {
  return () => new Date(value);
}

function fakeChildProcess(): {
  child: ChildProcess;
  stdout: PassThrough;
  stderr: PassThrough;
} {
  const child = new EventEmitter() as ChildProcess;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(child, {
    stdout,
    stderr,
    kill: vi.fn(() => true)
  });
  return { child, stdout, stderr };
}
