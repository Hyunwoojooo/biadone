import { constants } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { PROJECT_ROOT } from '../shared/identity.mjs';
import { createNativeSessionClient } from './native-session-client.mjs';

export class SharedLauncherError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const sessionPrefix = 'BLABEE_CLAUDE_SHARED_';

/** Deliberately exclude inherited Blabee capabilities and runtime fallback. */
export function cleanSharedEnvironment(inherited = process.env) {
  const env = Object.fromEntries(Object.entries(inherited).filter(([name]) => !name.startsWith('BLABEE_')));
  // Current Channels preview does not negotiate the newer MCP protocol mode.
  // This applies only to the owned child, never the user's global environment.
  env.MCP_PROTOCOL_NEGOTIATION = 'legacy';
  return env;
}

async function executable(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) {
    throw new SharedLauncherError('shared_executable_required');
  }
  const canonical = await realpath(path);
  await access(canonical, constants.X_OK);
  if (!(await lstat(canonical)).isFile()) throw new SharedLauncherError('shared_executable_invalid');
  return canonical;
}

async function privateRuntime(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') || path !== resolve(path)) {
    throw new SharedLauncherError('shared_runtime_invalid');
  }
  const info = await lstat(path);
  const canonical = await realpath(path);
  if (canonical !== path || !info.isDirectory() || info.isSymbolicLink()
      || info.uid !== process.getuid() || (info.mode & 0o7777) !== 0o700
      || canonical.includes('/Library/Application Support/Blabee/')
      || canonical.endsWith('/Library/Application Support/Blabee')
      || Buffer.byteLength(join(canonical, 'native.sock')) > 103) {
    throw new SharedLauncherError('shared_runtime_invalid');
  }
  return canonical;
}

async function stopOwned(child, exited) {
  if (child.exitCode !== null || child.signalCode !== null) { await exited; return; }
  child.kill('SIGTERM');
  let timer;
  try { await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 2500); })]); }
  finally { clearTimeout(timer); }
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await exited;
}

export function createSharedHostArguments({ runtime, contractsDirectory, fixture = false, pet = false }) {
  return [fixture ? 'claude-session-host-test' : 'claude-session-host',
    '--runtime', runtime, '--contracts', contractsDirectory, '--grant-fd', '3', '--owner-fd', '4',
    ...(pet ? ['--pet'] : [])];
}

/**
 * Trusted owner API. It exposes a selector client only to its caller, never in
 * the Hook/MCP environments. Each invocation must use a fresh private root.
 * `fixture` is for executable tests; the public CLI never enables it.
 */
export async function startSharedRuntime({
  coordinatorBinary, contractsDirectory, runtime, cwd, fixture = false, pet = false, ttlMs = 3_600_000, signal,
} = {}) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 100 || ttlMs > 86_400_000
      || typeof fixture !== 'boolean' || typeof pet !== 'boolean') {
    throw new SharedLauncherError('shared_grant_invalid');
  }
  const binary = await executable(coordinatorBinary);
  const root = await privateRuntime(runtime);
  const project = await realpath(cwd);
  if (!(await lstat(project)).isDirectory()) throw new SharedLauncherError('shared_cwd_invalid');
  const contracts = await realpath(contractsDirectory);
  if (signal?.aborted) throw new SharedLauncherError('shared_launch_cancelled');
  const scopeID = randomUUID();
  const sessionID = randomUUID();
  const projectID = `claude_project_${createHash('sha256').update(project).digest('hex')}`;
  const grant = {
    schema_version: 'blabee.claude-native-grant.v1', scope_id: scopeID,
    project_id: projectID, session_id: sessionID, cwd: project,
    expires_at: new Date(Date.now() + ttlMs).toISOString(),
    bridge_token: randomBytes(32).toString('hex'), selection_token: randomBytes(32).toString('hex'),
    hook_token: randomBytes(32).toString('hex'), control_token: randomBytes(32).toString('hex'),
  };
  const child = spawn(binary, createSharedHostArguments({
    runtime: root, contractsDirectory: contracts, fixture, pet,
  }), {
    // Keep terminal Ctrl-C scoped to the interactive Claude process group.
    // This host is still owned through FD4 and explicit bounded cleanup.
    detached: true, env: cleanSharedEnvironment(), stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
  });
  const exited = new Promise(resolveExit => {
    child.once('close', (code, signal) => resolveExit({ code, signal }));
    child.once('error', () => resolveExit({ code: 1, signal: null }));
  });
  // Never relay bootstrap stderr: even a wrong executable cannot echo a grant.
  child.stderr.resume();
  // Kept open only by this owner; never inherited by the Claude child. Closing
  // it also terminates the host if the owner dies without running cleanup.
  child.stdio[4].on('error', () => {});
  child.stdio[3].on('error', () => {});
  child.stdio[3].end(JSON.stringify(grant));
  let control;
  let selector;
  try {
    const ready = await new Promise((resolveReady, rejectReady) => {
      let pending = Buffer.alloc(0);
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdout.off('data', onData);
        child.off('error', onError);
        child.off('close', onClose);
        signal?.removeEventListener('abort', onAbort);
        child.stdout.resume();
        if (error) rejectReady(error); else resolveReady(result);
      };
      const onError = () => finish(new SharedLauncherError('shared_host_unavailable'));
      const onClose = () => finish(new SharedLauncherError('shared_host_unavailable'));
      const onAbort = () => finish(new SharedLauncherError('shared_launch_cancelled'));
      const onData = chunk => {
        pending = Buffer.concat([pending, chunk]);
        if (pending.length > 4096) return onError();
        if (!pending.includes(10)) return;
        try {
          if (pending.indexOf(10) !== pending.length - 1) return onError();
          const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(pending));
          const names = ['ready', 'schema_version', 'scope_id', 'session_id', 'runtime_identity'];
          if (!result || Object.keys(result).length !== names.length || names.some(name => !Object.hasOwn(result, name))
              || result.ready !== true || result.schema_version !== 'blabee.claude-native-host.v1'
              || result.scope_id !== scopeID || result.session_id !== sessionID
              || !/^sha256:[0-9a-f]{64}$/.test(result.runtime_identity)) return onError();
          finish(null, result);
        } catch { onError(); }
      };
      const timer = setTimeout(() => finish(new SharedLauncherError('shared_host_start_timeout')), 10_000);
      child.once('error', onError);
      child.once('close', onClose);
      child.stdout.on('data', onData);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
    const socketPath = join(root, 'native.sock');
    const base = { socketPath, runtimeIdentity: ready.runtime_identity, scopeID, sessionID };
    control = await createNativeSessionClient({ ...base, role: 'control', authToken: grant.control_token });
    selector = await createNativeSessionClient({ ...base, role: 'selector', authToken: grant.selection_token });
    const shared = {
      [`${sessionPrefix}SOCKET`]: socketPath,
      [`${sessionPrefix}RUNTIME_IDENTITY`]: ready.runtime_identity,
      [`${sessionPrefix}SCOPE_ID`]: scopeID, [`${sessionPrefix}SESSION_ID`]: sessionID,
      [`${sessionPrefix}CWD`]: project,
    };
    let ending;
    let closing;
    const end = () => {
      ending ??= control.request({ operation: 'session.end' });
      return ending;
    };
    const close = () => {
      closing ??= (async () => {
        try { await end(); } catch { /* Expiry/SessionEnd already revoked this grant, or transport is unknown. */ }
        await Promise.allSettled([control.close(), selector.close()]);
        child.stdio[4].destroy();
        await stopOwned(child, exited);
      })();
      return closing;
    };
    return {
      scopeID, sessionID, projectID, runtime: root, cwd: project, socketPath,
      runtimeIdentity: ready.runtime_identity,
      hookEnvironment: Object.freeze({ ...shared, [`${sessionPrefix}HOOK_TOKEN`]: grant.hook_token }),
      mcpEnvironment: Object.freeze({ ...shared, [`${sessionPrefix}BRIDGE_TOKEN`]: grant.bridge_token }),
      selectorClient: selector, end, close,
    };
  } catch (error) {
    await Promise.allSettled([control?.close(), selector?.close()]);
    child.stdio[4].destroy();
    await stopOwned(child, exited);
    throw error instanceof SharedLauncherError ? error : new SharedLauncherError('shared_host_unavailable');
  }
}

export function createSharedLaunchConfiguration(host, { node = process.execPath, root = PROJECT_ROOT } = {}) {
  const environment = { ...host.mcpEnvironment,
    [`${sessionPrefix}BRIDGE_TOKEN`]: '${BLABEE_CLAUDE_SHARED_BRIDGE_TOKEN}',
    [`${sessionPrefix}HOOK_TOKEN`]: '', [`${sessionPrefix}SELECTOR_TOKEN`]: '', [`${sessionPrefix}CONTROL_TOKEN`]: '',
  };
  const mcp = { mcpServers: { 'blabee-claude': {
    command: node, args: [join(root, 'src/bridge/product-mcp.mjs')], env: environment,
  } } };
  const hooks = Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd'].map(event => [event,
    [{ hooks: [{ type: 'command', command: node,
      args: [join(root, 'src/bridge/product-hook.mjs'), '--expected-session-id', host.sessionID], timeout: 5 }] }],
  ]));
  return { mcp, settings: { hooks } };
}

export function parseSharedArguments(argv) {
  const result = { cwd: process.cwd(), pet: false, extra: [] };
  const seen = new Set();
  const fields = { '--cwd': 'cwd', '--coordinator-bin': 'coordinatorBinary', '--contracts': 'contractsDirectory',
    '--claude-bin': 'claudeBinary', '--runtime': 'runtime' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--') { result.extra = argv.slice(index + 1); break; }
    if (arg === '--pet') {
      if (seen.has(arg)) throw new SharedLauncherError('shared_launcher_arguments');
      seen.add(arg);
      result.pet = true;
      continue;
    }
    if (!fields[arg] || !argv[index + 1] || argv[index + 1].startsWith('--') || seen.has(arg)) {
      throw new SharedLauncherError('shared_launcher_arguments');
    }
    seen.add(arg);
    result[fields[arg]] = argv[++index];
  }
  validateExtra(result.extra);
  if (!result.coordinatorBinary) throw new SharedLauncherError('shared_coordinator_binary_required');
  return result;
}

function validateExtra(extra) {
  if (!Array.isArray(extra) || extra.length > 16 || extra.some(value => typeof value !== 'string' || value.includes('\0'))) {
    throw new SharedLauncherError('shared_launcher_override_forbidden');
  }
  // A small explicit pass-through surface cannot override the fresh session,
  // Hooks/MCP enrollment, foreground lifetime, or native permission settings.
  for (let index = 0; index < extra.length; index++) {
    const value = extra[index];
    if (value === '--verbose') continue;
    if (!['--model', '--effort'].includes(value) || !extra[index + 1]
        || extra[index + 1].startsWith('-')) throw new SharedLauncherError('shared_launcher_override_forbidden');
    index++;
  }
}

async function findClaude(path) {
  if (path) return executable(resolve(path));
  for (const directory of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    try { return await executable(join(directory, 'claude')); } catch { /* Next explicit PATH candidate. */ }
  }
  throw new SharedLauncherError('shared_claude_binary_required');
}

export async function launchSharedClaude(options, { fixture = false, onRuntime = () => {} } = {}) {
  validateExtra(options.extra || []);
  if (options.pet !== undefined && typeof options.pet !== 'boolean') {
    throw new SharedLauncherError('shared_launcher_arguments');
  }
  const abort = new AbortController();
  let interrupted;
  const interruption = new Promise(resolveInterrupted => { interrupted = resolveInterrupted; });
  let exitOnSignal = 143;
  let host;
  let child;
  let exited;
  const requestStop = code => {
    if (abort.signal.aborted) return;
    exitOnSignal = code;
    abort.abort();
    interrupted();
  };
  const terminate = () => requestStop(143);
  // An interactive child shares the foreground process group, so Ctrl-C is
  // already delivered to it. Do not send a second SIGINT. During startup there
  // is no interactive child yet, and Ctrl-C instead cancels startup safely.
  const interrupt = () => { if (!child) requestStop(130); };
  const requireActive = () => {
    if (abort.signal.aborted) throw new SharedLauncherError('shared_launch_cancelled');
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    const claude = await findClaude(options.claudeBinary);
    requireActive();
    const version = spawnSync(claude, ['--version'], { encoding: 'utf8', timeout: 5000,
      env: cleanSharedEnvironment() });
    const match = version.stdout?.match(/(\d+)\.(\d+)\.(\d+)/);
    if (version.status !== 0 || !match || Number(match[1]) !== 2 || Number(match[2]) < 1
        || (Number(match[2]) === 1 && Number(match[3]) < 248)) {
      throw new SharedLauncherError('shared_claude_version_unsupported');
    }
    const build = join(PROJECT_ROOT, 'build');
    await mkdir(build, { recursive: true });
    const runtime = options.runtime || await realpath(await mkdtemp(join(build, 'ns-')));
    requireActive();
    host = await startSharedRuntime({
      coordinatorBinary: resolve(options.coordinatorBinary),
      contractsDirectory: options.contractsDirectory || join(PROJECT_ROOT, '../Contracts/v1'),
      runtime, cwd: options.cwd, fixture, pet: options.pet, signal: abort.signal,
    });
    requireActive();
    const generated = createSharedLaunchConfiguration(host);
    const mcpPath = join(runtime, 'mcp.json');
    const hooksPath = join(runtime, 'hooks.json');
    await writeFile(mcpPath, JSON.stringify(generated.mcp, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await writeFile(hooksPath, JSON.stringify(generated.settings, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await Promise.race([Promise.resolve(onRuntime(host)), interruption]);
    requireActive();
    const env = { ...cleanSharedEnvironment(), ...host.hookEnvironment, ...host.mcpEnvironment };
    child = spawn(claude, ['--session-id', host.sessionID, '--mcp-config', mcpPath, '--strict-mcp-config',
      '--settings', hooksPath, '--dangerously-load-development-channels', 'server:blabee-claude',
      ...(options.extra || [])], { cwd: host.cwd, env, stdio: 'inherit' });
    exited = new Promise((resolveExit, reject) => {
      child.once('error', () => reject(new SharedLauncherError('shared_claude_start_failed')));
      child.once('close', (code, signal) => resolveExit(code ?? (signal === 'SIGINT' ? 130 : 1)));
    });
    return await Promise.race([exited, interruption.then(() => exitOnSignal)]);
  } catch (error) {
    if (abort.signal.aborted) return exitOnSignal;
    throw error;
  } finally {
    // Revoke immediately while independently giving only our own child a
    // bounded SIGTERM grace period. A stuck child cannot keep the grant alive.
    await Promise.allSettled([
      host?.close(),
      child && exited ? stopOwned(child, exited.catch(() => {})) : undefined,
    ]);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
}
