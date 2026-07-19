import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "../../src/app/api/golden/quality/route";

const temporaryDirectories: string[] = [];

describe("GET /api/golden/quality", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
      temporaryDirectories.splice(0).map((path) =>
        rm(path, {
          recursive: true,
          force: true
        })
      )
    );
  });

  it("returns a no-store sanitized report", async () => {
    const reportPath = await writeTemporaryReport(
      JSON.stringify(persistedReport())
    );
    vi.stubEnv("BLABASE_GOLDEN_QUALITY_REPORT_PATH", reportPath);

    const response = await GET();
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload).toEqual({
      datasetVersion: "gold-core-v0.1",
      goldSnapshotSha256:
        "f02a650d2e78bb605ae8b068d224d454aa5808aff61f72073eb5f2f3266ae672",
      qualityReportVersion: "golden-quality-v1",
      generatedAt: "2026-07-20T01:00:00.000Z",
      issueCounts: { error: 0, warning: 1 },
      warnings: [{ code: "PROMPT_CANCELLED_INPUT", targetId: "S-001-P031" }]
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("private.example");
    expect(serialized).not.toContain("민감한 Golden 원문");
  });

  it("returns a sanitized 404 when no report exists", async () => {
    const directory = await makeTemporaryDirectory();
    const missingPath = join(directory, "missing.json");
    vi.stubEnv("BLABASE_GOLDEN_QUALITY_REPORT_PATH", missingPath);

    const response = await GET();
    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload.error.code).toBe("GOLDEN_QUALITY_REPORT_NOT_FOUND");
    expect(JSON.stringify(payload)).not.toContain(missingPath);
  });

  it("returns a sanitized 503 for an invalid report", async () => {
    const reportPath = await writeTemporaryReport(
      '{"private":"민감한 Golden 원문"'
    );
    vi.stubEnv("BLABASE_GOLDEN_QUALITY_REPORT_PATH", reportPath);

    const response = await GET();
    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe("GOLDEN_QUALITY_REPORT_INVALID");
    expect(JSON.stringify(payload)).not.toContain("민감한 Golden 원문");
    expect(JSON.stringify(payload)).not.toContain(reportPath);
  });
});

async function writeTemporaryReport(source: string) {
  const directory = await makeTemporaryDirectory();
  const path = join(directory, "quality.json");
  await writeFile(path, source, "utf8");
  return path;
}

async function makeTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "blabase-quality-api-"));
  temporaryDirectories.push(directory);
  return directory;
}

function persistedReport() {
  return {
    reportVersion: "golden-quality-v1",
    generatedAt: "2026-07-20T01:00:00.000Z",
    datasetVersion: "gold-core-v0.1",
    goldSnapshotSha256:
      "f02a650d2e78bb605ae8b068d224d454aa5808aff61f72073eb5f2f3266ae672",
    issueCounts: {
      error: 0,
      warning: 1,
      info: 0
    },
    issues: [
      {
        severity: "warning",
        code: "PROMPT_CANCELLED_INPUT",
        entityType: "prompt",
        sessionId: "S-001",
        targetId: "S-001-P031",
        field: "inputIntent",
        message: "민감한 Golden 원문",
        shareUrl: "https://private.example/share/secret"
      }
    ],
    sourceSpreadsheetId: "private-sheet-id",
    rawGold: "민감한 Golden 원문"
  };
}
