import type { CodexResumeTarget } from "../../connectors/codex/resumeTarget";

export type CompanionCommand = {
  commandId: string;
  claimToken: string;
  bindingId: string;
  operation: "focus_or_resume";
  executionId: string;
  scopeId: string;
  createdAt: string;
  expiresAt: string;
};

export type CompanionResultCode =
  | "FOCUSED_EXISTING"
  | "RESUMED_IN_TERMINAL"
  | "EXECUTION_NOT_FOUND"
  | "EXECUTION_STALE"
  | "CODEX_UNAVAILABLE"
  | "UNSUPPORTED_PLATFORM"
  | "LAUNCH_FAILED"
  | "LAUNCH_OUTCOME_UNKNOWN"
  | "COMMAND_EXPIRED";

export type CompanionCommandCompletion = {
  status: "succeeded" | "failed" | "expired";
  resultCode: CompanionResultCode;
};

export type CompanionHeartbeat = {
  instanceId: string;
  observedAt: string;
};

export type CompanionLaunchLeaseResult =
  | { state: "not_current" }
  | {
      state: "expired";
      resultCode: "COMMAND_EXPIRED";
    }
  | {
      state: "completed";
      resultCode: CompanionResultCode;
    };

export interface WorkResumptionQueueAdapter {
  writeHeartbeat(heartbeat: CompanionHeartbeat): Promise<void>;
  clearHeartbeat(input: { instanceId: string }): Promise<void>;
  claimNext(input: {
    claimedAt: string;
  }): Promise<CompanionCommand | null>;
  isClaimCurrent(input: {
    commandId: string;
    bindingId: string;
    claimToken: string;
  }): Promise<boolean>;
  complete(input: {
    commandId: string;
    claimToken: string;
    completedAt: string;
    completion: CompanionCommandCompletion;
  }): Promise<void>;
  launchIfCurrent(
    input: {
      commandId: string;
      bindingId: string;
      claimToken: string;
      launchStartedAt: string;
    },
    launch: () => Promise<{
      completedAt: string;
      completion: CompanionCommandCompletion;
    }>
  ): Promise<CompanionLaunchLeaseResult>;
}

export type ResumeLaunchInput = {
  bindingId: string;
  codexBinaryPath: string;
  target: CodexResumeTarget;
};

export interface CodexResumeLauncher {
  focusOrResume(
    input: ResumeLaunchInput
  ): Promise<"FOCUSED_EXISTING" | "RESUMED_IN_TERMINAL">;
}

export type CompanionErrorCode =
  | "UNSUPPORTED_PLATFORM"
  | "INVALID_RESUME_INVOCATION"
  | "TERMINAL_LAUNCH_FAILED";

export class WorkResumptionCompanionError extends Error {
  constructor(
    public readonly code: CompanionErrorCode,
    message: string
  ) {
    super(message);
    this.name = "WorkResumptionCompanionError";
  }
}
