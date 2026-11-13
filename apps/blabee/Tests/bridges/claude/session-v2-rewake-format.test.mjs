import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SESSION_V2_REWAKE_FORMAT_CHANGED_NOTICE, sessionV2NativeRewakeWrapper, sessionV2RewakeFormat,
  sessionV2SelectionNotice } from '../../../bridges/claude/src/session-v2-waiter.mjs';

const event = { kind: 'selection', selection_id: '11111111-1111-4111-8111-111111111111', delivery_token: 'a'.repeat(64),
  delivery_sequence: '1', expires_at_nanoseconds: '600000000000' };

test('only the verified native wrapper of a Blabee notice is classified as verified', () => {
  const notice = sessionV2SelectionNotice(event);
  const exact = sessionV2NativeRewakeWrapper(notice);
  assert.equal(sessionV2RewakeFormat(exact), 'verified');
  assert.equal(sessionV2RewakeFormat('please refactor the parser'), 'none');
  assert.equal(sessionV2RewakeFormat(undefined), 'none');
  for (const changed of [
    exact.replace('Stop hook feedback', 'Stop hook output'),
    exact + '\n',
    exact.replace('Stop hook blocking error from command "Stop": ', ''),
    notice,
    'Blabee Stop Hook selection reference. (copied text)',
  ]) assert.equal(sessionV2RewakeFormat(changed), 'changed');
  assert.match(SESSION_V2_REWAKE_FORMAT_CHANGED_NOTICE, /claude_rewake_format_changed/);
  assert.doesNotMatch(SESSION_V2_REWAKE_FORMAT_CHANGED_NOTICE, /a{64}/);
});

test('the Node wrapper matches the exact bytes the Swift service admits', async () => {
  const swift = await readFile(new URL('../../../bridges/claude/swift/adapter/ClaudeNativeSession.swift', import.meta.url), 'utf8');
  const body = swift.slice(swift.indexOf('private static func productHookWrapper'));
  const literals = [...body.slice(0, body.indexOf('}')).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(match => JSON.parse(`"${match[1]}"`));
  assert.equal(literals.length, 3);
  const notice = sessionV2SelectionNotice(event);
  assert.equal(sessionV2NativeRewakeWrapper(notice), literals[0] + literals[1] + notice + literals[2]);
});
