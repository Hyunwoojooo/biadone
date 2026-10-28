import { createHash } from "node:crypto";

import { z } from "zod";

import {
  classifyDayflowCoverage,
  dayflowScreenEvidenceExportSchema,
  domainSeparatedSha256,
  jcsCanonicalize,
  verifyArtifactBlobBytes,
} from "../../dayflowEvidence/contracts";
import * as dayflowAblationContracts from "./contracts";
import {
  dayflowAblationSyntheticCasesSchema,
  dayflowAblationSyntheticConfigSchema,
  experimentManifestSchema,
  runResultsSchema,
  type DayflowAblationExperimentManifest,
  type DayflowAblationRunResults,
  type DayflowAblationSyntheticCases,
  type DayflowAblationSyntheticConfig,
} from "./contracts";

export const DAYFLOW_FIXTURE_GENERATOR_CONFIG_HASH_DOMAIN =
  "blabase.dayflow-ablation.fixture-generator-config.v0.2";
export const DAYFLOW_EVIDENCE_VECTOR_HASH_DOMAIN =
  "blabase.dayflow-ablation.synthetic-evidence-vector.v0.1";
export const DAYFLOW_SYNTHETIC_CASES_HASH_DOMAIN =
  "blabase.dayflow-ablation.synthetic-cases.v0.2";
export const DAYFLOW_SYNTHETIC_BLOB_SENTINEL =
  "SYNTHETIC_DAYFLOW_PLACEHOLDER_PNG_DO_NOT_USE_AS_HUMAN_DATA";
export const DAYFLOW_SYNTHETIC_PLACEHOLDER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL0WQAAAABJRU5ErkJggg==";

export type DayflowDatasetIntegrityIssueCode =
  | "CONFIG_HASH_MISMATCH"
  | "VECTOR_HASH_MISMATCH"
  | "CASES_HASH_MISMATCH"
  | "VECTOR_PAYLOAD_MISMATCH"
  | "EVAL_CROSS_VALIDATOR_UNAVAILABLE"
  | "EVAL_CROSS_VALIDATION_FAILED";

export class DayflowDatasetIntegrityError extends Error {
  readonly issueCode: DayflowDatasetIntegrityIssueCode;

  constructor(issueCode: DayflowDatasetIntegrityIssueCode, message: string) {
    super(message);
    this.name = "DayflowDatasetIntegrityError";
    this.issueCode = issueCode;
  }
}

const executableArtifactBlobSchema = z
  .object({
    sourceArtifactId: z.string().regex(/^[a-z][a-z0-9._:-]{0,127}$/u),
    encoding: z.literal("base64"),
    syntheticSentinel: z.literal(DAYFLOW_SYNTHETIC_BLOB_SENTINEL),
    bytes: z.literal(DAYFLOW_SYNTHETIC_PLACEHOLDER_PNG_BASE64),
  })
  .strict()
  .superRefine((value, context) => {
    let decoded: Buffer;
    try {
      decoded = Buffer.from(value.bytes, "base64");
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bytes"],
        message: "Artifact bytes must be canonical base64",
      });
      return;
    }
    if (decoded.toString("base64") !== value.bytes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bytes"],
        message: "Artifact bytes must be canonical base64",
      });
    }
  });

export const executableEvidencePayloadSchema = z
  .object({
    exportManifest: dayflowScreenEvidenceExportSchema,
    artifactBlobs: z.array(executableArtifactBlobSchema).max(256),
  })
  .strict()
  .superRefine((value, context) => {
    const artifactsById = new Map(
      value.exportManifest.artifacts.map((artifact) => [
        artifact.sourceArtifactId,
        artifact,
      ]),
    );
    const blobIds = new Set<string>();
    value.artifactBlobs.forEach((blob, index) => {
      const artifact = artifactsById.get(blob.sourceArtifactId);
      if (blobIds.has(blob.sourceArtifactId) || artifact === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifactBlobs", index, "sourceArtifactId"],
          message: "Artifact blob ownership must be unique and exact",
        });
      } else {
        if (artifact.mimeType !== "image/png") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["exportManifest", "artifacts"],
            message: "Allowlisted synthetic placeholder bytes require image/png",
          });
        }
        if (
          !verifyArtifactBlobBytes(artifact, Buffer.from(blob.bytes, "base64"))
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["artifactBlobs", index, "bytes"],
            message: "Artifact blob bytes do not match manifest length/hash",
          });
        }
      }
      blobIds.add(blob.sourceArtifactId);
    });
    if (
      blobIds.size !== artifactsById.size ||
      [...artifactsById.keys()].some((id) => !blobIds.has(id))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifactBlobs"],
        message: "Artifact blob map must exactly cover manifest artifacts",
      });
    }
  });

export type ExecutableEvidencePayload = z.infer<
  typeof executableEvidencePayloadSchema
>;

type EvidenceBoundaryVector =
  DayflowAblationSyntheticCases["evidenceBoundaryVectors"][number];

export type ExecutableEvidenceBoundaryVector = EvidenceBoundaryVector &
  Readonly<{ payload: ExecutableEvidencePayload }>;

export type DayflowAblationExecutableCases = Omit<
  DayflowAblationSyntheticCases,
  "evidenceBoundaryVectors"
> &
  Readonly<{
    evidenceBoundaryVectors: readonly ExecutableEvidenceBoundaryVector[];
  }>;

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_JSON_DEPTH = 64;

export type DayflowJsonParseIssueCode =
  | "DUPLICATE_JSON_KEY"
  | "JSON_DEPTH_LIMIT"
  | "JSON_SIZE_LIMIT"
  | "INVALID_JSON";

export class DayflowJsonParseError extends Error {
  readonly issueCode: DayflowJsonParseIssueCode;
  readonly offset: number;
  readonly jsonPath: string;

  constructor(
    issueCode: DayflowJsonParseIssueCode,
    message: string,
    offset: number,
    jsonPath: string,
  ) {
    super(message);
    this.name = "DayflowJsonParseError";
    this.issueCode = issueCode;
    this.offset = offset;
    this.jsonPath = jsonPath;
  }
}

function pointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

/**
 * A deliberately small, duplicate-aware JSON parser for the synthetic DFA-002
 * boundary. Duplicate member names are compared after escape decoding, before
 * any schema validation can observe a last-key-wins object.
 */
export function parseDuplicateAwareJson(raw: string): unknown {
  const rawByteLength = new TextEncoder().encode(raw).byteLength;
  if (rawByteLength > MAX_JSON_BYTES) {
    throw new DayflowJsonParseError(
      "JSON_SIZE_LIMIT",
      `JSON input exceeds ${MAX_JSON_BYTES} bytes`,
      0,
      "",
    );
  }

  let offset = 0;

  const fail = (
    message: string,
    jsonPath: string,
    issueCode: DayflowJsonParseIssueCode = "INVALID_JSON",
  ): never => {
    throw new DayflowJsonParseError(issueCode, message, offset, jsonPath);
  };

  const skipWhitespace = (): void => {
    while (
      raw[offset] === " " ||
      raw[offset] === "\n" ||
      raw[offset] === "\r" ||
      raw[offset] === "\t"
    ) {
      offset += 1;
    }
  };

  const parseHexCodeUnit = (jsonPath: string): number => {
    const hex = raw.slice(offset, offset + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
      fail("Invalid Unicode escape", jsonPath);
    }
    offset += 4;
    return Number.parseInt(hex, 16);
  };

  const parseString = (jsonPath: string): string => {
    if (raw[offset] !== '"') {
      fail("Expected a JSON string", jsonPath);
    }
    offset += 1;
    let value = "";

    while (offset < raw.length) {
      const character = raw[offset];
      const codeUnit = raw.charCodeAt(offset);

      if (character === '"') {
        offset += 1;
        return value;
      }

      if (character === "\\") {
        offset += 1;
        const escape = raw[offset];
        offset += 1;
        switch (escape) {
          case '"':
          case "\\":
          case "/":
            value += escape;
            break;
          case "b":
            value += "\b";
            break;
          case "f":
            value += "\f";
            break;
          case "n":
            value += "\n";
            break;
          case "r":
            value += "\r";
            break;
          case "t":
            value += "\t";
            break;
          case "u": {
            const first = parseHexCodeUnit(jsonPath);
            if (first >= 0xd800 && first <= 0xdbff) {
              if (raw.slice(offset, offset + 2) !== "\\u") {
                fail("Unpaired high surrogate", jsonPath);
              }
              offset += 2;
              const second = parseHexCodeUnit(jsonPath);
              if (second < 0xdc00 || second > 0xdfff) {
                fail("Unpaired high surrogate", jsonPath);
              }
              value += String.fromCharCode(first, second);
            } else if (first >= 0xdc00 && first <= 0xdfff) {
              fail("Unpaired low surrogate", jsonPath);
            } else {
              value += String.fromCharCode(first);
            }
            break;
          }
          default:
            fail("Invalid JSON string escape", jsonPath);
        }
        continue;
      }

      if (codeUnit <= 0x1f) {
        fail("Unescaped control character in JSON string", jsonPath);
      }
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const next = raw.charCodeAt(offset + 1);
        if (next < 0xdc00 || next > 0xdfff) {
          fail("Unpaired high surrogate", jsonPath);
        }
        value += raw.slice(offset, offset + 2);
        offset += 2;
        continue;
      }
      if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        fail("Unpaired low surrogate", jsonPath);
      }
      value += character;
      offset += 1;
    }

    return fail("Unterminated JSON string", jsonPath);
  };

  const parseNumber = (jsonPath: string): number => {
    const remainder = raw.slice(offset);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      remainder,
    );
    if (!match) return fail("Invalid JSON number", jsonPath);
    offset += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) {
      fail("JSON number is not finite", jsonPath);
    }
    if (Object.is(value, -0)) {
      fail("Negative zero is not permitted", jsonPath);
    }
    return value;
  };

  const parseLiteral = <T>(
    literal: string,
    value: T,
    jsonPath: string,
  ): T => {
    if (raw.slice(offset, offset + literal.length) !== literal) {
      fail(`Expected ${literal}`, jsonPath);
    }
    offset += literal.length;
    return value;
  };

  const parseValue = (jsonPath: string, depth: number): unknown => {
    if (depth > MAX_JSON_DEPTH) {
      fail(
        `JSON nesting exceeds ${MAX_JSON_DEPTH}`,
        jsonPath,
        "JSON_DEPTH_LIMIT",
      );
    }
    skipWhitespace();
    const character = raw[offset];

    if (character === '"') {
      return parseString(jsonPath);
    }
    if (character === "-") {
      return parseNumber(jsonPath);
    }
    if (character !== undefined && character >= "0" && character <= "9") {
      return parseNumber(jsonPath);
    }
    if (character === "t") {
      return parseLiteral("true", true, jsonPath);
    }
    if (character === "f") {
      return parseLiteral("false", false, jsonPath);
    }
    if (character === "n") {
      return parseLiteral("null", null, jsonPath);
    }
    if (character === "[") {
      offset += 1;
      const values: unknown[] = [];
      skipWhitespace();
      if (raw[offset] === "]") {
        offset += 1;
        return values;
      }
      while (true) {
        const itemPath = `${jsonPath}/${values.length}`;
        values.push(parseValue(itemPath, depth + 1));
        skipWhitespace();
        if (raw[offset] === "]") {
          offset += 1;
          return values;
        }
        if (raw[offset] !== ",") {
          fail("Expected ',' or ']'", jsonPath);
        }
        offset += 1;
        skipWhitespace();
      }
    }
    if (character === "{") {
      offset += 1;
      const value: Record<string, unknown> = Object.create(null) as Record<
        string,
        unknown
      >;
      const keys = new Set<string>();
      skipWhitespace();
      if (raw[offset] === "}") {
        offset += 1;
        return value;
      }
      while (true) {
        const keyOffset = offset;
        const key = parseString(jsonPath);
        const keyPath = `${jsonPath}/${pointerToken(key)}`;
        if (keys.has(key)) {
          offset = keyOffset;
          fail(
            `Duplicate JSON object key: ${key}`,
            keyPath,
            "DUPLICATE_JSON_KEY",
          );
        }
        keys.add(key);
        skipWhitespace();
        if (raw[offset] !== ":") {
          fail("Expected ':' after object key", keyPath);
        }
        offset += 1;
        value[key] = parseValue(keyPath, depth + 1);
        skipWhitespace();
        if (raw[offset] === "}") {
          offset += 1;
          return value;
        }
        if (raw[offset] !== ",") {
          fail("Expected ',' or '}'", jsonPath);
        }
        offset += 1;
        skipWhitespace();
      }
    }

    fail("Unexpected token", jsonPath);
  };

  if (raw.startsWith("\uFEFF")) {
    fail("A UTF-8 BOM is not permitted", "");
  }

  const value = parseValue("", 0);
  skipWhitespace();
  if (offset !== raw.length) {
    fail("Trailing data after JSON value", "");
  }
  return value;
}

export function loadDayflowAblationSyntheticConfig(
  raw: string,
): DayflowAblationSyntheticConfig {
  const config = dayflowAblationSyntheticConfigSchema.parse(
    parseDuplicateAwareJson(raw),
  );
  const actual = dayflowFixtureGeneratorConfigSha256({
    version: config.generationTuple.fixtureGeneratorVersion,
    seed: config.generationTuple.fixtureGeneratorSeed,
    syntheticOnly: config.generationTuple.syntheticOnly,
  });
  if (
    actual !== config.fixtureGeneratorConfigSha256 ||
    actual !== config.generationTuple.fixtureGeneratorConfigSha256
  ) {
    throw new DayflowDatasetIntegrityError(
      "CONFIG_HASH_MISMATCH",
      "Synthetic fixture generator config detached hash mismatch",
    );
  }
  return config;
}

export function loadDayflowAblationSyntheticCases(
  raw: string,
): DayflowAblationExecutableCases {
  const candidate = parseDuplicateAwareJson(raw);
  const candidateRecord = requireRecord(candidate, "Synthetic cases");
  const rawVectors = candidateRecord.evidenceBoundaryVectors;
  if (!Array.isArray(rawVectors)) {
    throw new DayflowDatasetIntegrityError(
      "VECTOR_PAYLOAD_MISMATCH",
      "Synthetic cases evidenceBoundaryVectors must be an array",
    );
  }

  const projectedCandidate = {
    ...candidateRecord,
    evidenceBoundaryVectors: rawVectors.map((rawVector) => {
      const vector = requireRecord(rawVector, "Evidence boundary vector");
      const { payload: _payload, ...metadata } = vector;
      return metadata;
    }),
  };
  const metadataCases = dayflowAblationSyntheticCasesSchema.parse(
    projectedCandidate,
  );
  if (
    dayflowFixtureGeneratorConfigSha256({
      version: metadataCases.fixtureGenerator.version,
      seed: metadataCases.fixtureGenerator.seed,
      syntheticOnly: metadataCases.fixtureGenerator.syntheticOnly,
    }) !== metadataCases.fixtureGenerator.configSha256
  ) {
    throw new DayflowDatasetIntegrityError(
      "CONFIG_HASH_MISMATCH",
      "Synthetic cases generator config detached hash mismatch",
    );
  }
  const executableVectors = metadataCases.evidenceBoundaryVectors.map(
    (metadata, index): ExecutableEvidenceBoundaryVector => {
      const rawVector = requireRecord(
        rawVectors[index],
        "Evidence boundary vector",
      );
      const allowedKeys = new Set([
        "vectorId",
        "vectorKind",
        "syntheticSentinel",
        "fixtureSha256",
        "expectedDisposition",
        "expectedIssueCodes",
        "payload",
      ]);
      if (Object.keys(rawVector).some((key) => !allowedKeys.has(key))) {
        throw new DayflowDatasetIntegrityError(
          "VECTOR_PAYLOAD_MISMATCH",
          `Evidence vector ${metadata.vectorId} has an unknown field`,
        );
      }
      const payload = executableEvidencePayloadSchema.parse(rawVector.payload);
      const snapshotIdentity =
        payload.exportManifest.databaseSnapshotIdentity;
      if (
        payload.exportManifest.dataOrigin !== "synthetic" ||
        payload.exportManifest.studyPhase !== "contract_conformance" ||
        payload.exportManifest.studyProtocolHash !==
          metadataCases.studyProtocolHash ||
        snapshotIdentity.snapshotKind !== "synthetic-fixture" ||
        snapshotIdentity.fixtureSetId !== metadataCases.fixtureSetId ||
        snapshotIdentity.fixtureGeneratorVersion !==
          metadataCases.fixtureGenerator.version ||
        snapshotIdentity.fixtureGeneratorSeed !==
          metadataCases.fixtureGenerator.seed ||
        snapshotIdentity.fixtureGeneratorConfigSha256 !==
          metadataCases.fixtureGenerator.configSha256
      ) {
        throw new DayflowDatasetIntegrityError(
          "VECTOR_PAYLOAD_MISMATCH",
          `Evidence vector ${metadata.vectorId} is not nested synthetic-only lineage`,
        );
      }
      const actualKind = classifyDayflowCoverage({
        coverage: payload.exportManifest.coverage,
        artifacts: payload.exportManifest.artifacts,
      });
      if (
        actualKind !==
        (metadata.vectorKind === "valid_empty"
          ? "valid-empty"
          : metadata.vectorKind)
      ) {
        throw new DayflowDatasetIntegrityError(
          "VECTOR_PAYLOAD_MISMATCH",
          `Evidence vector ${metadata.vectorId} payload does not match its kind`,
        );
      }
      const vector = { ...metadata, payload };
      if (dayflowEvidenceVectorSha256(vector) !== metadata.fixtureSha256) {
        throw new DayflowDatasetIntegrityError(
          "VECTOR_HASH_MISMATCH",
          `Evidence vector ${metadata.vectorId} detached hash mismatch`,
        );
      }
      return vector;
    },
  );
  const cases: DayflowAblationExecutableCases = {
    ...metadataCases,
    evidenceBoundaryVectors: executableVectors,
  };
  const matchesOuterLineage = (entry: {
    dataOrigin: string;
    studyPhase: string;
    studyProtocolHash: string;
  }): boolean =>
    entry.dataOrigin === cases.dataOrigin &&
    entry.studyPhase === cases.studyPhase &&
    entry.studyProtocolHash === cases.studyProtocolHash;
  if (
    cases.matchedInputVectors.some(
      (vector) =>
        !matchesOuterLineage(vector.a1Input) ||
        !matchesOuterLineage(vector.bInput),
    ) ||
    cases.dagVectors.some(
      (dag) =>
        !matchesOuterLineage(dag.generation) ||
        dag.decisions.some((decision) => !matchesOuterLineage(decision)) ||
        !matchesOuterLineage(dag.closure) ||
        !matchesOuterLineage(dag.manifest) ||
        !matchesOuterLineage(dag.binding),
    )
  ) {
    throw new DayflowDatasetIntegrityError(
      "VECTOR_PAYLOAD_MISMATCH",
      "Synthetic cases contain nested lineage outside the outer fixture tuple",
    );
  }
  if (dayflowSyntheticCasesSha256(cases) !== cases.casesSha256) {
    throw new DayflowDatasetIntegrityError(
      "CASES_HASH_MISMATCH",
      "Synthetic cases detached hash mismatch",
    );
  }
  return cases;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DayflowDatasetIntegrityError(
      "VECTOR_PAYLOAD_MISMATCH",
      `${label} must be an object`,
    );
  }
  return value as Record<string, unknown>;
}

export function dayflowFixtureGeneratorConfigSha256(value: Readonly<{
  version: string;
  seed: string;
  syntheticOnly: true;
}>): string {
  return domainSeparatedSha256(
    DAYFLOW_FIXTURE_GENERATOR_CONFIG_HASH_DOMAIN,
    value,
  );
}

export function dayflowEvidenceVectorSha256(
  value: ExecutableEvidenceBoundaryVector,
): string {
  const { fixtureSha256: _detached, ...preimage } = value;
  return domainSeparatedSha256(DAYFLOW_EVIDENCE_VECTOR_HASH_DOMAIN, preimage);
}

export function dayflowSyntheticCasesSha256(
  value: DayflowAblationExecutableCases,
): string {
  const { casesSha256: _detached, ...preimage } = value;
  return domainSeparatedSha256(DAYFLOW_SYNTHETIC_CASES_HASH_DOMAIN, preimage);
}

type CombinedSyntheticDatasetValidator = (
  config: DayflowAblationSyntheticConfig,
  cases: DayflowAblationExecutableCases,
) => boolean;

/**
 * Combined loading intentionally fails closed until the evaluation contract
 * publishes its cross-document validator. Keeping the dependency here typed
 * avoids duplicating evaluation policy in this pure dataset builder.
 */
export function loadDayflowAblationSyntheticDataset(
  configRaw: string,
  casesRaw: string,
): Readonly<{
  config: DayflowAblationSyntheticConfig;
  cases: DayflowAblationExecutableCases;
}> {
  const config = loadDayflowAblationSyntheticConfig(configRaw);
  const cases = loadDayflowAblationSyntheticCases(casesRaw);
  const validator = (
    dayflowAblationContracts as typeof dayflowAblationContracts &
      Readonly<{
        validateDayflowAblationSyntheticDataset?: CombinedSyntheticDatasetValidator;
      }>
  ).validateDayflowAblationSyntheticDataset;
  if (validator === undefined) {
    throw new DayflowDatasetIntegrityError(
      "EVAL_CROSS_VALIDATOR_UNAVAILABLE",
      "Evaluation contract combined synthetic dataset validator is unavailable",
    );
  }
  if (!validator(config, cases)) {
    throw new DayflowDatasetIntegrityError(
      "EVAL_CROSS_VALIDATION_FAILED",
      "Evaluation contract rejected the combined synthetic dataset",
    );
  }
  return { config, cases };
}

const SYNTHETIC_DRY_RUN_SNAPSHOT_HASH_DOMAIN =
  "blabase.dayflow-ablation.synthetic-dry-run-snapshot.v0.1";
const SYNTHETIC_DRY_RUN_MODE = "synthetic-contract-conformance" as const;
const COMPARISON_REPORT_FORMAT =
  "dayflow-ablation-comparison-report-v0.1" as const;
const COLIN_DECISION_FORMAT =
  "dayflow-ablation-colin-decision-v0.1" as const;

const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const dryRunIdentitySchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
const dryRunLabelSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u)
  .refine((value) => !value.includes(".."), {
    message: "runLabel must not contain '..'",
  });
const canonicalUtcTimestampSchema = z
  .string()
  .datetime({ offset: false, precision: 3 });
const safeMarkdownScalarSchema = (maximumLength: number) =>
  z
    .string()
    .min(1)
    .max(maximumLength)
    .refine((value) => value === value.trim(), {
      message: "Markdown values must not have surrounding whitespace",
    })
    .refine(
      (value) =>
        /^[\p{L}\p{N}]/u.test(value) &&
        !/[\u0000-\u001f\u007f-\u009f\u2028\u2029`<>\[\]]/u.test(value),
      { message: "Markdown values must be single-line safe text" },
    );

const dryRunDecisionSchema = z
  .object({
    decidedAt: canonicalUtcTimestampSchema,
    outcome: z.enum(["continue", "revise", "stop"]),
    rationale: safeMarkdownScalarSchema(2_000),
    followUpConditions: z
      .array(safeMarkdownScalarSchema(500))
      .max(16)
      .refine((values) => new Set(values).size === values.length, {
        message: "followUpConditions must be unique",
      }),
    rollback: safeMarkdownScalarSchema(1_000),
  })
  .strict();

const syntheticDryRunInputSchema = z
  .object({
    mode: z.literal(SYNTHETIC_DRY_RUN_MODE),
    runLabel: dryRunLabelSchema,
    experimentManifest: experimentManifestSchema,
    runResults: runResultsSchema,
    configIdentity: z
      .object({
        configId: dryRunIdentitySchema,
        configSha256: sha256HexSchema,
      })
      .strict(),
    casesIdentity: z
      .object({
        fixtureSetId: dryRunIdentitySchema,
        casesSha256: sha256HexSchema,
      })
      .strict(),
    colinDecision: dryRunDecisionSchema,
  })
  .strict();

export type DayflowAblationSyntheticDryRunInput = z.input<
  typeof syntheticDryRunInputSchema
>;

export type DayflowAblationSyntheticDryRunFile = Readonly<{
  relativePath:
    | "experiment-manifest.json"
    | "run-results.json"
    | "comparison-report.md"
    | "colin-decision.md";
  mediaType: "application/json" | "text/markdown; charset=utf-8";
  byteLength: number;
  rawSha256: string;
  bytes: Uint8Array;
}>;

export type DayflowAblationSyntheticDryRunPackage = Readonly<{
  mode: typeof SYNTHETIC_DRY_RUN_MODE;
  runLabel: string;
  files: readonly [
    DayflowAblationSyntheticDryRunFile,
    DayflowAblationSyntheticDryRunFile,
    DayflowAblationSyntheticDryRunFile,
    DayflowAblationSyntheticDryRunFile,
  ];
  snapshotSha256: string;
}>;

function rawSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function canonicalJsonLfBytes(value: unknown): Uint8Array {
  return utf8Bytes(`${jcsCanonicalize(value)}\n`);
}

function buildDryRunFile(
  relativePath: DayflowAblationSyntheticDryRunFile["relativePath"],
  mediaType: DayflowAblationSyntheticDryRunFile["mediaType"],
  bytes: Uint8Array,
): DayflowAblationSyntheticDryRunFile {
  return {
    relativePath,
    mediaType,
    byteLength: bytes.byteLength,
    rawSha256: rawSha256(bytes),
    bytes,
  };
}

function assertSyntheticDryRunLineage(input: {
  experimentManifest: DayflowAblationExperimentManifest;
  runResults: DayflowAblationRunResults;
  configIdentity: { configId: string; configSha256: string };
  casesIdentity: { fixtureSetId: string; casesSha256: string };
  decidedAt: string;
}): void {
  const { experimentManifest, runResults } = input;
  if (
    experimentManifest.targetDataOrigin !== "synthetic" ||
    experimentManifest.targetStudyPhase !== "contract_conformance" ||
    runResults.dataOrigin !== "synthetic" ||
    runResults.studyPhase !== "contract_conformance"
  ) {
    throw new TypeError(
      "Synthetic dry-run packaging requires synthetic contract_conformance lineage",
    );
  }
  if (
    runResults.experimentManifestRef.schemaVersion !==
      experimentManifest.experimentManifestSchemaVersion ||
    runResults.experimentManifestRef.experimentManifestId !==
      experimentManifest.experimentManifestId ||
    runResults.experimentManifestRef.experimentManifestSha256 !==
      experimentManifest.experimentManifestSha256
  ) {
    throw new TypeError(
      "Run results do not reference the exact experiment manifest",
    );
  }
  if (
    runResults.studyProtocolHash !==
    runResults.studyProtocolRef.studyProtocolHash
  ) {
    throw new TypeError(
      "Run results do not preserve exact study protocol lineage",
    );
  }
  if (
    input.configIdentity.configId !==
      experimentManifest.configurationIdentity.configId ||
    input.configIdentity.configSha256 !==
      experimentManifest.configurationIdentity.configSha256
  ) {
    throw new TypeError(
      "Config identity does not match the experiment manifest",
    );
  }
  if (
    input.casesIdentity.fixtureSetId !==
      experimentManifest.commonEvaluationInputIdentity.inputId ||
    input.casesIdentity.casesSha256 !==
      experimentManifest.commonEvaluationInputIdentity.inputSha256
  ) {
    throw new TypeError(
      "Cases identity does not match the experiment manifest",
    );
  }
  const manifestCreatedAt = Date.parse(experimentManifest.createdAt);
  const completedAt = Date.parse(runResults.completedAt);
  const decidedAt = Date.parse(input.decidedAt);
  if (
    !Number.isFinite(manifestCreatedAt) ||
    !Number.isFinite(completedAt) ||
    !Number.isFinite(decidedAt) ||
    manifestCreatedAt > completedAt ||
    completedAt > decidedAt
  ) {
    throw new TypeError(
      "Synthetic dry-run timestamps must satisfy manifest.createdAt <= runResults.completedAt <= decision.decidedAt",
    );
  }
}

function renderComparisonReport(input: {
  runLabel: string;
  experimentManifest: DayflowAblationExperimentManifest;
  runResults: DayflowAblationRunResults;
  configIdentity: { configId: string; configSha256: string };
  casesIdentity: { fixtureSetId: string; casesSha256: string };
}): string {
  const { experimentManifest, runResults } = input;
  const terminalRunLines = runResults.terminalArmRunRefs.map(
    (reference) =>
      `- Arm \`${reference.armId}\`; replicate \`${reference.replicateIndex}\`; run ID \`${reference.runId}\`; run SHA-256 \`${reference.runSha256}\`.`,
  );
  return `${[
    "# DFA-002 Synthetic Contract-Conformance Comparison Dry Run",
    "",
    `- Format: \`${COMPARISON_REPORT_FORMAT}\``,
    `- Mode: \`${SYNTHETIC_DRY_RUN_MODE}\``,
    `- Run label: \`${input.runLabel}\``,
    "- Owner: `colin`",
    "- Data origin: `synthetic`",
    "- Study phase: `contract_conformance`",
    `- Experiment manifest schema: \`${experimentManifest.experimentManifestSchemaVersion}\``,
    `- Experiment manifest ID: \`${experimentManifest.experimentManifestId}\``,
    `- Experiment manifest SHA-256: \`${experimentManifest.experimentManifestSha256}\``,
    `- Run results schema: \`${runResults.runResultsSchemaVersion}\``,
    `- Run results ID: \`${runResults.runResultsId}\``,
    `- Run results SHA-256: \`${runResults.runResultsSha256}\``,
    `- Study protocol schema: \`${runResults.studyProtocolRef.schemaVersion}\``,
    `- Study protocol SHA-256: \`${runResults.studyProtocolRef.studyProtocolHash}\``,
    `- Execution freeze schema: \`${runResults.executionFreezeRef.schemaVersion}\``,
    `- Execution freeze ID: \`${runResults.executionFreezeRef.evaluationExecutionFreezeId}\``,
    `- Execution freeze SHA-256: \`${runResults.executionFreezeRef.evaluationExecutionFreezeSha256}\``,
    `- Config ID: \`${input.configIdentity.configId}\``,
    `- Config SHA-256: \`${input.configIdentity.configSha256}\``,
    `- Cases fixture-set ID: \`${input.casesIdentity.fixtureSetId}\``,
    `- Cases SHA-256: \`${input.casesIdentity.casesSha256}\``,
    "- Metrics status: `not-computed`",
    "- Execution resolution: `unresolved-fixture-lineage`",
    "- Blind review: `not-performed`",
    "- Arm reveal: `not-performed`",
    "- Real experiment approval: `false`",
    "",
    "## Terminal run references",
    "",
    ...terminalRunLines,
    "",
    "## Limitations",
    "",
    "- This package is synthetic contract-conformance material only; it contains no live or production data.",
    "- Terminal run references are recorded but are not resolved by this four-file package.",
    "- Metrics were not computed; this report makes no A/B/C execution or performance claim.",
    "- Blind review, arm reveal, provider execution, and production approval were not performed.",
  ].join("\n")}\n`;
}

function renderColinDecision(input: {
  runLabel: string;
  experimentManifest: DayflowAblationExperimentManifest;
  runResults: DayflowAblationRunResults;
  comparisonReportRawSha256: string;
  comparisonReportByteLength: number;
  decision: z.infer<typeof dryRunDecisionSchema>;
}): string {
  const followUpLines =
    input.decision.followUpConditions.length === 0
      ? ["- None."]
      : input.decision.followUpConditions.map((condition) => `- ${condition}`);
  return `${[
    "# Colin Decision — DFA-002 Synthetic Packaging Dry Run",
    "",
    `- Format: \`${COLIN_DECISION_FORMAT}\``,
    `- Mode: \`${SYNTHETIC_DRY_RUN_MODE}\``,
    `- Run label: \`${input.runLabel}\``,
    "- Decision authority: `colin`",
    "- Approval scope: `synthetic-packaging-only`",
    "- Real experiment approval: `false`",
    `- Experiment manifest schema: \`${input.experimentManifest.experimentManifestSchemaVersion}\``,
    `- Experiment manifest ID: \`${input.experimentManifest.experimentManifestId}\``,
    `- Experiment manifest SHA-256: \`${input.experimentManifest.experimentManifestSha256}\``,
    `- Run results schema: \`${input.runResults.runResultsSchemaVersion}\``,
    `- Run results ID: \`${input.runResults.runResultsId}\``,
    `- Run results SHA-256: \`${input.runResults.runResultsSha256}\``,
    `- Comparison report raw SHA-256: \`${input.comparisonReportRawSha256}\``,
    `- Comparison report byte length: \`${input.comparisonReportByteLength}\``,
    `- Decided at: \`${input.decision.decidedAt}\``,
    `- Outcome: \`${input.decision.outcome}\``,
    `- Rationale: ${input.decision.rationale}`,
    "",
    "## Follow-up conditions",
    "",
    ...followUpLines,
    "",
    "## Rollback",
    "",
    `- ${input.decision.rollback}`,
    "",
    "This decision applies only to deterministic synthetic packaging. It is not approval of resolved experiment execution, live collection, production enablement, or release.",
  ].join("\n")}\n`;
}

/**
 * Builds the four Colin-owned synthetic dry-run files entirely in memory.
 * This function deliberately has no filesystem, clock, process, environment,
 * provider, or network capability.
 */
export function buildDayflowAblationSyntheticDryRunPackage(
  candidate: DayflowAblationSyntheticDryRunInput,
): DayflowAblationSyntheticDryRunPackage {
  const input = syntheticDryRunInputSchema.parse(candidate);
  assertSyntheticDryRunLineage({
    experimentManifest: input.experimentManifest,
    runResults: input.runResults,
    configIdentity: input.configIdentity,
    casesIdentity: input.casesIdentity,
    decidedAt: input.colinDecision.decidedAt,
  });

  const experimentManifestFile = buildDryRunFile(
    "experiment-manifest.json",
    "application/json",
    canonicalJsonLfBytes(input.experimentManifest),
  );
  const runResultsFile = buildDryRunFile(
    "run-results.json",
    "application/json",
    canonicalJsonLfBytes(input.runResults),
  );
  const comparisonReportFile = buildDryRunFile(
    "comparison-report.md",
    "text/markdown; charset=utf-8",
    utf8Bytes(
      renderComparisonReport({
        runLabel: input.runLabel,
        experimentManifest: input.experimentManifest,
        runResults: input.runResults,
        configIdentity: input.configIdentity,
        casesIdentity: input.casesIdentity,
      }),
    ),
  );
  const colinDecisionFile = buildDryRunFile(
    "colin-decision.md",
    "text/markdown; charset=utf-8",
    utf8Bytes(
      renderColinDecision({
        runLabel: input.runLabel,
        experimentManifest: input.experimentManifest,
        runResults: input.runResults,
        comparisonReportRawSha256: comparisonReportFile.rawSha256,
        comparisonReportByteLength: comparisonReportFile.byteLength,
        decision: input.colinDecision,
      }),
    ),
  );
  const files = [
    experimentManifestFile,
    runResultsFile,
    comparisonReportFile,
    colinDecisionFile,
  ] as const;
  const snapshotSha256 = domainSeparatedSha256(
    SYNTHETIC_DRY_RUN_SNAPSHOT_HASH_DOMAIN,
    files.map(({ relativePath, mediaType, byteLength, rawSha256: sha256 }) => ({
      relativePath,
      mediaType,
      byteLength,
      rawSha256: sha256,
    })),
  );
  return {
    mode: SYNTHETIC_DRY_RUN_MODE,
    runLabel: input.runLabel,
    files,
    snapshotSha256,
  };
}

function uniqueMarkdownCodeField(
  markdown: string,
  label: string,
): string | undefined {
  const prefix = `- ${label}: \``;
  const matches = markdown
    .split("\n")
    .filter((line) => line.startsWith(prefix) && line.endsWith("`"));
  if (matches.length !== 1) {
    return undefined;
  }
  return matches[0]!.slice(prefix.length, -1);
}

/** Verifies the terminal Markdown binding without trusting returned metadata. */
export function verifyDayflowAblationSyntheticDryRunDecisionBinding(
  files: ReadonlyArray<
    Readonly<{
      relativePath: string;
      bytes: Uint8Array;
    }>
  >,
): boolean {
  const reports = files.filter(
    (file) => file.relativePath === "comparison-report.md",
  );
  const decisions = files.filter(
    (file) => file.relativePath === "colin-decision.md",
  );
  if (reports.length !== 1 || decisions.length !== 1) {
    return false;
  }
  try {
    const report = reports[0]!;
    const decisionText = new TextDecoder("utf-8", { fatal: true }).decode(
      decisions[0]!.bytes,
    );
    if (
      decisionText.includes("\r") ||
      !decisionText.endsWith("\n") ||
      uniqueMarkdownCodeField(decisionText, "Format") !==
        COLIN_DECISION_FORMAT ||
      uniqueMarkdownCodeField(decisionText, "Mode") !==
        SYNTHETIC_DRY_RUN_MODE ||
      uniqueMarkdownCodeField(decisionText, "Real experiment approval") !==
        "false"
    ) {
      return false;
    }
    return (
      uniqueMarkdownCodeField(
        decisionText,
        "Comparison report raw SHA-256",
      ) === rawSha256(report.bytes) &&
      uniqueMarkdownCodeField(
        decisionText,
        "Comparison report byte length",
      ) === String(report.bytes.byteLength)
    );
  } catch {
    return false;
  }
}

const STAGE_A_CONFIG_PATH =
  "suggestion/eval/synthetic/dayflowEvidenceAblationConfig.v0.2.json";
const STAGE_A_CASES_PATH =
  "suggestion/eval/synthetic/dayflowEvidenceAblationCases.v0.2.json";
const STAGE_A_LIMITATIONS = [
  "COMMANDS_MODELS_PROVIDERS_METRICS_NOT_EXECUTED",
  "LINEAGE_ARTIFACTS_CALLER_RESOLVED",
  "SYNTHETIC_CONTRACT_PACKAGING_ONLY",
] as const;

function requiredRepositoryRevision(repositoryId: "blabase" | "dayflow"): string {
  const pin = dayflowAblationContracts.DFA002_REQUIRED_PROVENANCE_PIN_SHAPES.find(
    (entry) =>
      entry.repositoryId === repositoryId &&
      entry.pinKind === "repository-revision",
  );
  if (pin === undefined || !("expectedRevision" in pin)) {
    throw new TypeError(`Missing ${repositoryId} revision contract`);
  }
  return pin.expectedRevision;
}

const STAGE_A_BLABASE_REVISION = requiredRepositoryRevision("blabase");
const STAGE_A_DAYFLOW_REVISION = requiredRepositoryRevision("dayflow");
const STAGE_A_REQUIRED_SNAPSHOT_PATHS = Object.freeze(
  Array.from(
    new Set([
      ...dayflowAblationContracts.DFA002_CONTRACT_SOURCE_ENTRIES.map(
        (entry) => entry.relativePath,
      ),
      ...dayflowAblationContracts.DFA002_COMMAND_DEFINING_INPUTS,
      ...dayflowAblationContracts.DFA002_REQUIRED_PROVENANCE_PIN_SHAPES.filter(
        (entry) =>
          entry.repositoryId === "blabase" && entry.pinKind === "file-sha256",
      ).map((entry) => entry.relativePath),
    ]),
  ).sort(),
);

const canonicalByteLengthSchema = z
  .string()
  .regex(/^[1-9][0-9]*$/u);
const stageASourceSnapshotEntrySchema = z
  .object({
    relativePath: z.string().min(1).max(512),
    bytes: z.instanceof(Uint8Array),
    expectedByteLength: canonicalByteLengthSchema,
    expectedRawSha256: sha256HexSchema,
  })
  .strict();
const stageADayflowFilePinFactSchema = z
  .object({
    relativePath: z.string().min(1).max(512),
    expectedByteLength: canonicalByteLengthSchema,
    expectedSha256: sha256HexSchema,
  })
  .strict();
const stageAInputSchema = z
  .object({
    mode: z.literal(SYNTHETIC_DRY_RUN_MODE),
    runLabel: dryRunLabelSchema,
    configBytes: z.instanceof(Uint8Array),
    casesBytes: z.instanceof(Uint8Array),
    sourceSnapshot: z.array(stageASourceSnapshotEntrySchema).min(1).max(64),
    provenanceFacts: z
      .object({
        blabaseRevision: z.string().regex(/^[a-f0-9]{40}$/u),
        dayflowRevision: z.string().regex(/^[a-f0-9]{40}$/u),
        dayflowFilePins: z.array(stageADayflowFilePinFactSchema).max(16),
      })
      .strict(),
    toolVersions: z
      .object({
        node: safeMarkdownScalarSchema(64),
        dependencyCruiser: z.literal(
          dayflowAblationContracts.DFA002_REQUIRED_COMMANDS[0].toolVersion,
        ),
        eslint: z.literal(
          dayflowAblationContracts.DFA002_REQUIRED_COMMANDS[1].toolVersion,
        ),
        typescript: z.literal(
          dayflowAblationContracts.DFA002_REQUIRED_COMMANDS[2].toolVersion,
        ),
        vitest: z.literal(
          dayflowAblationContracts.DFA002_REQUIRED_COMMANDS[3].toolVersion,
        ),
      })
      .strict(),
    manifestCreatedAt: canonicalUtcTimestampSchema,
  })
  .strict();

export type DayflowAblationSyntheticManifestBuildInput = z.input<
  typeof stageAInputSchema
>;

export type DayflowAblationSyntheticManifestBuildResult = Readonly<{
  mode: typeof SYNTHETIC_DRY_RUN_MODE;
  runLabel: string;
  experimentManifest: DayflowAblationExperimentManifest;
  experimentManifestRef: z.infer<
    typeof dayflowAblationContracts.experimentManifestRefSchema
  >;
}>;

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}

function decodeUtf8Strict(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError(`${label} must be strict UTF-8`);
  }
}

function expectedTrackedMediaType(
  relativePath: string,
): "application/json; charset=utf-8" | "text/plain; charset=utf-8" {
  return relativePath.endsWith(".json")
    ? "application/json; charset=utf-8"
    : "text/plain; charset=utf-8";
}

function assertExactStageASnapshot(
  snapshot: z.infer<typeof stageASourceSnapshotEntrySchema>[],
): Map<string, z.infer<typeof stageASourceSnapshotEntrySchema>> {
  const paths = snapshot.map((entry) => entry.relativePath);
  if (
    paths.length !== STAGE_A_REQUIRED_SNAPSHOT_PATHS.length ||
    paths.some(
      (relativePath, index) =>
        relativePath !== STAGE_A_REQUIRED_SNAPSHOT_PATHS[index],
    ) ||
    new Set(paths).size !== paths.length
  ) {
    throw new TypeError(
      "sourceSnapshot must exactly and canonically cover the current DFA-002 source/provenance paths",
    );
  }
  for (const entry of snapshot) {
    if (
      entry.bytes.byteLength === 0 ||
      entry.expectedByteLength !== String(entry.bytes.byteLength) ||
      entry.expectedRawSha256 !== rawSha256(entry.bytes)
    ) {
      throw new TypeError(
        `sourceSnapshot stable fact mismatch for ${entry.relativePath}`,
      );
    }
  }
  return new Map(snapshot.map((entry) => [entry.relativePath, entry]));
}

function assertExactDayflowPinFacts(
  facts: z.infer<typeof stageADayflowFilePinFactSchema>[],
): Map<string, z.infer<typeof stageADayflowFilePinFactSchema>> {
  const expected =
    dayflowAblationContracts.DFA002_REQUIRED_PROVENANCE_PIN_SHAPES.filter(
      (entry) =>
        entry.repositoryId === "dayflow" && entry.pinKind === "file-sha256",
    );
  if (
    facts.length !== expected.length ||
    facts.some((fact, index) => {
      const pin = expected[index];
      return (
        pin === undefined ||
        !("expectedSha256" in pin) ||
        !("expectedByteLength" in pin) ||
        fact.relativePath !== pin.relativePath ||
        fact.expectedSha256 !== pin.expectedSha256 ||
        fact.expectedByteLength !== pin.expectedByteLength
      );
    })
  ) {
    throw new TypeError(
      "dayflowFilePins must exactly match the current stable Dayflow provenance facts",
    );
  }
  return new Map(facts.map((fact) => [fact.relativePath, fact]));
}

/** Stage A: builds and seals the current synthetic experiment manifest. */
export function buildDayflowAblationSyntheticExperimentManifest(
  candidate: DayflowAblationSyntheticManifestBuildInput,
): DayflowAblationSyntheticManifestBuildResult {
  const input = stageAInputSchema.parse(candidate);
  if (
    dayflowAblationContracts.DAYFLOW_ABLATION_ARTIFACT_REGISTRY.length !== 30 ||
    dayflowAblationContracts.dayflowAblationArtifactRegistry.length !== 30
  ) {
    throw new TypeError("DFA-002 artifact registry must contain exactly 30 rows");
  }
  if (
    input.provenanceFacts.blabaseRevision !== STAGE_A_BLABASE_REVISION ||
    input.provenanceFacts.dayflowRevision !== STAGE_A_DAYFLOW_REVISION
  ) {
    throw new TypeError("Repository revision facts are not current DFA-002 pins");
  }
  const sourceByPath = assertExactStageASnapshot(input.sourceSnapshot);
  const dayflowFactByPath = assertExactDayflowPinFacts(
    input.provenanceFacts.dayflowFilePins,
  );
  const configSource = sourceByPath.get(STAGE_A_CONFIG_PATH);
  const casesSource = sourceByPath.get(STAGE_A_CASES_PATH);
  if (
    configSource === undefined ||
    casesSource === undefined ||
    !bytesEqual(configSource.bytes, input.configBytes) ||
    !bytesEqual(casesSource.bytes, input.casesBytes)
  ) {
    throw new TypeError(
      "configBytes and casesBytes must equal their exact sourceSnapshot bytes",
    );
  }
  const { config, cases } = loadDayflowAblationSyntheticDataset(
    decodeUtf8Strict(input.configBytes, "configBytes"),
    decodeUtf8Strict(input.casesBytes, "casesBytes"),
  );
  if (
    config.configSchemaVersion !== "dayflow-evidence-ablation-config-v0.2" ||
    config.configId !== "synthetic.dayflow.dfa002.config.v0.2" ||
    cases.casesSchemaVersion !== "dayflow-evidence-ablation-cases-v0.2" ||
    cases.fixtureSetId !== "synthetic.dayflow.dfa002.cases.v0.2" ||
    config.dataOrigin !== "synthetic" ||
    config.studyPhase !== "contract_conformance" ||
    cases.dataOrigin !== "synthetic" ||
    cases.studyPhase !== "contract_conformance"
  ) {
    throw new TypeError(
      "Stage A requires the exact current synthetic contract-conformance config and cases",
    );
  }

  const provenancePins =
    dayflowAblationContracts.DFA002_REQUIRED_PROVENANCE_PIN_SHAPES.map(
      (shape) => {
        if (shape.pinKind === "repository-revision") {
          return {
            repositoryId: shape.repositoryId,
            pinRole: shape.pinRole,
            pinKind: shape.pinKind,
            relativePath: shape.relativePath,
            revision:
              shape.repositoryId === "blabase"
                ? input.provenanceFacts.blabaseRevision
                : input.provenanceFacts.dayflowRevision,
          };
        }
        const sha256 =
          shape.repositoryId === "blabase"
            ? sourceByPath.get(shape.relativePath)?.expectedRawSha256
            : dayflowFactByPath.get(shape.relativePath)?.expectedSha256;
        if (sha256 === undefined) {
          throw new TypeError(
            `Missing stable provenance fact for ${shape.repositoryId}:${shape.relativePath}`,
          );
        }
        return {
          repositoryId: shape.repositoryId,
          pinRole: shape.pinRole,
          pinKind: shape.pinKind,
          relativePath: shape.relativePath,
          sha256,
        };
      },
    );
  const sourceProvenancePayload = {
    schemaVersion: "dayflow-ablation-source-provenance-v0.1",
    pins: provenancePins,
    createdAt: input.manifestCreatedAt,
  } as dayflowAblationContracts.DayflowAblationSourceProvenancePayload;
  const sourceProvenance = dayflowAblationContracts.sourceProvenanceSchema.parse({
    ...sourceProvenancePayload,
    sourceProvenanceSha256:
      dayflowAblationContracts.dayflowAblationSourceProvenanceSha256(
        sourceProvenancePayload,
      ),
  });
  const candidateFiles =
    dayflowAblationContracts.DFA002_CONTRACT_SOURCE_ENTRIES.map((entry) => {
      const source = sourceByPath.get(entry.relativePath);
      if (source === undefined) {
        throw new TypeError(`Missing candidate source ${entry.relativePath}`);
      }
      return {
        relativePath: entry.relativePath,
        mediaType: expectedTrackedMediaType(entry.relativePath),
        byteLength: String(source.bytes.byteLength),
        rawSha256: source.expectedRawSha256,
        role: entry.role,
      };
    });
  const commandDefiningFiles =
    dayflowAblationContracts.DFA002_COMMAND_DEFINING_INPUTS.map(
      (relativePath) => {
        const source = sourceByPath.get(relativePath);
        if (source === undefined) {
          throw new TypeError(`Missing command input ${relativePath}`);
        }
        return {
          relativePath,
          mediaType: expectedTrackedMediaType(relativePath),
          byteLength: String(source.bytes.byteLength),
          rawSha256: source.expectedRawSha256,
        };
      },
    );
  const validationInputSetPayload = {
    trackedBaseRevision: input.provenanceFacts.blabaseRevision,
    candidateFiles,
    commandDefiningFiles,
    unexpectedTrackedPaths: [] as [],
  };
  const validationInputSet =
    dayflowAblationContracts.dfa002ValidationInputSetSchema.parse({
      ...validationInputSetPayload,
      validationInputSetSha256:
        dayflowAblationContracts.dfa002ValidationInputSetSha256(
          validationInputSetPayload,
        ),
    });
  const manifestCandidate = {
    experimentManifestSchemaVersion:
      "dayflow-ablation-experiment-manifest-v0.2",
    experimentManifestId: `synthetic.dayflow.dfa002.experiment-manifest.${input.runLabel}`,
    lineageClass: "control",
    scopeId: "DFA-002",
    ownerPseudonym: "colin",
    targetDataOrigin: "synthetic",
    targetStudyPhase: "contract_conformance",
    sourceProvenance,
    validationInputSet,
    baseCodeProvenance: {
      blabaseRevision: input.provenanceFacts.blabaseRevision,
      dayflowRevision: input.provenanceFacts.dayflowRevision,
      sourceProvenanceSha256: sourceProvenance.sourceProvenanceSha256,
    },
    configurationIdentity: {
      schemaVersion: config.configSchemaVersion,
      configId: config.configId,
      relativePath: STAGE_A_CONFIG_PATH,
      configSha256: rawSha256(input.configBytes),
    },
    toolVersions: input.toolVersions,
    commandIdentities:
      dayflowAblationContracts.DFA002_REQUIRED_COMMANDS.map((command) => ({
        ...command,
        argv: [...command.argv],
      })),
    commonEvaluationInputIdentity: {
      schemaVersion: cases.casesSchemaVersion,
      inputId: cases.fixtureSetId,
      relativePath: STAGE_A_CASES_PATH,
      inputSha256: rawSha256(input.casesBytes),
    },
    limitations: [...STAGE_A_LIMITATIONS],
    createdAt: input.manifestCreatedAt,
    experimentManifestSha256: "0".repeat(64),
  } as DayflowAblationExperimentManifest;
  const experimentManifest = experimentManifestSchema.parse({
    ...manifestCandidate,
    experimentManifestSha256:
      dayflowAblationContracts.dayflowAblationExperimentManifestSha256(
        manifestCandidate,
      ),
  });
  const experimentManifestRef =
    dayflowAblationContracts.experimentManifestRefSchema.parse({
      schemaVersion: experimentManifest.experimentManifestSchemaVersion,
      experimentManifestId: experimentManifest.experimentManifestId,
      experimentManifestSha256:
        experimentManifest.experimentManifestSha256,
    });
  return {
    mode: SYNTHETIC_DRY_RUN_MODE,
    runLabel: input.runLabel,
    experimentManifest,
    experimentManifestRef,
  };
}

const stageAManifestResultSchema = z
  .object({
    mode: z.literal(SYNTHETIC_DRY_RUN_MODE),
    runLabel: dryRunLabelSchema,
    experimentManifest: experimentManifestSchema,
    experimentManifestRef:
      dayflowAblationContracts.experimentManifestRefSchema,
  })
  .strict();
const stageBInputSchema = z
  .object({
    stageA: stageAManifestResultSchema,
    studyProtocol: dayflowAblationContracts.executableStudyProtocolSchema,
    executionFreeze:
      dayflowAblationContracts.evaluationExecutionFreezeSchema,
    terminalRuns: z.array(dayflowAblationContracts.runSchema).min(1).max(32),
    completedAt: canonicalUtcTimestampSchema,
  })
  .strict();

export type DayflowAblationSyntheticRunResultsBuildInput = z.input<
  typeof stageBInputSchema
>;

export type DayflowAblationSyntheticRunResultsBuildResult = Readonly<{
  runResults: DayflowAblationRunResults;
  runResultsRef: z.infer<typeof dayflowAblationContracts.runResultsRefSchema>;
}>;

function exactCanonicalValue(left: unknown, right: unknown): boolean {
  return jcsCanonicalize(left) === jcsCanonicalize(right);
}

function timestampMs(value: string, label: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError(`${label} must be a valid timestamp`);
  }
  return milliseconds;
}

/** Stage B: verifies full lineage artifacts and derives sealed run-results. */
export function buildDayflowAblationSyntheticRunResults(
  candidate: DayflowAblationSyntheticRunResultsBuildInput,
): DayflowAblationSyntheticRunResultsBuildResult {
  const input = stageBInputSchema.parse(candidate);
  const { stageA, studyProtocol, executionFreeze } = input;
  const expectedManifestId =
    `synthetic.dayflow.dfa002.experiment-manifest.${stageA.runLabel}`;
  if (
    stageA.experimentManifest.experimentManifestId !== expectedManifestId ||
    !exactCanonicalValue(stageA.experimentManifestRef, {
      schemaVersion:
        stageA.experimentManifest.experimentManifestSchemaVersion,
      experimentManifestId: stageA.experimentManifest.experimentManifestId,
      experimentManifestSha256:
        stageA.experimentManifest.experimentManifestSha256,
    })
  ) {
    throw new TypeError("Stage A manifest and reference do not match exactly");
  }
  if (
    studyProtocol.studyProtocolSchemaVersion !==
      "dayflow-ablation-study-protocol-v0.3" ||
    studyProtocol.targetDataOrigin !== "synthetic" ||
    studyProtocol.targetStudyPhase !== "contract_conformance" ||
    !exactCanonicalValue(
      studyProtocol.experimentManifestRef,
      stageA.experimentManifestRef,
    )
  ) {
    throw new TypeError(
      "Study protocol does not bind the exact synthetic Stage A manifest",
    );
  }
  const studyProtocolRef = {
    schemaVersion: studyProtocol.studyProtocolSchemaVersion,
    studyProtocolHash: studyProtocol.studyProtocolHash,
  };
  if (
    executionFreeze.evaluationExecutionFreezeSchemaVersion !==
      "dayflow-ablation-evaluation-execution-freeze-v0.3" ||
    executionFreeze.targetDataOrigin !== "synthetic" ||
    executionFreeze.targetStudyPhase !== "contract_conformance" ||
    !exactCanonicalValue(
      executionFreeze.experimentManifestRef,
      stageA.experimentManifestRef,
    ) ||
    !exactCanonicalValue(executionFreeze.studyProtocolRef, studyProtocolRef)
  ) {
    throw new TypeError(
      "Execution freeze does not bind the exact manifest and study protocol",
    );
  }
  const executionFreezeRef = {
    schemaVersion: executionFreeze.evaluationExecutionFreezeSchemaVersion,
    evaluationExecutionFreezeId:
      executionFreeze.evaluationExecutionFreezeId,
    evaluationExecutionFreezeSha256:
      executionFreeze.evaluationExecutionFreezeSha256,
  };
  const manifestCreatedAt = timestampMs(
    stageA.experimentManifest.createdAt,
    "manifest.createdAt",
  );
  const protocolCreatedAt = timestampMs(
    studyProtocol.createdAt,
    "studyProtocol.createdAt",
  );
  const freezeCreatedAt = timestampMs(
    executionFreeze.createdAt,
    "executionFreeze.createdAt",
  );
  const completedAt = timestampMs(input.completedAt, "completedAt");
  if (
    manifestCreatedAt > protocolCreatedAt ||
    protocolCreatedAt > freezeCreatedAt ||
    freezeCreatedAt > completedAt
  ) {
    throw new TypeError(
      "Stage B chronology must be manifest <= protocol <= freeze <= completion",
    );
  }

  const terminalKeys = new Set<string>();
  for (const run of input.terminalRuns) {
    const key = `${run.armId}\u0000${run.replicateIndex}`;
    if (terminalKeys.has(key)) {
      throw new TypeError(`Duplicate terminal run for ${run.armId}/${run.replicateIndex}`);
    }
    terminalKeys.add(key);
    if (
      run.runSchemaVersion !== "dayflow-ablation-run-v0.4" ||
      run.dataOrigin !== "synthetic" ||
      run.studyPhase !== "contract_conformance" ||
      run.status !== "completed" ||
      run.studyProtocolHash !== studyProtocol.studyProtocolHash ||
      !exactCanonicalValue(run.executionFreezeRef, executionFreezeRef)
    ) {
      throw new TypeError(
        `Terminal run ${run.runId} does not bind the exact synthetic protocol and freeze`,
      );
    }
    if (
      timestampMs(run.startedAt, `${run.runId}.startedAt`) < freezeCreatedAt ||
      timestampMs(run.completedAt, `${run.runId}.completedAt`) > completedAt
    ) {
      throw new TypeError(`Terminal run ${run.runId} violates Stage B chronology`);
    }
  }
  const expectedTerminalKeys = new Set<string>();
  for (const armId of studyProtocol.armPolicy.enabledArms) {
    const replicateCount = studyProtocol.armPolicy.replicateCountByArm[armId];
    for (let replicateIndex = 0; replicateIndex < replicateCount; replicateIndex += 1) {
      expectedTerminalKeys.add(`${armId}\u0000${replicateIndex}`);
    }
  }
  if (
    terminalKeys.size !== expectedTerminalKeys.size ||
    [...terminalKeys].some((key) => !expectedTerminalKeys.has(key))
  ) {
    throw new TypeError(
      "Terminal runs must exactly cover the study protocol arm/replicate policy",
    );
  }
  const armOrder = new Map(
    ["A0", "A1", "B", "C"].map((armId, index) => [armId, index]),
  );
  const terminalArmRunRefs = input.terminalRuns
    .map((run) => ({
      schemaVersion: run.runSchemaVersion,
      runId: run.runId,
      runSha256: run.runSha256,
      armId: run.armId,
      replicateIndex: run.replicateIndex,
    }))
    .sort((left, right) => {
      const armDifference =
        (armOrder.get(left.armId) ?? Number.MAX_SAFE_INTEGER) -
        (armOrder.get(right.armId) ?? Number.MAX_SAFE_INTEGER);
      if (armDifference !== 0) return armDifference;
      if (left.replicateIndex !== right.replicateIndex) {
        return left.replicateIndex - right.replicateIndex;
      }
      return left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0;
    });
  const runResultsCandidate = {
    runResultsSchemaVersion: "dayflow-ablation-run-results-v0.1",
    runResultsId: `synthetic.dayflow.dfa002.run-results.${stageA.runLabel}`,
    lineageClass: "evidence",
    dataOrigin: "synthetic",
    studyPhase: "contract_conformance",
    studyProtocolHash: studyProtocol.studyProtocolHash,
    experimentManifestRef: stageA.experimentManifestRef,
    studyProtocolRef,
    executionFreezeRef,
    terminalArmRunRefs,
    completedAt: input.completedAt,
    runResultsSha256: "0".repeat(64),
  } as DayflowAblationRunResults;
  const runResults = runResultsSchema.parse({
    ...runResultsCandidate,
    runResultsSha256:
      dayflowAblationContracts.dayflowAblationRunResultsSha256(
        runResultsCandidate,
      ),
  });
  const runResultsRef =
    dayflowAblationContracts.runResultsRefSchema.parse({
      schemaVersion: runResults.runResultsSchemaVersion,
      runResultsId: runResults.runResultsId,
      runResultsSha256: runResults.runResultsSha256,
    });
  return { runResults, runResultsRef };
}

const SYNTHETIC_DRY_RUN_FILE_LAYOUT = [
  {
    relativePath: "experiment-manifest.json",
    mediaType: "application/json",
  },
  { relativePath: "run-results.json", mediaType: "application/json" },
  {
    relativePath: "comparison-report.md",
    mediaType: "text/markdown; charset=utf-8",
  },
  {
    relativePath: "colin-decision.md",
    mediaType: "text/markdown; charset=utf-8",
  },
] as const;

function exactObjectKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const canonicalExpected = [...expected].sort();
  if (
    actual.length !== canonicalExpected.length ||
    actual.some((key, index) => key !== canonicalExpected[index])
  ) {
    throw new TypeError(`${label} has an invalid field set`);
  }
}

function parseCanonicalDryRunJson<T>(
  bytes: Uint8Array,
  schema: { parse(value: unknown): T },
  label: string,
): T {
  const text = decodeUtf8Strict(bytes, label);
  if (!text.endsWith("\n") || text.endsWith("\n\n") || text.includes("\r")) {
    throw new TypeError(`${label} must use canonical single-LF framing`);
  }
  const parsed = schema.parse(parseDuplicateAwareJson(text.slice(0, -1)));
  if (!bytesEqual(bytes, canonicalJsonLfBytes(parsed))) {
    throw new TypeError(`${label} must be canonical JCS+LF`);
  }
  return parsed;
}

function parseDryRunDecisionMarkdown(input: {
  text: string;
  runLabel: string;
  experimentManifest: DayflowAblationExperimentManifest;
  runResults: DayflowAblationRunResults;
  comparisonReportRawSha256: string;
  comparisonReportByteLength: number;
}): z.infer<typeof dryRunDecisionSchema> {
  const { text } = input;
  if (text.includes("\r") || !text.endsWith("\n")) {
    throw new TypeError("colin-decision.md must be canonical LF-only Markdown");
  }
  const lines = text.slice(0, -1).split("\n");
  const followUpIndex = lines.indexOf("## Follow-up conditions");
  const rollbackIndex = lines.indexOf("## Rollback");
  if (
    followUpIndex < 0 ||
    rollbackIndex <= followUpIndex + 2 ||
    lines.lastIndexOf("## Follow-up conditions") !== followUpIndex ||
    lines.lastIndexOf("## Rollback") !== rollbackIndex ||
    lines[followUpIndex + 1] !== "" ||
    lines[rollbackIndex - 1] !== "" ||
    lines[rollbackIndex + 1] !== "" ||
    lines[rollbackIndex + 3] !== ""
  ) {
    throw new TypeError("colin-decision.md has an invalid section structure");
  }
  const rationaleLines = lines.filter((line) =>
    line.startsWith("- Rationale: "),
  );
  const rollbackLine = lines[rollbackIndex + 2];
  if (
    rationaleLines.length !== 1 ||
    rollbackLine === undefined ||
    !rollbackLine.startsWith("- ")
  ) {
    throw new TypeError("colin-decision.md is missing decision text");
  }
  const rawConditionLines = lines.slice(followUpIndex + 2, rollbackIndex - 1);
  const followUpConditions =
    rawConditionLines.length === 1 && rawConditionLines[0] === "- None."
      ? []
      : rawConditionLines.map((line) => {
          if (!line.startsWith("- ")) {
            throw new TypeError(
              "colin-decision.md has an invalid follow-up condition",
            );
          }
          return line.slice(2);
        });
  const decision = dryRunDecisionSchema.parse({
    decidedAt: uniqueMarkdownCodeField(text, "Decided at"),
    outcome: uniqueMarkdownCodeField(text, "Outcome"),
    rationale: rationaleLines[0]!.slice("- Rationale: ".length),
    followUpConditions,
    rollback: rollbackLine.slice(2),
  });
  const expected = renderColinDecision({
    runLabel: input.runLabel,
    experimentManifest: input.experimentManifest,
    runResults: input.runResults,
    comparisonReportRawSha256: input.comparisonReportRawSha256,
    comparisonReportByteLength: input.comparisonReportByteLength,
    decision,
  });
  if (text !== expected) {
    throw new TypeError("colin-decision.md is not deterministic Markdown");
  }
  return decision;
}

/**
 * Revalidates an entire four-file package and returns fresh metadata and byte
 * copies. This remains a pure domain boundary with no storage capability.
 */
export function parseDayflowAblationSyntheticDryRunPackage(
  candidate: unknown,
): DayflowAblationSyntheticDryRunPackage {
  const record = requireRecord(candidate, "Synthetic dry-run package");
  exactObjectKeys(
    record,
    ["mode", "runLabel", "files", "snapshotSha256"],
    "Synthetic dry-run package",
  );
  if (record.mode !== SYNTHETIC_DRY_RUN_MODE) {
    throw new TypeError("Synthetic dry-run package mode is invalid");
  }
  const runLabel = dryRunLabelSchema.parse(record.runLabel);
  const snapshotSha256 = sha256HexSchema.parse(record.snapshotSha256);
  if (!Array.isArray(record.files) || record.files.length !== 4) {
    throw new TypeError("Synthetic dry-run package must contain exactly four files");
  }
  const parsedFiles = record.files.map((value, index) => {
    const file = requireRecord(value, `Synthetic dry-run file ${index}`);
    exactObjectKeys(
      file,
      ["relativePath", "mediaType", "byteLength", "rawSha256", "bytes"],
      `Synthetic dry-run file ${index}`,
    );
    const expected = SYNTHETIC_DRY_RUN_FILE_LAYOUT[index];
    if (
      expected === undefined ||
      file.relativePath !== expected.relativePath ||
      file.mediaType !== expected.mediaType ||
      !Number.isSafeInteger(file.byteLength) ||
      Number(file.byteLength) < 0 ||
      !(file.bytes instanceof Uint8Array)
    ) {
      throw new TypeError(`Synthetic dry-run file ${index} metadata is invalid`);
    }
    const bytes = new Uint8Array(file.bytes);
    const rawHash = sha256HexSchema.parse(file.rawSha256);
    if (file.byteLength !== bytes.byteLength || rawHash !== rawSha256(bytes)) {
      throw new TypeError(`Synthetic dry-run file ${index} bytes do not match metadata`);
    }
    return {
      relativePath: expected.relativePath,
      mediaType: expected.mediaType,
      byteLength: bytes.byteLength,
      rawSha256: rawHash,
      bytes,
    } as DayflowAblationSyntheticDryRunFile;
  });
  const [
    experimentManifestFile,
    runResultsFile,
    comparisonReportFile,
    colinDecisionFile,
  ] = parsedFiles;
  if (
    experimentManifestFile === undefined ||
    runResultsFile === undefined ||
    comparisonReportFile === undefined ||
    colinDecisionFile === undefined
  ) {
    throw new TypeError("Synthetic dry-run package must contain exactly four files");
  }
  const files: DayflowAblationSyntheticDryRunPackage["files"] = [
    experimentManifestFile,
    runResultsFile,
    comparisonReportFile,
    colinDecisionFile,
  ];

  const experimentManifest = parseCanonicalDryRunJson(
    files[0].bytes,
    experimentManifestSchema,
    "experiment-manifest.json",
  );
  const runResults = parseCanonicalDryRunJson(
    files[1].bytes,
    runResultsSchema,
    "run-results.json",
  );
  const comparisonText = decodeUtf8Strict(
    files[2].bytes,
    "comparison-report.md",
  );
  const expectedComparison = renderComparisonReport({
    runLabel,
    experimentManifest,
    runResults,
    configIdentity: {
      configId: experimentManifest.configurationIdentity.configId,
      configSha256: experimentManifest.configurationIdentity.configSha256,
    },
    casesIdentity: {
      fixtureSetId: experimentManifest.commonEvaluationInputIdentity.inputId,
      casesSha256: experimentManifest.commonEvaluationInputIdentity.inputSha256,
    },
  });
  if (comparisonText !== expectedComparison) {
    throw new TypeError("comparison-report.md is not deterministic synthetic Markdown");
  }
  const decisionText = decodeUtf8Strict(files[3].bytes, "colin-decision.md");
  const decision = parseDryRunDecisionMarkdown({
    text: decisionText,
    runLabel,
    experimentManifest,
    runResults,
    comparisonReportRawSha256: files[2].rawSha256,
    comparisonReportByteLength: files[2].byteLength,
  });
  assertSyntheticDryRunLineage({
    experimentManifest,
    runResults,
    configIdentity: {
      configId: experimentManifest.configurationIdentity.configId,
      configSha256: experimentManifest.configurationIdentity.configSha256,
    },
    casesIdentity: {
      fixtureSetId: experimentManifest.commonEvaluationInputIdentity.inputId,
      casesSha256: experimentManifest.commonEvaluationInputIdentity.inputSha256,
    },
    decidedAt: decision.decidedAt,
  });
  if (!verifyDayflowAblationSyntheticDryRunDecisionBinding(files)) {
    throw new TypeError("Synthetic dry-run decision/report binding is invalid");
  }
  const actualSnapshotSha256 = domainSeparatedSha256(
    SYNTHETIC_DRY_RUN_SNAPSHOT_HASH_DOMAIN,
    files.map(({ relativePath, mediaType, byteLength, rawSha256: sha256 }) => ({
      relativePath,
      mediaType,
      byteLength,
      rawSha256: sha256,
    })),
  );
  if (snapshotSha256 !== actualSnapshotSha256) {
    throw new TypeError("Synthetic dry-run package snapshot hash is invalid");
  }
  return {
    mode: SYNTHETIC_DRY_RUN_MODE,
    runLabel,
    files,
    snapshotSha256,
  };
}
