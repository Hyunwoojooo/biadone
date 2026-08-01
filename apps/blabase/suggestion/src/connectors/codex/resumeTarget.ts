import {
  createHmac,
  timingSafeEqual
} from "node:crypto";
import { isAbsolute } from "node:path";

import { z } from "zod";

import {
  CODEX_LOOKBACK_DAYS,
  CODEX_THREAD_LIMIT
} from "./config";
import {
  queryCodexThreadsViaAppServer,
  type CodexThreadQuery
} from "./appServer";
import { readStoredCodexConfig } from "./localStore";
import type { StoredCodexConfig } from "./types";

const opaqueIdSchema = z.string().regex(/^[a-f0-9]{24}$/);
const executionReferenceSchema = z.union([
  opaqueIdSchema,
  z.string().regex(/^codex:execution:[a-f0-9]{24}$/)
]);
const nativeThreadIdSchema = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const threadListSchema = z
  .object({
    data: z.array(z.unknown())
  })
  .strip();
const threadSchema = z
  .object({
    id: z.string().min(1).max(512),
    cwd: z.string().nullable().optional(),
    createdAt: z.number().finite(),
    updatedAt: z.number().finite().nullable().optional()
  })
  .strip();

export type CodexResumeTarget = {
  nativeThreadId: string;
  cwd: string;
};

export type CodexResumeTargetErrorCode =
  | "CODEX_CONFIG_MISSING"
  | "CODEX_SCOPE_NOT_SELECTED"
  | "CODEX_EXECUTION_NOT_FOUND"
  | "CODEX_EXECUTION_STALE"
  | "CODEX_RESUME_TARGET_INVALID";

export class CodexResumeTargetError extends Error {
  constructor(
    public readonly code: CodexResumeTargetErrorCode,
    message: string
  ) {
    super(message);
    this.name = "CodexResumeTargetError";
  }
}

export type ResolveCodexResumeTargetOptions = {
  cwd?: string;
  now?: Date;
  queryThreads?: CodexThreadQuery;
  readConfig?: (
    cwd: string
  ) => Promise<StoredCodexConfig | null>;
};

/**
 * Resolves an opaque Codex execution reference only at the moment a local
 * resume action is handled. The native thread id and cwd are returned in
 * memory and must never be persisted or logged by callers.
 */
export async function resolveCodexResumeTarget(
  input: {
    executionId: string;
    scopeId: string;
  },
  options: ResolveCodexResumeTargetOptions = {}
): Promise<CodexResumeTarget> {
  const parsedExecutionId = executionReferenceSchema.safeParse(
    input.executionId
  );
  const parsedScopeId = opaqueIdSchema.safeParse(input.scopeId);
  if (!parsedExecutionId.success || !parsedScopeId.success) {
    throw new CodexResumeTargetError(
      "CODEX_RESUME_TARGET_INVALID",
      "Codex 작업 참조 형식이 올바르지 않습니다."
    );
  }

  const opaqueExecutionId = parsedExecutionId.data.startsWith(
    "codex:execution:"
  )
    ? parsedExecutionId.data.slice("codex:execution:".length)
    : parsedExecutionId.data;
  const cwd = options.cwd ?? process.cwd();
  const config = await (
    options.readConfig ?? readStoredCodexConfig
  )(cwd);
  if (!config) {
    throw new CodexResumeTargetError(
      "CODEX_CONFIG_MISSING",
      "Codex 연결 설정을 확인할 수 없습니다."
    );
  }

  const selectedIds = new Set(config.selectedScopeIds);
  const scope = config.scopes.find(
    (candidate) =>
      candidate.id === parsedScopeId.data &&
      selectedIds.has(candidate.id)
  );
  if (!scope) {
    throw new CodexResumeTargetError(
      "CODEX_SCOPE_NOT_SELECTED",
      "이 Codex 프로젝트 범위는 현재 선택되어 있지 않습니다."
    );
  }
  const selectedScopePath = normalizeAbsolutePath(
    scope.queryPath
  );
  if (!selectedScopePath) {
    throw new CodexResumeTargetError(
      "CODEX_RESUME_TARGET_INVALID",
      "Codex 프로젝트 경로를 안전하게 사용할 수 없습니다."
    );
  }

  const queryThreads =
    options.queryThreads ?? queryCodexThreadsViaAppServer;
  const response: Awaited<ReturnType<CodexThreadQuery>> =
    await queryThreads({
      cursor: null,
      limit: CODEX_THREAD_LIMIT,
      sortKey: "updated_at",
      sortDirection: "desc",
      sourceKinds: ["cli", "vscode", "appServer", "exec"],
      useStateDbOnly: true,
      cwd: [selectedScopePath]
    });

  const list = threadListSchema.safeParse(response.result);
  if (!list.success) {
    throw new CodexResumeTargetError(
      "CODEX_RESUME_TARGET_INVALID",
      "Codex 세션 목록 응답을 확인할 수 없습니다."
    );
  }

  const now = options.now ?? new Date();
  const staleBefore =
    now.getTime() -
    CODEX_LOOKBACK_DAYS * 24 * 60 * 60 * 1_000;

  for (const candidate of list.data.data) {
    const parsed = threadSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const threadCwd = normalizeAbsolutePath(parsed.data.cwd);
    if (!threadCwd || threadCwd !== selectedScopePath) {
      continue;
    }

    const currentOpaqueId = opaqueThreadId(
      config.installationSecret,
      parsed.data.id
    );
    if (
      !sameOpaqueId(
        opaqueExecutionId,
        currentOpaqueId
      )
    ) {
      continue;
    }

    const nativeThreadId = nativeThreadIdSchema.safeParse(
      parsed.data.id
    );
    if (!nativeThreadId.success) {
      throw new CodexResumeTargetError(
        "CODEX_RESUME_TARGET_INVALID",
        "Codex 세션 식별자를 안전하게 사용할 수 없습니다."
      );
    }

    const updatedAtSeconds =
      parsed.data.updatedAt ?? parsed.data.createdAt;
    const updatedAtMs = updatedAtSeconds * 1_000;
    if (
      !Number.isFinite(updatedAtMs) ||
      updatedAtMs < staleBefore
    ) {
      throw new CodexResumeTargetError(
        "CODEX_EXECUTION_STALE",
        "Codex 세션이 다시 확인해야 하는 오래된 상태입니다."
      );
    }

    return {
      nativeThreadId: nativeThreadId.data,
      cwd: threadCwd
    };
  }

  throw new CodexResumeTargetError(
    "CODEX_EXECUTION_NOT_FOUND",
    "현재 선택한 범위에서 Codex 세션을 찾지 못했습니다."
  );
}

function opaqueThreadId(
  installationSecret: string,
  nativeThreadId: string
): string {
  return createHmac("sha256", installationSecret)
    .update(`thread:${nativeThreadId}`)
    .digest("hex")
    .slice(0, 24);
}

function sameOpaqueId(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function normalizeAbsolutePath(
  value: string | null | undefined
): string | null {
  const trimmed = value?.trim();
  if (
    !trimmed ||
    !isAbsolute(trimmed) ||
    /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(
      trimmed
    )
  ) {
    return null;
  }
  return trimmed.replace(/\/+$/, "") || "/";
}
