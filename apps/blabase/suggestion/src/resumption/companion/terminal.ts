import {
  constants as fsConstants
} from "node:fs";
import { randomBytes } from "node:crypto";
import {
  access,
  stat
} from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  spawn,
  type ChildProcess
} from "node:child_process";

import type {
  CodexResumeLauncher,
  ResumeLaunchInput
} from "./types";
import { WorkResumptionCompanionError } from "./types";

const APPLE_SCRIPT_TIMEOUT_MS = 5_000;
const MAX_APPLE_SCRIPT_OUTPUT_BYTES = 1_024;
const SAFE_BINDING_ID = /^binding_[a-f0-9]{32}$/;
const SAFE_NATIVE_THREAD_ID =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const UNSAFE_LOCAL_VALUE =
  /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;

const OPEN_TERMINAL_SCRIPT = `
on run argv
  set fixedCommand to item 1 of argv
  set expectedMarker to item 2 of argv
  tell application "Terminal"
    activate
    set launchedTab to do script fixedCommand
    set custom title of launchedTab to expectedMarker
    return (id of front window) as text
  end tell
end run
`.trim();

const FOCUS_TERMINAL_SCRIPT = `
on run argv
  set requestedId to item 1 of argv as integer
  set expectedMarker to item 2 of argv
  tell application "Terminal"
    repeat with candidateWindow in windows
      if (id of candidateWindow) is requestedId then
        repeat with candidateTab in tabs of candidateWindow
          if (custom title of candidateTab) is expectedMarker and busy of candidateTab then
            set selected tab of candidateWindow to candidateTab
            set index of candidateWindow to 1
            activate
            return "focused"
          end if
        end repeat
        return "missing"
      end if
    end repeat
  end tell
  return "missing"
end run
`.trim();

export type AppleScriptRunner = (
  script: string,
  argv: string[]
) => Promise<string>;

type InvocationValidators = {
  assertDirectory?: (path: string) => Promise<void>;
  assertExecutable?: (path: string) => Promise<void>;
};

export class MacOsTerminalResumeLauncher
  implements CodexResumeLauncher
{
  private readonly terminalWindowByBinding = new Map<
    string,
    { windowId: string; marker: string }
  >();

  constructor(
    private readonly options: {
      platform?: NodeJS.Platform;
      runAppleScript?: AppleScriptRunner;
      validators?: InvocationValidators;
      createMarker?: () => string;
    } = {}
  ) {}

  async focusOrResume(
    input: ResumeLaunchInput
  ): Promise<"FOCUSED_EXISTING" | "RESUMED_IN_TERMINAL"> {
    if ((this.options.platform ?? process.platform) !== "darwin") {
      throw new WorkResumptionCompanionError(
        "UNSUPPORTED_PLATFORM",
        "이 Companion 버전은 macOS Terminal만 지원합니다."
      );
    }

    const fixedCommand = await buildFixedResumeCommand(
      input,
      this.options.validators
    );
    const runAppleScript =
      this.options.runAppleScript ?? runAppleScriptWithSpawn;
    const existingLocator = this.terminalWindowByBinding.get(
      input.bindingId
    );

    if (existingLocator) {
      const focusResult = await runAppleScript(
        FOCUS_TERMINAL_SCRIPT,
        [existingLocator.windowId, existingLocator.marker]
      );
      if (focusResult === "focused") {
        return "FOCUSED_EXISTING";
      }
      if (focusResult !== "missing") {
        throw new WorkResumptionCompanionError(
          "TERMINAL_LAUNCH_FAILED",
          "Terminal 창 상태를 확인하지 못했습니다."
        );
      }
      this.terminalWindowByBinding.delete(input.bindingId);
    }

    const marker = (
      this.options.createMarker ?? createTerminalMarker
    )();
    if (!/^blabase-resume-[a-f0-9]{32}$/.test(marker)) {
      throw new WorkResumptionCompanionError(
        "TERMINAL_LAUNCH_FAILED",
        "Terminal 작업 표식을 만들지 못했습니다."
      );
    }
    const windowId = (
      await runAppleScript(OPEN_TERMINAL_SCRIPT, [
        fixedCommand,
        marker
      ])
    ).trim();
    if (!/^[1-9][0-9]{0,15}$/.test(windowId)) {
      throw new WorkResumptionCompanionError(
        "TERMINAL_LAUNCH_FAILED",
        "새 Terminal 창을 확인하지 못했습니다."
      );
    }
    this.terminalWindowByBinding.set(input.bindingId, {
      windowId,
      marker
    });
    return "RESUMED_IN_TERMINAL";
  }
}

export class DryRunResumeValidator {
  constructor(
    private readonly validators: InvocationValidators = {}
  ) {}

  async validate(input: ResumeLaunchInput): Promise<void> {
    await validateResumeInvocation(input, this.validators);
  }
}

export async function runAppleScriptWithSpawn(
  script: string,
  argv: string[],
  spawnProcess: typeof spawn = spawn
): Promise<string> {
  const child = spawnProcess(
    "/usr/bin/osascript",
    ["-e", script, ...argv],
    {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  return collectAppleScriptResult(child);
}

export function quotePosixShellArgument(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

async function buildFixedResumeCommand(
  input: ResumeLaunchInput,
  validators: InvocationValidators = {}
): Promise<string> {
  await validateResumeInvocation(input, validators);
  return [
    "cd",
    quotePosixShellArgument(input.target.cwd),
    "&&",
    "exec",
    quotePosixShellArgument(input.codexBinaryPath),
    "resume",
    quotePosixShellArgument(input.target.nativeThreadId)
  ].join(" ");
}

async function validateResumeInvocation(
  input: ResumeLaunchInput,
  validators: InvocationValidators
): Promise<void> {
  if (
    !SAFE_BINDING_ID.test(input.bindingId) ||
    !isSafeAbsolutePath(input.target.cwd) ||
    !isSafeAbsolutePath(input.codexBinaryPath) ||
    !SAFE_NATIVE_THREAD_ID.test(input.target.nativeThreadId)
  ) {
    throw new WorkResumptionCompanionError(
      "INVALID_RESUME_INVOCATION",
      "고정된 Codex resume 작업의 입력을 검증하지 못했습니다."
    );
  }

  try {
    await (
      validators.assertDirectory ?? assertExistingDirectory
    )(input.target.cwd);
    await (
      validators.assertExecutable ?? assertExecutable
    )(input.codexBinaryPath);
  } catch {
    throw new WorkResumptionCompanionError(
      "INVALID_RESUME_INVOCATION",
      "Codex 프로젝트 또는 실행 파일을 확인하지 못했습니다."
    );
  }
}

function isSafeAbsolutePath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 4_096 &&
    isAbsolute(value) &&
    !UNSAFE_LOCAL_VALUE.test(value)
  );
}

async function assertExistingDirectory(path: string): Promise<void> {
  const metadata = await stat(path);
  if (!metadata.isDirectory()) {
    throw new Error("not a directory");
  }
}

async function assertExecutable(path: string): Promise<void> {
  await access(path, fsConstants.X_OK);
}

async function collectAppleScriptResult(
  child: ChildProcess
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let output = "";
    let outputBytes = 0;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finishWithError();
    }, APPLE_SCRIPT_TIMEOUT_MS);

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_APPLE_SCRIPT_OUTPUT_BYTES) {
        child.kill("SIGTERM");
        finishWithError();
        return;
      }
      output += chunk;
    });
    child.stderr?.resume();
    child.once("error", finishWithError);
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(terminalLaunchError());
        return;
      }
      resolve(output.trim());
    });

    function finishWithError(): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(terminalLaunchError());
    }
  });
}

function terminalLaunchError(): WorkResumptionCompanionError {
  return new WorkResumptionCompanionError(
    "TERMINAL_LAUNCH_FAILED",
    "macOS Terminal 작업을 실행하지 못했습니다."
  );
}

function createTerminalMarker(): string {
  return `blabase-resume-${randomBytes(16).toString("hex")}`;
}
