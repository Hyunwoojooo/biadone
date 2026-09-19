import test from 'node:test';
import assert from 'node:assert/strict';
import { appOpenArguments, createLaunchConfiguration, parseArguments, withRegisteredSession } from '../scripts/blabee-claude.mjs';
import { runtimePath, socketPath } from '../src/shared/identity.mjs';

test('session configuration keeps paths literal and credentials out of generated files', () => {
  const root = '/private/tmp/Blabee Claude $(literal)';
  const sessionID = '11111111-1111-4111-8111-111111111111';
  const config = createLaunchConfiguration({ sessionID, runtime: root + '/runtime', cwd: root, root, node: '/node path/node' });
  const server = config.mcp.mcpServers['blabee-claude'];
  assert.equal(server.command, '/node path/node');
  assert.deepEqual(server.args, [root + '/src/bridge/mcp.mjs']);
  assert.equal(server.env.BLABEE_CLAUDE_SESSION_TOKEN, '${BLABEE_CLAUDE_SESSION_TOKEN}');
  assert.equal(server.env.BLABEE_CLAUDE_SESSION_ID, sessionID);
  assert.equal(server.env.BLABEE_CLAUDE_UI_TOKEN, undefined);
  assert.equal(config.settings.permissions, undefined);
  for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd']) {
    const hook = config.settings.hooks[event][0].hooks[0];
    assert.equal(hook.command, '/node path/node');
    assert.deepEqual(hook.args, [root + '/src/bridge/hook.mjs', '--expected-session-id', sessionID]);
    assert.equal(hook.type, 'command');
  }
});

test('session-changing and noninteractive overrides cannot silently disconnect the bridge', () => {
  for (const flag of ['--resume', '-r', '-rexisting', '--session-id=other', '--mcp-config=x', '--settings=x', '--channels', '--safe-mode', '--bare', '--print', '-p', '--bg', '--worktree=x', '--dangerously-skip-permissions']) {
    assert.throws(() => parseArguments(['launch', '--', flag]), /unsupported override/);
  }
  assert.throws(() => parseArguments(['launch', '--', '--permission-mode', 'bypassPermissions']), /Native permissions/);
  assert.deepEqual(parseArguments(['launch', '--cwd', '/project with spaces', '--', '--model', 'sonnet', 'task $(literal)']).extra,
    ['--model', 'sonnet', 'task $(literal)']);
});

test('Claude paths refuse legacy product data and excessive UDS length', () => {
  assert.throws(() => runtimePath('/Users/test/Library/Application Support/Blabee/runtime'), /Codex runtime/);
  assert.throws(() => runtimePath('relative'), /absolute/);
  assert.throws(() => socketPath('/' + 'x'.repeat(104)), /socket path/);
  assert.match(socketPath('/private/tmp/claude-runtime'), /blabee-claude\.sock$/);
});

test('registration is revoked if config generation fails before spawning Claude', async () => {
  const calls = [];
  const sessionID = '11111111-1111-4111-8111-111111111111';
  const ipc = async (type, payload, options) => {
    calls.push({ type, payload, options });
    return type === 'session.register' ? { session_id: sessionID, session_token: 'fixture-only-token' } : {};
  };
  await assert.rejects(withRegisteredSession({ runtime: '/private/tmp/claude-fixture', sessionID, cwd: '/project', ipc },
    async () => { throw new Error('fixture: disk write failed'); }), /disk write failed/);
  assert.deepEqual(calls.map(call => call.type), ['session.register', 'hook']);
  assert.equal(calls[1].payload.event, 'SessionEnd');
  assert.equal(calls[1].options.auth, 'fixture-only-token');
});

test('app runtime override reaches the native process as literal arguments', () => {
  const app = '/app path/blabee-claude.app';
  assert.deepEqual(appOpenArguments(app), [app]);
  assert.deepEqual(appOpenArguments(app, '/private/tmp/Claude Runtime'),
    ['-n', app, '--args', '--runtime', '/private/tmp/Claude Runtime']);
});
