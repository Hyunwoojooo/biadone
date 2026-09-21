import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compileContracts } from '../../../Contracts/contract-harness.mjs';

const contracts = await Promise.all(['common.v1', 'pet-directory.v1'].map(async name => {
  const schema = JSON.parse(await readFile(new URL(`../../../../Contracts/bridge/${name}.json`, import.meta.url)));
  return { name, id: schema.$id, schema };
}));
const validate = compileContracts({ contracts }).validatorsByName.get('pet-directory.v1');
const id = '11111111-2222-3333-4444-555555555555';
const target = { scope_id: id, service_incarnation: id, session_incarnation: id,
  authority_epoch: id, ui_generation: '1' };
const request = (operation, payload) => ({ schema_version: 'blabee.pet-directory.v1', kind: 'request',
  request_id: id, operation, payload });
const response = (operation, result) => ({ schema_version: 'blabee.pet-directory.v1', kind: 'response',
  request_id: id, operation, service_incarnation: id, result });
const codex = { ...target, scope_id: 'codex-primary' };
delete codex.authority_epoch;
const row = { provider: 'claude', target, project_id: 'claude_project_example', session_id: 'claude_session_example',
  native_session_id: id, cwd: '/private/tmp/example', state: 'connected' };
const page = response('list', { codex_target: codex, claude_available: true, sessions: [row], next_cursor: null });

test('directory admits bounded discovery and exact scoped disconnect variants', () => {
  for (const value of [request('list', { after_scope_id: null }), request('list', { after_scope_id: id }),
    request('disconnect', { target }), response('disconnect', { disconnected: true }), page]) {
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
  }
});
test('directory denies unknown operations, unscoped disconnect and authority confusion', () => {
  for (const value of [request('enroll', {}), request('disconnect', {}), request('disconnect', { target: codex }),
    request('list', {}), request('list', { after_scope_id: 0 }), request('list', { after_scope_id: 'previous' }),
    response('disconnect', { disconnected: false }), { ...page, auth_token: 'private-test-value' }]) {
    assert.equal(validate(value), false);
  }
});
test('directory enforces scope generation syntax and page bounds', () => {
  for (const generation of [1, '01', '-1', '18446744073709551616']) {
    assert.equal(validate(request('disconnect', { target: { ...target, ui_generation: generation } })), false);
  }
  assert.equal(validate(request('disconnect', { target: { ...target, ui_generation: '18446744073709551615' } })), true);
  assert.equal(validate({ ...page, result: { ...page.result, sessions: Array(32).fill(row) } }), true);
  assert.equal(validate({ ...page, result: { ...page.result, sessions: Array(33).fill(row) } }), false);
  assert.equal(validate({ ...page, result: { ...page.result, sessions: [{ ...row, provider: 'codex' }] } }), false);
  assert.equal(validate({ ...page, result: { ...page.result, sessions: [{ ...row, state: 'ready' }] } }), false);
});
