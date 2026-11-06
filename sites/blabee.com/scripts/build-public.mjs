import { copyFile, lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PUBLIC_ENTRIES = Object.freeze([
  "index.html",
  "404.html",
  "_headers",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "css",
  "js",
  "assets",
  "liquid-glass",
]);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultSourceRoot = path.resolve(scriptDirectory, "..");

function assertInside(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);

  if (
    relativePath === "" ||
    relativePath.startsWith(`..${path.sep}`) ||
    relativePath === ".." ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Refusing path outside the expected directory: ${candidatePath}`);
  }
}

async function inspectSource(sourcePath, relativePath) {
  let stats;

  try {
    stats = await lstat(sourcePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Missing public entry: ${relativePath}`);
    }
    throw error;
  }

  if (stats.isSymbolicLink()) {
    throw new Error(`Symbolic links are not allowed in the public build: ${relativePath}`);
  }

  if (stats.isFile()) {
    return [{ type: "file", sourcePath, relativePath }];
  }

  if (!stats.isDirectory()) {
    throw new Error(`Unsupported public entry type: ${relativePath}`);
  }

  const children = await readdir(sourcePath, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name, "en"));

  const descendants = [];
  for (const child of children) {
    const childRelativePath = path.join(relativePath, child.name);
    descendants.push(
      ...(await inspectSource(path.join(sourcePath, child.name), childRelativePath)),
    );
  }

  return [
    { type: "directory", sourcePath, relativePath },
    ...descendants,
  ];
}

async function inspectPublicEntries(sourceRoot) {
  const entries = [];

  for (const relativePath of PUBLIC_ENTRIES) {
    const sourcePath = path.resolve(sourceRoot, relativePath);
    assertInside(sourceRoot, sourcePath);
    entries.push(...(await inspectSource(sourcePath, relativePath)));
  }

  return entries;
}

async function prepareOutputDirectory(sourceRoot, outputRoot) {
  const expectedOutputRoot = path.resolve(sourceRoot, "dist");

  if (outputRoot !== expectedOutputRoot) {
    throw new Error(`Refusing to recreate an unexpected output path: ${outputRoot}`);
  }

  try {
    const stats = await lstat(outputRoot);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("Refusing to replace dist because it is not a real directory");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: false });
}

export async function buildPublic({ sourceRoot = defaultSourceRoot } = {}) {
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const sourceStats = await lstat(resolvedSourceRoot);

  if (sourceStats.isSymbolicLink() || !sourceStats.isDirectory()) {
    throw new Error("The public build source must be a real directory");
  }

  const outputRoot = path.resolve(resolvedSourceRoot, "dist");
  const entries = await inspectPublicEntries(resolvedSourceRoot);
  await prepareOutputDirectory(resolvedSourceRoot, outputRoot);

  for (const entry of entries) {
    const destinationPath = path.resolve(outputRoot, entry.relativePath);
    assertInside(outputRoot, destinationPath);

    if (entry.type === "directory") {
      await mkdir(destinationPath, { recursive: true });
    } else {
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await copyFile(entry.sourcePath, destinationPath);
    }
  }

  return outputRoot;
}

const isDirectInvocation =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectInvocation) {
  try {
    const outputRoot = await buildPublic();
    console.log(`Built public site at ${path.relative(process.cwd(), outputRoot) || "."}/`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
