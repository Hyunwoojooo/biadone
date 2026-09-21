import { spawnSync } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { TEST_ROOT as PROJECT_ROOT, BUILD_ROOT } from '../support/paths.mjs';

const arguments_ = process.argv.slice(2);
if (arguments_.some(argument => argument !== '--lifecycle')) {
  throw new Error('Unknown shared-engine validation argument');
}
const includeLifecycle = arguments_.includes('--lifecycle');
const build = join(BUILD_ROOT, 'shared-engine');
const directories = Object.fromEntries(['scratch', 'cache', 'config', 'security', 'modules'].map(name => [name, join(build, name)]));
await Promise.all(Object.values(directories).map(path => mkdir(path, { recursive: true })));
const env = { ...process.env, SWIFTPM_MODULECACHE_OVERRIDE: directories.modules, CLANG_MODULE_CACHE_PATH: directories.modules };
// The installed Command Line Tools can lack the Swift Testing macro plugin.
// Prefer the full local Xcode toolchain, without changing xcode-select globally.
if (!env.DEVELOPER_DIR) {
  const xcode = '/Applications/Xcode.app/Contents/Developer';
  try { await access(join(xcode, 'usr/bin/xcodebuild')); env.DEVELOPER_DIR = xcode; }
  catch { /* An explicitly selected or complete CLI toolchain may work too. */ }
}
const args = ['--package-path', join(PROJECT_ROOT, 'shared-engine'), '--scratch-path', directories.scratch,
  '--cache-path', directories.cache, '--config-path', directories.config, '--security-path', directories.security,
  '--disable-keychain', '--disable-netrc', '--jobs', '2'];

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, { cwd: PROJECT_ROOT, env, stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) {
    console.error(`Shared-engine validation failed: ${command} (${result.error?.code || result.status || result.signal})`);
    process.exit(result.status || 1);
  }
  return result;
}

// Keep the long synchronous lifecycle fixtures from starving the existing
// concurrency tests' semaphore deadlines. Their internal races remain intact.
run('/usr/bin/swift', ['test', ...args, '--no-parallel', '--skip', 'ProductLifecycleTests']);
// The full lifecycle counts belong to test:product-lifecycle. Keep them
// separate from routine shared-engine checks and optimize their test build.
if (includeLifecycle) {
  const lifecycle = ['test', ...args, '--configuration', 'release', '--no-parallel'];
  // Validate the same journal/outcome assertions with the short fixtures first.
  run('/usr/bin/swift', [...lifecycle, '--filter', 'ProductLifecycleTests', '--skip', 'fiveHundredCycles']);
  run('/usr/bin/swift', [...lifecycle, '--filter', 'fiveHundredCycles']);
}
const binaryPath = run('/usr/bin/swift', ['build', ...args, '--show-bin-path'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).stdout.trim();
run(process.execPath, ['--test', 'integration/client.test.mjs', 'integration/roundtrip.test.mjs',
  'integration/product-wire-schema.test.mjs'], {
  env: { ...env, BLABEE_CLAUDE_SHARED_CORE_FIXTURE: join(binaryPath, 'blabee-claude-core-fixture') },
});
