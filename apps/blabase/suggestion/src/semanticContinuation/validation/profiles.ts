import { realpath, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  SEMANTIC_VALIDATION_PROFILE_VERSION,
  SEMANTIC_VALIDATION_STEPS
} from "./versions";
import type { SemanticValidationStep } from "./contracts";

const EXPECTED_PACKAGE_SCRIPTS = {
  typecheck: "tsc --noEmit",
  lint:
    "eslint . --ignore-pattern '.next/**' --ignore-pattern '.next-dev/**' --ignore-pattern '.next-build/**'",
  test: "vitest run"
} as const;

const packageSchema = z
  .object({
    name: z.literal("blabase-suggestion-prototype"),
    scripts: z.record(z.string())
  })
  .passthrough();

export type SemanticValidationProfileEntry = {
  step: SemanticValidationStep;
  executable: string;
  entrypoint: string;
  args: readonly string[];
  timeoutMs: number;
};

export type SemanticValidationProfile = {
  version: typeof SEMANTIC_VALIDATION_PROFILE_VERSION;
  root: string;
  environment: Readonly<Record<string, string>>;
  entries: readonly SemanticValidationProfileEntry[];
};

export async function resolveFixedSemanticValidationProfile(): Promise<SemanticValidationProfile> {
  try {
    const root = await resolveFixedSemanticValidationRoot();
    const packageJson = packageSchema.parse(
      JSON.parse(await readFile(resolve(root, "package.json"), "utf8"))
    );
    if (!hasExactValidationScripts(packageJson.scripts)) {
      throw new SemanticValidationProfileError("PROFILE_MISMATCH");
    }
    const executable = await realpath(process.execPath);
    const entries = await Promise.all([
      profileEntry(root, executable, {
        step: "typecheck",
        relativeEntrypoint: "node_modules/typescript/lib/tsc.js",
        args: ["--noEmit"],
        timeoutMs: 5 * 60_000
      }),
      profileEntry(root, executable, {
        step: "lint",
        relativeEntrypoint: "node_modules/eslint/bin/eslint.js",
        args: [
          ".",
          "--ignore-pattern",
          ".next/**",
          "--ignore-pattern",
          ".next-dev/**",
          "--ignore-pattern",
          ".next-build/**"
        ],
        timeoutMs: 5 * 60_000
      }),
      profileEntry(root, executable, {
        step: "unit_test",
        relativeEntrypoint: "node_modules/vitest/vitest.mjs",
        args: ["run"],
        timeoutMs: 15 * 60_000
      })
    ]);
    if (
      entries.length !== SEMANTIC_VALIDATION_STEPS.length ||
      entries.some(
        (entry, index) => entry.step !== SEMANTIC_VALIDATION_STEPS[index]
      )
    ) {
      throw new SemanticValidationProfileError("PROFILE_MISMATCH");
    }
    return Object.freeze({
      version: SEMANTIC_VALIDATION_PROFILE_VERSION,
      root,
      environment: Object.freeze({
        CI: "1",
        FORCE_COLOR: "0",
        NODE_ENV: "test",
        NO_COLOR: "1",
        PATH: "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
      }),
      entries: Object.freeze(entries)
    });
  } catch (error) {
    if (error instanceof SemanticValidationProfileError) throw error;
    throw new SemanticValidationProfileError("PROFILE_MISMATCH");
  }
}

export async function resolveFixedSemanticValidationRoot(): Promise<string> {
  const declaredRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../.."
  );
  const root = await realpath(declaredRoot);
  const packageJson = packageSchema.parse(
    JSON.parse(await readFile(resolve(root, "package.json"), "utf8"))
  );
  if (packageJson.name !== "blabase-suggestion-prototype") {
    throw new SemanticValidationProfileError("PROFILE_MISMATCH");
  }
  return root;
}

export function hasExactValidationScripts(
  scripts: Record<string, string>
): boolean {
  return (
    scripts.typecheck === EXPECTED_PACKAGE_SCRIPTS.typecheck &&
    scripts.lint === EXPECTED_PACKAGE_SCRIPTS.lint &&
    scripts.test === EXPECTED_PACKAGE_SCRIPTS.test
  );
}

export class SemanticValidationProfileError extends Error {
  constructor(public readonly code: "PROFILE_MISMATCH") {
    super(code);
    this.name = "SemanticValidationProfileError";
  }
}

async function profileEntry(
  root: string,
  executable: string,
  input: {
    step: SemanticValidationStep;
    relativeEntrypoint: string;
    args: readonly string[];
    timeoutMs: number;
  }
): Promise<SemanticValidationProfileEntry> {
  const entrypoint = await realpath(resolve(root, input.relativeEntrypoint));
  const relativeEntrypoint = relative(root, entrypoint);
  if (
    relativeEntrypoint.startsWith(`..${sep}`) ||
    !relativeEntrypoint.startsWith(`node_modules${sep}`)
  ) {
    throw new SemanticValidationProfileError("PROFILE_MISMATCH");
  }
  return Object.freeze({
    step: input.step,
    executable,
    entrypoint,
    args: Object.freeze([...input.args]),
    timeoutMs: input.timeoutMs
  });
}
