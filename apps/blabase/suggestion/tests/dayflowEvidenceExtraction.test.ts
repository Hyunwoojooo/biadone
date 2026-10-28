import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DAYFLOW_ARTIFACT_REGISTRY,
  dayflowScreenEvidenceExportSchema,
  domainSeparatedSha256,
  evidenceOriginPhaseSchema,
  screenClaimPolicySchema
} from "../src/dayflowEvidence/contracts";
import {
  DayflowDatasetIntegrityError,
  dayflowEvidenceVectorSha256,
  dayflowFixtureGeneratorConfigSha256,
  dayflowSyntheticCasesSha256,
  executableEvidencePayloadSchema,
  loadDayflowAblationSyntheticCases,
  loadDayflowAblationSyntheticConfig,
  loadDayflowAblationSyntheticDataset,
  parseDuplicateAwareJson
} from "../src/evaluation/dayflowAblation/buildDataset";

const CONTRACT_SOURCE_URL = new URL(
  "../src/dayflowEvidence/contracts.ts",
  import.meta.url
);
const DATASET_BUILDER_SOURCE_URL = new URL(
  "../src/evaluation/dayflowAblation/buildDataset.ts",
  import.meta.url
);
const CONFIG_FIXTURE_URL = new URL(
  "../eval/synthetic/dayflowEvidenceAblationConfig.v0.2.json",
  import.meta.url
);
const CASES_FIXTURE_URL = new URL(
  "../eval/synthetic/dayflowEvidenceAblationCases.v0.2.json",
  import.meta.url
);

describe("Dayflow evidence extraction boundary", () => {
  it("is contract-only and exposes no extractor implementation", () => {
    expect(dayflowScreenEvidenceExportSchema).toBeDefined();
    expect(evidenceOriginPhaseSchema).toBeDefined();
    expect(screenClaimPolicySchema).toBeDefined();
    expect(DAYFLOW_ARTIFACT_REGISTRY.length).toBeGreaterThan(0);

    const source = readFileSync(CONTRACT_SOURCE_URL, "utf8");
    expect(source).not.toMatch(
      /export\s+(?:async\s+)?function\s+(?:extract|normalize|evaluate|run)\b/u
    );
    expect(source).not.toMatch(/class\s+.*(?:Extractor|Provider|Client)\b/u);
  });

  it("imports only zod and node:crypto and has no external capability surface", () => {
    const source = readFileSync(CONTRACT_SOURCE_URL, "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map(
      (match) => match[1]
    );
    expect(imports.sort()).toEqual(["node:crypto", "zod"]);

    const forbiddenCapabilities = [
      /node:(?:fs|fs\/promises|child_process|net|http|https|tls|dns|os)/u,
      /\bprocess\s*\.\s*env\b/u,
      /\bfetch\s*\(/u,
      /\bWebSocket\b/u,
      /\bXMLHttpRequest\b/u,
      /\b(?:spawn|exec|execFile|fork)\s*\(/u,
      /\b(?:openai|anthropic|gemini|provider|telemetry)\b/iu,
      /(?:production|app\/api|route|action|store)\//u,
      /\b(?:DATABASE_URL|API_KEY|TOKEN|SECRET)\b/u
    ];
    for (const pattern of forbiddenCapabilities) {
      expect(source).not.toMatch(pattern);
    }
  });

  it("rejects nested duplicate keys and every spelling of negative zero", () => {
    expect(() =>
      parseDuplicateAwareJson('{"outer":{"a":1,"\\u0061":2}}')
    ).toThrowError(/Duplicate JSON object key/u);
    for (const raw of ["-0", "-0.0", "-0e0", '{"outer":[1,-0]}']) {
      expect(() => parseDuplicateAwareJson(raw)).toThrowError(
        /Negative zero/u
      );
    }
  });

  it("loads executable synthetic-only observed, empty, and failure vectors", () => {
    const configRaw = readFileSync(CONFIG_FIXTURE_URL, "utf8");
    const casesRaw = readFileSync(CASES_FIXTURE_URL, "utf8");
    const config = loadDayflowAblationSyntheticConfig(configRaw);
    const cases = loadDayflowAblationSyntheticCases(casesRaw);

    expect(
      dayflowFixtureGeneratorConfigSha256({
        version: config.generationTuple.fixtureGeneratorVersion,
        seed: config.generationTuple.fixtureGeneratorSeed,
        syntheticOnly: true
      })
    ).toBe(config.fixtureGeneratorConfigSha256);
    expect(cases.evidenceBoundaryVectors.map((entry) => entry.vectorKind)).toEqual(
      ["observed", "valid_empty", "failure"]
    );
    for (const vector of cases.evidenceBoundaryVectors) {
      expect(dayflowEvidenceVectorSha256(vector)).toBe(vector.fixtureSha256);
      expect(vector.payload.exportManifest.dataOrigin).toBe("synthetic");
      expect(vector.payload.exportManifest.studyPhase).toBe(
        "contract_conformance"
      );
    }
    expect(dayflowSyntheticCasesSha256(cases)).toBe(cases.casesSha256);
    const observedBlob =
      cases.evidenceBoundaryVectors[0]!.payload.artifactBlobs[0]!;
    expect(observedBlob.syntheticSentinel).toBe(
      "SYNTHETIC_DAYFLOW_PLACEHOLDER_PNG_DO_NOT_USE_AS_HUMAN_DATA"
    );
    expect(
      Buffer.from(observedBlob.bytes, "base64").subarray(0, 8).toString("hex")
    ).toBe("89504e470d0a1a0a");
    expect(cases.evidenceBoundaryVectors[1]!.payload.artifactBlobs).toEqual([]);
    expect(cases.evidenceBoundaryVectors[2]!.payload.artifactBlobs).toEqual([]);
  });

  it("recomputes every detached fixture hash and rejects payload tampering", () => {
    const config = JSON.parse(
      readFileSync(CONFIG_FIXTURE_URL, "utf8")
    ) as Record<string, unknown>;
    const generationTuple = config.generationTuple as Record<string, unknown>;
    config.fixtureGeneratorConfigSha256 = "0".repeat(64);
    generationTuple.fixtureGeneratorConfigSha256 = "0".repeat(64);
    expect(() =>
      loadDayflowAblationSyntheticConfig(JSON.stringify(config))
    ).toThrowError(
      expect.objectContaining<Partial<DayflowDatasetIntegrityError>>({
        issueCode: "CONFIG_HASH_MISMATCH"
      })
    );

    const cases = JSON.parse(
      readFileSync(CASES_FIXTURE_URL, "utf8")
    ) as Record<string, unknown>;
    cases.casesSha256 = "0".repeat(64);
    expect(() =>
      loadDayflowAblationSyntheticCases(JSON.stringify(cases))
    ).toThrowError(
      expect.objectContaining<Partial<DayflowDatasetIntegrityError>>({
        issueCode: "CASES_HASH_MISMATCH"
      })
    );

    const casesGeneratorTamper = JSON.parse(
      readFileSync(CASES_FIXTURE_URL, "utf8")
    ) as { fixtureGenerator: { configSha256: string } };
    casesGeneratorTamper.fixtureGenerator.configSha256 = "0".repeat(64);
    expect(() =>
      loadDayflowAblationSyntheticCases(JSON.stringify(casesGeneratorTamper))
    ).toThrowError(
      expect.objectContaining<Partial<DayflowDatasetIntegrityError>>({
        issueCode: "CONFIG_HASH_MISMATCH"
      })
    );

    const vectorTamper = JSON.parse(
      readFileSync(CASES_FIXTURE_URL, "utf8")
    ) as {
      evidenceBoundaryVectors: { fixtureSha256: string }[];
    };
    vectorTamper.evidenceBoundaryVectors[0]!.fixtureSha256 = "0".repeat(64);
    expect(() =>
      loadDayflowAblationSyntheticCases(JSON.stringify(vectorTamper))
    ).toThrowError(
      expect.objectContaining<Partial<DayflowDatasetIntegrityError>>({
        issueCode: "VECTOR_HASH_MISMATCH"
      })
    );

    const blobTamper = JSON.parse(
      readFileSync(CASES_FIXTURE_URL, "utf8")
    ) as {
      evidenceBoundaryVectors: {
        payload: { artifactBlobs: { bytes: string }[] };
      }[];
    };
    blobTamper.evidenceBoundaryVectors[0]!.payload.artifactBlobs[0]!.bytes =
      Buffer.from("NOT_ALLOWLISTED", "utf8").toString("base64");
    expect(() =>
      loadDayflowAblationSyntheticCases(JSON.stringify(blobTamper))
    ).toThrow();

    const mimeTamper = JSON.parse(
      readFileSync(CASES_FIXTURE_URL, "utf8")
    ) as {
      evidenceBoundaryVectors: {
        payload: {
          exportManifest: Record<string, unknown> & {
            captureConfig: { allowedMimeTypes: string[] };
            artifacts: { mimeType: string }[];
            detachedManifestSha256: string;
          };
        };
      }[];
    };
    const manifest =
      mimeTamper.evidenceBoundaryVectors[0]!.payload.exportManifest;
    manifest.captureConfig.allowedMimeTypes = ["image/jpeg"];
    manifest.artifacts[0]!.mimeType = "image/jpeg";
    const { detachedManifestSha256: _detached, ...manifestPreimage } =
      manifest;
    manifest.detachedManifestSha256 = domainSeparatedSha256(
      "blabase.dayflow-screen-evidence-export.v0.1",
      manifestPreimage
    );
    expect(
      executableEvidencePayloadSchema.safeParse(
        mimeTamper.evidenceBoundaryVectors[0]!.payload
      ).success
    ).toBe(false);
  });

  it("requires and uses the eval cross-validator", () => {
    const loaded = loadDayflowAblationSyntheticDataset(
      readFileSync(CONFIG_FIXTURE_URL, "utf8"),
      readFileSync(CASES_FIXTURE_URL, "utf8")
    );
    expect(loaded.config.configId).toBe(
      "synthetic.dayflow.dfa002.config.v0.2"
    );
  });

  it("keeps the pure loader free of filesystem, network, and process access", () => {
    const source = readFileSync(DATASET_BUILDER_SOURCE_URL, "utf8");
    expect(source).not.toMatch(
      /node:(?:fs|fs\/promises|child_process|net|http|https|tls|dns|os)/u
    );
    expect(source).not.toMatch(/\bprocess\s*\.\s*env\b/u);
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(
      /(?<!\.)\b(?:spawn|exec|execFile|fork)\s*\(/u
    );
  });
});
