import { spawnSync } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../src/shared/identity.mjs';

const build = join(PROJECT_ROOT, 'build/product-ingress');
const directories = Object.fromEntries(['scratch', 'cache', 'config', 'security', 'modules']
  .map(name => [name, join(build, name)]));
await Promise.all(Object.values(directories).map(path => mkdir(path, { recursive: true, mode: 0o700 })));
const env = { ...process.env, SWIFTPM_MODULECACHE_OVERRIDE: directories.modules,
  CLANG_MODULE_CACHE_PATH: directories.modules };
if (!env.DEVELOPER_DIR) {
  const xcode = '/Applications/Xcode.app/Contents/Developer';
  try { await access(join(xcode, 'usr/bin/xcodebuild')); env.DEVELOPER_DIR = xcode; }
  catch { /* Keep an explicitly selected or complete CLI toolchain. */ }
}
const args = ['--package-path', join(PROJECT_ROOT, '../src/coordinator-swift'),
  '--scratch-path', directories.scratch, '--cache-path', directories.cache,
  '--config-path', directories.config, '--security-path', directories.security,
  '--disable-keychain', '--disable-netrc', '--jobs', '2', '-Xswiftc', '-DBLABEE_JOURNAL_TEST_HARNESS'];

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, { cwd: PROJECT_ROOT, env, stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) {
    console.error(`Product-ingress validation failed: ${command} (${result.error?.code || result.status || result.signal})`);
    process.exit(result.status || 1);
  }
  return result;
}

run('/usr/bin/swift', ['build', ...args, '--product', 'blabee-coordinator']);
const binaryPath = run('/usr/bin/swift', ['build', ...args, '--show-bin-path'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
}).stdout.trim();
run(process.execPath, ['--test', 'tests/shared-engine/product-ingress.test.mjs'], {
  env: { ...env, BLABEE_CLAUDE_PRODUCT_COORDINATOR: join(binaryPath, 'blabee-coordinator') },
});
