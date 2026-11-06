import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BUILD_ROOT, REPOSITORY_ROOT, TEST_ROOT } from '../support/paths.mjs';

const phase = process.argv[2] || '--all';
if (process.argv.length > 3 || !['--all', '--source', '--native', '--node', '--production'].includes(phase)) {
  throw new Error('Usage: test-installed-session.mjs [--all|--source|--native|--node|--production]');
}
const root = join(BUILD_ROOT, 'cp05');
const env = { ...process.env,
  DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer',
  BLABEE_CP05_NODE: process.execPath,
};

function run(command, args, extra = {}) {
  const result = spawnSync(command, args, { cwd: REPOSITORY_ROOT, env, stdio: 'inherit', ...extra });
  if (result.error || result.status !== 0) {
    console.error(`CP-05 validation failed (${result.error?.code || result.status || result.signal})`);
    process.exit(result.status || 1);
  }
  return result;
}
function swift(phaseName, packagePath, command, args, fixture = false) {
  const directories = Object.fromEntries(['scratch', 'cache', 'config', 'security', 'modules']
    .map(name => [name, join(root, phaseName, name)]));
  for (const directory of Object.values(directories)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const launcher = ['-t', '0', '-k', '-w', '/tmp/blabee-coordinator-swift-tests.lock', '/usr/bin/xcrun', 'swift'];
  const common = ['--package-path', packagePath,
    '--scratch-path', directories.scratch, '--cache-path', directories.cache,
    '--config-path', directories.config, '--security-path', directories.security,
    '--disable-keychain', '--disable-netrc', '--jobs', '2',
    ...(fixture ? ['-Xswiftc', '-DBLABEE_JOURNAL_TEST_HARNESS'] : [])];
  const options = {
    env: { ...env, SWIFTPM_MODULECACHE_OVERRIDE: directories.modules, CLANG_MODULE_CACHE_PATH: directories.modules },
  };
  if (phaseName === 'native') {
    const binaryPath = run('/usr/bin/lockf', [...launcher, 'build', ...common, '--show-bin-path'], {
      ...options, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
    }).stdout.trim();
    options.env.BLABEE_CP05_COORDINATOR = join(binaryPath, 'blabee-coordinator');
  }
  run('/usr/bin/lockf', [...launcher, command, ...common, ...args], options);
}

if (['--all', '--source'].includes(phase)) {
  swift('source', join(TEST_ROOT, 'shared-engine'), 'test', ['--no-parallel', '--filter',
    'ProductChannelSourceTests|NativeSessionTests|ProductAuthorityIntegrationTests|ProductWireCodecTests']);
}
if (['--all', '--native'].includes(phase)) {
  swift('native', REPOSITORY_ROOT, 'test', ['--no-parallel', '--filter',
    'ClaudeInstalledLauncherTests|ClaudeInstalledSessionIntegrationTests|ClaudeSessionEnrollmentTests|ClaudeOwnerRenewalControllerTests|ClaudeAutoConnect'], true);
}
if (['--all', '--node'].includes(phase)) {
  run(process.execPath, ['--test', '--test-concurrency=1',
    join(TEST_ROOT, 'auto-connect.test.mjs'),
    join(TEST_ROOT, 'session-v2-client.test.mjs'), join(TEST_ROOT, 'session-v2-bridge.test.mjs'),
    join(TEST_ROOT, 'session-v2-lifecycle.test.mjs'), join(TEST_ROOT, 'session-v2-channel-poller.test.mjs'),
    join(TEST_ROOT, 'product-bridge.test.mjs'), join(TEST_ROOT, 'integration/product-wire-schema.test.mjs')]);
}
if (['--all', '--production'].includes(phase)) {
  swift('production', REPOSITORY_ROOT, 'build', ['--product', 'blabee-coordinator']);
}
