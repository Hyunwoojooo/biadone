import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { SESSION_V2_AUTHORITY_KEYS } from '../../../bridges/claude/src/session-v2-client.mjs';
import { runSessionV2MCP } from '../../../bridges/claude/src/session-v2-mcp.mjs';

async function until(predicate) {
  const deadline = Date.now() + 2500;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('MCP compatibility fixture timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function fixture(t) {
  const cwd = await realpath(await mkdtemp('/private/tmp/blabee-mcp-compat-'));
  const prefix = 'BLABEE_CLAUDE_SESSION_V2_';
  const authority = Object.fromEntries(SESSION_V2_AUTHORITY_KEYS.map(key => [key, randomUUID()]));
  const env = { [prefix + 'SOCKET']: join(cwd, 'unused.sock'), [prefix + 'RUNTIME_IDENTITY']: `sha256:${'1'.repeat(64)}`,
    [prefix + 'CWD']: cwd, [prefix + 'CHANNEL_SOURCE']: 'blabee-claude', [prefix + 'BRIDGE_TOKEN']: 'b'.repeat(64),
    ...Object.fromEntries(Object.entries(authority).map(([key, value]) => [prefix + key.toUpperCase(), value])) };
  const input = new PassThrough(), output = new PassThrough(), messages = [], calls = [];
  const bridgeID = randomUUID(), probeID = randomUUID(), nonce = 'c'.repeat(64);
  let buffer = '', diagnostics = '', runtime;
  output.on('data', data => {
    buffer += data.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      messages.push(JSON.parse(buffer.slice(0, newline))); buffer = buffer.slice(newline + 1);
    }
  });
  t.after(async () => {
    await runtime?.close(); input.destroy(); output.destroy();
    await rm(cwd, { recursive: true, force: true });
  });
  runtime = await runSessionV2MCP({ env, args: [], input, output, pollIntervalMs: 1000,
    errorOutput: { write: value => { diagnostics += value; } }, createClient: async configuration => {
      assert.deepEqual(configuration.authority, authority);
      assert.equal(configuration.role, 'bridge');
      assert.equal(configuration.authToken, 'b'.repeat(64));
      return {
        async request(command) {
          calls.push(command);
          if (command.operation === 'bridge.open') return { bridge_id: bridgeID };
          assert.equal(command.bridge_id, bridgeID);
          if (command.operation === 'bridge.close') return { closed: true };
          if (command.operation === 'readiness.begin') return { probe_id: probeID, nonce,
            expires_at_nanoseconds: '300000000000', status: 'pending' };
          if (command.operation === 'readiness.ack') {
            assert.equal(command.probe_id, probeID); assert.equal(command.nonce, nonce);
            return { acknowledged: true };
          }
          assert.fail('unexpected service request');
        },
        async exchange(envelope) {
          calls.push({ operation: envelope.operation });
          const { payload: _, ...common } = envelope;
          return { ...common, kind: 'response', ok: true, result: { event: null } };
        },
        async close() {},
      };
    } });
  const send = value => input.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
  const reply = async id => {
    await until(() => messages.some(message => message.id === id));
    return messages.find(message => message.id === id);
  };
  return { runtime, send, reply, messages, calls, diagnostics: () => diagnostics };
}

const cases = [
  ['legacy protocol', '2025-03-26', {}, '2025-03-26'],
  ['current protocol', '2025-11-25', {}, '2025-11-25'],
  ['bare elicitation', '2025-11-25', { elicitation: {} }, '2025-11-25'],
  ['form elicitation', '2025-11-25', { elicitation: { form: {} } }, '2025-11-25'],
  ['form and URL elicitation', '2025-11-25', { elicitation: { form: {}, url: {} } }, '2025-11-25'],
  ['newer client protocol falls back', '2026-07-28', { elicitation: { form: {}, url: {} } }, '2025-11-25'],
];

for (const [name, protocolVersion, capabilities, negotiated] of cases) {
  test(`product MCP: ${name} retains tools and explicit readiness without Channels`, async t => {
    const f = await fixture(t);
    f.send({ id: 1, method: 'initialize', params: { protocolVersion, capabilities,
      clientInfo: { name: 'protocol-compatibility-fixture', version: '1' } } });
    const initialized = (await f.reply(1)).result;
    assert.equal(initialized.protocolVersion, negotiated);
    assert.equal(initialized.capabilities.experimental, undefined);
    assert.deepEqual(initialized.capabilities.tools, {});
    assert.equal(f.calls.length, 0);
    f.send({ id: 2, method: 'tools/call', params: { name: 'check_connection_v1' } });
    assert.equal(JSON.parse((await f.reply(2)).result.content[0].text).error.code, 'session_v2_bridge_not_registered');
    assert.equal(f.calls.length, 0);
    f.send({ method: 'notifications/initialized' });
    f.send({ method: 'notifications/initialized' });
    f.send({ id: 3, method: 'tools/list' });
    assert.deepEqual((await f.reply(3)).result.tools.map(tool => tool.name),
      ['check_connection_v1', 'ack_readiness_probe_v1', 'emit_decision_v1', 'claim_selection_v1', 'complete_selection_v1']);
    await until(() => f.runtime.session.snapshot().registered);
    assert.equal(f.calls.filter(command => command.operation === 'bridge.open').length, 1);
    assert.equal(f.calls.some(command => ['readiness.begin', 'readiness.ack', 'selection.claim'].includes(command.operation)), false);
    f.send({ id: 4, method: 'tools/call', params: { name: 'check_connection_v1' } });
    const probe = JSON.parse((await f.reply(4)).result.content[0].text).result;
    assert.equal(probe.status, 'pending');
    assert.equal(f.calls.filter(command => command.operation === 'readiness.begin').length, 1);
    assert.equal(f.calls.some(command => command.operation === 'readiness.ack'), false);
    f.send({ id: 5, method: 'tools/call', params: { name: 'ack_readiness_probe_v1',
      arguments: { probe_id: probe.probe_id, nonce: probe.nonce } } });
    assert.equal(JSON.parse((await f.reply(5)).result.content[0].text).result.acknowledged, true);
    assert.equal(f.calls.filter(command => command.operation === 'readiness.ack').length, 1);
    assert.equal(f.messages.some(message => message.method === 'notifications/claude/channel'), false);
    await f.runtime.close();
    assert.equal(f.calls.filter(command => command.operation === 'bridge.close').length, 1);
    assert.equal(f.diagnostics(), '');
    assert.doesNotMatch(JSON.stringify(f.messages), /b{64}/);
  });
}
