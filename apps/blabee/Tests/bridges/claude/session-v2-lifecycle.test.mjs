import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { normalizeSessionV2Hook } from '../../../bridges/claude/src/session-v2-lifecycle.mjs';

const common = () => ({ session_id: randomUUID(), cwd: '/private/tmp/blabee-fixture' });
const observation = (input, fields) => ({ native_session_id: input.session_id, cwd: input.cwd, ...fields });

test('v2 startup and compact preserve observed identity and only actual prompt IDs', () => {
  const input = common();
  assert.deepEqual(normalizeSessionV2Hook({ ...input, hook_event_name: 'SessionStart', source: 'startup',
    prompt_id: randomUUID() }), observation(input, { event: 'SessionStart', source: 'startup' }));
  for (const trigger of ['manual', 'auto']) {
    const prompt_id = randomUUID();
    assert.deepEqual(normalizeSessionV2Hook({ ...input, hook_event_name: 'SessionStart', source: 'compact',
      prompt_id, trigger }), observation(input, { event: 'SessionStart', source: 'compact', prompt_id }));
  }
  assert.deepEqual(normalizeSessionV2Hook({ ...input, hook_event_name: 'SessionStart', source: 'compact' }),
    observation(input, { event: 'SessionStart', source: 'compact' }));
  assert.deepEqual(normalizeSessionV2Hook({ ...input, hook_event_name: 'SessionStart', source: 'compact', prompt_id: 'bad' }),
    observation(input, { event: 'ObservationUnavailable', reason: 'invalid_prompt_id' }));
  // A valid different native identity is reported, not replaced by a cached or
  // generated ID. The authenticated service owns mismatch/revocation policy.
  const changed = { ...input, session_id: randomUUID(), cwd: '/private/tmp/different' };
  assert.deepEqual(normalizeSessionV2Hook({ ...changed, hook_event_name: 'SessionEnd' }), observation(changed, { event: 'SessionEnd' }));
});

test('v2 hashes original UTF-8 prompt and rejects unavailable observations without raw content', () => {
  const input = { ...common(), hook_event_name: 'UserPromptSubmit', prompt_id: randomUUID(), prompt: '원문 e\u0301\n🦭' };
  assert.deepEqual(normalizeSessionV2Hook(input), observation(input, { event: 'UserPromptSubmit', prompt_id: input.prompt_id,
    prompt_sha256: createHash('sha256').update(input.prompt, 'utf8').digest('hex') }));
  for (const prompt of [undefined, {}, '\ud800', 'x'.repeat(128 * 1024 + 1)]) {
    assert.deepEqual(normalizeSessionV2Hook({ ...input, prompt }), observation(input,
      { event: 'ObservationUnavailable', reason: 'invalid_prompt_text' }));
  }
  assert.deepEqual(normalizeSessionV2Hook({ ...input, prompt_id: undefined }), observation(input,
    { event: 'ObservationUnavailable', reason: 'invalid_prompt_id' }));
});

test('v2 Stop preserves unknown versus observed empty background registry and excludes content', () => {
  const input = { ...common(), hook_event_name: 'Stop', prompt_id: randomUUID() };
  const expected = observation(input, { event: 'Stop', prompt_id: input.prompt_id });
  for (const fields of [{}, { background_tasks: [] }, { session_crons: [] },
    { background_tasks: [{ id: 'active', description: 'PRIVATE DESCRIPTION' }] }]) {
    assert.deepEqual(normalizeSessionV2Hook({ ...input, ...fields }), expected);
  }
  assert.deepEqual(normalizeSessionV2Hook({ ...input, background_tasks: [], session_crons: [] }),
    { ...expected, background_task_ids: [] });
  assert.deepEqual(normalizeSessionV2Hook({ ...input, stop_hook_active: true, last_assistant_message: 'PRIVATE RESPONSE',
    background_tasks: [{ id: 'task-001', type: 'shell', status: 'running', command: 'PRIVATE COMMAND', description: 'PRIVATE DESCRIPTION' }],
    session_crons: [{ id: 'cron-001', schedule: '0 9 * * 1-5', recurring: true, prompt: 'PRIVATE CRON PROMPT' }],
  }), { ...expected, background_task_ids: ['task-001', 'cron-001'] });
  // Stop is only an observation; normalization creates no completion/cancel DTO.
  assert.deepEqual(Object.keys(expected).sort(), ['cwd', 'event', 'native_session_id', 'prompt_id']);
});

test('malformed or over-capacity background fields produce a fixed unavailable observation', () => {
  const input = { ...common(), hook_event_name: 'Stop', prompt_id: randomUUID(), background_tasks: [], session_crons: [] };
  for (const changes of [{ background_tasks: null }, { session_crons: 'secret' }, { background_tasks: [null] },
    { background_tasks: [{}] }, { session_crons: [{ id: '\0' }] }, { background_tasks: [{ id: 'x'.repeat(513) }] },
    { background_tasks: [{ id: '\ud800' }] }, { background_tasks: Array.from({ length: 257 }, (_, i) => ({ id: `task-${i}` })) },
    { background_tasks: Array.from({ length: 256 }, (_, i) => ({ id: `task-${i}` })), session_crons: [{ id: 'cron' }] }]) {
    assert.deepEqual(normalizeSessionV2Hook({ ...input, ...changes }), observation(input,
      { event: 'ObservationUnavailable', reason: 'unknown_event' }));
  }
  assert.equal(normalizeSessionV2Hook({ ...input, background_tasks: null, session_crons: undefined }).event, 'ObservationUnavailable');
});

test('StopFailure maps only documented API types and never stores an error message or invents interruption', () => {
  const input = { ...common(), hook_event_name: 'StopFailure', error_details: 'PRIVATE DETAILS', last_assistant_message: 'PRIVATE ERROR' };
  for (const error of ['rate_limit', 'overloaded', 'authentication_failed', 'oauth_org_not_allowed', 'account_on_hold',
    'billing_error', 'invalid_request', 'model_not_found', 'server_error', 'max_output_tokens', 'cloud_credential_error']) {
    assert.deepEqual(normalizeSessionV2Hook({ ...input, error }), observation(input, { event: 'StopFailure', failure_code: 'api_error' }));
  }
  for (const error of ['unknown', 'interrupted', 'PRIVATE ERROR', undefined, {}]) {
    assert.deepEqual(normalizeSessionV2Hook({ ...input, error, is_interrupt: true }), observation(input,
      { event: 'StopFailure', failure_code: 'unknown' }));
  }
  const prompt_id = randomUUID();
  assert.deepEqual(normalizeSessionV2Hook({ ...input, prompt_id, error: 'rate_limit' }),
    observation(input, { event: 'StopFailure', failure_code: 'api_error', prompt_id }));
});

test('unsupported source and unknown lifecycle become safe DTOs, while unidentifiable or subagent input stays local', () => {
  const input = common();
  for (const source of ['resume', 'fork', 'clear', undefined, 'PRIVATE SOURCE']) {
    assert.deepEqual(normalizeSessionV2Hook({ ...input, hook_event_name: 'SessionStart', source }),
      observation(input, { event: 'ObservationUnavailable', reason: 'unsupported_source' }));
  }
  for (const hook_event_name of ['PostToolUseFailure', 'Interrupt', 'PRIVATE EVENT', undefined]) {
    assert.deepEqual(normalizeSessionV2Hook({ ...input, hook_event_name, is_interrupt: true }),
      observation(input, { event: 'ObservationUnavailable', reason: 'unknown_event' }));
  }
  for (const changed of [null, [], { ...input, session_id: 'bad' }, { ...input, cwd: 'relative' },
    { ...input, cwd: '/private/tmp/../tmp' }, { ...input, cwd: '/private/tmp\0bad' }]) {
    assert.throws(() => normalizeSessionV2Hook(changed), /^Error: session_v2_hook_invalid_/);
  }
  for (const field of ['agent_id', 'agent_type']) {
    assert.throws(() => normalizeSessionV2Hook({ ...input, [field]: '' }), { code: 'session_v2_hook_subagent' });
  }
});
