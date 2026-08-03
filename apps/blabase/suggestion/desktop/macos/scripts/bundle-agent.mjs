import { build } from "esbuild";
import { writeFile } from "node:fs/promises";

const [entryPoint, outfile, metafile, workingDirectory] = process.argv.slice(2);
if (!entryPoint || !outfile || !metafile || !workingDirectory) {
  process.stderr.write(
    "usage: bundle-agent.mjs <entry.ts> <output.mjs> <metafile.json> <working-directory>\n"
  );
  process.exitCode = 2;
} else {
  const result = await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    packages: "bundle",
    legalComments: "eof",
    logLevel: "warning",
    metafile: true,
    absWorkingDir: workingDirectory
  });
  await writeFile(metafile, `${JSON.stringify(result.metafile)}\n`, {
    mode: 0o600
  });
}
