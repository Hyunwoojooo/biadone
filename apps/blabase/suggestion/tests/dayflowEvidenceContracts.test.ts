import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  DAYFLOW_ARTIFACT_REGISTRY,
  classifyDayflowCoverage,
  compareCanonicalDecimal,
  dayflowExportManifestSha256,
  dayflowNormalizedEvidenceSchema,
  dayflowNormalizedEvidenceSha256,
  dayflowScreenEvidenceExportSchema,
  domainSeparatedSha256,
  evidenceOriginPhaseSchema,
  fatalPrivacyIssueCodeSchema,
  getDayflowArtifactRegistration,
  hasFatalPrivacyIssue,
  jcsCanonicalize,
  jsonUnsignedIntegerSchema,
  privacyIssueSchema,
  registeredHashDomainSchema,
  semanticOutputSha256,
  semanticOutputWithHashSchema,
  verifyArtifactBlobBytes,
  verifyRegisteredArtifactHash,
  verifyResolvedNormalizedEvidence as verifyResolvedNormalizedEvidenceContract,
  type DayflowNormalizedEvidence,
  type DayflowScreenEvidenceExport
} from "../src/dayflowEvidence/contracts";

it("keeps shared JCS and domain hashing stable after hostile intrinsic mutation", () => {
  const value = {
    zeta: "fictional-end",
    alpha: [
      { zebra: "fictional-z", alpha: "fictional-a" },
      "fictional-array",
      [true, null, 7.25]
    ],
    middle: { beta: 2, alpha: 1 }
  };
  const domain = "blabase.test.shared-jcs.v0.1";
  const sparse: unknown[] = [];
  sparse.length = 1;
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const captureFailure = (
    operation: () => unknown
  ): { readonly name: string; readonly message: string } | null => {
    try {
      operation();
      return null;
    } catch (error) {
      if (error instanceof Error) {
        return { name: error.name, message: error.message };
      }
      return { name: typeof error, message: "non-Error throw" };
    }
  };

  const baselineCanonical = jcsCanonicalize(value);
  const baselineHash = domainSeparatedSha256(domain, value);
  const baselineUnicodeFailure = captureFailure(() =>
    jcsCanonicalize("\ud800")
  );
  const baselineSparseFailure = captureFailure(() => jcsCanonicalize(sparse));
  const baselineCycleFailure = captureFailure(() => jcsCanonicalize(cyclic));
  const baselineDomainFailure = captureFailure(() =>
    domainSeparatedSha256("invalid\u0000domain", value)
  );

  const sabotages: ReadonlyArray<
    readonly [object, PropertyKey, (...args: never[]) => never]
  > = [
    [String.prototype, "includes", () => {
      throw new Error("hostile String.prototype.includes");
    }],
    [String.prototype, "charCodeAt", () => {
      throw new Error("hostile String.prototype.charCodeAt");
    }],
    [Array.prototype, "map", () => {
      throw new Error("hostile Array.prototype.map");
    }],
    [Object.prototype, "hasOwnProperty", () => {
      throw new Error("hostile Object.prototype.hasOwnProperty");
    }],
    [Set.prototype, "has", () => {
      throw new Error("hostile Set.prototype.has");
    }],
    [Set.prototype, "add", () => {
      throw new Error("hostile Set.prototype.add");
    }],
    [Set.prototype, "delete", () => {
      throw new Error("hostile Set.prototype.delete");
    }],
    [Number, "isFinite", () => {
      throw new Error("hostile Number.isFinite");
    }],
    [Number, "isInteger", () => {
      throw new Error("hostile Number.isInteger");
    }],
    [Array, "isArray", () => {
      throw new Error("hostile Array.isArray");
    }],
    [Object, "getPrototypeOf", () => {
      throw new Error("hostile Object.getPrototypeOf");
    }],
    [Object, "keys", () => {
      throw new Error("hostile Object.keys");
    }],
    [JSON, "stringify", () => {
      throw new Error("hostile JSON.stringify");
    }],
    [Reflect, "apply", () => {
      throw new Error("hostile Reflect.apply");
    }]
  ];
  const originalDescriptors: PropertyDescriptor[] = [];
  let canonicalUnderMutation: string | undefined;
  let hashUnderMutation: string | undefined;
  let unicodeFailureUnderMutation: ReturnType<typeof captureFailure> = null;
  let sparseFailureUnderMutation: ReturnType<typeof captureFailure> = null;
  let cycleFailureUnderMutation: ReturnType<typeof captureFailure> = null;
  let domainFailureUnderMutation: ReturnType<typeof captureFailure> = null;

  try {
    for (let index = 0; index < sabotages.length; index += 1) {
      const [owner, key, replacement] = sabotages[index];
      const descriptor = Object.getOwnPropertyDescriptor(owner, key);
      if (descriptor === undefined) {
        throw new Error(`missing intrinsic descriptor: ${String(key)}`);
      }
      originalDescriptors[index] = descriptor;
      Object.defineProperty(owner, key, { ...descriptor, value: replacement });
    }

    canonicalUnderMutation = jcsCanonicalize(value);
    hashUnderMutation = domainSeparatedSha256(domain, value);
    unicodeFailureUnderMutation = captureFailure(() =>
      jcsCanonicalize("\ud800")
    );
    sparseFailureUnderMutation = captureFailure(() => jcsCanonicalize(sparse));
    cycleFailureUnderMutation = captureFailure(() => jcsCanonicalize(cyclic));
    domainFailureUnderMutation = captureFailure(() =>
      domainSeparatedSha256("invalid\u0000domain", value)
    );
  } finally {
    for (let index = sabotages.length - 1; index >= 0; index -= 1) {
      const [owner, key] = sabotages[index];
      const descriptor = originalDescriptors[index];
      if (descriptor !== undefined) {
        Object.defineProperty(owner, key, descriptor);
      }
    }
  }

  expect(baselineCanonical).toBe(
    '{"alpha":[{"alpha":"fictional-a","zebra":"fictional-z"},"fictional-array",[true,null,7.25]],"middle":{"alpha":1,"beta":2},"zeta":"fictional-end"}'
  );
  expect(baselineUnicodeFailure?.name).toBe("TypeError");
  expect(baselineSparseFailure?.name).toBe("TypeError");
  expect(baselineCycleFailure?.name).toBe("TypeError");
  expect(baselineDomainFailure?.name).toBe("TypeError");
  expect(canonicalUnderMutation).toBe(baselineCanonical);
  expect(hashUnderMutation).toBe(baselineHash);
  expect(unicodeFailureUnderMutation).toEqual(baselineUnicodeFailure);
  expect(sparseFailureUnderMutation).toEqual(baselineSparseFailure);
  expect(cycleFailureUnderMutation).toEqual(baselineCycleFailure);
  expect(domainFailureUnderMutation).toEqual(baselineDomainFailure);
});

const ZERO_HASH = "0".repeat(64);
const ONE_HASH = "1".repeat(64);
const TWO_HASH = "2".repeat(64);
const START = "2026-08-17T00:00:00.000Z";
const END = "2026-08-17T00:00:01.000Z";
const SYNTHETIC_FRAME_BYTES = new TextEncoder().encode("synthetic frame");
const SYNTHETIC_FRAME_HASH = createHash("sha256")
  .update(SYNTHETIC_FRAME_BYTES)
  .digest("hex");

type ResolvedNormalizedEvidenceInput = Parameters<
  typeof verifyResolvedNormalizedEvidenceContract
>[0];

function verifyResolvedNormalizedEvidence(
  input: Omit<ResolvedNormalizedEvidenceInput, "resolvedExportManifests"> &
    Partial<Pick<ResolvedNormalizedEvidenceInput, "resolvedExportManifests">>
) {
  const resolvedExportManifests =
    input.resolvedExportManifests ??
    [
      ...new Map(
        input.resolvedArtifacts.map((resolved) => [
          resolved.exportManifest.detachedManifestSha256,
          resolved.exportManifest
        ])
      ).values()
    ];
  return verifyResolvedNormalizedEvidenceContract({
    ...input,
    resolvedExportManifests
  });
}

describe("Dayflow evidence contract primitives", () => {
  it("implements JCS ordering/number serialization and domain-NUL hashing", () => {
    const value = {
      z: -0,
      a: [333333333.33333329, 1e30, 4.5, 0.002, 1e-27],
      "€": "euro",
      "\r": "control-key"
    };
    const canonical =
      '{"\\r":"control-key","a":[333333333.3333333,1e+30,4.5,0.002,1e-27],"z":0,"€":"euro"}';

    expect(jcsCanonicalize(value)).toBe(canonical);
    expect(domainSeparatedSha256("example.domain.v0.1", value)).toBe(
      createHash("sha256")
        .update("example.domain.v0.1\u0000", "utf8")
        .update(canonical, "utf8")
        .digest("hex")
    );
    expect(() => jcsCanonicalize({ invalid: Number.NaN })).toThrow(/finite/u);
    expect(() => jcsCanonicalize({ invalid: undefined })).toThrow(/undefined/u);
    expect(() => jcsCanonicalize("\ud800")).toThrow(/Unicode scalar/u);
  });

  it("keeps a unique exact schema/domain registry and verifies detached hashes", () => {
    expect(DAYFLOW_ARTIFACT_REGISTRY).toHaveLength(30);
    expect(
      new Set(DAYFLOW_ARTIFACT_REGISTRY.map((entry) => entry.artifactClass))
        .size
    ).toBe(DAYFLOW_ARTIFACT_REGISTRY.length);
    for (const entry of DAYFLOW_ARTIFACT_REGISTRY) {
      expect(getDayflowArtifactRegistration(entry.artifactClass)).toBe(entry);
      expect(registeredHashDomainSchema.parse(entry.hashDomain)).toBe(
        entry.hashDomain
      );
      expect(entry.storageMode).toBe("standalone");
    }
    expect(getDayflowArtifactRegistration("artifact-layout-config")).toEqual({
      artifactClass: "artifact-layout-config",
      schemaVersion: "dayflow-ablation-artifact-layout-config-v0.2",
      hashDomain: "blabase.dayflow-ablation.artifact-layout-config.v0.2",
      storageMode: "standalone"
    });
    expect(getDayflowArtifactRegistration("experiment-manifest")).toEqual({
      artifactClass: "experiment-manifest",
      schemaVersion: "dayflow-ablation-experiment-manifest-v0.2",
      hashDomain: "blabase.dayflow-ablation.experiment-manifest.v0.2",
      storageMode: "standalone"
    });
    expect(getDayflowArtifactRegistration("run-results")).toEqual({
      artifactClass: "run-results",
      schemaVersion: "dayflow-ablation-run-results-v0.1",
      hashDomain: "blabase.dayflow-ablation.run-results.v0.1",
      storageMode: "standalone"
    });
    expect(getDayflowArtifactRegistration("semantic-output")).toEqual({
      artifactClass: "semantic-output",
      schemaVersion: "dayflow-ablation-semantic-output-v0.1",
      hashDomain: "blabase.dayflow-ablation.semantic-output.v0.1",
      storageMode: "standalone"
    });
    expect(
      getDayflowArtifactRegistration("request-issuance-receipt")
    ).toEqual({
      artifactClass: "request-issuance-receipt",
      schemaVersion: "dayflow-ablation-request-issuance-receipt-v0.1",
      hashDomain:
        "blabase.dayflow-ablation.request-issuance-receipt.v0.1",
      storageMode: "standalone"
    });
    expect(
      DAYFLOW_ARTIFACT_REGISTRY.filter((entry) =>
        ["a0-arm-input", "a1-arm-input", "b-arm-input", "c-arm-input"].includes(
          entry.artifactClass
        )
      ).every(
        (entry) =>
          entry.schemaVersion === "dayflow-ablation-arm-input-v0.4" &&
          entry.hashDomain.endsWith(".v0.4")
      )
    ).toBe(true);
    expect(getDayflowArtifactRegistration("arm-run")).toMatchObject({
      schemaVersion: "dayflow-ablation-run-v0.4",
      hashDomain: "blabase.dayflow-ablation.run.v0.4"
    });
    expect(
      getDayflowArtifactRegistration("pilot-verification-attestation")
    ).toEqual({
      artifactClass: "pilot-verification-attestation",
      schemaVersion:
        "dayflow-ablation-pilot-verification-attestation-v0.1",
      hashDomain:
        "blabase.dayflow-ablation.pilot-verification-attestation.v0.1",
      storageMode: "standalone"
    });
    const pilotAttestation = {
      pilotVerificationAttestationSchemaVersion:
        "dayflow-ablation-pilot-verification-attestation-v0.1",
      pilotVerificationAttestationId: "pilot-attestation-001",
      verificationStatus: "verified",
      pilotVerificationAttestationSha256: ZERO_HASH
    };
    pilotAttestation.pilotVerificationAttestationSha256 =
      domainSeparatedSha256(
        "blabase.dayflow-ablation.pilot-verification-attestation.v0.1",
        {
          pilotVerificationAttestationSchemaVersion:
            pilotAttestation.pilotVerificationAttestationSchemaVersion,
          pilotVerificationAttestationId:
            pilotAttestation.pilotVerificationAttestationId,
          verificationStatus: pilotAttestation.verificationStatus
        }
      );
    expect(
      verifyRegisteredArtifactHash(
        "pilot-verification-attestation",
        pilotAttestation
      )
    ).toBe(true);
    expect(
      verifyRegisteredArtifactHash("pilot-verification-attestation", {
        ...pilotAttestation,
        verificationStatus: "forged"
      })
    ).toBe(false);

    const issuanceReceipt = {
      requestIssuanceReceiptSchemaVersion:
        "dayflow-ablation-request-issuance-receipt-v0.1",
      requestIssuanceReceiptId: "request-receipt-001",
      requestId: "request-001",
      requestIssuanceReceiptSha256: ZERO_HASH
    };
    issuanceReceipt.requestIssuanceReceiptSha256 = domainSeparatedSha256(
      "blabase.dayflow-ablation.request-issuance-receipt.v0.1",
      {
        requestIssuanceReceiptSchemaVersion:
          issuanceReceipt.requestIssuanceReceiptSchemaVersion,
        requestIssuanceReceiptId: issuanceReceipt.requestIssuanceReceiptId,
        requestId: issuanceReceipt.requestId
      }
    );
    expect(
      verifyRegisteredArtifactHash(
        "request-issuance-receipt",
        issuanceReceipt
      )
    ).toBe(true);
    expect(
      verifyRegisteredArtifactHash("request-issuance-receipt", {
        ...issuanceReceipt,
        requestId: "request-substituted"
      })
    ).toBe(false);

    const manifest = exportFixture();
    expect(verifyRegisteredArtifactHash("dayflow-export-manifest", manifest))
      .toBe(true);
    expect(
      verifyRegisteredArtifactHash("dayflow-export-manifest", {
        ...manifest,
        consentRevision: "changed"
      })
    ).toBe(false);
    expect(() => getDayflowArtifactRegistration("not-registered")).toThrow(
      /Unregistered/u
    );
  });

  it("binds standalone and embedded semantic output to one hash domain", () => {
    const semanticOutput = normalizedEvidenceFixture().semanticOutput;
    const semanticOutputSha = semanticOutputSha256(semanticOutput);
    const standalone = {
      ...semanticOutput,
      semanticOutputSha256: semanticOutputSha
    };

    expect(semanticOutputWithHashSchema.parse(standalone)).toEqual(standalone);
    expect(verifyRegisteredArtifactHash("semantic-output", standalone)).toBe(
      true
    );
    expect(
      semanticOutputWithHashSchema.safeParse({
        ...standalone,
        items: [
          {
            ...standalone.items[0]!,
            title: "tampered synthetic title"
          }
        ]
      }).success
    ).toBe(false);
    expect(
      semanticOutputWithHashSchema.safeParse({
        ...standalone,
        unexpectedDetachedAlias: semanticOutputSha
      }).success
    ).toBe(false);
  });

  it("rejects unknown fields at the envelope and nested levels", () => {
    const manifest = exportFixture();
    expect(dayflowScreenEvidenceExportSchema.parse(manifest)).toEqual(manifest);
    expect(
      dayflowScreenEvidenceExportSchema.safeParse({
        ...manifest,
        structuredCandidate: "forbidden"
      }).success
    ).toBe(false);
    expect(
      dayflowScreenEvidenceExportSchema.safeParse({
        ...manifest,
        captureConfig: {
          ...manifest.captureConfig,
          hiddenDefault: true
        }
      }).success
    ).toBe(false);
    expect(
      dayflowScreenEvidenceExportSchema.safeParse({
        ...manifest,
        artifacts: [{ ...manifest.artifacts[0], rawContent: "forbidden" }]
      }).success
    ).toBe(false);
  });

  it("requires export publication after the capture window closes", () => {
    const manifest = exportFixture();
    expect(
      dayflowScreenEvidenceExportSchema.safeParse(
        resignExport({ ...manifest, exportedAt: START })
      ).success
    ).toBe(false);
  });

  it("requires normalized evidence retention through capture completion", () => {
    const evidence = normalizedEvidenceFixture();
    expect(
      dayflowNormalizedEvidenceSchema.safeParse(
        resignNormalized({ ...evidence, expiresAt: START })
      ).success
    ).toBe(false);
  });

  it("enforces coverage partition/count bounds and derives typed coverage states", () => {
    const manifest = exportFixture();
    expect(
      classifyDayflowCoverage({
        coverage: manifest.coverage,
        artifacts: manifest.artifacts
      })
    ).toBe("observed");

    const validEmpty = exportFixture({ empty: true });
    expect(dayflowScreenEvidenceExportSchema.safeParse(validEmpty).success).toBe(
      true
    );
    expect(
      classifyDayflowCoverage({
        coverage: validEmpty.coverage,
        artifacts: validEmpty.artifacts
      })
    ).toBe("valid-empty");

    const failedCoverage = {
      ...validEmpty.coverage,
      intervals: [
        {
          ...validEmpty.coverage.intervals[0],
          reason: "unavailable" as const
        }
      ]
    };
    expect(
      classifyDayflowCoverage({ coverage: failedCoverage, artifacts: [] })
    ).toBe("failure");

    expect(
      dayflowScreenEvidenceExportSchema.safeParse(
        resignExport({
          ...manifest,
          coverage: { ...manifest.coverage, observedFrameCount: 2 }
        })
      ).success
    ).toBe(false);
    expect(
      dayflowScreenEvidenceExportSchema.safeParse(
        resignExport({
          ...manifest,
          captureConfig: {
            ...manifest.captureConfig,
            maxBlobBytes: "10485761"
          }
        })
      ).success
    ).toBe(false);
  });

  it("orders same-second source rows numerically and verifies exact blob bytes", () => {
    expect(compareCanonicalDecimal("2", "10")).toBeLessThan(0);
    expect(compareCanonicalDecimal("9007199254740993", "9007199254740994"))
      .toBeLessThan(0);

    const bytes = new TextEncoder().encode("synthetic frame");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    expect(
      verifyArtifactBlobBytes(
        { byteSize: String(bytes.byteLength), sha256 },
        bytes
      )
    ).toBe(true);
    expect(
      verifyArtifactBlobBytes(
        { byteSize: String(bytes.byteLength + 1), sha256 },
        bytes
      )
    ).toBe(false);
    expect(
      verifyArtifactBlobBytes(
        { byteSize: String(bytes.byteLength), sha256: ZERO_HASH },
        bytes
      )
    ).toBe(false);

    const manifest = exportFixture();
    const rowTwo = { ...manifest.artifacts[0]!, sourceRowId: "2" };
    const rowTen = {
      ...manifest.artifacts[0]!,
      sourceArtifactId: "artifact-10",
      sourceRowId: "10",
      relativeBlobRef: "blobs/10"
    };
    const twoRows = resignExport({
      ...manifest,
      coverage: {
        intervals: [
          {
            ...manifest.coverage.intervals[0]!,
            expectedFrameCount: 2,
            observedFrameCount: 2
          }
        ],
        expectedFrameCount: 2,
        observedFrameCount: 2,
        rejectedFrameCount: 0
      },
      artifacts: [rowTwo, rowTen]
    });
    expect(dayflowScreenEvidenceExportSchema.safeParse(twoRows).success).toBe(
      true
    );
    expect(
      dayflowScreenEvidenceExportSchema.safeParse(
        resignExport({ ...twoRows, artifacts: [rowTen, rowTwo] })
      ).success
    ).toBe(false);
  });

  it("fails closed for invalid origin/phase and synthetic/live privacy states", () => {
    expect(
      evidenceOriginPhaseSchema.safeParse({
        lineageClass: "evidence",
        dataOrigin: "synthetic",
        studyPhase: "private_pilot"
      }).success
    ).toBe(false);
    expect(
      evidenceOriginPhaseSchema.safeParse({
        lineageClass: "evidence",
        dataOrigin: "live",
        studyPhase: "directional_study"
      }).success
    ).toBe(true);

    const manifest = exportFixture();
    expect(
      dayflowScreenEvidenceExportSchema.safeParse(
        resignExport({
          ...manifest,
          artifacts: [
            { ...manifest.artifacts[0]!, privacyState: "consented_live" }
          ]
        })
      ).success
    ).toBe(false);
    expect(
      dayflowScreenEvidenceExportSchema.safeParse(
        resignExport({
          ...manifest,
          artifacts: [
            { ...manifest.artifacts[0]!, privacyState: "unknown" }
          ]
        })
      ).success
    ).toBe(false);

    const empty = exportFixture({ empty: true });
    const liveSnapshot = {
      snapshotKind: "dayflow-stable-snapshot" as const,
      snapshotAlgorithmVersion: "snapshot-v0.1",
      snapshotId: "live-snapshot-empty",
      databaseSchemaFingerprint: ZERO_HASH,
      mainDatabaseSha256: ONE_HASH,
      walState: "none" as const,
      stableSnapshotMarkerSha256: TWO_HASH,
      createdAt: START
    };
    expect(
      dayflowScreenEvidenceExportSchema.safeParse(
        resignExport({
          ...empty,
          databaseSnapshotIdentity: liveSnapshot
        })
      ).success
    ).toBe(false);
    expect(
      dayflowScreenEvidenceExportSchema.safeParse(
        resignExport({
          ...empty,
          dataOrigin: "live",
          studyPhase: "private_pilot",
          databaseSnapshotIdentity: empty.databaseSnapshotIdentity
        })
      ).success
    ).toBe(false);

    const issue = privacyIssueSchema.parse({
      issueCode: "PRIVACY_STATE_UNKNOWN",
      artifactRef: "artifact-2",
      fieldPath: "/artifacts/0/privacyState",
      detectedAt: START
    });
    expect(fatalPrivacyIssueCodeSchema.options).toContain(issue.issueCode);
    expect(hasFatalPrivacyIssue([issue])).toBe(true);
    expect(hasFatalPrivacyIssue([])).toBe(false);
    expect(
      privacyIssueSchema.safeParse({ ...issue, severity: "warning" }).success
    ).toBe(false);
  });

  it("rejects negative zero in every shared unsigned-number boundary", () => {
    expect(jsonUnsignedIntegerSchema.safeParse(-0).success).toBe(false);

    const manifest = exportFixture();
    expect(
      dayflowScreenEvidenceExportSchema.safeParse(
        resignExport({
          ...manifest,
          coverage: {
            ...manifest.coverage,
            expectedFrameCount: -0
          }
        })
      ).success
    ).toBe(false);
    expect(
      dayflowScreenEvidenceExportSchema.safeParse(
        resignExport({
          ...manifest,
          artifacts: [{ ...manifest.artifacts[0]!, idleSeconds: -0 }]
        })
      ).success
    ).toBe(false);
    const evidence = normalizedEvidenceFixture();
    expect(
      dayflowNormalizedEvidenceSchema.safeParse(
        resignNormalized({ ...evidence, confidenceBasisPoints: -0 })
      ).success
    ).toBe(false);
  });

  it("rejects mixed synthetic/live attestations for both origins", () => {
    const synthetic = exportFixture();
    expect(
      dayflowScreenEvidenceExportSchema.safeParse(
        resignExport({
          ...synthetic,
          artifacts: [
            {
              ...synthetic.artifacts[0]!,
              pseudonymousWindowAttestation: attestation("live-window")
            }
          ]
        })
      ).success
    ).toBe(false);

    const live = resignExport({
      ...synthetic,
      dataOrigin: "live",
      studyPhase: "private_pilot",
      databaseSnapshotIdentity: {
        snapshotKind: "dayflow-stable-snapshot",
        snapshotAlgorithmVersion: "snapshot-v0.1",
        snapshotId: "live-snapshot-1",
        databaseSchemaFingerprint: ZERO_HASH,
        mainDatabaseSha256: ONE_HASH,
        walState: "none",
        stableSnapshotMarkerSha256: TWO_HASH,
        createdAt: START
      },
      artifacts: [
        {
          ...synthetic.artifacts[0]!,
          privacyState: "consented_live",
          placeholderState: "verified_non_placeholder",
          pseudonymousDisplayAttestation: attestation("synthetic-display"),
          pseudonymousWindowAttestation: attestation("live-window")
        }
      ]
    });
    expect(dayflowScreenEvidenceExportSchema.safeParse(live).success).toBe(
      false
    );

    expect(
      dayflowScreenEvidenceExportSchema.safeParse(
        resignExport({
          ...synthetic,
          artifacts: [
            {
              ...synthetic.artifacts[0]!,
              pseudonymousWindowAttestation: {
                ...synthetic.artifacts[0]!.pseudonymousWindowAttestation,
                policySha256: ONE_HASH
              }
            }
          ]
        })
      ).success
    ).toBe(false);
  });
});

describe("normalized Dayflow evidence lineage", () => {
  it("accepts source-only evidence with exact one-to-one claim lineage", () => {
    const evidence = normalizedEvidenceFixture();
    expect(dayflowNormalizedEvidenceSchema.parse(evidence)).toEqual(evidence);
    expect(
      verifyRegisteredArtifactHash("normalized-screen-evidence", evidence)
    ).toBe(true);
  });

  it("rejects structured contamination and missing, extra, or crossed lineage", () => {
    const evidence = normalizedEvidenceFixture();
    expect(
      dayflowNormalizedEvidenceSchema.safeParse({
        ...evidence,
        structuredCandidate: { title: "must not enter extraction" }
      }).success
    ).toBe(false);

    expect(
      dayflowNormalizedEvidenceSchema.safeParse(
        resignNormalized({ ...evidence, fieldEvidence: [] })
      ).success
    ).toBe(false);

    expect(
      dayflowNormalizedEvidenceSchema.safeParse(
        resignNormalized({
          ...evidence,
          semanticOutput: {
            ...evidence.semanticOutput,
            items: [
              {
                ...evidence.semanticOutput.items[0]!,
                claimIds: ["claim-1"]
              }
            ]
          }
        })
      ).success
    ).toBe(false);

    expect(
      dayflowNormalizedEvidenceSchema.safeParse(
        resignNormalized({
          ...evidence,
          fieldEvidence: [
            {
              ...evidence.fieldEvidence[0]!,
              outputFieldPath: "/items/0/summary"
            }
          ]
        })
      ).success
    ).toBe(false);
    expect(
      dayflowNormalizedEvidenceSchema.safeParse(
        resignNormalized({
          ...evidence,
          sourceArtifactHashes: [TWO_HASH]
        })
      ).success
    ).toBe(false);
  });

  it("does not allow failure coverage to emit accepted claims", () => {
    const evidence = normalizedEvidenceFixture();
    const failureCoverage = {
      intervals: [
        {
          start: START,
          end: END,
          reason: "unavailable" as const,
          expectedFrameCount: 0,
          observedFrameCount: 0,
          rejectedFrameCount: 0
        }
      ],
      expectedFrameCount: 0,
      observedFrameCount: 0,
      rejectedFrameCount: 0
    };
    expect(
      dayflowNormalizedEvidenceSchema.safeParse(
        resignNormalized({
          ...evidence,
          coverageCode: "failure",
          normalizedCoverage: failureCoverage,
          sourceArtifactHashes: []
        })
      ).success
    ).toBe(false);
  });

  it("keeps accepted and rejected claim identifiers globally disjoint", () => {
    const evidence = normalizedEvidenceFixture();
    expect(
      dayflowNormalizedEvidenceSchema.safeParse(
        resignNormalized({
          ...evidence,
          rejectedClaims: [
            {
              rejectedClaimId: evidence.acceptedClaims[0]!.claimId,
              proposedOutputFieldPath: "/items/0/title",
              claimClass: "DISPLAY_TITLE_HINT",
              proposedValueHash: TWO_HASH,
              reasonCode: "INSUFFICIENT_EVIDENCE",
              sourceArtifactRefs:
                evidence.fieldEvidence[0]!.sourceArtifactRefs,
              rejectedAt: END
            }
          ]
        })
      ).success
    ).toBe(false);
  });

  it("requires every conflict screen claim to resolve as rejected-only lineage", () => {
    const evidence = conflictEvidenceFixture();
    expect(dayflowNormalizedEvidenceSchema.safeParse(evidence).success).toBe(
      true
    );
    expect(
      dayflowNormalizedEvidenceSchema.safeParse(
        resignNormalized({ ...evidence, conflictingClaims: [] })
      ).success
    ).toBe(false);
    expect(
      dayflowNormalizedEvidenceSchema.safeParse(
        resignNormalized({
          ...evidence,
          conflictingClaims: [
            {
              ...evidence.conflictingClaims[0]!,
              screenClaimIds: ["missing-screen-claim"]
            }
          ]
        })
      ).success
    ).toBe(false);

    const accepted = normalizedEvidenceFixture();
    expect(
      dayflowNormalizedEvidenceSchema.safeParse(
        resignNormalized({
          ...accepted,
          rejectedClaims: [
            {
              rejectedClaimId: "claim-1",
              proposedOutputFieldPath: "/items/0/title",
              claimClass: "DISPLAY_TITLE_HINT",
              proposedValueHash: TWO_HASH,
              reasonCode: "STRUCTURED_AUTHORITY_CONFLICT",
              sourceArtifactRefs:
                accepted.fieldEvidence[0]!.sourceArtifactRefs,
              rejectedAt: END
            }
          ],
          conflictingClaims: [
            conflictRecord("claim-1", "/items/0/title")
          ]
        })
      ).success
    ).toBe(false);

    expect(
      dayflowNormalizedEvidenceSchema.safeParse(
        resignNormalized({
          ...accepted,
          rejectedClaims: [
            {
              rejectedClaimId: "synthetic-screen-conflict-2",
              proposedOutputFieldPath: "/items/0/title",
              claimClass: "DISPLAY_TITLE_HINT",
              proposedValueHash: TWO_HASH,
              reasonCode: "STRUCTURED_AUTHORITY_CONFLICT",
              sourceArtifactRefs:
                accepted.fieldEvidence[0]!.sourceArtifactRefs,
              rejectedAt: END
            }
          ],
          conflictingClaims: [
            conflictRecord(
              "synthetic-screen-conflict-2",
              "/items/0/title"
            )
          ]
        })
      ).success
    ).toBe(false);
  });

  it("resolves exact export ownership and normalized UTF-8 byte spans", () => {
    const manifest = exportFixture();
    const evidence = bindNormalizedEvidenceToExport(
      normalizedEvidenceFixture(),
      manifest
    );
    const sourceArtifactRef =
      evidence.fieldEvidence[0]!.sourceArtifactRefs[0]!;
    const resolvedArtifact = {
      sourceArtifactRef,
      exportManifest: manifest,
      artifact: manifest.artifacts[0]!
    };
    const resolvedArtifactBlob = {
      sourceArtifactId: manifest.artifacts[0]!.sourceArtifactId,
      bytes: SYNTHETIC_FRAME_BYTES
    };
    expect(
      verifyResolvedNormalizedEvidence({
        evidence,
        resolvedArtifacts: [resolvedArtifact],
        artifactBlobs: [resolvedArtifactBlob],
        normalizedTexts: []
      })
    ).toMatchObject({ valid: true, issueCodes: [] });
    expect(
      verifyResolvedNormalizedEvidence({
        evidence,
        resolvedArtifacts: [resolvedArtifact],
        artifactBlobs: [],
        normalizedTexts: []
      })
    ).toMatchObject({
      valid: false,
      issueCodes: expect.arrayContaining(["ARTIFACT_BLOB_MAP_NOT_EXACT"])
    });
    expect(
      verifyResolvedNormalizedEvidence({
        evidence,
        resolvedArtifacts: [resolvedArtifact],
        artifactBlobs: [
          {
            ...resolvedArtifactBlob,
            bytes: new TextEncoder().encode("tampered frame")
          }
        ],
        normalizedTexts: []
      })
    ).toMatchObject({
      valid: false,
      issueCodes: expect.arrayContaining(["ARTIFACT_BLOB_BYTES_MISMATCH"])
    });
    expect(
      verifyResolvedNormalizedEvidence({
        evidence,
        resolvedArtifacts: [],
        artifactBlobs: [],
        normalizedTexts: []
      })
    ).toMatchObject({
      valid: false,
      issueCodes: expect.arrayContaining(["SOURCE_ARTIFACT_MAP_NOT_EXACT"])
    });
    expect(
      verifyResolvedNormalizedEvidence({
        evidence,
        resolvedArtifacts: [
          {
            ...resolvedArtifact,
            sourceArtifactRef: {
              ...sourceArtifactRef,
              sourceRowId: "3"
            }
          }
        ],
        artifactBlobs: [resolvedArtifactBlob],
        normalizedTexts: []
      })
    ).toMatchObject({
      valid: false,
      issueCodes: expect.arrayContaining([
        "EXPORT_ARTIFACT_OWNERSHIP_MISMATCH",
        "SOURCE_ARTIFACT_MAP_NOT_EXACT"
      ])
    });

    const utf8Bytes = new TextEncoder().encode("A€B");
    const normalizedTextSha256 = createHash("sha256")
      .update(utf8Bytes)
      .digest("hex");
    const withText = resignNormalized({
      ...evidence,
      fieldEvidence: evidence.fieldEvidence.map((field, index) =>
        index === 1
          ? {
              ...field,
              captureSpans: [
                {
                  spanKind: "text_offset_utf8",
                  sourceArtifactRef,
                  normalizedTextSha256,
                  startByteOffset: 1,
                  endByteOffset: 4
                }
              ]
            }
          : field
      )
    });
    const normalizedText = {
      sourceArtifactRef,
      normalizedTextSha256,
      byteLength: "5",
      utf8Bytes
    };
    expect(
      verifyResolvedNormalizedEvidence({
        evidence: withText,
        resolvedArtifacts: [resolvedArtifact],
        artifactBlobs: [resolvedArtifactBlob],
        normalizedTexts: [normalizedText]
      })
    ).toMatchObject({ valid: true, issueCodes: [] });
    expect(
      verifyResolvedNormalizedEvidence({
        evidence: withText,
        resolvedArtifacts: [resolvedArtifact],
        artifactBlobs: [resolvedArtifactBlob],
        normalizedTexts: [{ ...normalizedText, byteLength: "4" }]
      })
    ).toMatchObject({
      valid: false,
      issueCodes: expect.arrayContaining(["NORMALIZED_TEXT_LENGTH_MISMATCH"])
    });
    expect(
      verifyResolvedNormalizedEvidence({
        evidence: withText,
        resolvedArtifacts: [resolvedArtifact],
        artifactBlobs: [resolvedArtifactBlob],
        normalizedTexts: [
          {
            ...normalizedText,
            utf8Bytes: new TextEncoder().encode("A€C")
          }
        ]
      })
    ).toMatchObject({
      valid: false,
      issueCodes: expect.arrayContaining(["NORMALIZED_TEXT_HASH_MISMATCH"])
    });
    expect(
      verifyResolvedNormalizedEvidence({
        evidence: withText,
        resolvedArtifacts: [resolvedArtifact],
        artifactBlobs: [resolvedArtifactBlob],
        normalizedTexts: [
          {
            ...normalizedText,
            sourceArtifactRef: {
              ...sourceArtifactRef,
              sourceRowId: "3"
            }
          }
        ]
      })
    ).toMatchObject({
      valid: false,
      issueCodes: expect.arrayContaining(["NORMALIZED_TEXT_MAP_NOT_EXACT"])
    });

    const splitCodePoint = resignNormalized({
      ...withText,
      fieldEvidence: withText.fieldEvidence.map((field, index) =>
        index === 1
          ? {
              ...field,
              captureSpans: [
                {
                  ...field.captureSpans[0]!,
                  startByteOffset: 2
                }
              ]
            }
          : field
      )
    });
    expect(
      verifyResolvedNormalizedEvidence({
        evidence: splitCodePoint,
        resolvedArtifacts: [resolvedArtifact],
        artifactBlobs: [resolvedArtifactBlob],
        normalizedTexts: [normalizedText]
      })
    ).toMatchObject({
      valid: false,
      issueCodes: expect.arrayContaining(["UTF8_SPAN_NOT_BOUNDARY"])
    });

    const outOfBounds = resignNormalized({
      ...withText,
      fieldEvidence: withText.fieldEvidence.map((field, index) =>
        index === 1
          ? {
              ...field,
              captureSpans: [
                {
                  ...field.captureSpans[0]!,
                  endByteOffset: 6
                }
              ]
            }
          : field
      )
    });
    expect(
      verifyResolvedNormalizedEvidence({
        evidence: outOfBounds,
        resolvedArtifacts: [resolvedArtifact],
        artifactBlobs: [resolvedArtifactBlob],
        normalizedTexts: [normalizedText]
      })
    ).toMatchObject({
      valid: false,
      issueCodes: expect.arrayContaining(["UTF8_SPAN_OUT_OF_BOUNDS"])
    });
  });

  it("requires an exact export envelope even for valid-empty evidence", () => {
    const manifest = exportFixture({ empty: true });
    const emptyEvidence = resignNormalized({
      ...normalizedEvidenceFixture(),
      studyProtocolHash: manifest.studyProtocolHash,
      captureWindow: { start: manifest.windowStart, end: manifest.windowEnd },
      coverageCode: "valid-empty",
      normalizedCoverage: manifest.coverage,
      sourceExportRefs: [
        {
          schemaVersion: manifest.schemaVersion,
          exportId: manifest.exportId,
          detachedManifestSha256: manifest.detachedManifestSha256
        }
      ],
      sourceArtifactHashes: [],
      semanticOutput: {
        schemaVersion: "dayflow-ablation-semantic-output-v0.1",
        presentationMode: "display_only",
        status: "no_suggestion",
        items: []
      },
      acceptedClaims: [],
      fieldEvidence: [],
      rejectedClaims: [],
      conflictingClaims: []
    });
    expect(
      verifyResolvedNormalizedEvidence({
        evidence: emptyEvidence,
        resolvedExportManifests: [manifest],
        resolvedArtifacts: [],
        artifactBlobs: [],
        normalizedTexts: []
      })
    ).toMatchObject({ valid: true, issueCodes: [] });
    expect(
      verifyResolvedNormalizedEvidence({
        evidence: emptyEvidence,
        resolvedExportManifests: [],
        resolvedArtifacts: [],
        artifactBlobs: [],
        normalizedTexts: []
      })
    ).toMatchObject({
      valid: false,
      issueCodes: expect.arrayContaining(["EXPORT_MANIFEST_MAP_NOT_EXACT"])
    });

    expect(
      dayflowNormalizedEvidenceSchema.safeParse(
        resignNormalized({
          ...emptyEvidence,
          sourceExportRefs: [
            emptyEvidence.sourceExportRefs[0]!,
            {
              ...emptyEvidence.sourceExportRefs[0]!,
              exportId: "export-empty-second"
            }
          ]
        })
      ).success
    ).toBe(false);
    expect(
      verifyResolvedNormalizedEvidenceContract({
        evidence: emptyEvidence,
        resolvedExportManifests: [manifest, manifest],
        resolvedArtifacts: [],
        artifactBlobs: [],
        normalizedTexts: []
      })
    ).toMatchObject({
      valid: false,
      issueCodes: expect.arrayContaining(["EXPORT_MANIFEST_MAP_NOT_EXACT"])
    });

    const liveEvidence = resignNormalized({
      ...emptyEvidence,
      dataOrigin: "live",
      studyPhase: "private_pilot"
    });
    expect(
      verifyResolvedNormalizedEvidence({
        evidence: liveEvidence,
        resolvedExportManifests: [manifest],
        resolvedArtifacts: [],
        artifactBlobs: [],
        normalizedTexts: []
      })
    ).toMatchObject({
      valid: false,
      issueCodes: expect.arrayContaining([
        "ORIGIN_PHASE_PROTOCOL_MISMATCH"
      ])
    });

    const substitutedManifest = dayflowScreenEvidenceExportSchema.parse(
      resignExport({
        ...manifest,
        exportId: "export-empty-substituted",
        databaseSnapshotIdentity: {
          ...manifest.databaseSnapshotIdentity,
          fixtureSetId: "synthetic-substituted-fixture-set"
        }
      })
    );
    expect(
      verifyResolvedNormalizedEvidence({
        evidence: emptyEvidence,
        resolvedExportManifests: [substitutedManifest],
        resolvedArtifacts: [],
        artifactBlobs: [],
        normalizedTexts: []
      })
    ).toMatchObject({
      valid: false,
      issueCodes: expect.arrayContaining(["EXPORT_MANIFEST_MAP_NOT_EXACT"])
    });
  });

  it("allows identical blob bytes under distinct exact artifact owners", () => {
    const baseManifest = exportFixture();
    const secondArtifact = {
      ...baseManifest.artifacts[0]!,
      sourceArtifactId: "artifact-10",
      sourceRowId: "10",
      relativeBlobRef: "blobs/fixture-10.jpg"
    };
    const manifest = dayflowScreenEvidenceExportSchema.parse(
      resignExport({
        ...baseManifest,
        coverage: {
          intervals: [
            {
              ...baseManifest.coverage.intervals[0]!,
              expectedFrameCount: 2,
              observedFrameCount: 2
            }
          ],
          expectedFrameCount: 2,
          observedFrameCount: 2,
          rejectedFrameCount: 0
        },
        artifacts: [baseManifest.artifacts[0]!, secondArtifact]
      })
    );
    const refs = manifest.artifacts.map((artifact) => ({
      artifactType: "dayflow_export_frame" as const,
      exportRef: {
        schemaVersion: manifest.schemaVersion,
        exportId: manifest.exportId,
        detachedManifestSha256: manifest.detachedManifestSha256
      },
      sourceRowId: artifact.sourceRowId,
      blobSha256: artifact.sha256
    }));
    const initiallyBound = bindNormalizedEvidenceToExport(
      normalizedEvidenceFixture(),
      manifest
    );
    const evidence = resignNormalized({
      ...initiallyBound,
      fieldEvidence: initiallyBound.fieldEvidence.map((field) => ({
        ...field,
        sourceArtifactRefs: refs
      }))
    });
    const resolvedArtifacts = manifest.artifacts.map((artifact, index) => ({
      sourceArtifactRef: refs[index]!,
      exportManifest: manifest,
      artifact
    }));
    const artifactBlobs = manifest.artifacts.map((artifact) => ({
      sourceArtifactId: artifact.sourceArtifactId,
      bytes: SYNTHETIC_FRAME_BYTES
    }));

    expect(
      verifyResolvedNormalizedEvidence({
        evidence,
        resolvedArtifacts,
        artifactBlobs,
        normalizedTexts: []
      })
    ).toMatchObject({ valid: true, issueCodes: [] });
    expect(
      verifyResolvedNormalizedEvidence({
        evidence,
        resolvedArtifacts: [
          resolvedArtifacts[0]!,
          {
            ...resolvedArtifacts[1]!,
            artifact: {
              ...resolvedArtifacts[1]!.artifact,
              sourceArtifactId: resolvedArtifacts[0]!.artifact.sourceArtifactId
            }
          }
        ],
        artifactBlobs,
        normalizedTexts: []
      })
    ).toMatchObject({
      valid: false,
      issueCodes: expect.arrayContaining([
        "EXPORT_ARTIFACT_OWNERSHIP_MISMATCH",
        "SOURCE_ARTIFACT_MAP_NOT_EXACT"
      ])
    });
  });
});

function exportFixture(options: { empty?: boolean } = {}) {
  const empty = options.empty ?? false;
  const withoutHash = {
    contract: "dayflow-screen-evidence-export-v0.1" as const,
    schemaVersion: "dayflow-screen-evidence-export-v0.1" as const,
    exportId: "export-1",
    lineageClass: "evidence" as const,
    dataOrigin: "synthetic" as const,
    studyPhase: "contract_conformance" as const,
    studyProtocolHash: ZERO_HASH,
    exportedAt: END,
    windowStart: START,
    windowEnd: END,
    dayflowCommitSha: "a".repeat(40),
    sourceFileHashes: [
      { relativePath: "Sources/ScreenRecorder.swift", sha256: ZERO_HASH }
    ],
    packageResolvedSha256: ONE_HASH,
    capturePolicyVersion: "capture-v0.1",
    captureConfig: {
      captureIntervalMs: "1000",
      maxWindowDurationMs: "1000",
      maxArtifactsPerExport: "256",
      maxBlobBytes: "10485760",
      allowedMimeTypes: ["image/jpeg" as const, "image/png" as const]
    },
    databaseSnapshotIdentity: {
      snapshotKind: "synthetic-fixture" as const,
      fixtureSetId: "fixture-set-1",
      fixtureGeneratorVersion: "generator-v0.1",
      fixtureGeneratorSeed: "seed-1",
      fixtureGeneratorConfigSha256: TWO_HASH
    },
    consentRevision: "synthetic-consent-v0.1",
    retentionPolicyId: "synthetic-retention-v0.1",
    coverage: {
      intervals: [
        {
          start: START,
          end: END,
          reason: empty ? ("paused" as const) : ("running" as const),
          expectedFrameCount: empty ? 0 : 1,
          observedFrameCount: empty ? 0 : 1,
          rejectedFrameCount: 0
        }
      ],
      expectedFrameCount: empty ? 0 : 1,
      observedFrameCount: empty ? 0 : 1,
      rejectedFrameCount: 0
    },
    artifacts: empty
      ? []
      : [
          {
            sourceArtifactId: "artifact-2",
            sourceRowId: "2",
            capturedAt: START,
            sequenceWithinSecond: "0",
            idleSeconds: 0,
            relativeBlobRef: "blobs/fixture-2.jpg",
            mimeType: "image/jpeg" as const,
            byteSize: String(SYNTHETIC_FRAME_BYTES.byteLength),
            sha256: SYNTHETIC_FRAME_HASH,
            privacyState: "synthetic_fixture" as const,
            captureConsentRevision: "synthetic-consent-v0.1",
            capturePolicyVersion: "capture-v0.1",
            capturePolicyDecision: "allow" as const,
            pseudonymousDisplayAttestation: attestation("synthetic-display"),
            pseudonymousWindowAttestation: attestation("synthetic-window"),
            placeholderState: "synthetic_fixture" as const,
            availability: "available" as const
          }
        ]
  };
  return {
    ...withoutHash,
    detachedManifestSha256: dayflowExportManifestSha256(withoutHash)
  };
}

function attestation(pseudonymousSubjectId: string) {
  return {
    attestationSchemaVersion:
      "dayflow-pseudonymous-capture-attestation-v0.1" as const,
    pseudonymousSubjectId,
    policyVersion: "capture-v0.1",
    policySha256: ZERO_HASH,
    attestedAt: START
  };
}

function resignExport(
  value: DayflowScreenEvidenceExport | Record<string, unknown>
) {
  const { detachedManifestSha256: _ignored, ...withoutHash } = value;
  return {
    ...withoutHash,
    detachedManifestSha256: dayflowExportManifestSha256(
      withoutHash as Omit<
        DayflowScreenEvidenceExport,
        "detachedManifestSha256"
      >
    )
  };
}

function normalizedEvidenceFixture() {
  const sourceArtifactRef = {
    artifactType: "dayflow_export_frame" as const,
    exportRef: {
      schemaVersion: "dayflow-screen-evidence-export-v0.1" as const,
      exportId: "export-1",
      detachedManifestSha256: ZERO_HASH
    },
    sourceRowId: "2",
    blobSha256: ONE_HASH
  };
  const withoutHash = {
    schemaVersion: "dayflow-normalized-evidence-v0.1" as const,
    evidenceId: "evidence-1",
    generationId: "generation-1",
    lineageClass: "evidence" as const,
    dataOrigin: "synthetic" as const,
    studyPhase: "contract_conformance" as const,
    studyProtocolHash: ZERO_HASH,
    extractorInputHash: TWO_HASH,
    captureWindow: { start: START, end: END },
    activityKind: "focused_work",
    applicationCategory: "development",
    subjectLabel: "synthetic subject",
    taskIntent: "inspect a synthetic fixture",
    stateClaim: null,
    confidenceBasisPoints: 8000,
    coverageCode: "observed" as const,
    normalizedCoverage: {
      intervals: [
        {
          start: START,
          end: END,
          reason: "running" as const,
          expectedFrameCount: 1,
          observedFrameCount: 1,
          rejectedFrameCount: 0
        }
      ],
      expectedFrameCount: 1,
      observedFrameCount: 1,
      rejectedFrameCount: 0
    },
    sourceExportRefs: [sourceArtifactRef.exportRef],
    sourceArtifactHashes: [ONE_HASH],
    preprocessingVersion: "preprocess-v0.1",
    extractorVersion: "extractor-v0.1",
    model: "none",
    promptVersion: "none",
    promptSha256: ZERO_HASH,
    configVersion: "config-v0.1",
    guardrailVersion: "guardrail-v0.1",
    verificationStatus: "verified" as const,
    reasonCodes: ["SYNTHETIC_CONTRACT_FIXTURE"],
    semanticOutput: {
      schemaVersion: "dayflow-ablation-semantic-output-v0.1" as const,
      presentationMode: "display_only" as const,
      status: "suggestions_available" as const,
      items: [
        {
          position: 1,
          title: "synthetic subject",
          summary: "inspect a synthetic fixture",
          caveatCodes: [],
          claimIds: ["claim-1", "claim-2"]
        }
      ]
    },
    acceptedClaims: [
      {
        claimId: "claim-1",
        outputFieldPath: "/items/0/title",
        claimClass: "DISPLAY_TITLE_HINT" as const,
        normalizedValueHash: TWO_HASH,
        confidenceBasisPoints: 8000,
        fieldEvidenceId: "field-evidence-1"
      },
      {
        claimId: "claim-2",
        outputFieldPath: "/items/0/summary",
        claimClass: "VISIBLE_TASK_INTENT" as const,
        normalizedValueHash: TWO_HASH,
        confidenceBasisPoints: 8000,
        fieldEvidenceId: "field-evidence-2"
      }
    ],
    fieldEvidence: [
      {
        fieldEvidenceId: "field-evidence-1",
        claimId: "claim-1",
        outputFieldPath: "/items/0/title",
        sourceArtifactRefs: [sourceArtifactRef],
        captureSpans: [
          {
            spanKind: "normalized_frame" as const,
            sourceArtifactRef,
            startOffsetMs: 0,
            endOffsetMs: 1000
          }
        ]
      },
      {
        fieldEvidenceId: "field-evidence-2",
        claimId: "claim-2",
        outputFieldPath: "/items/0/summary",
        sourceArtifactRefs: [sourceArtifactRef],
        captureSpans: [
          {
            spanKind: "normalized_frame" as const,
            sourceArtifactRef,
            startOffsetMs: 0,
            endOffsetMs: 1000
          }
        ]
      }
    ],
    rejectedClaims: [],
    conflictingClaims: [],
    expiresAt: "2026-08-18T00:00:00.000Z"
  };
  return {
    ...withoutHash,
    dayflowNormalizedEvidenceHash:
      dayflowNormalizedEvidenceSha256(withoutHash)
  };
}

function conflictRecord(screenClaimId: string, outputFieldPath: string) {
  return {
    conflictId: `conflict-${screenClaimId}`,
    outputFieldPath,
    screenClaimIds: [screenClaimId],
    structuredAuthorityRef: {
      authorityType: "sealed_attention_result" as const,
      resultId: "synthetic-sealed-result-1",
      resultSha256: ZERO_HASH
    },
    resolutionCode: "STRUCTURED_AUTHORITY_WINS" as const,
    reasonCode: "STRUCTURED_AUTHORITY_CONFLICT" as const
  };
}

function conflictEvidenceFixture() {
  const evidence = normalizedEvidenceFixture();
  const sourceArtifactRef =
    evidence.fieldEvidence[0]!.sourceArtifactRefs[0]!;
  return resignNormalized({
    ...evidence,
    semanticOutput: {
      schemaVersion: "dayflow-ablation-semantic-output-v0.1",
      presentationMode: "display_only",
      status: "no_suggestion",
      items: []
    },
    acceptedClaims: [],
    fieldEvidence: [],
    rejectedClaims: [
      {
        rejectedClaimId: "synthetic-screen-conflict-1",
        proposedOutputFieldPath: "/items/0/title",
        claimClass: "DISPLAY_TITLE_HINT",
        proposedValueHash: TWO_HASH,
        reasonCode: "STRUCTURED_AUTHORITY_CONFLICT",
        sourceArtifactRefs: [sourceArtifactRef],
        rejectedAt: END
      }
    ],
    conflictingClaims: [
      conflictRecord("synthetic-screen-conflict-1", "/items/0/title")
    ]
  });
}

function bindNormalizedEvidenceToExport(
  evidence: DayflowNormalizedEvidence,
  manifest: DayflowScreenEvidenceExport
) {
  const artifact = manifest.artifacts[0]!;
  const sourceArtifactRef = {
    artifactType: "dayflow_export_frame" as const,
    exportRef: {
      schemaVersion: manifest.schemaVersion,
      exportId: manifest.exportId,
      detachedManifestSha256: manifest.detachedManifestSha256
    },
    sourceRowId: artifact.sourceRowId,
    blobSha256: artifact.sha256
  };
  return resignNormalized({
    ...evidence,
    studyProtocolHash: manifest.studyProtocolHash,
    captureWindow: {
      start: manifest.windowStart,
      end: manifest.windowEnd
    },
    normalizedCoverage: manifest.coverage,
    sourceExportRefs: [sourceArtifactRef.exportRef],
    sourceArtifactHashes: [artifact.sha256],
    fieldEvidence: evidence.fieldEvidence.map((field) => ({
      ...field,
      sourceArtifactRefs: [sourceArtifactRef],
      captureSpans: field.captureSpans.map((span) => ({
        ...span,
        sourceArtifactRef
      }))
    }))
  });
}

function resignNormalized(
  value: DayflowNormalizedEvidence | Record<string, unknown>
): DayflowNormalizedEvidence {
  const { dayflowNormalizedEvidenceHash: _ignored, ...withoutHash } = value;
  return {
    ...withoutHash,
    dayflowNormalizedEvidenceHash: dayflowNormalizedEvidenceSha256(
      withoutHash as Omit<
        DayflowNormalizedEvidence,
        "dayflowNormalizedEvidenceHash"
      >
    )
  } as DayflowNormalizedEvidence;
}
