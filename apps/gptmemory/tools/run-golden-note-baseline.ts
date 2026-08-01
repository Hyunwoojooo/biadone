#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { importChatGPTShareUrl } from "../lib/chatgpt/index.ts";
import {
  GoldenDatasetError,
  loadGoldenNoteDataset,
  runGoldenBaseline,
  writeGoldenBaselineArtifacts,
  type GoldenRunMode,
} from "../lib/golden-notes/index.ts";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const datasetRoot = resolve(projectRoot, "evals/golden-notes");

interface CliOptions {
  caseIds: string[];
  htmlByCaseId: Map<string, string>;
  allowLiveFetch: boolean;
  outputDirectory: string | null;
  timeoutMs: number;
  help: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }

  const dataset = await loadGoldenNoteDataset(datasetRoot);
  const selectedIds =
    options.caseIds.length > 0
      ? [...new Set(options.caseIds)]
      : dataset.cases
          .filter((item) => item.definition.status !== "retired")
          .map((item) => item.definition.id);
  const knownCaseIds = new Set(
    dataset.cases.map((item) => item.definition.id),
  );
  const selectedCaseIds = new Set(selectedIds);
  for (const caseId of options.htmlByCaseId.keys()) {
    if (!knownCaseIds.has(caseId)) {
      throw new GoldenDatasetError(
        "UNKNOWN_HTML_CASE_ID",
        `The --html mapping uses an unknown case ID: ${caseId}`,
      );
    }
    if (!selectedCaseIds.has(caseId)) {
      throw new GoldenDatasetError(
        "UNUSED_HTML_MAPPING",
        `The --html mapping is not selected by --case: ${caseId}`,
      );
    }
  }
  const missingLocalInputs = selectedIds.filter(
    (id) => !options.htmlByCaseId.has(id),
  );
  if (!options.allowLiveFetch && missingLocalInputs.length > 0) {
    throw new GoldenDatasetError(
      "LIVE_FETCH_NOT_ALLOWED",
      "Every selected case needs --html <case-id>=<path>, or pass --allow-live-fetch explicitly.",
    );
  }

  const startedAt = new Date().toISOString();
  const runId = createRunId(startedAt);
  const outputDirectory =
    options.outputDirectory ??
    resolve(projectRoot, "outputs/golden-notes", runId);
  assertPrivateOutputDirectory(projectRoot, outputDirectory);
  const mode = determineMode(
    selectedIds,
    options.htmlByCaseId,
    options.allowLiveFetch,
  );
  const codeCommitSha = await readCodeRevision(projectRoot);
  const artifactLocation = safeArtifactLocation(projectRoot, outputDirectory);

  process.stdout.write(
    `Running ${selectedIds.length} Golden case(s) in ${mode} mode.\n`,
  );
  process.stdout.write(
    "Technical gates do not score semantic note quality; human review remains pending.\n",
  );

  const execution = await runGoldenBaseline({
    dataset,
    caseIds: selectedIds,
    mode,
    codeCommitSha,
    timeoutMs: options.timeoutMs,
    artifactLocation,
    runId,
    acquisitionModeForCase: (datasetCase) =>
      options.htmlByCaseId.has(datasetCase.definition.id)
        ? "local_html"
        : "live_share_fetch",
    importCase: async (datasetCase) => {
      const localHtmlPath = options.htmlByCaseId.get(
        datasetCase.definition.id,
      );
      if (localHtmlPath) {
        const html = await readFile(localHtmlPath, "utf8");
        return importChatGPTShareUrl({
          url: datasetCase.definition.source.shareUrl,
          timeoutMs: options.timeoutMs,
          fetchHtml: async () => html,
        });
      }
      return importChatGPTShareUrl({
        url: datasetCase.definition.source.shareUrl,
        timeoutMs: options.timeoutMs,
      });
    },
  });

  await writeGoldenBaselineArtifacts(execution, outputDirectory);
  const { totals } = execution.report;
  process.stdout.write(`Run ID: ${execution.report.run.runId}\n`);
  process.stdout.write(`Artifacts: ${artifactLocation}\n`);
  process.stdout.write(
    `Technical pass/fail/blocked: ${totals.technicalPassed}/${totals.technicalFailed}/${totals.technicalBlocked}\n`,
  );
  process.stdout.write(
    `Generated candidates: ${totals.generatedCandidates}; semantic quality pending: ${totals.qualityPendingHumanReview}\n`,
  );

  if (totals.technicalFailed > 0 || totals.technicalBlocked > 0) {
    process.exitCode = 1;
  }
}

function parseArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    caseIds: [],
    htmlByCaseId: new Map(),
    allowLiveFetch: false,
    outputDirectory: null,
    timeoutMs: 10_000,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case "--case": {
        options.caseIds.push(requireNextArg(args, ++index, "--case"));
        break;
      }
      case "--html": {
        const mapping = requireNextArg(args, ++index, "--html");
        const separatorIndex = mapping.indexOf("=");
        if (separatorIndex <= 0 || separatorIndex === mapping.length - 1) {
          throw new GoldenDatasetError(
            "INVALID_ARGUMENT",
            "--html must use <case-id>=<private-html-path>.",
          );
        }
        const caseId = mapping.slice(0, separatorIndex);
        const htmlPath = mapping.slice(separatorIndex + 1);
        options.htmlByCaseId.set(caseId, resolve(htmlPath));
        break;
      }
      case "--allow-live-fetch":
        options.allowLiveFetch = true;
        break;
      case "--output":
        options.outputDirectory = resolve(
          requireNextArg(args, ++index, "--output"),
        );
        break;
      case "--timeout": {
        const rawTimeout = requireNextArg(args, ++index, "--timeout");
        const timeoutMs = Number(rawTimeout);
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
          throw new GoldenDatasetError(
            "INVALID_ARGUMENT",
            "--timeout must be an integer from 1 to 120000 milliseconds.",
          );
        }
        options.timeoutMs = timeoutMs;
        break;
      }
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new GoldenDatasetError(
          "INVALID_ARGUMENT",
          `Unknown argument: ${argument}`,
        );
    }
  }
  return options;
}

function requireNextArg(
  args: readonly string[],
  index: number,
  option: string,
): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new GoldenDatasetError(
      "INVALID_ARGUMENT",
      `${option} requires a value.`,
    );
  }
  return value;
}

function determineMode(
  selectedIds: readonly string[],
  htmlByCaseId: ReadonlyMap<string, string>,
  allowLiveFetch: boolean,
): GoldenRunMode {
  const localCount = selectedIds.filter((id) => htmlByCaseId.has(id)).length;
  if (localCount === selectedIds.length) return "local_html";
  if (localCount > 0 && allowLiveFetch) return "mixed";
  return "live_share_fetch";
}

async function readCodeRevision(root: string): Promise<string> {
  try {
    const [{ stdout: revision }, { stdout: status }] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root }),
      execFileAsync("git", ["status", "--porcelain", "--", "."], {
        cwd: root,
      }),
    ]);
    const sha = revision.trim();
    return status.trim() ? `${sha}+dirty` : sha;
  } catch {
    return "unknown";
  }
}

function safeArtifactLocation(root: string, outputDirectory: string): string {
  const relativePath = relative(root, outputDirectory);
  if (
    relativePath &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`)
  ) {
    return relativePath.split(sep).join("/");
  }
  return `external-private-output/${basename(outputDirectory)}`;
}

function assertPrivateOutputDirectory(
  root: string,
  outputDirectory: string,
): void {
  const allowedRoots = [resolve(root, "outputs"), resolve(root, ".local")];
  if (
    !allowedRoots.some(
      (allowedRoot) =>
        outputDirectory === allowedRoot ||
        outputDirectory.startsWith(`${allowedRoot}${sep}`),
    )
  ) {
    throw new GoldenDatasetError(
      "UNSAFE_OUTPUT_DIRECTORY",
      "Evaluation output must stay under this project's ignored outputs/ or .local/ directory.",
    );
  }
}

function createRunId(startedAt: string): string {
  return `golden-${startedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

function helpText(): string {
  return `Golden Note deterministic baseline\n\nUsage:\n  npm run eval:golden -- [options]\n\nOptions:\n  --case <id>                 Run one case (repeatable; default: all non-retired)\n  --html <id>=<path>          Use a private local capture for one case\n  --allow-live-fetch          Explicitly allow public share URL fetching\n  --output <directory>        Private output under outputs/ or .local/\n  --timeout <milliseconds>    Per-share timeout, 1..120000 (default: 10000)\n  --help                      Show this help\n\nThe default output is outputs/golden-notes/<run-id>.\nThe runner never copies raw HTML or serializes restored message arrays.\nGenerated candidates are private derived artifacts and belong under an ignored output directory.\n`;
}

main().catch((error: unknown) => {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "EVAL_FAILED")
      : "EVAL_FAILED";
  const message =
    error instanceof Error ? error.message : "Golden baseline failed.";
  process.stderr.write(`${code}: ${sanitizeCliError(message)}\n`);
  process.exitCode = 1;
});

function sanitizeCliError(message: string): string {
  return message
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|key|token)-[A-Za-z0-9_-]{8,}\b/g, "[redacted-secret]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\/(?:Users|private|tmp|home)\/[^\s]+/g, "[redacted-path]")
    .slice(0, 500);
}
