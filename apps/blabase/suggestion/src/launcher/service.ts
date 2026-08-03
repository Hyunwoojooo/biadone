import { isAbsolute } from "node:path";

import {
  resolveAttentionCodeProvenance,
  unavailableCodeProvenance,
  type AttentionCodeProvenance
} from "../attention/codeProvenance";
import {
  createAttentionExecutionIds,
  createAttentionFailureRecord,
  type AttentionExecutionIds,
  type AttentionFailureStage
} from "../attention/execution";
import { evaluateCurrentAttention } from "../attention/liveAttention";
import {
  recordAttentionFailure,
  recordAttentionRun
} from "../attention/localMonitorStore";
import type {
  AttentionMonitorRun,
  AttentionReplayInputArtifact
} from "../attention/monitoringSchema";
import type { ActiveAttentionResult } from "../attentionDecision";
import type { Phase2AttentionResult } from "../crossSource/attentionSchema";
import {
  openWorkSession,
  readWorkResumptionCommandStatus,
  readWorkResumptionStatus,
  WorkResumptionStoreError,
  type PublicWorkResumptionCommandStatus,
  type WorkResumptionStatus
} from "../resumption";
import { syncRuntimeSources } from "../sync/runtime";
import {
  LAUNCHER_EXECUTION_CONTRACT,
  launcherExecutionProjectionSchema,
  type LauncherAttentionProjection,
  type LauncherExecutionProjection,
  type LauncherIpcRequest
} from "./contracts";
import {
  buildLauncherAttentionView,
  type LauncherExecutionGuard
} from "./projection";

export type LauncherAttentionEvaluation = {
  result: ActiveAttentionResult;
  baseResult: Phase2AttentionResult;
  run: AttentionMonitorRun;
  replayArtifact: AttentionReplayInputArtifact;
};

export const MAX_LAUNCHER_RECOMMENDATION_AGE_MS =
  5 * 60 * 1_000;

export type LauncherSourceMode = "managed" | "read_only";

export function resolveLauncherSourceMode(
  env: NodeJS.ProcessEnv
): LauncherSourceMode {
  const value = env.BLABASE_LAUNCHER_SOURCE_MODE;
  if (value === undefined || value === "managed") return "managed";
  return "read_only";
}

export type LauncherServiceDependencies = {
  syncSources: typeof syncRuntimeSources;
  evaluateAttention: (
    input: Parameters<typeof evaluateCurrentAttention>[0]
  ) => Promise<LauncherAttentionEvaluation>;
  readResumptionStatus: typeof readWorkResumptionStatus;
  openSession: typeof openWorkSession;
  readCommandStatus: typeof readWorkResumptionCommandStatus;
  createExecutionIds: () => AttentionExecutionIds;
  resolveCodeProvenance: (
    cwd: string,
    env: NodeJS.ProcessEnv
  ) => Promise<AttentionCodeProvenance>;
  recordRun: typeof recordAttentionRun;
  recordFailure: typeof recordAttentionFailure;
  now: () => Date;
  warn: (code: string) => void;
};

const defaultDependencies: LauncherServiceDependencies = {
  syncSources: syncRuntimeSources,
  evaluateAttention: evaluateCurrentAttention,
  readResumptionStatus: readWorkResumptionStatus,
  openSession: openWorkSession,
  readCommandStatus: readWorkResumptionCommandStatus,
  createExecutionIds: createAttentionExecutionIds,
  resolveCodeProvenance: resolveAttentionCodeProvenance,
  recordRun: recordAttentionRun,
  recordFailure: recordAttentionFailure,
  now: () => new Date(),
  warn: () => undefined
};

type CachedRecommendation = {
  resultId: string;
  candidateId: string;
  asOf: string;
  executionGuard: LauncherExecutionGuard;
};

export class LauncherService {
  private readonly recommendations = new Map<
    string,
    CachedRecommendation
  >();
  private readonly executionCommands = new Map<string, string>();
  private readonly dependencies: LauncherServiceDependencies;

  constructor(
    private readonly dataRoot: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
    dependencies: Partial<LauncherServiceDependencies> = {}
  ) {
    if (!isAbsolute(dataRoot)) {
      throw new TypeError("Launcher data root must be absolute.");
    }
    this.dependencies = {
      ...defaultDependencies,
      ...dependencies
    };
  }

  async handle(
    request: LauncherIpcRequest
  ): Promise<
    LauncherAttentionProjection | LauncherExecutionProjection
  > {
    switch (request.method) {
      case "attention.get":
        return this.getAttention(request.params.refresh);
      case "attention.execute":
        return this.executeAttention(request.params);
      case "command.get":
        return this.getCommand(request.params.commandId);
    }
  }

  private async getAttention(
    refresh: boolean
  ): Promise<LauncherAttentionProjection> {
    const evaluated = await this.evaluate(refresh);
    let resumption: WorkResumptionStatus;
    try {
      resumption = await this.dependencies.readResumptionStatus(
        this.dataRoot,
        this.dependencies.now()
      );
    } catch {
      throw new LauncherServiceError(
        "WORK_RESUMPTION_READ_FAILED",
        "Codex 작업 이어가기 상태를 확인하지 못했습니다."
      );
    }
    const view = buildLauncherAttentionView({
      result: evaluated.result,
      baseResult: evaluated.baseResult,
      run: evaluated.run,
      resumption
    });
    const candidateId = view.projection.card?.candidateId;
    if (candidateId) {
      this.remember({
        resultId: view.projection.resultId,
        candidateId,
        asOf: view.projection.asOf,
        executionGuard: view.executionGuard
      });
    }
    return view.projection;
  }

  private async executeAttention(input: {
    resultId: string;
    candidateId: string;
    explicitUserAction: true;
  }): Promise<LauncherExecutionProjection> {
    const cached = this.recommendations.get(input.resultId);
    if (!cached || cached.candidateId !== input.candidateId) {
      throw staleRecommendation();
    }
    if (isStaleRecommendation(cached.asOf, this.dependencies.now())) {
      this.recommendations.delete(input.resultId);
      throw staleRecommendation();
    }
    if (cached.executionGuard.kind !== "focus_or_resume") {
      throw new LauncherServiceError(
        "ACTION_NOT_AVAILABLE",
        "이 제안은 GitHub에서 직접 열어야 합니다."
      );
    }
    if (
      cached.executionGuard.expectedBindingId === null ||
      cached.executionGuard.expectedExecutionId === null
    ) {
      throw new LauncherServiceError(
        "BINDING_IDENTITY_CHANGED",
        "추천에 사용된 Codex 세션 연결을 다시 확인해주세요."
      );
    }
    const executionKey = launcherExecutionKey(
      input.resultId,
      input.candidateId
    );
    const existingCommandId = this.executionCommands.get(
      executionKey
    );
    if (existingCommandId) {
      return this.getCommand(existingCommandId);
    }

    let evaluated: LauncherAttentionEvaluation;
    try {
      const codeProvenance = await this.resolveCodeProvenance();
      evaluated = await this.dependencies.evaluateAttention({
        cwd: this.dataRoot,
        env: this.env,
        now: new Date(cached.asOf),
        refreshSources: false,
        codeProvenance
      });
    } catch {
      throw staleRecommendation();
    }
    const suggestion = evaluated.result.decision.topSuggestion;
    if (
      evaluated.result.resultId !== input.resultId ||
      evaluated.result.decision.status !== "suggested" ||
      suggestion?.candidateId !== input.candidateId
    ) {
      throw staleRecommendation();
    }

    let resumption: WorkResumptionStatus;
    try {
      resumption = await this.dependencies.readResumptionStatus(
        this.dataRoot,
        this.dependencies.now()
      );
    } catch {
      throw new LauncherServiceError(
        "WORK_RESUMPTION_READ_FAILED",
        "Codex 작업 이어가기 상태를 확인하지 못했습니다."
      );
    }
    const currentView = buildLauncherAttentionView({
      result: evaluated.result,
      baseResult: evaluated.baseResult,
      run: evaluated.run,
      resumption
    });
    const currentGuard = currentView.executionGuard;
    if (
      currentGuard.kind !== "focus_or_resume" ||
      currentGuard.expectedBindingId !==
        cached.executionGuard.expectedBindingId ||
      currentGuard.expectedExecutionId !==
        cached.executionGuard.expectedExecutionId
    ) {
      throw new LauncherServiceError(
        "BINDING_IDENTITY_CHANGED",
        "추천에 사용된 Codex 세션 연결이 변경되었습니다."
      );
    }
    if (!currentGuard.enabled) {
      throw new LauncherServiceError(
        "COMPANION_OFFLINE",
        "Local Companion이 오프라인입니다."
      );
    }

    const taskRef = {
      kind: "attention_subject" as const,
      source: "github" as const,
      subjectId: suggestion.githubSubjectId,
      displayTitle: suggestion.title
    };
    try {
      const command = await this.dependencies.openSession(
        {
          taskRef,
          explicitUserAction: input.explicitUserAction,
          expectedBindingId: currentGuard.expectedBindingId,
          expectedExecutionId: currentGuard.expectedExecutionId
        },
        this.dataRoot,
        this.dependencies.now()
      );
      this.rememberExecution(executionKey, command.commandId);
      return executionProjection(command);
    } catch (error) {
      throw mapWorkResumptionError(error);
    }
  }

  private async getCommand(
    commandId: string
  ): Promise<LauncherExecutionProjection> {
    let command: PublicWorkResumptionCommandStatus | null;
    try {
      command = await this.dependencies.readCommandStatus(
        commandId,
        this.dataRoot,
        this.dependencies.now()
      );
    } catch (error) {
      throw mapWorkResumptionError(error);
    }
    if (!command) {
      throw new LauncherServiceError(
        "COMMAND_NOT_FOUND",
        "작업 열기 요청을 찾지 못했습니다."
      );
    }
    return executionProjection(command);
  }

  private async evaluate(
    refresh: boolean
  ): Promise<LauncherAttentionEvaluation> {
    if (
      !refresh ||
      resolveLauncherSourceMode(this.env) === "read_only"
    ) {
      try {
        const codeProvenance = await this.resolveCodeProvenance();
        return await this.dependencies.evaluateAttention({
          cwd: this.dataRoot,
          env: this.env,
          now: this.dependencies.now(),
          refreshSources: false,
          codeProvenance
        });
      } catch {
        throw new LauncherServiceError(
          "ATTENTION_RUN_FAILED",
          "현재 작업 제안을 만들지 못했습니다."
        );
      }
    }

    const startedAt = this.dependencies.now();
    const executionIds = this.dependencies.createExecutionIds();
    let stage: AttentionFailureStage = "source_sync";
    let codeProvenance = unavailableCodeProvenance();
    try {
      codeProvenance = await this.resolveCodeProvenance();
      await this.dependencies.syncSources({
        cwd: this.dataRoot,
        env: this.env
      });
      stage = "attention_resolution";
      const evaluated = await this.dependencies.evaluateAttention({
        cwd: this.dataRoot,
        env: this.env,
        now: this.dependencies.now(),
        startedAt,
        refreshSources: false,
        executionIds,
        codeProvenance
      });
      try {
        await this.dependencies.recordRun(
          evaluated.run,
          evaluated.replayArtifact,
          this.dataRoot,
          new Date(evaluated.run.completedAt)
        );
      } catch {
        this.dependencies.warn("RUN_HISTORY_WRITE_FAILED");
      }
      return evaluated;
    } catch {
      const completedAt = new Date(
        Math.max(startedAt.getTime(), this.dependencies.now().getTime())
      );
      try {
        await this.dependencies.recordFailure(
          createAttentionFailureRecord({
            executionIds,
            startedAt,
            completedAt,
            stage,
            retryCount: 0,
            codeProvenance
          }),
          this.dataRoot,
          completedAt
        );
      } catch {
        this.dependencies.warn("RUN_FAILURE_HISTORY_WRITE_FAILED");
      }
      throw new LauncherServiceError(
        "ATTENTION_RUN_FAILED",
        "현재 작업 제안을 만들지 못했습니다."
      );
    }
  }

  private async resolveCodeProvenance(): Promise<AttentionCodeProvenance> {
    try {
      return await this.dependencies.resolveCodeProvenance(
        this.dataRoot,
        this.env
      );
    } catch {
      return unavailableCodeProvenance();
    }
  }

  private remember(recommendation: CachedRecommendation): void {
    this.recommendations.delete(recommendation.resultId);
    this.recommendations.set(recommendation.resultId, recommendation);
    while (this.recommendations.size > 32) {
      const oldest = this.recommendations.keys().next().value;
      if (typeof oldest !== "string") break;
      this.recommendations.delete(oldest);
    }
  }

  private rememberExecution(key: string, commandId: string): void {
    this.executionCommands.delete(key);
    this.executionCommands.set(key, commandId);
    while (this.executionCommands.size > 32) {
      const oldest = this.executionCommands.keys().next().value;
      if (typeof oldest !== "string") break;
      this.executionCommands.delete(oldest);
    }
  }
}

export class LauncherServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "LauncherServiceError";
  }
}

function staleRecommendation(): LauncherServiceError {
  return new LauncherServiceError(
    "STALE_RECOMMENDATION",
    "작업 제안이 변경되었습니다. 다시 확인해주세요."
  );
}

function isStaleRecommendation(asOf: string, now: Date): boolean {
  const createdAt = Date.parse(asOf);
  const currentTime = now.getTime();
  if (!Number.isFinite(createdAt) || !Number.isFinite(currentTime)) {
    return true;
  }
  const age = currentTime - createdAt;
  return age < 0 || age > MAX_LAUNCHER_RECOMMENDATION_AGE_MS;
}

function launcherExecutionKey(
  resultId: string,
  candidateId: string
): string {
  return `${resultId}:${candidateId}`;
}

function executionProjection(
  command: PublicWorkResumptionCommandStatus
): LauncherExecutionProjection {
  return launcherExecutionProjectionSchema.parse({
    contract: LAUNCHER_EXECUTION_CONTRACT,
    kind: "focus_or_resume",
    commandId: command.commandId,
    status: command.status
  });
}

function mapWorkResumptionError(error: unknown): LauncherServiceError {
  if (error instanceof WorkResumptionStoreError) {
    switch (error.code) {
      case "BINDING_NOT_FOUND":
      case "BINDING_IDENTITY_CHANGED":
      case "COMPANION_OFFLINE":
      case "COMMAND_NOT_FOUND":
      case "CODEX_EXECUTION_NOT_FOUND":
      case "CODEX_CONNECTION_UNAVAILABLE":
        return new LauncherServiceError(
          error.code,
          workResumptionMessage(error.code)
        );
      default:
        break;
    }
  }
  return new LauncherServiceError(
    "WORK_RESUMPTION_FAILED",
    "Codex 작업을 열지 못했습니다."
  );
}

function workResumptionMessage(code: string): string {
  switch (code) {
    case "BINDING_NOT_FOUND":
      return "이 작업에 연결된 Codex 세션이 없습니다.";
    case "BINDING_IDENTITY_CHANGED":
      return "추천에 사용된 Codex 세션 연결이 변경되었습니다.";
    case "COMPANION_OFFLINE":
      return "Local Companion이 오프라인입니다.";
    case "COMMAND_NOT_FOUND":
      return "작업 열기 요청을 찾지 못했습니다.";
    case "CODEX_EXECUTION_NOT_FOUND":
      return "연결된 Codex 세션을 찾지 못했습니다.";
    case "CODEX_CONNECTION_UNAVAILABLE":
      return "Codex 연결 상태가 변경되었습니다.";
    default:
      return "Codex 작업을 열지 못했습니다.";
  }
}
