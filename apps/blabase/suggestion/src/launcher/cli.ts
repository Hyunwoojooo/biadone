import { realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  parse,
  resolve
} from "node:path";

const MAX_DATA_ROOT_LENGTH = 1_024;
const UNSAFE_PATH_TEXT =
  /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;

export type LauncherAgentCliOptions = {
  dataRoot: string;
};

export function parseLauncherAgentArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): LauncherAgentCliOptions {
  if (
    argv.length !== 2 ||
    argv[0] !== "--data-root" ||
    !argv[1]
  ) {
    throw new LauncherAgentCliError("INVALID_ARGUMENTS");
  }
  const raw = argv[1];
  if (
    raw.length > MAX_DATA_ROOT_LENGTH ||
    UNSAFE_PATH_TEXT.test(raw) ||
    !isAbsolute(raw)
  ) {
    throw new LauncherAgentCliError("INVALID_DATA_ROOT");
  }
  const dataRoot = resolvePhysicalPath(raw);
  if (dataRoot === parse(dataRoot).root) {
    throw new LauncherAgentCliError("UNSAFE_DATA_ROOT");
  }
  const configuredHome = env.HOME;
  if (
    configuredHome &&
    isAbsolute(configuredHome) &&
    dataRoot === resolvePhysicalPath(configuredHome)
  ) {
    throw new LauncherAgentCliError("UNSAFE_DATA_ROOT");
  }
  return { dataRoot };
}

function resolvePhysicalPath(path: string): string {
  let existingAncestor = resolve(path);
  const missingSegments: string[] = [];

  while (true) {
    try {
      return resolve(
        realpathSync(existingAncestor),
        ...missingSegments
      );
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw new LauncherAgentCliError("INVALID_DATA_ROOT");
      }
    }

    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) {
      throw new LauncherAgentCliError("INVALID_DATA_ROOT");
    }
    missingSegments.unshift(basename(existingAncestor));
    existingAncestor = parent;
  }
}

function isMissingPathError(
  error: unknown
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

export class LauncherAgentCliError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "LauncherAgentCliError";
  }
}
