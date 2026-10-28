import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const architectureDirectory = path.resolve("architecture");
const sourceFiles = (await readdir(architectureDirectory))
  .filter((name) => name.endsWith(".c4"))
  .sort();
const failures = [];
let linkCount = 0;

for (const sourceFile of sourceFiles) {
  const sourcePath = path.join(architectureDirectory, sourceFile);
  const source = await readFile(sourcePath, "utf8");
  const links = source.matchAll(/\blink\s+([^\s]+)\s+['"]/g);

  for (const match of links) {
    linkCount += 1;
    const authoredTarget = match[1];
    const localTarget = authoredTarget.split("#", 1)[0];
    const resolvedTarget = path.resolve(path.dirname(sourcePath), localTarget);

    try {
      await stat(resolvedTarget);
    } catch {
      failures.push(`${sourceFile}: ${authoredTarget}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`LikeC4 local source links missing (${failures.length}):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`LikeC4 local source links valid: ${linkCount}`);
}
