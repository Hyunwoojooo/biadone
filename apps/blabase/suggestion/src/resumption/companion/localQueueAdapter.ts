import {
  claimNextPendingCommand,
  clearCompanionHeartbeat,
  completeClaimedCommand,
  isClaimedCommandCurrent,
  runClaimedCommandWithLaunchLease,
  WorkResumptionStoreError,
  writeCompanionHeartbeat
} from "../store";
import type { CompleteClaimedCommandInput } from "../contracts";
import type {
  CompanionCommandCompletion,
  WorkResumptionQueueAdapter
} from "./types";

export function createLocalWorkResumptionQueueAdapter(
  cwd = process.cwd()
): WorkResumptionQueueAdapter {
  return {
    async writeHeartbeat(input) {
      await writeCompanionHeartbeat(
        cwd,
        new Date(input.observedAt),
        input.instanceId
      );
    },

    async clearHeartbeat(input) {
      await clearCompanionHeartbeat(cwd, input.instanceId);
    },

    async claimNext(input) {
      const command = await claimNextPendingCommand(
        cwd,
        new Date(input.claimedAt)
      );
      if (
        !command ||
        command.status !== "claimed" ||
        !command.claimToken
      ) {
        return null;
      }
      return {
        commandId: command.commandId,
        claimToken: command.claimToken,
        bindingId: command.bindingId,
        operation: command.operation,
        executionId: command.executionId,
        scopeId: command.scopeId,
        createdAt: command.createdAt,
        expiresAt: command.expiresAt
      };
    },

    async isClaimCurrent(input) {
      return isClaimedCommandCurrent(input, cwd);
    },

    async complete(input) {
      const completion = toStoreCompletion(
        input.commandId,
        input.claimToken,
        input.completedAt,
        input.completion
      );
      try {
        await completeClaimedCommand(completion, cwd);
      } catch (error) {
        if (
          error instanceof WorkResumptionStoreError &&
          (error.code === "COMMAND_NOT_FOUND" ||
            error.code === "COMMAND_CLAIM_MISMATCH")
        ) {
          // Disconnect or unbind won the race after the final current-claim
          // check. The action is not recreated and the daemon stays alive.
          return;
        }
        throw error;
      }
    },

    async launchIfCurrent(input, launch) {
      const result = await runClaimedCommandWithLaunchLease(
        input,
        async () => {
          const launched = await launch();
          return toStoreCompletion(
            input.commandId,
            input.claimToken,
            launched.completedAt,
            launched.completion
          );
        },
        cwd
      );
      if (result.state === "not_current") return result;
      if (result.state === "expired") {
        return {
          state: "expired",
          resultCode: "COMMAND_EXPIRED"
        };
      }
      return {
        state: "completed",
        resultCode:
          result.command.resultCode ?? "LAUNCH_FAILED"
      };
    }
  };
}

function toStoreCompletion(
  commandId: string,
  claimToken: string,
  completedAt: string,
  completion: CompanionCommandCompletion
): CompleteClaimedCommandInput {
  if (completion.status === "expired") {
    return {
      commandId,
      claimToken,
      outcome: "expired",
      resultCode: "COMMAND_EXPIRED",
      completedAt
    };
  }
  if (completion.status === "succeeded") {
    if (
      completion.resultCode !== "FOCUSED_EXISTING" &&
      completion.resultCode !== "RESUMED_IN_TERMINAL"
    ) {
      throw new Error("Invalid successful Companion result.");
    }
    return {
      commandId,
      claimToken,
      outcome: "completed",
      resultCode: completion.resultCode,
      completedAt
    };
  }
  if (
    completion.resultCode === "FOCUSED_EXISTING" ||
    completion.resultCode === "RESUMED_IN_TERMINAL" ||
    completion.resultCode === "COMMAND_EXPIRED"
  ) {
    throw new Error("Invalid failed Companion result.");
  }
  return {
    commandId,
    claimToken,
    outcome: "failed",
    resultCode: completion.resultCode,
    completedAt
  };
}
