import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  inspectGoldenDataset,
  type GoldenDatasetQualityReport
} from "../src/core/golden-baseline/dataQuality";

await main();

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.has("--help")) {
      process.stdout.write(`Usage: npm run golden:validate -- [options]

Options:
  --input <path>       Golden input JSON (default: .local/golden-v01-input.json)
  --output <path>      Write the complete quality report as JSON
  --json               Print the complete report as JSON
  --no-profile         Skip known frozen-dataset count and scope checks
  --fail-on-warning    Exit with status 1 when warnings are present
  --help               Show this help
`);
      return;
    }

    const inputPath = args.get("--input") ?? ".local/golden-v01-input.json";
    const outputPath = args.get("--output") ?? null;
    const source = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
    const report = inspectGoldenDataset(source, {
      profile: args.has("--no-profile") ? null : undefined
    });

    if (outputPath) await persist(outputPath, report);
    if (args.has("--json")) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printHumanReport(report, inputPath, outputPath);
    }

    if (
      report.status === "error" ||
      (args.has("--fail-on-warning") && report.status === "warning")
    ) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(
      `Golden Dataset 품질 검사를 실행하지 못했습니다: ${safeErrorMessage(error)}\n`
    );
    process.exitCode = 1;
  }
}

function printHumanReport(
  report: GoldenDatasetQualityReport,
  inputPathValue: string,
  outputPathValue: string | null
) {
  const lines = [
    `Golden Dataset quality: ${report.status.toUpperCase()}`,
    `reportVersion: ${report.reportVersion}`,
    `datasetVersion: ${report.datasetVersion ?? "unknown"}`,
    `goldSnapshotSha256: ${report.goldSnapshotSha256 ?? "unavailable"}`,
    `profile: ${report.profile ?? "none"}`,
    `input: ${inputPathValue}`,
    `records: sessions=${report.counts.sessions}, prompts=${report.counts.prompts}, summaries=${report.counts.summaries}`,
    `issues: errors=${report.issueCounts.error}, warnings=${report.issueCounts.warning}, info=${report.issueCounts.info}, affectedRecords=${report.counts.affectedRecords}`
  ];
  if (outputPathValue) lines.push(`report: ${outputPathValue}`);
  for (const issue of report.issues) {
    const target = issue.targetId ?? issue.field ?? "dataset";
    const field = issue.field ? ` field=${issue.field}` : "";
    lines.push(
      `[${issue.severity}] ${issue.code} target=${target}${field} — ${issue.message}`
    );
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function persist(path: string, report: GoldenDatasetQualityReport) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  await rename(temporaryPath, path);
}

function parseArgs(values: string[]) {
  const valueArguments = new Set(["--input", "--output"]);
  const flagArguments = new Set([
    "--json",
    "--no-profile",
    "--fail-on-warning",
    "--help"
  ]);
  const parsed = new Map<string, string>();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!valueArguments.has(key) && !flagArguments.has(key)) {
      throw new Error(`알 수 없는 인수입니다: ${key}`);
    }
    if (valueArguments.has(key)) {
      const next = values[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${key}에는 경로 값이 필요합니다.`);
      }
      parsed.set(key, next);
      index += 1;
    } else {
      parsed.set(key, "true");
    }
  }
  return parsed;
}

function safeErrorMessage(error: unknown) {
  if (error instanceof SyntaxError)
    return "입력 파일이 유효한 JSON이 아닙니다.";
  if (error instanceof Error) return error.message;
  return "알 수 없는 오류";
}
