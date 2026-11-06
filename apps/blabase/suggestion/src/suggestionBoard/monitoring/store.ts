import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  constants as fsConstants,
  type Dirent,
  type Stats
} from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rmdir,
  unlink,
  type FileHandle
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import {
  inspectLocalPrivateDirectoryChain,
  readLocalPrivateText
} from "../../localReadMode";
import {
  runtimeCanonicalJson,
  runtimeSha256
} from "../../crossSource/canonicalHash";
import {
  WORK_BOARD_MONITORING_REVIEW_FIELDS,
  workBoardMonitoringEventContentSchema,
  workBoardMonitoringEventSchema,
  workBoardMonitoringMutationResponseSchema,
  workBoardMonitoringStateResponseSchema,
  workBoardMonitoringStoreSchema,
  type WorkBoardMonitoringEvent,
  type WorkBoardMonitoringEventContent,
  type WorkBoardMonitoringMutationInput,
  type WorkBoardMonitoringReceiptPayload,
  type WorkBoardMonitoringStore,
  type WorkBoardMonitoringStoreContent
} from "./contracts";
import {
  deriveWorkBoardMonitoringQuality,
  workBoardMonitoringConsent,
  workBoardMonitoringHistory
} from "./quality";
import {
  verifyWorkBoardMonitoringReceipt,
  workBoardMonitoringAuthKeyId,
  workBoardMonitoringReceiptDigestHmac
} from "./receipt";
import {
  WORK_BOARD_MONITORING_API_CONTRACT,
  WORK_BOARD_MONITORING_CONSENT_POLICY_VERSION,
  WORK_BOARD_MONITORING_EVENT_CONTRACT,
  WORK_BOARD_MONITORING_EVENT_RESERVE,
  WORK_BOARD_MONITORING_IDEMPOTENCY_POLICY_VERSION,
  WORK_BOARD_MONITORING_MAX_EVENTS,
  WORK_BOARD_MONITORING_MAX_HISTORY,
  WORK_BOARD_MONITORING_RETENTION_MS,
  WORK_BOARD_MONITORING_RETENTION_POLICY_VERSION,
  WORK_BOARD_MONITORING_SCHEMA_VERSION,
  WORK_BOARD_MONITORING_STORE_CONTRACT,
  WORK_BOARD_MONITORING_SURFACE
} from "./versions";

const STORE_FILENAME = "events.json";
const LOCKS_DIRECTORY = "locks";
const LOCK_FILENAME = "state.lock";
const LOCK_WAIT_ATTEMPTS = 500;
const LOCK_WAIT_MS = 10;
const TEMP_PATTERN = /^events\.json\.[a-f0-9]{32}\.tmp$/u;
const AUTH_DIRECTORY_PATTERN = /^work_board_monitor_key_[a-f0-9]{32}$/u;

export class WorkBoardMonitoringStoreError extends Error {
  constructor(
    public readonly code:
      | "CONSENT_REQUIRED"
      | "RECEIPT_NOT_CURRENT"
      | "STORE_UNAVAILABLE"
  ) {
    super(code);
    this.name = "WorkBoardMonitoringStoreError";
  }
}

export type WorkBoardMonitoringStoreReadResult =
  | { status: "available"; value: WorkBoardMonitoringStore }
  | { status: "missing" }
  | { status: "invalid" };

export function workBoardMonitoringLocalRoot(
  cwd = process.cwd()
): string {
  return join(cwd, ".local", "work-board-monitoring");
}

export function workBoardMonitoringLocalDirectory(
  cwd: string,
  installationSecret: string
): string {
  return join(
    workBoardMonitoringLocalRoot(cwd),
    workBoardMonitoringAuthKeyId(installationSecret)
  );
}

/** Pure authenticated read. It never compacts, repairs or creates state. */
export async function readWorkBoardMonitoringStore(input: {
  cwd?: string;
  installationSecret: string;
}): Promise<WorkBoardMonitoringStoreReadResult> {
  return readWorkBoardMonitoringStoreWithVerifier(
    input,
    verifyWorkBoardMonitoringStore
  );
}

/**
 * Pure authenticated replay read. Unlike the normal state boundary, this
 * deliberately leaves aggregate derivation comparison to the replay result.
 */
export async function readWorkBoardMonitoringStoreForReplay(input: {
  cwd?: string;
  installationSecret: string;
}): Promise<WorkBoardMonitoringStoreReadResult> {
  return readWorkBoardMonitoringStoreWithVerifier(
    input,
    verifyWorkBoardMonitoringStoreAuthenticity
  );
}

async function readWorkBoardMonitoringStoreWithVerifier(
  input: { cwd?: string; installationSecret: string },
  verifier: (
    value: unknown,
    installationSecret: string
  ) => WorkBoardMonitoringStore | null
): Promise<WorkBoardMonitoringStoreReadResult> {
  const cwd = resolve(input.cwd ?? process.cwd());
  const target = join(
    workBoardMonitoringLocalDirectory(cwd, input.installationSecret),
    STORE_FILENAME
  );
  try {
    if (
      (await inspectLocalPrivateDirectoryChain(cwd, dirname(target))) ===
      "missing"
    ) {
      return { status: "missing" };
    }
    const value = JSON.parse(
      await readLocalPrivateText(target, "preserve", cwd)
    ) as unknown;
    const verified = verifier(
      value,
      input.installationSecret
    );
    return verified === null
      ? { status: "invalid" }
      : { status: "available", value: verified };
  } catch (error) {
    return isNodeError(error, "ENOENT")
      ? { status: "missing" }
      : { status: "invalid" };
  }
}

export async function readWorkBoardMonitoringState(input: {
  cwd?: string;
  installationSecret: string;
  now?: Date;
}) {
  const now = sampleClock(input.now);
  const read = await readWorkBoardMonitoringStore(input);
  if (read.status === "invalid") throw unavailable();
  const store =
    read.status === "available"
      ? compactStore(read.value, input.installationSecret, now)
      : createEmptyStore(input.installationSecret, now);
  return publicState(store, now);
}

export async function recordWorkBoardMonitoringMutation(input: {
  cwd?: string;
  installationSecret: string;
  mutation: WorkBoardMonitoringMutationInput;
  clock?: () => Date;
}) {
  const cwd = resolve(input.cwd ?? process.cwd());
  return withMonitoringLock(cwd, async () => {
    const now = sampleClock(input.clock?.());
    if (input.mutation.operation === "purge") {
      await purgeAllMonitoringNamespaces(cwd);
      const empty = createEmptyStore(input.installationSecret, now);
      return workBoardMonitoringMutationResponseSchema.parse({
        contract: WORK_BOARD_MONITORING_API_CONTRACT,
        status: "recorded",
        operation: "purge",
        consent: false,
        aggregate: deriveWorkBoardMonitoringQuality({
          events: [],
          asOf: now.toISOString()
        })
      });
    }

    await ensureNamespace(cwd, input.installationSecret);
    await assertNoPendingWrite(cwd, input.installationSecret);
    const read = await readWorkBoardMonitoringStore({
      cwd,
      installationSecret: input.installationSecret
    });
    if (read.status === "invalid") throw unavailable();
    const persistedStoreHmac =
      read.status === "available" ? read.value.storeHmac : null;
    let store = compactStore(
      read.status === "available"
        ? read.value
        : createEmptyStore(input.installationSecret, now),
      input.installationSecret,
      now
    );

    if (input.mutation.operation === "consent") {
      const desiredType = input.mutation.consent
        ? "consent_granted"
        : "consent_revoked";
      if (workBoardMonitoringConsent(store.events) !== input.mutation.consent) {
        store = appendEvent({
          store,
          installationSecret: input.installationSecret,
          content: emptyEventContent({
            store,
            eventType: desiredType,
            occurredAt: now.toISOString()
          })
        });
      }
    } else {
      if (!workBoardMonitoringConsent(store.events)) {
        throw new WorkBoardMonitoringStoreError("CONSENT_REQUIRED");
      }
      const receipt = requireCurrentReceipt({
        receipt: input.mutation.receipt,
        installationSecret: input.installationSecret,
        now
      });
      const receiptDigestHmac = workBoardMonitoringReceiptDigestHmac({
        receipt: input.mutation.receipt,
        installationSecret: input.installationSecret
      });
      if (input.mutation.operation === "render_confirmed") {
        const presentations = receipt.items.map((item) =>
          storedPresentation(receipt, item)
        );
        const consentSequence = latestConsentGrantedSequence(store);
        const duplicate = store.events.some(
          (event) =>
            event.eventType === "render_confirmed" &&
            event.sequence > consentSequence &&
            runtimeCanonicalJson(event.presentations) ===
              runtimeCanonicalJson(presentations)
        );
        if (!duplicate) {
          store = appendEvent({
            store,
            installationSecret: input.installationSecret,
            content: eventContent({
              store,
              eventType: "render_confirmed",
              occurredAt: now.toISOString(),
              receiptDigestHmac,
              captureId: receipt.captureId,
              presentations,
              target: null,
              feedback: null,
              reason: null,
              supersedesEventSha256: null
            })
          });
        }
      } else {
        const item = receipt.items[input.mutation.ordinal];
        if (
          item === undefined ||
          item.ordinal !== input.mutation.ordinal ||
          (item.lane !== "continuation" && item.lane !== "setup") ||
          !hasRenderAcknowledgement(store, item.presentationTargetHmac)
        ) {
          throw new WorkBoardMonitoringStoreError("RECEIPT_NOT_CURRENT");
        }
        const target = storedPresentation(receipt, item);
        const latest = latestFeedbackEvent(
          store,
          item.presentationTargetHmac
        );
        if (input.mutation.operation === "feedback") {
          const reason = input.mutation.reason ?? null;
          if (
            latest?.eventType !== "feedback_recorded" ||
            latest.feedback !== input.mutation.feedback ||
            latest.reason !== reason
          ) {
            store = appendEvent({
              store,
              installationSecret: input.installationSecret,
              content: eventContent({
                store,
                eventType: "feedback_recorded",
                occurredAt: now.toISOString(),
                receiptDigestHmac,
                captureId: receipt.captureId,
                presentations: [],
                target,
                feedback: input.mutation.feedback,
                reason,
                supersedesEventSha256: latest?.eventSha256 ?? null
              })
            });
          }
        } else if (
          input.mutation.operation === "reset" &&
          latest?.eventType === "feedback_recorded"
        ) {
          store = appendEvent({
            store,
            installationSecret: input.installationSecret,
            content: eventContent({
              store,
              eventType: "feedback_reset",
              occurredAt: now.toISOString(),
              receiptDigestHmac,
              captureId: receipt.captureId,
              presentations: [],
              target,
              feedback: null,
              reason: null,
              supersedesEventSha256: latest.eventSha256
            })
          });
        }
      }
    }

    if (store.storeHmac !== persistedStoreHmac) {
      await writeStore(cwd, input.installationSecret, store);
    }
    const state = publicState(store, now);
    return workBoardMonitoringMutationResponseSchema.parse({
      contract: WORK_BOARD_MONITORING_API_CONTRACT,
      status: "recorded",
      operation: input.mutation.operation,
      consent: state.consent,
      aggregate: state.aggregate
    });
  });
}

/** Explicit all-data deletion; intentionally independent of Codex config. */
export async function purgeAllWorkBoardMonitoringData(input: {
  cwd?: string;
  now?: Date;
} = {}) {
  const cwd = resolve(input.cwd ?? process.cwd());
  return withMonitoringLock(cwd, async () => {
    const now = sampleClock(input.now);
    await purgeAllMonitoringNamespaces(cwd);
    return workBoardMonitoringMutationResponseSchema.parse({
      contract: WORK_BOARD_MONITORING_API_CONTRACT,
      status: "recorded",
      operation: "purge",
      consent: false,
      aggregate: deriveWorkBoardMonitoringQuality({
        events: [],
        asOf: now.toISOString()
      })
    });
  });
}

export function verifyWorkBoardMonitoringStore(
  value: unknown,
  installationSecret: string
): WorkBoardMonitoringStore | null {
  const store = verifyWorkBoardMonitoringStoreAuthenticity(
    value,
    installationSecret
  );
  if (
    store === null ||
    store.aggregateSha256 !==
      runtimeSha256(
        deriveWorkBoardMonitoringQuality({
          events: store.events,
          asOf: store.updatedAt
        })
      )
  ) {
    return null;
  }
  return store;
}

function verifyWorkBoardMonitoringStoreAuthenticity(
  value: unknown,
  installationSecret: string
): WorkBoardMonitoringStore | null {
  try {
    const store = workBoardMonitoringStoreSchema.parse(value);
    if (
      store.authKeyId !==
      workBoardMonitoringAuthKeyId(installationSecret)
    ) {
      return null;
    }
    let previousSha = store.anchorEventSha256;
    let expectedSequence = store.anchorSequence + 1;
    let previousTime = Number.NEGATIVE_INFINITY;
    for (const event of store.events) {
      const {
        eventSha256: claimedSha,
        eventHmac: claimedHmac,
        ...content
      } = event;
      const parsed = workBoardMonitoringEventContentSchema.parse(content);
      const expectedSha = runtimeSha256(parsed);
      if (
        event.sequence !== expectedSequence ||
        event.previousEventSha256 !== previousSha ||
        claimedSha !== expectedSha ||
        !safeHexEqual(
          claimedHmac,
          eventHmac(installationSecret, expectedSha)
        ) ||
        Date.parse(event.occurredAt) < previousTime
      ) {
        return null;
      }
      previousSha = expectedSha;
      expectedSequence += 1;
      previousTime = Date.parse(event.occurredAt);
    }
    const { storeHmac: claimedStoreHmac, ...content } = store;
    if (
      !safeHexEqual(
        claimedStoreHmac,
        storeHmac(installationSecret, content)
      )
    ) {
      return null;
    }
    return store;
  } catch {
    return null;
  }
}

function createEmptyStore(
  installationSecret: string,
  now: Date
): WorkBoardMonitoringStore {
  const timestamp = now.toISOString();
  return sealStore(
    installationSecret,
    {
      contract: WORK_BOARD_MONITORING_STORE_CONTRACT,
      schemaVersion: WORK_BOARD_MONITORING_SCHEMA_VERSION,
      consentPolicyVersion:
        WORK_BOARD_MONITORING_CONSENT_POLICY_VERSION,
      retentionPolicyVersion:
        WORK_BOARD_MONITORING_RETENTION_POLICY_VERSION,
      idempotencyPolicyVersion:
        WORK_BOARD_MONITORING_IDEMPOTENCY_POLICY_VERSION,
      authKeyId: workBoardMonitoringAuthKeyId(installationSecret),
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 0,
      anchorSequence: 0,
      anchorEventSha256: null,
      events: [],
      aggregateSha256: runtimeSha256(
        deriveWorkBoardMonitoringQuality({ events: [], asOf: timestamp })
      )
    }
  );
}

function appendEvent(input: {
  store: WorkBoardMonitoringStore;
  installationSecret: string;
  content: WorkBoardMonitoringEventContent;
}): WorkBoardMonitoringStore {
  const limit = workBoardMonitoringEventCapacity(
    input.content.eventType
  );
  if (input.store.events.length + 1 > limit) throw unavailable();
  const parsed = workBoardMonitoringEventContentSchema.parse(input.content);
  const eventSha256 = runtimeSha256(parsed);
  const event = workBoardMonitoringEventSchema.parse({
    ...parsed,
    eventSha256,
    eventHmac: eventHmac(input.installationSecret, eventSha256)
  });
  return resealStore(input.store, input.installationSecret, {
    events: [...input.store.events, event],
    updatedAt: event.occurredAt,
    revision: input.store.revision + 1
  });
}

export function workBoardMonitoringEventCapacity(
  eventType: WorkBoardMonitoringEvent["eventType"]
): number {
  if (eventType === "consent_revoked") {
    return WORK_BOARD_MONITORING_MAX_EVENTS;
  }
  if (
    eventType === "feedback_recorded" ||
    eventType === "feedback_reset"
  ) {
    return WORK_BOARD_MONITORING_MAX_EVENTS - 1;
  }
  return (
    WORK_BOARD_MONITORING_MAX_EVENTS -
    WORK_BOARD_MONITORING_EVENT_RESERVE
  );
}

function compactStore(
  store: WorkBoardMonitoringStore,
  installationSecret: string,
  now: Date
): WorkBoardMonitoringStore {
  let removeCount = 0;
  while (
    removeCount < store.events.length &&
    Date.parse(store.events[removeCount]!.retainedUntil) <= now.getTime()
  ) {
    removeCount += 1;
  }
  if (removeCount === 0) return store;
  const anchor = store.events[removeCount - 1]!;
  return resealStore(store, installationSecret, {
    events: store.events.slice(removeCount),
    updatedAt: now.toISOString(),
    revision: store.revision + 1,
    anchorSequence: anchor.sequence,
    anchorEventSha256: anchor.eventSha256
  });
}

function resealStore(
  store: WorkBoardMonitoringStore,
  installationSecret: string,
  changes: Partial<WorkBoardMonitoringStoreContent>
): WorkBoardMonitoringStore {
  const { storeHmac: _storeHmac, ...current } = store;
  const content = workBoardMonitoringStoreSchema.omit({ storeHmac: true }).parse({
    ...current,
    ...changes,
    aggregateSha256: "0".repeat(64)
  });
  content.aggregateSha256 = runtimeSha256(
    deriveWorkBoardMonitoringQuality({
      events: content.events,
      asOf: content.updatedAt
    })
  );
  return sealStore(installationSecret, content);
}

function sealStore(
  installationSecret: string,
  contentInput: WorkBoardMonitoringStoreContent
): WorkBoardMonitoringStore {
  const content = workBoardMonitoringStoreSchema
    .omit({ storeHmac: true })
    .parse(contentInput);
  return workBoardMonitoringStoreSchema.parse({
    ...content,
    storeHmac: storeHmac(installationSecret, content)
  });
}

function eventContent(input: {
  store: WorkBoardMonitoringStore;
  eventType: WorkBoardMonitoringEvent["eventType"];
  occurredAt: string;
  receiptDigestHmac: WorkBoardMonitoringEvent["receiptDigestHmac"];
  captureId: WorkBoardMonitoringEvent["captureId"];
  presentations: WorkBoardMonitoringEvent["presentations"];
  target: WorkBoardMonitoringEvent["target"];
  feedback: WorkBoardMonitoringEvent["feedback"];
  reason: WorkBoardMonitoringEvent["reason"];
  supersedesEventSha256: WorkBoardMonitoringEvent["supersedesEventSha256"];
}): WorkBoardMonitoringEventContent {
  const lastOccurredAt = input.store.events.at(-1)?.occurredAt;
  if (
    lastOccurredAt !== undefined &&
    Date.parse(input.occurredAt) < Date.parse(lastOccurredAt)
  ) {
    throw unavailable();
  }
  return workBoardMonitoringEventContentSchema.parse({
    contract: WORK_BOARD_MONITORING_EVENT_CONTRACT,
    schemaVersion: WORK_BOARD_MONITORING_SCHEMA_VERSION,
    authKeyId: input.store.authKeyId,
    sequence:
      input.store.anchorSequence + input.store.events.length + 1,
    previousEventSha256:
      input.store.events.at(-1)?.eventSha256 ??
      input.store.anchorEventSha256,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    retainedUntil: new Date(
      Date.parse(input.occurredAt) + WORK_BOARD_MONITORING_RETENTION_MS
    ).toISOString(),
    receiptDigestHmac: input.receiptDigestHmac,
    captureId: input.captureId,
    presentations: input.presentations,
    target: input.target,
    feedback: input.feedback,
    reason: input.reason,
    supersedesEventSha256: input.supersedesEventSha256,
    ...WORK_BOARD_MONITORING_REVIEW_FIELDS
  });
}

function emptyEventContent(input: {
  store: WorkBoardMonitoringStore;
  eventType: "consent_granted" | "consent_revoked";
  occurredAt: string;
}): WorkBoardMonitoringEventContent {
  return eventContent({
    ...input,
    receiptDigestHmac: null,
    captureId: null,
    presentations: [],
    target: null,
    feedback: null,
    reason: null,
    supersedesEventSha256: null
  });
}

function storedPresentation(
  receipt: WorkBoardMonitoringReceiptPayload,
  item: WorkBoardMonitoringReceiptPayload["items"][number]
) {
  return {
    ordinal: item.ordinal,
    presentationTargetHmac: item.presentationTargetHmac,
    lane: item.lane,
    position: item.position,
    kind: item.kind,
    evidenceBand: item.evidenceBand,
    caveatCodes: item.caveatCodes,
    mode: receipt.mode,
    surface: WORK_BOARD_MONITORING_SURFACE
  };
}

function requireCurrentReceipt(input: {
  receipt: string;
  installationSecret: string;
  now: Date;
}): WorkBoardMonitoringReceiptPayload {
  const receipt = verifyWorkBoardMonitoringReceipt(input);
  if (receipt === null) {
    throw new WorkBoardMonitoringStoreError("RECEIPT_NOT_CURRENT");
  }
  return receipt;
}

function hasRenderAcknowledgement(
  store: WorkBoardMonitoringStore,
  presentationTargetHmac: string
): boolean {
  const consentSequence = latestConsentGrantedSequence(store);
  return store.events.some(
    (event) =>
      event.eventType === "render_confirmed" &&
      event.sequence > consentSequence &&
      event.presentations.some(
        (presentation) =>
          presentation.presentationTargetHmac === presentationTargetHmac
      )
  );
}

function latestConsentGrantedSequence(
  store: WorkBoardMonitoringStore
): number {
  let sequence = store.anchorSequence;
  for (const event of store.events) {
    if (event.eventType === "consent_granted") {
      sequence = event.sequence;
    } else if (event.eventType === "consent_revoked") {
      sequence = event.sequence;
    }
  }
  return sequence;
}

function latestFeedbackEvent(
  store: WorkBoardMonitoringStore,
  target: string
): WorkBoardMonitoringEvent | null {
  for (let index = store.events.length - 1; index >= 0; index -= 1) {
    const event = store.events[index]!;
    if (event.target?.presentationTargetHmac === target) {
      return event.eventType === "feedback_recorded" ||
        event.eventType === "feedback_reset"
        ? event
        : null;
    }
  }
  return null;
}

function publicState(store: WorkBoardMonitoringStore, now: Date) {
  return workBoardMonitoringStateResponseSchema.parse({
    contract: WORK_BOARD_MONITORING_API_CONTRACT,
    status: "ready",
    consent: workBoardMonitoringConsent(store.events),
    aggregate: deriveWorkBoardMonitoringQuality({
      events: store.events,
      asOf: now.toISOString()
    }),
    history: workBoardMonitoringHistory(
      store.events,
      WORK_BOARD_MONITORING_MAX_HISTORY
    )
  });
}

function eventHmac(
  installationSecret: string,
  eventSha256: string
): string {
  return hmacHex(
    installationSecret,
    "work-board-monitoring-event-hmac-v0.1",
    eventSha256
  );
}

function storeHmac(
  installationSecret: string,
  content: WorkBoardMonitoringStoreContent
): string {
  return hmacHex(
    installationSecret,
    "work-board-monitoring-store-hmac-v0.1",
    runtimeCanonicalJson(content)
  );
}

function hmacHex(
  installationSecret: string,
  domain: string,
  value: string
): string {
  return createHmac(
    "sha256",
    createHmac("sha256", Buffer.from(installationSecret, "hex"))
      .update(domain, "utf8")
      .digest()
  )
    .update(value, "utf8")
    .digest("hex");
}

function safeHexEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

async function withMonitoringLock<T>(
  cwd: string,
  operation: () => Promise<T>
): Promise<T> {
  const root = workBoardMonitoringLocalRoot(cwd);
  const locks = join(root, LOCKS_DIRECTORY);
  await ensurePrivateDirectoryChain(cwd, [
    join(cwd, ".local"),
    root,
    locks
  ]);
  const path = join(locks, LOCK_FILENAME);
  let handle: FileHandle | null = null;
  let identity: Stats | null = null;
  for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt += 1) {
    try {
      handle = await open(
        path,
        fsConstants.O_CREAT |
          fsConstants.O_EXCL |
          fsConstants.O_RDWR |
          fsConstants.O_NOFOLLOW,
        0o600
      );
      await handle.writeFile(`${randomBytes(32).toString("hex")}\n`, "utf8");
      await handle.sync();
      identity = await handle.stat();
      await assertPrivateFileIdentity(path, identity);
      break;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      handle = null;
      identity = null;
      if (!isNodeError(error, "EEXIST")) throw unavailable();
      await wait(LOCK_WAIT_MS);
    }
  }
  if (handle === null || identity === null) throw unavailable();
  try {
    return await operation();
  } finally {
    try {
      await assertPrivateFileIdentity(path, identity);
      await unlink(path);
      await syncDirectory(locks);
    } catch {
      throw unavailable();
    } finally {
      await handle.close().catch(() => undefined);
    }
  }
}

async function ensureNamespace(
  cwd: string,
  installationSecret: string
): Promise<void> {
  await ensurePrivateDirectoryChain(cwd, [
    workBoardMonitoringLocalDirectory(cwd, installationSecret)
  ]);
}

async function ensurePrivateDirectoryChain(
  cwd: string,
  directories: string[]
): Promise<void> {
  const root = resolve(cwd);
  const rootMetadata = await lstat(root).catch(() => null);
  const uid = process.geteuid?.() ?? process.getuid?.();
  if (
    rootMetadata === null ||
    !rootMetadata.isDirectory() ||
    rootMetadata.isSymbolicLink() ||
    (uid !== undefined && rootMetadata.uid !== uid)
  ) {
    throw unavailable();
  }
  for (const value of directories) {
    const directory = resolve(value);
    const relativePath = relative(root, directory);
    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      relativePath.startsWith(sep)
    ) {
      throw unavailable();
    }
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw unavailable();
    }
    const metadata = await lstat(directory).catch(() => null);
    if (
      metadata === null ||
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o777) !== 0o700 ||
      (uid !== undefined && metadata.uid !== uid)
    ) {
      throw unavailable();
    }
  }
}

async function assertNoPendingWrite(
  cwd: string,
  installationSecret: string
): Promise<void> {
  const names = await readdir(
    workBoardMonitoringLocalDirectory(cwd, installationSecret)
  );
  if (names.some((name) => TEMP_PATTERN.test(name))) throw unavailable();
}

async function writeStore(
  cwd: string,
  installationSecret: string,
  store: WorkBoardMonitoringStore
): Promise<void> {
  const target = join(
    workBoardMonitoringLocalDirectory(cwd, installationSecret),
    STORE_FILENAME
  );
  const temporary = `${target}.${randomBytes(16).toString("hex")}.tmp`;
  let handle: FileHandle | null = null;
  try {
    handle = await open(
      temporary,
      fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_WRONLY |
        fsConstants.O_NOFOLLOW,
      0o600
    );
    await handle.writeFile(`${JSON.stringify(store)}\n`, "utf8");
    await handle.sync();
    const metadata = await handle.stat();
    if (!privateFileMetadata(metadata)) throw unavailable();
    await handle.close();
    handle = null;
    await rename(temporary, target);
    const installed = await lstat(target);
    if (!privateFileMetadata(installed) || installed.isSymbolicLink()) {
      throw unavailable();
    }
    await syncDirectory(dirname(target));
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    if (error instanceof WorkBoardMonitoringStoreError) throw error;
    throw unavailable();
  }
}

async function purgeAllMonitoringNamespaces(cwd: string): Promise<void> {
  const root = workBoardMonitoringLocalRoot(cwd);
  const boundary = await inspectLocalPrivateDirectoryChain(cwd, root);
  if (boundary === "missing") return;
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    throw unavailable();
  }

  const namespaceFiles: Array<{ directory: string; paths: string[] }> = [];
  for (const entry of entries) {
    if (entry.name === LOCKS_DIRECTORY) continue;
    if (
      !AUTH_DIRECTORY_PATTERN.test(entry.name) ||
      !entry.isDirectory() ||
      entry.isSymbolicLink()
    ) {
      throw unavailable();
    }
    const directory = join(root, entry.name);
    if (
      (await inspectLocalPrivateDirectoryChain(cwd, directory)) !==
      "available"
    ) {
      throw unavailable();
    }
    const names = await readdir(directory);
    const paths: string[] = [];
    for (const name of names) {
      if (name !== STORE_FILENAME && !TEMP_PATTERN.test(name)) {
        throw unavailable();
      }
      const path = join(directory, name);
      const metadata = await lstat(path).catch(() => null);
      if (
        metadata === null ||
        !privateFileMetadata(metadata) ||
        metadata.isSymbolicLink()
      ) {
        throw unavailable();
      }
      paths.push(path);
    }
    namespaceFiles.push({ directory, paths });
  }

  for (const namespace of namespaceFiles) {
    for (const path of namespace.paths) await unlink(path);
    await syncDirectory(namespace.directory);
    await rmdir(namespace.directory);
  }
  await syncDirectory(root);
}

async function assertPrivateFileIdentity(
  path: string,
  expected: Stats
): Promise<void> {
  const current = await lstat(path);
  if (
    !privateFileMetadata(current) ||
    current.isSymbolicLink() ||
    current.dev !== expected.dev ||
    current.ino !== expected.ino
  ) {
    throw unavailable();
  }
}

function privateFileMetadata(metadata: Stats): boolean {
  const uid = process.geteuid?.() ?? process.getuid?.();
  return (
    metadata.isFile() &&
    (metadata.mode & 0o777) === 0o600 &&
    (uid === undefined || metadata.uid === uid)
  );
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function sampleClock(value: Date | undefined): Date {
  const now = new Date(value?.getTime() ?? Date.now());
  if (!Number.isFinite(now.getTime())) throw unavailable();
  return new Date(now.toISOString());
}

function unavailable(): WorkBoardMonitoringStoreError {
  return new WorkBoardMonitoringStoreError("STORE_UNAVAILABLE");
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function isNodeError(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === code
  );
}
