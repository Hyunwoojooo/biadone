import { createHash } from "node:crypto";
import path from "node:path";
import { types as nodeUtilTypes } from "node:util";

import {
  type ScreenEvidenceBundleEntryV1,
  type ScreenEvidenceBundleInputV1,
  type ScreenEvidenceManifestV1,
  type ScreenEvidencePayloadV1,
} from "./contractsV1";
import {
  importScreenEvidenceBundleV1,
  ScreenEvidenceImportErrorV1,
} from "./importScreenEvidenceBundleV1";
import {
  canonicalPrivateScreenEvidenceJsonBytesV1,
  createPrivateScreenEvidenceDirectoryNoClobberV1,
  ensurePrivateScreenEvidenceDirectoryChainV1,
  fsyncPrivateScreenEvidenceDirectoryV1,
  PrivateScreenEvidenceFilesystemErrorV1,
  publishImmutablePrivateScreenEvidenceFileV1,
  writeNewPrivateScreenEvidenceFileV1,
} from "./privateScreenEvidenceFilesystemV1.internal";
import {
  readScreenEvidenceBundleV1,
  ScreenEvidenceReadErrorV1,
  type ReadScreenEvidenceBundleV1Result,
} from "./readScreenEvidenceBundleV1";

const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export interface PublishScreenEvidenceBundleV1InternalInputV1 {
  readonly projectDirectory: string;
  readonly bundle: ScreenEvidenceBundleInputV1;
}

export interface PublishedScreenEvidenceBundleV1InternalResultV1 {
  readonly publicationSchemaVersion: "blabase.screen-evidence-export-publication.v1";
  readonly bundleDirectory: string;
  readonly readback: ReadScreenEvidenceBundleV1Result;
}

export type PrivateScreenEvidencePublicationEventKindV1 =
  | "DIRECTORY_CREATED"
  | "PAYLOAD_COMMITTED"
  | "MANIFEST_COMMITTED"
  | "MANIFEST_MARKER_COMMITTED"
  | "BEFORE_COMPLETE"
  | "COMPLETE_COMMIT_STARTED"
  | "COMPLETE_COMMITTED"
  | "BEFORE_FINAL_READBACK";

export type PrivateScreenEvidencePublicationEventV1 =
  | Readonly<{ kind: "DIRECTORY_CREATED"; bundleDirectory: string }>
  | Readonly<{ kind: "PAYLOAD_COMMITTED"; bundleDirectory: string }>
  | Readonly<{ kind: "MANIFEST_COMMITTED"; bundleDirectory: string }>
  | Readonly<{ kind: "MANIFEST_MARKER_COMMITTED"; bundleDirectory: string }>
  | Readonly<{ kind: "BEFORE_COMPLETE"; bundleDirectory: string }>
  | Readonly<{ kind: "COMPLETE_COMMIT_STARTED"; bundleDirectory: string }>
  | Readonly<{ kind: "COMPLETE_COMMITTED"; bundleDirectory: string }>
  | Readonly<{ kind: "BEFORE_FINAL_READBACK"; bundleDirectory: string }>;

export type PrivateScreenEvidencePublicationFaultClassificationV1 =
  | "BEFORE_COMPLETE"
  | "DURING_COMPLETE"
  | "AFTER_COMPLETE";

export type PrivateScreenEvidencePublicationEventSinkV1 = (
  event: PrivateScreenEvidencePublicationEventV1,
) => void | Promise<void>;

export interface PublishScreenEvidenceBundleV1InternalOptionsV1 {
  readonly onEvent?: PrivateScreenEvidencePublicationEventSinkV1;
}

export class PrivateScreenEvidencePublicationFaultV1 extends Error {
  readonly issueCode = "INJECTED_PUBLICATION_FAULT" as const;
  readonly classification: PrivateScreenEvidencePublicationFaultClassificationV1;
  readonly eventKind: PrivateScreenEvidencePublicationEventKindV1;

  constructor(
    classification: PrivateScreenEvidencePublicationFaultClassificationV1,
    eventKind: PrivateScreenEvidencePublicationEventKindV1,
  ) {
    super(`Private screen evidence publication fault (${classification}:${eventKind})`);
    this.name = "PrivateScreenEvidencePublicationFaultV1";
    this.classification = classification;
    this.eventKind = eventKind;
  }
}

export type PrivateScreenEvidencePublicationIssueCodeV1 =
  | "EXPORT_INPUT_INVALID"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "BUNDLE_PREFLIGHT_REJECTED"
  | "EXPORT_RUN_EXISTS"
  | "EXPORT_DIRECTORY_UNSAFE"
  | "EXPORT_WRITE_REJECTED"
  | "POST_COMPLETE_FAILURE"
  | "FINAL_READBACK_REJECTED";

export class PrivateScreenEvidencePublicationErrorV1 extends Error {
  readonly issueCode: PrivateScreenEvidencePublicationIssueCodeV1;

  constructor(issueCode: PrivateScreenEvidencePublicationIssueCodeV1) {
    super(`Private screen evidence publication failed (${issueCode})`);
    this.name = "PrivateScreenEvidencePublicationErrorV1";
    this.issueCode = issueCode;
  }
}

function fail(issueCode: PrivateScreenEvidencePublicationIssueCodeV1): never {
  throw new PrivateScreenEvidencePublicationErrorV1(issueCode);
}

function mapFilesystemError(error: PrivateScreenEvidenceFilesystemErrorV1): never {
  switch (error.issueCode) {
    case "ENTRY_EXISTS":
      return fail("EXPORT_RUN_EXISTS");
    case "ENTRY_COMMITTED_FAILURE":
      return fail("POST_COMPLETE_FAILURE");
    case "RESOURCE_LIMIT_EXCEEDED":
      return fail("RESOURCE_LIMIT_EXCEEDED");
    case "DIRECTORY_UNSAFE":
    case "FILE_UNSAFE":
      return fail("EXPORT_DIRECTORY_UNSAFE");
    case "INPUT_INVALID":
      return fail("EXPORT_INPUT_INVALID");
    default:
      return fail("EXPORT_WRITE_REJECTED");
  }
}

function faultClassification(
  kind: PrivateScreenEvidencePublicationEventKindV1,
): PrivateScreenEvidencePublicationFaultClassificationV1 {
  if (kind === "COMPLETE_COMMIT_STARTED") return "DURING_COMPLETE";
  if (kind === "COMPLETE_COMMITTED" || kind === "BEFORE_FINAL_READBACK") {
    return "AFTER_COMPLETE";
  }
  return "BEFORE_COMPLETE";
}

async function emitEvent(
  sink: PrivateScreenEvidencePublicationEventSinkV1 | undefined,
  event: PrivateScreenEvidencePublicationEventV1,
): Promise<void> {
  if (sink === undefined) return;
  try {
    await sink(objectFreeze(event));
  } catch {
    throw new PrivateScreenEvidencePublicationFaultV1(
      faultClassification(event.kind),
      event.kind,
    );
  }
}

function snapshotInput(
  candidate: unknown,
): Readonly<{ projectDirectory: string; bundle: unknown }> {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    Array.isArray(candidate) ||
    nodeUtilTypes.isProxy(candidate) ||
    objectGetPrototypeOf(candidate) !== Object.prototype
  ) {
    return fail("EXPORT_INPUT_INVALID");
  }
  const descriptors = objectGetOwnPropertyDescriptors(candidate);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== 2 ||
    keys.some((key) => key !== "projectDirectory" && key !== "bundle")
  ) {
    return fail("EXPORT_INPUT_INVALID");
  }
  const projectDirectory = descriptors.projectDirectory;
  const bundle = descriptors.bundle;
  if (
    projectDirectory === undefined ||
    !("value" in projectDirectory) ||
    typeof projectDirectory.value !== "string" ||
    bundle === undefined ||
    !("value" in bundle)
  ) {
    return fail("EXPORT_INPUT_INVALID");
  }
  return { projectDirectory: projectDirectory.value, bundle: bundle.value };
}

function frozenEntry(
  relativePath: ScreenEvidenceBundleEntryV1["relativePath"],
  bytes: Uint8Array,
): ScreenEvidenceBundleEntryV1 {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  return objectFreeze({
    relativePath,
    entryKind: "regular-file" as const,
    byteLength: owned.byteLength,
    bytes: owned,
  });
}

function ownedBundle(
  payload: ScreenEvidencePayloadV1,
  manifest: ScreenEvidenceManifestV1,
): ScreenEvidenceBundleInputV1 {
  const payloadBytes = canonicalPrivateScreenEvidenceJsonBytesV1(payload);
  const manifestBytes = canonicalPrivateScreenEvidenceJsonBytesV1(manifest);
  const manifestSha256 = createHash("sha256")
    .update(manifestBytes)
    .digest("hex");
  const marker = new TextEncoder().encode(manifestSha256);
  return objectFreeze({
    bundleDirectoryName: payload.exportRunId,
    entries: objectFreeze([
      frozenEntry("payload.json", payloadBytes),
      frozenEntry("manifest.json", manifestBytes),
      frozenEntry("manifest.sha256", marker),
      frozenEntry("COMPLETE", marker),
    ]),
  });
}

export async function publishScreenEvidenceBundleV1Internal(
  input: PublishScreenEvidenceBundleV1InternalInputV1,
  options: PublishScreenEvidenceBundleV1InternalOptionsV1 = {},
): Promise<PublishedScreenEvidenceBundleV1InternalResultV1> {
  try {
    const candidate = snapshotInput(input);
    let imported;
    try {
      imported = importScreenEvidenceBundleV1(
        candidate.bundle as ScreenEvidenceBundleInputV1,
      );
    } catch (error) {
      if (error instanceof ScreenEvidenceImportErrorV1) {
        return fail("BUNDLE_PREFLIGHT_REJECTED");
      }
      return fail("EXPORT_INPUT_INVALID");
    }
    const bundle = ownedBundle(imported.evidence, imported.manifest);
    const entries = new Map(
      bundle.entries.map((entry) => [entry.relativePath, entry]),
    );
    if (
      bundle.bundleDirectoryName !== imported.evidence.exportRunId ||
      !idPattern.test(imported.evidence.exportRunId)
    ) {
      return fail("EXPORT_INPUT_INVALID");
    }

    const exportsDirectory = await ensurePrivateScreenEvidenceDirectoryChainV1(
      candidate.projectDirectory,
      "exports",
    );
    const bundleDirectory = await createPrivateScreenEvidenceDirectoryNoClobberV1(
      exportsDirectory,
      imported.evidence.exportRunId,
    );
    await emitEvent(options.onEvent, {
      kind: "DIRECTORY_CREATED",
      bundleDirectory,
    });

    const orderedEntries = [
      ["payload.json", "PAYLOAD_COMMITTED"],
      ["manifest.json", "MANIFEST_COMMITTED"],
      ["manifest.sha256", "MANIFEST_MARKER_COMMITTED"],
    ] as const;
    for (const [relativePath, eventKind] of orderedEntries) {
      const entry = entries.get(relativePath);
      if (entry === undefined) return fail("BUNDLE_PREFLIGHT_REJECTED");
      await writeNewPrivateScreenEvidenceFileV1(
        bundleDirectory,
        relativePath,
        entry.bytes,
      );
      await emitEvent(options.onEvent, { kind: eventKind, bundleDirectory });
    }
    await fsyncPrivateScreenEvidenceDirectoryV1(bundleDirectory);
    await emitEvent(options.onEvent, {
      kind: "BEFORE_COMPLETE",
      bundleDirectory,
    });
    const complete = entries.get("COMPLETE");
    if (complete === undefined) return fail("BUNDLE_PREFLIGHT_REJECTED");
    await emitEvent(options.onEvent, {
      kind: "COMPLETE_COMMIT_STARTED",
      bundleDirectory,
    });
    await publishImmutablePrivateScreenEvidenceFileV1(
      bundleDirectory,
      "COMPLETE",
      complete.bytes,
    );
    await emitEvent(options.onEvent, {
      kind: "COMPLETE_COMMITTED",
      bundleDirectory,
    });
    await emitEvent(options.onEvent, {
      kind: "BEFORE_FINAL_READBACK",
      bundleDirectory,
    });

    let readback: ReadScreenEvidenceBundleV1Result;
    try {
      readback = await readScreenEvidenceBundleV1({ bundleDirectory });
    } catch (error) {
      if (error instanceof ScreenEvidenceReadErrorV1) {
        return fail("FINAL_READBACK_REJECTED");
      }
      return fail("FINAL_READBACK_REJECTED");
    }
    if (
      readback.imported.descriptor.manifestSha256 !==
        imported.descriptor.manifestSha256 ||
      readback.imported.descriptor.payloadSha256 !==
        imported.descriptor.payloadSha256 ||
      path.basename(bundleDirectory) !== imported.evidence.exportRunId
    ) {
      return fail("FINAL_READBACK_REJECTED");
    }
    return objectFreeze({
      publicationSchemaVersion:
        "blabase.screen-evidence-export-publication.v1" as const,
      bundleDirectory,
      readback,
    });
  } catch (error) {
    if (
      error instanceof PrivateScreenEvidencePublicationErrorV1 ||
      error instanceof PrivateScreenEvidencePublicationFaultV1
    ) {
      throw error;
    }
    if (error instanceof PrivateScreenEvidenceFilesystemErrorV1) {
      return mapFilesystemError(error);
    }
    return fail("EXPORT_WRITE_REJECTED");
  }
}
