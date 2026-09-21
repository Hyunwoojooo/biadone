import { spawnSync } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { TEST_ROOT as PROJECT_ROOT, REPOSITORY_ROOT, BUILD_ROOT } from '../support/paths.mjs';

// Compile the shared UI in an isolated scratch path. SwiftUI/AppKit rendering
// runs serially; this never launches Claude or replaces the installed app.
const build = join(BUILD_ROOT, 'common-pet');
const directories = Object.fromEntries(['scratch', 'cache', 'config', 'security', 'modules', 'artifacts']
  .map(name => [name, join(build, name)]));
await Promise.all(Object.values(directories).map(path => mkdir(path, { recursive: true, mode: 0o700 })));
const env = { ...process.env, SWIFTPM_MODULECACHE_OVERRIDE: directories.modules,
  CLANG_MODULE_CACHE_PATH: directories.modules, BLABEE_CLAUDE_PET_ARTIFACTS: directories.artifacts,
  BLABEE_AIR_RENDER_DIRECTORY: directories.artifacts };
if (!env.DEVELOPER_DIR) {
  const xcode = '/Applications/Xcode.app/Contents/Developer';
  try { await access(join(xcode, 'usr/bin/xcodebuild')); env.DEVELOPER_DIR = xcode; }
  catch { /* Keep the selected command-line toolchain. */ }
}
const filter = 'ClaudePet|blabeePet|PetAirViewTests|petActionGeneration|petEventActionGeneration|PetSkipDecisionTests|petTransport';
const result = spawnSync('/usr/bin/swift', ['test', '--package-path', REPOSITORY_ROOT,
  '--scratch-path', directories.scratch, '--cache-path', directories.cache,
  '--config-path', directories.config, '--security-path', directories.security,
  '--disable-keychain', '--disable-netrc', '--jobs', '2', '--no-parallel', '--filter', filter],
{ cwd: PROJECT_ROOT, env, stdio: 'inherit' });
if (result.error || result.status !== 0) {
  console.error(`Common Pet validation failed (${result.error?.code || result.status || result.signal})`);
  process.exitCode = result.status || 1;
}
