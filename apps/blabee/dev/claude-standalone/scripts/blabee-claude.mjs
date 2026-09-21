#!/usr/bin/env node
import { constants } from 'node:fs';
import { access, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DEVELOPMENT_BUILD_ROOT, PROJECT_ROOT, PROTOCOL, BUNDLE_ID, runtimePath, socketPath } from '../src/shared/identity.mjs';
import { request } from '../src/shared/client.mjs';

const protectedFlags = new Set(['--session-id', '--resume', '-r', '--continue', '-c', '--fork-session', '--settings', '--mcp-config', '--strict-mcp-config', '--dangerously-load-development-channels', '--channels', '--bare', '--safe-mode', '--print', '-p', '--bg', '--background', '--worktree', '-w', '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions']);

export function parseArguments(argv) {
  const [command = 'help', ...args] = argv;
  if (!['help', 'doctor', 'app', 'launch'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const options = { command, cwd: process.cwd(), extra: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') { options.extra = args.slice(i + 1); break; }
    const names = { '--cwd': 'cwd', '--runtime': 'runtime', '--claude-bin': 'claudeBin' };
    if (!names[arg] || !args[i + 1]) throw new Error(`Unknown or incomplete option: ${arg}`);
    options[names[arg]] = args[++i];
  }
  for (const arg of options.extra) {
    const key = arg.split('=', 1)[0];
    if (protectedFlags.has(key) || /^-[rcpw].+/.test(arg)) {
      throw new Error(`This first version requires a new interactive session; unsupported override: ${key}`);
    }
    if (arg === 'bypassPermissions' || arg === '--permission-mode=bypassPermissions') throw new Error('Native permissions must remain enabled');
  }
  return options;
}

export function createLaunchConfiguration({ sessionID, runtime, cwd, node = process.execPath, root = PROJECT_ROOT }) {
  const mcp = { mcpServers: { 'blabee-claude': {
    command: node, args: [join(root, 'src/bridge/mcp.mjs')],
    env: {
      BLABEE_CLAUDE_SESSION_ID: sessionID,
      BLABEE_CLAUDE_SESSION_TOKEN: '${BLABEE_CLAUDE_SESSION_TOKEN}',
      BLABEE_CLAUDE_RUNTIME: runtime,
    },
  } } };
  const hooks = {};
  for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd']) {
    hooks[event] = [{ hooks: [{ type: 'command', command: node,
      args: [join(root, 'src/bridge/hook.mjs'), '--expected-session-id', sessionID], timeout: 5 }] }];
  }
  return { mcp, settings: { hooks }, sessionID, runtime, cwd };
}

async function findExecutable(explicit, name) {
  const candidates = explicit ? [resolve(explicit)] : (process.env.PATH || '').split(delimiter).filter(Boolean).map(path => join(path, name));
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); if ((await stat(candidate)).isFile()) return await realpath(candidate); } catch { /* next PATH entry */ }
  }
  throw new Error(`${name} executable not found; use --claude-bin ABS`);
}

export async function withRegisteredSession({ runtime, sessionID, cwd, ipc = request }, operation) {
  const registration = await ipc('session.register', { session_id: sessionID, cwd }, { runtime });
  try {
    if (registration.session_id !== sessionID || typeof registration.session_token !== 'string') throw new Error('Invalid session registration');
    return await operation(registration);
  } finally {
    if (typeof registration.session_token === 'string') {
      await ipc('hook', { session_id: sessionID, session_id_native: sessionID, event: 'SessionEnd', cwd },
        { runtime, auth: registration.session_token }).catch(() => {});
    }
  }
}

export function appOpenArguments(app, runtimeOverride) {
  return runtimeOverride ? ['-n', app, '--args', '--runtime', runtimePath(runtimeOverride)] : [app];
}

async function launch(options) {
  const runtime = runtimePath(options.runtime);
  const cwd = await realpath(resolve(options.cwd));
  if (!(await stat(cwd)).isDirectory()) throw new Error('cwd must be a directory');
  const claude = await findExecutable(options.claudeBin || process.env.BLABEE_CLAUDE_CLI, 'claude');
  const version = spawnSync(claude, ['--version'], { encoding: 'utf8', timeout: 5000 });
  const match = version.stdout?.match(/(\d+)\.(\d+)\.(\d+)/);
  if (version.status !== 0 || !match || [Number(match[1]), Number(match[2]), Number(match[3])].reduce((n, value) => n * 10000 + value, 0) < 200010248) {
    throw new Error('Claude Code 2.1.248 or later is required for this development integration');
  }
  const health = await request('health', {}, { runtime });
  if (health.provider !== 'claude' || health.protocol !== PROTOCOL) throw new Error('Wrong coordinator identity');
  const sessionID = randomUUID();
  await withRegisteredSession({ runtime, sessionID, cwd }, async registered => {
  const generated = createLaunchConfiguration({ sessionID, runtime, cwd });
  const directory = join(DEVELOPMENT_BUILD_ROOT, 'sessions', sessionID);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const mcpPath = join(directory, 'mcp.json');
  const hooksPath = join(directory, 'hooks.json');
  await writeFile(mcpPath, JSON.stringify(generated.mcp, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(hooksPath, JSON.stringify(generated.settings, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const env = { ...process.env, BLABEE_CLAUDE_SESSION_ID: sessionID,
    BLABEE_CLAUDE_SESSION_TOKEN: registered.session_token, BLABEE_CLAUDE_RUNTIME: runtime };
  // UI authority belongs to the native app, never to model subprocesses.
  delete env.BLABEE_CLAUDE_UI_TOKEN;
  const args = ['--session-id', sessionID, '--mcp-config', mcpPath, '--settings', hooksPath,
    '--dangerously-load-development-channels', 'server:blabee-claude', ...options.extra];
  console.error(`Blabee Claude · session ${sessionID}\nClaude의 개발용 Channels 확인과 기존 권한 화면을 따라 진행하세요.`);
  const child = spawn(claude, args, { cwd, env, stdio: 'inherit' });
  let ended = false;
  const stop = signal => { if (!ended) child.kill(signal); };
  const onInt = () => stop('SIGINT');
  const onTerm = () => stop('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  let exitCode;
  try {
    exitCode = await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolveExit(code ?? (signal === 'SIGINT' ? 130 : 1)));
    });
  } finally {
    ended = true;
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
  }
  process.exitCode = exitCode;
  });
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.command === 'help') {
    console.log('blabee-claude: app | doctor | launch [--cwd PATH] [--runtime ABS] [--claude-bin ABS] [-- CLAUDE_ARGS]');
    return;
  }
  const runtime = runtimePath(options.runtime);
  if (options.command === 'doctor') {
    let coordinator;
    try { coordinator = { reachable: true, ...(await request('health', {}, { runtime })) }; }
    catch (error) { coordinator = { reachable: false, reason: error.code || error.message }; }
    console.log(JSON.stringify({ product: 'blabee-claude', bundle_id: BUNDLE_ID, runtime, socket: socketPath(runtime), coordinator }, null, 2));
    return;
  }
  if (options.command === 'app') {
    const app = join(DEVELOPMENT_BUILD_ROOT, 'blabee-claude.app');
    await access(join(app, 'Contents/MacOS/blabee-claude'), constants.X_OK);
    const result = spawnSync('/usr/bin/open', appOpenArguments(app, options.runtime), { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Could not open Blabee Claude');
    return;
  }
  await launch(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`blabee-claude: ${error.message}`); process.exitCode = 1; });
}
