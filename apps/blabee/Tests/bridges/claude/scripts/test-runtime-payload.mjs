import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BUILD_ROOT, REPOSITORY_ROOT } from '../support/paths.mjs';

const phase = process.argv[2] || '--all';
if (process.argv.length > 3 || !['--all', '--integration', '--swift', '--packaged', '--packaging', '--production'].includes(phase)) {
  throw new Error('Usage: test-runtime-payload.mjs [--all|--integration|--swift|--packaged|--packaging|--production]');
}
const root = join(BUILD_ROOT, 'cp07');
const environment = { ...process.env,
  DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer',
  BLABEE_CP05_NODE: process.execPath,
  BLABEE_CP07_RUNTIME_ROOT: process.env.BLABEE_CP07_RUNTIME_ROOT || join(root, 'runtime'),
  BLABEE_CLAUDE_PACKAGED_RUNTIME: process.env.BLABEE_CP07_RUNTIME_ROOT || join(root, 'runtime'),
};
function run(command, args, extra = {}) {
  const result = spawnSync(command, args, { cwd: REPOSITORY_ROOT, env: environment, stdio: 'inherit', ...extra });
  if (result.error || result.status !== 0) {
    console.error(`CP-07 validation failed (${result.error?.code || result.status || result.signal})`);
    process.exit(result.status || 1);
  }
  return result;
}
function swift(name, command, args, fixture = false) {
  const directories = Object.fromEntries(['scratch', 'cache', 'config', 'security', 'modules']
    .map(key => [key, join(root, name, key)]));
  for (const directory of Object.values(directories)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const launcher = ['-t', '0', '-k', '-w', '/tmp/blabee-coordinator-swift-tests.lock', '/usr/bin/xcrun', 'swift'];
  const common = ['--package-path', REPOSITORY_ROOT, '--scratch-path', directories.scratch,
    '--cache-path', directories.cache, '--config-path', directories.config, '--security-path', directories.security,
    '--disable-keychain', '--disable-netrc', '--jobs', '2',
    ...(fixture ? ['-Xswiftc', '-DBLABEE_JOURNAL_TEST_HARNESS'] : [])];
  const options = { env: { ...environment, SWIFTPM_MODULECACHE_OVERRIDE: directories.modules,
    CLANG_MODULE_CACHE_PATH: directories.modules } };
  if (fixture) {
    const binary = run('/usr/bin/lockf', [...launcher, 'build', ...common, '--show-bin-path'], {
      ...options, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
    }).stdout.trim();
    options.env.BLABEE_CP05_COORDINATOR = join(binary, 'blabee-coordinator');
  }
  run('/usr/bin/lockf', [...launcher, command, ...common, ...args], options);
}
if (['--all', '--packaging'].includes(phase)) {
  run(process.execPath, ['--test', '--test-concurrency=1',
    'Tests/AppPackaging/claude-runtime-payload.test.mjs',
    'Tests/AppPackaging/macos-app-assembly.test.mjs', 'Tests/AppPackaging/release-signing.test.mjs']);
}
if (['--all', '--integration', '--swift'].includes(phase)) {
  swift('native', 'test', ['--no-parallel', '--filter',
    'ClaudeRuntimePayload|ClaudeRuntimePayloadUse|ClaudeInstalledRuntimeTrust|PetClaudeLauncher|ClaudeInstalledLauncherTests|AppInstallation|AppRuntimeUseLease|AppUpdateTransaction|PetProductUpdateMetrics'], true);
}
if (['--all', '--integration', '--packaged'].includes(phase)) {
  swift('native', 'test', ['--no-parallel', '--filter',
    'ClaudeInstalledPackagedIntegrationTests|ClaudeInstalledSessionIntegrationTests'], true);
}
if (['--all', '--production'].includes(phase)) {
  swift('production', 'build', ['--product', 'blabee-coordinator']);
}
