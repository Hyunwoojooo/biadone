import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  GoldenDatasetError,
  applyGoldenInputCutoff,
  evaluateGoldenCase,
  loadGoldenNoteDataset,
  runGoldenBaseline,
  writeGoldenBaselineArtifacts,
} from "./index.ts";

const goldenRoot = new URL("../../evals/golden-notes/", import.meta.url);

test("loads the development manifest and validates all 12 Golden case contracts", async () => {
  const dataset = await loadGoldenNoteDataset(fileURLToPath(goldenRoot));

  assert.equal(dataset.manifest.datasetVersion, "gptmemory-golden-notes-dev-v1");
  assert.equal(dataset.manifest.datasetClass, "development");
  assert.equal(dataset.cases.length, 12);
  assert.equal(
    dataset.datasetSha256,
    "3975c01140f1354a776292c64e6abe6d3e2943b403aed539deab631d1a8ee849",
  );
  const expectedCutoffs = {
    "saber-aaai27-001": [88, 86, [87, 88]],
    "mac-mini-cross-migration-002": [91, 89, [90, 91]],
    "remote-dev-ghostty-codex-003": [172, 170, [171, 172]],
    "nuvin-ai-learning-service-004": [90, 88, [89, 90]],
    "playmcp-codex-remote-control-005": [77, 74, [75, 76, 77]],
    "delay-tolerant-grasp-research-006": [16, 14, [15, 16]],
    "world-action-model-research-007": [66, 64, [65, 66]],
    "rl-adaptation-business-008": [10, 8, [9, 10]],
    "pieces-personal-memory-os-009": [14, 12, [13, 14]],
    "blabase-incremental-memory-architecture-010": [15, 13, [14, 15]],
    "note-service-video-research-011": [54, 52, [53, 54]],
    "llm-context-acquisition-preference-012": [60, 58, [59, 60]],
  };
  assert.deepEqual(
    Object.fromEntries(
      dataset.cases.map(({ definition }) => [
        definition.id,
        [
          definition.source.messageCountAtCapture,
          definition.inputCutoff.lastIncludedMessageIndex,
          definition.inputCutoff.excludedMessageIndexes,
        ],
      ]),
    ),
    expectedCutoffs,
  );

  const playMcp = dataset.cases.find(
    (item) => item.definition.id === "playmcp-codex-remote-control-005",
  ).definition;
  assert.deepEqual(playMcp.inputCutoff.teacherPromptMessageIndexes, [75, 76]);
  assert.equal(playMcp.inputCutoff.teacherResponseMessageIndex, 77);
  assert.equal(playMcp.inputCutoff.duplicateTeacherPromptWarning, true);

  const delay = dataset.cases.find(
    (item) => item.definition.id === "delay-tolerant-grasp-research-006",
  ).definition;
  assert.equal(delay.source.alternateCaptures.length, 1);
  assert.equal(delay.teacher.variantDrafts.length, 1);

  const noteResearch = dataset.cases.find(
    (item) => item.definition.id === "note-service-video-research-011",
  ).definition;
  assert.equal(noteResearch.source.captureWarnings[0].messageCount, 44);
  const contextResearch = dataset.cases.find(
    (item) =>
      item.definition.id === "llm-context-acquisition-preference-012",
  ).definition;
  assert.deepEqual(
    contextResearch.source.captureWarnings.map((warning) => warning.messageCount),
    [37, 1],
  );
});

test("cuts by sourceIndex, includes same-index events, and fails closed on null indexes", () => {
  const result = applyGoldenInputCutoff(
    [
      message("u1", 1, "user", "첫 요청"),
      message("a1", 3, "assistant", "첫 응답"),
      event("image1", 4, "[생성된 이미지: 구조도]"),
      event("image-unindexed", null, "[생성된 이미지: 출처 없음]"),
      event("image-invalid", 0, "[생성된 이미지: 잘못된 출처]"),
      message("teacher", 5, "user", "[REFERENCE_NOTE]를 작성해줘"),
    ],
    4,
  );

  assert.deepEqual(
    result.messages.map((item) => item.id),
    ["u1", "a1", "image1"],
  );
  assert.deepEqual(result.includedSourceIndexes, [1, 3, 4]);
  assert.equal(result.omittedUnindexedCount, 2);
  assert.equal(result.filteredAfterCutoffCount, 1);
  assert.deepEqual(result.excludedMessageIds, [
    "image-unindexed",
    "image-invalid",
    "teacher",
  ]);
});

test("generates a technical-pass candidate without leaking post-cutoff Teacher turns", () => {
  const datasetCase = syntheticDatasetCase();
  const imported = syntheticImport();
  const result = evaluateGoldenCase(datasetCase, imported, 12.5);

  assert.equal(result.report.technicalStatus, "pass");
  assert.equal(
    result.report.qualityStatus,
    "not_scored_pending_human_reference",
  );
  assert.equal(result.report.durationMs, 12.5);
  assert.deepEqual(result.report.input.includedSourceIndexes, [1, 3, 4]);
  assert.equal(result.report.input.filteredAfterCutoffCount, 2);
  assert.equal(result.report.metrics.eventMessages, 1);
  assert.equal(result.report.metrics.provenanceCoverage, 1);
  assert.match(result.candidateMarkdown, /첫 요청/);
  assert.match(result.candidateMarkdown, /생성된 이미지/);
  assert.doesNotMatch(result.candidateMarkdown, /TEACHER SECRET|REFERENCE_NOTE/);
  assert.doesNotMatch(
    JSON.stringify(result.report),
    /TEACHER SECRET|chatgpt\.com\/share\/fixture/,
  );
  assert.equal(
    result.report.gates.find(
      (item) => item.id === "input.known_internal_text_omitted",
    ).status,
    "pass",
  );
  assert.equal(
    result.report.gates.find(
      (item) => item.id === "source.content_identity_unverified",
    ).status,
    "warning",
  );
  assert.equal(
    result.report.gates.find((item) => item.id === "source.identity").status,
    "pass",
  );
});

test("blocks a drifted source before generating any candidate", () => {
  const imported = syntheticImport();
  imported.diagnostics.sourceMessageCount = 7;
  const result = evaluateGoldenCase(syntheticDatasetCase(), imported);

  assert.equal(result.report.technicalStatus, "blocked");
  assert.equal(result.report.error.code, "SOURCE_DRIFT");
  assert.equal(result.report.output.candidatePath, null);
  assert.equal(result.candidateMarkdown, null);
});

test("quarantines an output that contains a private artifact URI", () => {
  const imported = syntheticImport();
  imported.conversation.messages[1].text =
    "파일은 [여기](sandbox:/mnt/data/private.md)에 있습니다.";
  const result = evaluateGoldenCase(syntheticDatasetCase(), imported);

  assert.equal(result.report.technicalStatus, "fail");
  assert.equal(result.report.error.code, "OUTPUT_GUARDRAIL_FAILED");
  assert.equal(result.report.output.candidatePath, null);
  assert.equal(result.candidateMarkdown, null);
  assert.equal(
    result.report.gates.find(
      (item) => item.id === "output.no_private_artifact_uri",
    ).status,
    "fail",
  );
});

test("quarantines an output that contains an unsanitized rich-reference marker", () => {
  const imported = syntheticImport();
  imported.conversation.messages[1].text =
    "근거가 있습니다. \uE200cite\uE202turn1search0\uE201";
  const result = evaluateGoldenCase(syntheticDatasetCase(), imported);

  assert.equal(result.report.technicalStatus, "fail");
  assert.equal(result.report.error.code, "OUTPUT_GUARDRAIL_FAILED");
  assert.equal(result.report.output.candidatePath, null);
  assert.equal(result.candidateMarkdown, null);
  assert.equal(
    result.report.gates.find(
      (item) => item.id === "output.no_rich_reference_marker",
    ).status,
    "fail",
  );
});

test("fails closed when a declared post-cutoff Teacher turn was not observed", () => {
  const imported = syntheticImport();
  imported.conversation.messages = imported.conversation.messages.filter(
    (item) => item.sourceIndex !== 6,
  );
  const result = evaluateGoldenCase(syntheticDatasetCase(), imported);

  assert.equal(result.report.technicalStatus, "fail");
  assert.equal(result.candidateMarkdown, null);
  assert.equal(
    result.report.gates.find(
      (item) => item.id === "input.declared_teacher_turns_observed",
    ).status,
    "fail",
  );
});

test("isolates a failed fetch while continuing other selected cases", async () => {
  const first = syntheticDatasetCase("fixture-one");
  const second = syntheticDatasetCase("fixture-two");
  const dataset = syntheticDataset([first, second]);
  const execution = await runGoldenBaseline({
    dataset,
    mode: "fixture",
    codeCommitSha: "abc123+dirty",
    timeoutMs: 1000,
    artifactLocation: "outputs/test-run",
    runId: "golden-test-run",
    now: () => new Date("2026-08-01T00:00:00.000Z"),
    importCase: async (item) => {
      if (item.definition.id === "fixture-one") {
        const error = new Error(
          "failed at https://chatgpt.com/share/private-fixture",
        );
        error.code = "SHARE_LINK_NOT_ACCESSIBLE";
        throw error;
      }
      return syntheticImport();
    },
  });

  assert.equal(execution.report.totals.technicalBlocked, 1);
  assert.equal(execution.report.totals.technicalPassed, 1);
  assert.equal(execution.report.totals.generatedCandidates, 1);
  assert.equal(execution.candidates.size, 1);
  assert.doesNotMatch(
    JSON.stringify(execution.report),
    /chatgpt\.com\/share\/private-fixture/,
  );
  assert.equal(execution.report.run.provider, null);
  assert.equal(execution.report.cases[1].acquisitionMode, "fixture");
  assert.match(execution.report.run.candidateBundleSha256, /^[a-f0-9]{64}$/);
});

test("writes a complete run atomically and refuses to overwrite it", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "gptmemory-golden-"));
  const output = join(temporaryRoot, "baseline-output");
  try {
    const datasetCase = syntheticDatasetCase();
    const execution = await runGoldenBaseline({
      dataset: syntheticDataset([datasetCase]),
      mode: "fixture",
      codeCommitSha: "abc123",
      timeoutMs: 1000,
      artifactLocation: "outputs/test-run",
      runId: "golden-write-test",
      now: () => new Date("2026-08-01T00:00:00.000Z"),
      importCase: async () => syntheticImport(),
    });

    await writeGoldenBaselineArtifacts(execution, output);
    const [report, summary, candidate, outputStat, reportStat, candidateStat] = await Promise.all([
      readFile(join(output, "report.json"), "utf8"),
      readFile(join(output, "summary.md"), "utf8"),
      readFile(join(output, "candidates", "fixture-case.md"), "utf8"),
      stat(output),
      stat(join(output, "report.json")),
      stat(join(output, "candidates", "fixture-case.md")),
    ]);
    assert.match(report, /gptmemory\.golden-baseline-report\.v2/);
    assert.doesNotMatch(report, /TEACHER SECRET/);
    assert.match(summary, /Semantic quality: not scored/);
    assert.match(candidate, /첫 요청/);
    assert.equal(outputStat.mode & 0o777, 0o700);
    assert.equal(reportStat.mode & 0o777, 0o600);
    assert.equal(candidateStat.mode & 0o777, 0o600);
    const candidateSha256 = createHash("sha256")
      .update(candidate, "utf8")
      .digest("hex");
    assert.equal(
      JSON.parse(report).cases[0].output.sha256,
      candidateSha256,
    );
    assert.equal(
      JSON.parse(report).run.candidateBundleSha256,
      createHash("sha256")
        .update(
          JSON.stringify([
            { id: "fixture-case", sha256: candidateSha256 },
          ]),
          "utf8",
        )
        .digest("hex"),
    );

    await assert.rejects(
      writeGoldenBaselineArtifacts(execution, output),
      (error) =>
        error instanceof GoldenDatasetError && error.code === "OUTPUT_EXISTS",
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("rejects a manifest case path that escapes the dataset directory", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "gptmemory-dataset-"));
  try {
    await mkdir(join(temporaryRoot, "cases"), { recursive: true });
    await writeFile(
      join(temporaryRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: "gptmemory.golden-note-manifest.v1",
        datasetVersion: "unsafe-fixture-v1",
        datasetClass: "development",
        cases: [
          {
            id: "unsafe-case",
            path: "../outside.json",
            status: "teacher_draft_pending_human_review",
            language: "ko",
            domain: "fixture",
          },
        ],
      }),
      "utf8",
    );

    await assert.rejects(
      loadGoldenNoteDataset(temporaryRoot),
      (error) =>
        error instanceof GoldenDatasetError &&
        error.code === "UNSAFE_DATASET_PATH",
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

function syntheticDatasetCase(id = "fixture-case") {
  const definition = {
    schemaVersion: "gptmemory.golden-note-case.v1",
    id,
    createdAt: "2026-08-01",
    language: "ko",
    domain: "fixture",
    title: `Fixture ${id}`,
    source: {
      type: "chatgpt_share_link",
      shareUrl: "https://chatgpt.com/share/fixture",
      messageCountAtCapture: 6,
      candidateContentSha256: "legacy-digest",
      captureWarnings: [
        {
          code: "tool_call_like_assistant_messages",
          messageIndexes: [2, 4],
        },
      ],
    },
    inputCutoff: {
      indexBase: 1,
      strategy: "exclude_teacher_turn",
      lastIncludedMessageIndex: 4,
      excludedMessageIndexes: [5, 6],
      excludedTrailingMessageCount: 2,
      teacherPromptMessageIndex: 5,
      teacherResponseMessageIndex: 6,
    },
    teacher: {
      promptVersion: "teacher-note-v1",
      promptPath: "prompts/teacher-note-v1.md",
      draftPath: `cases/${id}/teacher-draft.md`,
    },
    humanReview: {
      status: "pending",
      reviewPath: `cases/${id}/review.md`,
      referencePath: null,
    },
    status: "teacher_draft_pending_human_review",
  };
  return {
    definition,
    manifestEntry: {
      id,
      path: `cases/${id}/case.json`,
      status: definition.status,
      language: definition.language,
      domain: definition.domain,
    },
    caseRelativePath: `cases/${id}/case.json`,
    caseDirectory: `/private/tmp/${id}`,
    teacherDraftRelativePath: `cases/${id}/teacher-draft.md`,
    reviewRelativePath: `cases/${id}/review.md`,
    referenceRelativePath: null,
  };
}

function syntheticDataset(cases) {
  return {
    rootDirectory: "/private/tmp/golden-fixture",
    manifest: {
      schemaVersion: "gptmemory.golden-note-manifest.v1",
      datasetVersion: "fixture-v1",
      datasetClass: "development",
      cases: cases.map((item) => item.manifestEntry),
    },
    cases,
    datasetSha256: "a".repeat(64),
  };
}

function syntheticImport() {
  return {
    conversation: {
      title: "Fixture conversation",
      messages: [
        message("u1", 1, "user", "첫 요청"),
        message("a1", 3, "assistant", "첫 응답"),
        event("image1", 4, "[생성된 이미지: 구조도]"),
        message("teacher", 5, "user", "[REFERENCE_NOTE] TEACHER SECRET"),
        message("teacher-answer", 6, "assistant", "TEACHER SECRET ANSWER"),
      ],
    },
    source: {
      type: "chatgpt_share_link",
      originalUrl: "https://chatgpt.com/share/fixture",
      normalizedUrl: "https://chatgpt.com/share/fixture",
      shareId: "fixture",
      fetchedAt: "2026-08-01T00:00:00.000Z",
      adapterVersion: "gptmemory-chatgpt-share.v4",
    },
    warnings: [],
    diagnostics: {
      payloadCount: 1,
      sourceMessageCount: 6,
      noteMessageCount: 5,
      omittedInternalCount: 2,
      preservedEventCount: 1,
      unsupportedContentCount: 0,
      privateArtifactReferenceRedactedCount: 0,
      richReferenceMarkerOmittedCount: 0,
      titleSource: "payload",
    },
  };
}

function message(id, sourceIndex, role, text) {
  return {
    id,
    index: 1,
    sourceIndex,
    role,
    kind: "text",
    text,
    createdAt: null,
  };
}

function event(id, sourceIndex, text) {
  return {
    id,
    index: 1,
    sourceIndex,
    role: "assistant",
    kind: "event",
    eventType: "image_generated",
    text,
    createdAt: null,
  };
}
