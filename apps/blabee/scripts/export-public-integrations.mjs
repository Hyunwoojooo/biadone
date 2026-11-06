import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, realpath, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(sourceRoot, 'Packaging/PublicIntegrations/manifest.json');
const allowedTargetRoots = new Set(['Contracts', 'Fixtures', 'Tests', 'bridges', 'docs', 'examples', 'scripts', '.github']);
const forbiddenSegments = new Set(['.git', 'node_modules', 'engine', 'app', 'supabase', 'account-web', 'dev', 'build']);
const allowedSourcePrefixes = [
  'Contracts/v1/', 'Fixtures/v1/', 'Tests/Contracts/',
  'bridges/codex/plugin/', 'bridges/claude/src/', 'Tests/bridges/claude/',
];
const allowedSourceFiles = new Set([
  'Tests/CoordinatorOperational/plugin-package.test.mjs',
  'docs/github/blabee-hero-light.svg', 'docs/github/blabee-hero-dark.svg',
  'docs/github/blabee-social-preview.png',
]);

function relativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || path.posix.isAbsolute(value)
      || value.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('public_export_invalid_relative_path');
  }
  return value;
}

async function regularSourceFile(relative) {
  const parts = relativePath(relative).split('/');
  let filename = sourceRoot;
  for (const part of parts) {
    filename = path.join(filename, part);
    const info = await lstat(filename);
    if (info.isSymbolicLink()) throw new Error(`public_export_symlink: ${relative}`);
  }
  if (!(await lstat(filename)).isFile()) throw new Error(`public_export_not_a_file: ${relative}`);
  const canonical = await realpath(filename);
  if (!canonical.startsWith(`${await realpath(sourceRoot)}${path.sep}`)) {
    throw new Error(`public_export_source_escape: ${relative}`);
  }
  return filename;
}

export async function exportPublicIntegrations(outputDirectory) {
  const configuration = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (configuration.schema_version !== '1.0' || !Array.isArray(configuration.files) || !configuration.files.length) {
    throw new Error('public_export_invalid_configuration');
  }
  const output = path.resolve(outputDirectory);
  if (output === sourceRoot || sourceRoot.startsWith(`${output}${path.sep}`)) {
    throw new Error('public_export_output_contains_source');
  }
  // A fresh destination prevents accidentally publishing old private files or
  // copying .git history from the working repository.
  await mkdir(output, { recursive: false });
  if ((await readdir(output)).length !== 0 || (await lstat(output)).isSymbolicLink()) {
    throw new Error('public_export_output_not_empty');
  }
  const seen = new Set();
  const files = [];
  for (const entry of configuration.files) {
    const source = relativePath(entry.source);
    const target = relativePath(entry.path);
    const segments = target.split('/');
    if (seen.has(target) || target === 'PUBLIC_SOURCES.json'
        || segments.some(segment => forbiddenSegments.has(segment) || /^\.env(?:\.|$)/i.test(segment))
        || (segments.length > 1 && !allowedTargetRoots.has(segments[0]))) {
      throw new Error(`public_export_disallowed_target: ${target}`);
    }
    if (!['source', 'public-template'].includes(entry.origin)) throw new Error('public_export_invalid_origin');
    if (entry.origin === 'public-template' ? !source.startsWith('docs/github/public/')
        : !allowedSourceFiles.has(source) && !allowedSourcePrefixes.some(prefix => source.startsWith(prefix))) {
      throw new Error(`public_export_disallowed_source: ${source}`);
    }
    const inputFile = await regularSourceFile(source);
    const bytes = await readFile(inputFile);
    const destination = path.join(output, target);
    await mkdir(path.dirname(destination), { recursive: true });
    const mode = (await lstat(inputFile)).mode & 0o111 ? '0755' : '0644';
    await writeFile(destination, bytes, { flag: 'wx', mode: Number.parseInt(mode, 8) });
    await chmod(destination, Number.parseInt(mode, 8));
    seen.add(target);
    files.push({ path: target, sha256: createHash('sha256').update(bytes).digest('hex'), mode, origin: entry.origin });
  }
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  await writeFile(path.join(output, 'PUBLIC_SOURCES.json'), `${JSON.stringify({
    schema_version: '1.0', app_release: configuration.app_release, files,
  }, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
  return { files: files.length + 1, output };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--output') {
      throw new Error('usage: node scripts/export-public-integrations.mjs --output <new-directory>');
    }
    const result = await exportPublicIntegrations(process.argv[3]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
