import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LauncherAgentCliError,
  parseLauncherAgentArgs
} from "../src/launcher";

const HOME = "/Users/tester";
const DATA_ROOT =
  "/Users/tester/Library/Application Support/Blabase";
const TEST_ENV: NodeJS.ProcessEnv = {
  HOME,
  NODE_ENV: "test"
};
const tempRoots: string[] = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

describe("launcher agent CLI", () => {
  it("accepts one explicit absolute data root", () => {
    expect(
      parseLauncherAgentArgs(
        [
          "--data-root",
          "/Users/tester/Library/../Library/Application Support/Blabase"
        ],
        TEST_ENV
      )
    ).toEqual({ dataRoot: DATA_ROOT });
  });

  it("rejects invalid argument shapes", () => {
    const cases: string[][] = [
      [],
      ["--data-root"],
      ["--other", DATA_ROOT],
      ["--data-root", DATA_ROOT, "extra"]
    ];
    for (const argv of cases) {
      expectCliError(argv, "INVALID_ARGUMENTS");
    }
  });

  it("rejects unsafe data roots", () => {
    const cases: Array<[string, string]> = [
      ["relative/path", "INVALID_DATA_ROOT"],
      [`${DATA_ROOT}\u0000suffix`, "INVALID_DATA_ROOT"],
      [`/${"a".repeat(1_025)}`, "INVALID_DATA_ROOT"],
      ["/", "UNSAFE_DATA_ROOT"],
      [HOME, "UNSAFE_DATA_ROOT"]
    ];
    for (const [dataRoot, code] of cases) {
      expectCliError(["--data-root", dataRoot], code);
    }
  });

  it("returns the physical path for an existing symlink", () => {
    const tempRoot = createTempRoot();
    const physicalParent = join(tempRoot, "physical-parent");
    const physicalDataRoot = join(physicalParent, "data");
    const dataRootLink = join(tempRoot, "data-link");
    mkdirSync(physicalDataRoot, { recursive: true });
    symlinkSync(physicalDataRoot, dataRootLink, "dir");

    expect(
      parseLauncherAgentArgs(
        ["--data-root", dataRootLink],
        { HOME: join(tempRoot, "home"), NODE_ENV: "test" }
      )
    ).toEqual({ dataRoot: realpathSync(physicalDataRoot) });
  });

  it("resolves the nearest existing ancestor for a missing leaf", () => {
    const tempRoot = createTempRoot();
    const physicalParent = join(tempRoot, "physical-parent");
    const parentLink = join(tempRoot, "parent-link");
    mkdirSync(physicalParent);
    symlinkSync(physicalParent, parentLink, "dir");

    expect(
      parseLauncherAgentArgs(
        [
          "--data-root",
          join(parentLink, "missing", "nested")
        ],
        { HOME: join(tempRoot, "home"), NODE_ENV: "test" }
      )
    ).toEqual({
      dataRoot: join(
        realpathSync(physicalParent),
        "missing",
        "nested"
      )
    });
  });

  it("rejects a symlink whose physical path is the filesystem root", () => {
    const tempRoot = createTempRoot();
    const rootLink = join(tempRoot, "root-link");
    symlinkSync(parse(tempRoot).root, rootLink, "dir");

    expectCliError(
      ["--data-root", rootLink],
      "UNSAFE_DATA_ROOT",
      { HOME: join(tempRoot, "home"), NODE_ENV: "test" }
    );
  });

  it("rejects aliases of the physical home directory", () => {
    const tempRoot = createTempRoot();
    const physicalHome = join(tempRoot, "physical-home");
    const configuredHomeLink = join(tempRoot, "home-link");
    const dataRootLink = join(tempRoot, "data-link");
    mkdirSync(physicalHome);
    symlinkSync(physicalHome, configuredHomeLink, "dir");
    symlinkSync(physicalHome, dataRootLink, "dir");

    expectCliError(
      ["--data-root", dataRootLink],
      "UNSAFE_DATA_ROOT",
      { HOME: configuredHomeLink, NODE_ENV: "test" }
    );
  });
});

function createTempRoot(): string {
  const tempRoot = mkdtempSync(
    join(tmpdir(), "blabase-launcher-cli-")
  );
  tempRoots.push(tempRoot);
  return tempRoot;
}

function expectCliError(
  argv: string[],
  code: string,
  env: NodeJS.ProcessEnv = TEST_ENV
): void {
  try {
    parseLauncherAgentArgs(argv, env);
    throw new Error("Expected launcher CLI parsing to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(LauncherAgentCliError);
    expect(error).toMatchObject({ code });
  }
}
