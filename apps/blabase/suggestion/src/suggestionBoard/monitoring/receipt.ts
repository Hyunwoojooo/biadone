import { createHmac, timingSafeEqual } from "node:crypto";

import {
  runtimeCanonicalJson
} from "../../crossSource/canonicalHash";
import type { AttentionSourceMonitor } from "../../attention/monitoringSchema";
import type { SemanticContinuationWorkBoardResponse } from "../../semanticContinuation/contracts";
import {
  workBoardMonitoringReceiptPayloadSchema,
  type WorkBoardMonitoringReceiptPayload
} from "./contracts";
import {
  WORK_BOARD_MONITORING_MAX_RECEIPT_HEADER_BYTES,
  WORK_BOARD_MONITORING_RECEIPT_CONTRACT,
  WORK_BOARD_MONITORING_RECEIPT_POLICY_VERSION,
  WORK_BOARD_MONITORING_RECEIPT_TTL_MS,
  WORK_BOARD_MONITORING_SCHEMA_VERSION,
  WORK_BOARD_MONITORING_SURFACE
} from "./versions";

const INSTALLATION_SECRET_PATTERN = /^[a-f0-9]{64}$/u;
const RECEIPT_PATTERN = /^wbm1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/u;
const HMAC_REF_PREFIX = "work_board_monitor_";

export type WorkBoardMonitoringReceiptAuthority = {
  installationSecret: string;
  response: SemanticContinuationWorkBoardResponse;
  sources: readonly [AttentionSourceMonitor, AttentionSourceMonitor];
  /** Values are HMAC input only and are never copied into the receipt. */
  privateProvenance: {
    registrySha256: string | null;
    codeCommitSha: string | null;
    codeState: string;
    codeFingerprintSha256: string | null;
    boardResultSha256: string | null;
    continuationResultSha256: string | null;
  };
};

export type CreatedWorkBoardMonitoringReceipt = {
  headerValue: string;
  payload: WorkBoardMonitoringReceiptPayload;
};

export function workBoardMonitoringAuthKeyId(
  installationSecret: string
): string {
  return `work_board_monitor_key_${hmacHex(
    installationSecret,
    "work-board-monitoring-auth-key-id-v0.1",
    { contract: WORK_BOARD_MONITORING_RECEIPT_CONTRACT }
  ).slice(0, 32)}`;
}

export function createWorkBoardMonitoringReceipt(input: {
  authority: WorkBoardMonitoringReceiptAuthority;
  issuedAt?: Date;
}): CreatedWorkBoardMonitoringReceipt | null {
  const { authority } = input;
  assertInstallationSecret(authority.installationSecret);
  if (
    authority.response.base.status !== "ready" ||
    authority.response.contract !==
      "semantic-continuation-work-board-response-v0.2"
  ) {
    return null;
  }
  const readyBase = authority.response.base;
  const issuedAt = new Date(input.issuedAt?.getTime() ?? Date.now());
  if (!Number.isFinite(issuedAt.getTime())) {
    throw new TypeError("Work Board monitoring receipt time is invalid");
  }
  const entries = orderedEntries(authority.response);
  const visibilityExpiries = entries
    .filter((entry) => entry.lane !== "attention")
    .map((entry) => Date.parse(entry.item.expiresAt!));
  const expiresAtMs = Math.min(
    issuedAt.getTime() + WORK_BOARD_MONITORING_RECEIPT_TTL_MS,
    ...visibilityExpiries
  );
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= issuedAt.getTime()) {
    return null;
  }

  const responseDigestHmac = digestRef(
    authority.installationSecret,
    "work-board-monitoring-response-v0.1",
    authority.response
  );
  const captureId = `work_board_capture_${hmacHex(
    authority.installationSecret,
    "work-board-monitoring-capture-id-v0.1",
    {
      issuedAt: issuedAt.toISOString(),
      generatedAt: readyBase.board.generatedAt,
      responseDigestHmac
    }
  ).slice(0, 32)}`;
  const overlayTitles = semanticOverlayTitles(authority.response);
  const items = entries.map((entry, ordinal) => {
    const effectiveTitle =
      entry.lane === "continuation"
        ? (overlayTitles.get(entry.item.itemRef) ?? entry.item.title)
        : entry.item.title;
    const position =
      ordinal === 0
        ? ("primary" as const)
        : (`alternative_${ordinal}` as const);
    const presentationExpiresAt =
      entry.lane === "attention" ? null : entry.item.expiresAt;
    const copyDigestHmac = digestRef(
      authority.installationSecret,
      "work-board-monitoring-copy-digest-v0.1",
      { title: effectiveTitle, summary: entry.item.summary }
    );
    const presentationTargetHmac = digestRef(
      authority.installationSecret,
      "work-board-monitoring-presentation-target-v0.1",
      {
        itemRef: entry.item.itemRef,
        lane: entry.lane,
        position,
        kind: entry.item.kind,
        evidenceBand: entry.item.evidenceBand,
        caveatCodes: entry.item.caveatCodes,
        mode: readyBase.mode,
        expiresAt: presentationExpiresAt,
        copyDigestHmac
      }
    );
    return {
      ordinal,
      ordinalHandleHmac: digestRef(
        authority.installationSecret,
        "work-board-monitoring-ordinal-handle-v0.1",
        { captureId, ordinal, presentationTargetHmac }
      ),
      presentationTargetHmac,
      privateProvenanceHmac: digestRef(
        authority.installationSecret,
        "work-board-monitoring-item-provenance-v0.1",
        {
          itemRef: entry.item.itemRef,
          workContextRef: entry.item.workContextRef
        }
      ),
      lane: entry.lane,
      position,
      kind: entry.item.kind,
      evidenceBand: entry.item.evidenceBand,
      caveatCodes: entry.item.caveatCodes,
      copyDigestHmac,
      expiresAt: presentationExpiresAt
    };
  });
  const payload = workBoardMonitoringReceiptPayloadSchema.parse({
    contract: WORK_BOARD_MONITORING_RECEIPT_CONTRACT,
    schemaVersion: WORK_BOARD_MONITORING_SCHEMA_VERSION,
    receiptPolicyVersion:
      WORK_BOARD_MONITORING_RECEIPT_POLICY_VERSION,
    surface: WORK_BOARD_MONITORING_SURFACE,
    authKeyId: workBoardMonitoringAuthKeyId(
      authority.installationSecret
    ),
    captureId,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    generatedAt: readyBase.board.generatedAt,
    mode: readyBase.mode,
    fallbackReasonCode: readyBase.reasonCode,
    continuationStatus:
      readyBase.board.continuationStatus,
    responseDigestHmac,
    privateProvenanceHmac: digestRef(
      authority.installationSecret,
      "work-board-monitoring-private-provenance-v0.1",
      authority.privateProvenance
    ),
    sources: authority.sources.map((source) => ({
      source: source.source,
      state: source.inputState,
      reasonCode: source.unavailableReason,
      version: source.normalizerVersion,
      stateDigestHmac: digestRef(
        authority.installationSecret,
        "work-board-monitoring-source-state-v0.1",
        source
      )
    })),
    items
  });
  const encodedPayload = Buffer.from(
    runtimeCanonicalJson(payload),
    "utf8"
  ).toString("base64url");
  const signature = hmacBuffer(
    authority.installationSecret,
    "work-board-monitoring-receipt-signature-v0.1",
    encodedPayload
  ).toString("base64url");
  const headerValue = `wbm1.${encodedPayload}.${signature}`;
  if (
    Buffer.byteLength(headerValue, "ascii") >
    WORK_BOARD_MONITORING_MAX_RECEIPT_HEADER_BYTES
  ) {
    return null;
  }
  return { headerValue, payload };
}

export function verifyWorkBoardMonitoringReceipt(input: {
  receipt: string;
  installationSecret: string;
  now?: Date;
}): WorkBoardMonitoringReceiptPayload | null {
  try {
    assertInstallationSecret(input.installationSecret);
    if (
      Buffer.byteLength(input.receipt, "ascii") >
      WORK_BOARD_MONITORING_MAX_RECEIPT_HEADER_BYTES
    ) {
      return null;
    }
    const match = RECEIPT_PATTERN.exec(input.receipt);
    if (match === null) return null;
    const [, encodedPayload, encodedSignature] = match;
    const expected = hmacBuffer(
      input.installationSecret,
      "work-board-monitoring-receipt-signature-v0.1",
      encodedPayload
    );
    const actual = Buffer.from(encodedSignature, "base64url");
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      return null;
    }
    const payload = workBoardMonitoringReceiptPayloadSchema.parse(
      JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"))
    );
    const now = new Date(input.now?.getTime() ?? Date.now());
    if (
      !Number.isFinite(now.getTime()) ||
      payload.authKeyId !==
        workBoardMonitoringAuthKeyId(input.installationSecret) ||
      now.getTime() < Date.parse(payload.issuedAt) ||
      now.getTime() >= Date.parse(payload.expiresAt)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function workBoardMonitoringReceiptDigestHmac(input: {
  receipt: string;
  installationSecret: string;
}): string {
  return digestRef(
    input.installationSecret,
    "work-board-monitoring-receipt-storage-digest-v0.1",
    input.receipt
  );
}

function orderedEntries(
  response: SemanticContinuationWorkBoardResponse
) {
  if (response.base.status !== "ready") return [];
  return [
    ...(response.base.board.primary === null
      ? []
      : [response.base.board.primary]),
    ...response.base.board.alternatives
  ];
}

function semanticOverlayTitles(
  response: SemanticContinuationWorkBoardResponse
): Map<string, string> {
  return new Map(
    response.semanticPresentation?.overlays.map((overlay) => [
      overlay.itemRef,
      overlay.displayTitle
    ]) ?? []
  );
}

function digestRef(
  installationSecret: string,
  domain: string,
  value: unknown
): string {
  return `${HMAC_REF_PREFIX}${hmacHex(
    installationSecret,
    domain,
    value
  )}`;
}

function hmacHex(
  installationSecret: string,
  domain: string,
  value: unknown
): string {
  return hmacBuffer(
    installationSecret,
    domain,
    runtimeCanonicalJson(value)
  ).toString("hex");
}

function hmacBuffer(
  installationSecret: string,
  domain: string,
  value: string
): Buffer {
  assertInstallationSecret(installationSecret);
  return createHmac(
    "sha256",
    createHmac(
      "sha256",
      Buffer.from(installationSecret, "hex")
    )
      .update(domain, "utf8")
      .digest()
  )
    .update(value, "utf8")
    .digest();
}

function assertInstallationSecret(value: string): void {
  if (!INSTALLATION_SECRET_PATTERN.test(value)) {
    throw new TypeError("Work Board monitoring installation secret is invalid");
  }
}
