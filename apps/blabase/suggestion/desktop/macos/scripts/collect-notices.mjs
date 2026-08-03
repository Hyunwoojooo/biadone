import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const [metafilePath, projectRootInput, outputPath] = process.argv.slice(2);
if (!metafilePath || !projectRootInput || !outputPath) {
  process.stderr.write(
    "usage: collect-notices.mjs <metafile.json> <project-root> <output.txt>\n"
  );
  process.exitCode = 2;
} else {
  const projectRoot = resolve(projectRootInput);
  const metafile = JSON.parse(await readFile(metafilePath, "utf8"));
  const packageRoots = new Set();

  for (const inputPath of Object.keys(metafile.inputs ?? {})) {
    const absoluteInput = resolve(projectRoot, inputPath);
    const relativeInput = relative(projectRoot, absoluteInput);
    const parts = relativeInput.split(sep);
    const nodeModulesIndex = parts.lastIndexOf("node_modules");
    if (nodeModulesIndex < 0 || nodeModulesIndex + 1 >= parts.length) {
      continue;
    }
    const first = parts[nodeModulesIndex + 1];
    const packageParts = first.startsWith("@")
      ? [first, parts[nodeModulesIndex + 2]]
      : [first];
    if (packageParts.some((part) => !part)) continue;
    packageRoots.add(
      join(projectRoot, ...parts.slice(0, nodeModulesIndex + 1), ...packageParts)
    );
  }

  const notices = [
    "Blabase Launcher bundled third-party notices",
    "",
    "The following packages are embedded in launcher-agent.mjs.",
    ""
  ];
  for (const packageRoot of [...packageRoots].sort()) {
    const packageJson = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8")
    );
    const licensePath = await findLicense(packageRoot);
    if (!licensePath) {
      throw new Error(
        `LICENSE_NOT_FOUND:${packageJson.name ?? basename(packageRoot)}`
      );
    }
    const licenseText = (await readFile(licensePath, "utf8")).trim();
    notices.push(
      "================================================================================",
      `${packageJson.name ?? basename(packageRoot)} ${packageJson.version ?? "unknown"}`,
      `Declared license: ${packageJson.license ?? "see included license"}`,
      "================================================================================",
      licenseText,
      ""
    );
  }

  await writeFile(outputPath, `${notices.join("\n")}\n`, { mode: 0o644 });
}

async function findLicense(packageRoot) {
  for (const name of [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "LICENCE",
    "LICENCE.md",
    "COPYING"
  ]) {
    const candidate = join(packageRoot, name);
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      // Try the next conventional license filename.
    }
  }
  return null;
}
