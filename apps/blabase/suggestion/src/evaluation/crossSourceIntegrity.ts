import { createHash } from "node:crypto";

import type {
  CrossSourceEvaluationCase,
  CrossSourceEvaluationDataset
} from "./crossSourceDatasetSchema";

type SnapshotReference =
  CrossSourceEvaluationCase["sourceSnapshotWindows"][number]["orderedSnapshotRefs"][number];
type WorkSignal = CrossSourceEvaluationCase["workSignals"][number];

export type CrossSourceIntegrityIssue =
  | {
      kind: "snapshot_hash_mismatch";
      caseId: string;
      reference: string;
      expectedSha256: string;
      actualSha256: string;
    }
  | {
      kind: "detector_config_artifact_missing";
      caseId: string;
      reference: string;
    }
  | {
      kind: "detector_config_hash_mismatch";
      caseId: string;
      reference: string;
      expectedSha256: string;
      actualSha256: string;
    }
  | {
      kind: "detector_config_version_mismatch";
      caseId: string;
      reference: string;
      expectedVersion: string;
      actualVersion: string | null;
    }
  | {
      kind: "dataset_hash_mismatch";
      reference: string;
      expectedSha256: string;
      actualSha256: string;
    };

export type CrossSourceIntegrityResult = {
  ok: boolean;
  issues: CrossSourceIntegrityIssue[];
};

export type CrossSourceIntegrityOptions = {
  configArtifacts?: Readonly<Record<string, unknown>>;
};

function normalizeCanonicalJson(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("canonical JSON does not support non-finite numbers");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeCanonicalJson);
  }
  if (typeof value === "object") {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) {
        throw new TypeError("canonical JSON does not support undefined");
      }
      normalized[key] = normalizeCanonicalJson(child);
    }
    return normalized;
  }
  throw new TypeError(`canonical JSON does not support ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeCanonicalJson(value));
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function computeCrossSourceSnapshotSha256(input: {
  schemaVersion: SnapshotReference["schemaVersion"];
  normalizerVersion: SnapshotReference["normalizerVersion"];
  fetchedAt: SnapshotReference["fetchedAt"];
  signals: WorkSignal[];
}): string {
  return sha256Canonical(input);
}

/**
 * Dataset digests omit lifecycle.datasetSha256 itself. Every other field,
 * including immutableRef and frozenAt, remains part of the canonical digest.
 */
export function computeCrossSourceDatasetSha256(
  dataset: CrossSourceEvaluationDataset
): string {
  const { datasetSha256: _storedDigest, ...lifecycleWithoutDigest } =
    dataset.lifecycle;

  return sha256Canonical({
    ...dataset,
    lifecycle: lifecycleWithoutDigest
  });
}

export function verifyCrossSourceEvaluationDatasetIntegrity(
  dataset: CrossSourceEvaluationDataset,
  options: CrossSourceIntegrityOptions = {}
): CrossSourceIntegrityResult {
  const issues: CrossSourceIntegrityIssue[] = [];

  for (const evaluationCase of dataset.cases) {
    for (const window of evaluationCase.sourceSnapshotWindows) {
      for (const snapshot of window.orderedSnapshotRefs) {
        const signals = evaluationCase.workSignals.filter(
          (signal) =>
            signal.source === window.source &&
            signal.evidenceRefs.includes(snapshot.snapshotId)
        );
        const actualSha256 = computeCrossSourceSnapshotSha256({
          schemaVersion: snapshot.schemaVersion,
          normalizerVersion: snapshot.normalizerVersion,
          fetchedAt: snapshot.fetchedAt,
          signals
        });
        if (actualSha256 !== snapshot.snapshotSha256) {
          issues.push({
            kind: "snapshot_hash_mismatch",
            caseId: evaluationCase.caseId,
            reference: snapshot.snapshotId,
            expectedSha256: snapshot.snapshotSha256,
            actualSha256
          });
        }
      }
    }

    if (evaluationCase.codexDetectorConfig !== null) {
      const configReference = evaluationCase.codexDetectorConfig;
      const artifact = options.configArtifacts?.[configReference.immutableRef];
      if (artifact === undefined) {
        issues.push({
          kind: "detector_config_artifact_missing",
          caseId: evaluationCase.caseId,
          reference: configReference.immutableRef
        });
      } else {
        const actualVersion =
          typeof artifact === "object" &&
          artifact !== null &&
          typeof (artifact as Record<string, unknown>).version === "string"
            ? ((artifact as Record<string, unknown>).version as string)
            : null;
        if (actualVersion !== configReference.version) {
          issues.push({
            kind: "detector_config_version_mismatch",
            caseId: evaluationCase.caseId,
            reference: configReference.immutableRef,
            expectedVersion: configReference.version,
            actualVersion
          });
        }
        const actualSha256 = sha256Canonical(artifact);
        if (actualSha256 !== configReference.sha256) {
          issues.push({
            kind: "detector_config_hash_mismatch",
            caseId: evaluationCase.caseId,
            reference: configReference.immutableRef,
            expectedSha256: configReference.sha256,
            actualSha256
          });
        }
      }
    }
  }

  if (dataset.lifecycle.state === "frozen") {
    const actualSha256 = computeCrossSourceDatasetSha256(dataset);
    if (actualSha256 !== dataset.lifecycle.datasetSha256) {
      issues.push({
        kind: "dataset_hash_mismatch",
        reference: dataset.lifecycle.immutableRef,
        expectedSha256: dataset.lifecycle.datasetSha256,
        actualSha256
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

export function assertCrossSourceEvaluationDatasetIntegrity(
  dataset: CrossSourceEvaluationDataset,
  options: CrossSourceIntegrityOptions = {}
): void {
  const result = verifyCrossSourceEvaluationDatasetIntegrity(dataset, options);
  if (!result.ok) {
    const summary = result.issues
      .map((issue) => `${issue.kind}:${issue.reference}`)
      .join(", ");
    throw new Error(`Cross-source evaluation integrity check failed: ${summary}`);
  }
}
