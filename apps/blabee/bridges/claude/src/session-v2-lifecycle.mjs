import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const API_ERRORS = new Set(['rate_limit', 'overloaded', 'authentication_failed', 'oauth_org_not_allowed',
  'account_on_hold', 'billing_error', 'invalid_request', 'model_not_found', 'server_error',
  'max_output_tokens', 'cloud_credential_error']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && value.length === 36 && UUID.test(value);
const text = (value, maximum) => typeof value === 'string' && value.isWellFormed()
  && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value) && Buffer.byteLength(value) <= maximum;

export class SessionV2LifecycleError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/**
 * Pure normalization for the explicitly enrolled session-v2 Hook. It performs
 * no authentication, realpath lookup, environment lookup, IPC or persistence.
 * CP-05 must validate its trusted connection first and send this observation
 * with that connection's authority. Preserve actual native IDs/cwd so the
 * service can revoke a mismatching owner; never replace them with configured IDs.
 *
 * Raw Stop/StopFailure fields: https://code.claude.com/docs/en/hooks#stop-input
 * background_task_ids is our internal DTO, not a native Claude Hook field.
 */
export function normalizeSessionV2Hook(input) {
  if (!record(input)) throw new SessionV2LifecycleError('session_v2_hook_invalid_input');
  // agent_type also names a main session launched with --agent. It is ignored
  // metadata; only agent_id marks subagent input, including malformed values.
  if (Object.hasOwn(input, 'agent_id')) {
    throw new SessionV2LifecycleError('session_v2_hook_subagent');
  }
  if (!uuid(input.session_id) || !text(input.cwd, 4096) || !isAbsolute(input.cwd) || resolve(input.cwd) !== input.cwd) {
    throw new SessionV2LifecycleError('session_v2_hook_invalid_identity');
  }
  const base = { native_session_id: input.session_id, cwd: input.cwd };
  const unavailable = reason => ({ ...base, event: 'ObservationUnavailable', reason });
  const event = input.hook_event_name;
  switch (event) {
    case 'SessionStart':
      if (input.source === 'startup') return { ...base, event, source: 'startup' };
      if (input.source !== 'compact') return unavailable('unsupported_source');
      if (Object.hasOwn(input, 'prompt_id') && !uuid(input.prompt_id)) return unavailable('invalid_prompt_id');
      return { ...base, event, source: 'compact', ...(input.prompt_id === undefined ? {} : { prompt_id: input.prompt_id }) };
    case 'UserPromptSubmit':
      if (!uuid(input.prompt_id)) return unavailable('invalid_prompt_id');
      if (typeof input.prompt !== 'string' || !input.prompt.isWellFormed()
          || Buffer.byteLength(input.prompt) > 128 * 1024) return unavailable('invalid_prompt_text');
      return { ...base, event, prompt_id: input.prompt_id,
        prompt_sha256: createHash('sha256').update(input.prompt, 'utf8').digest('hex') };
    case 'Stop': {
      if (!uuid(input.prompt_id)) return unavailable('invalid_prompt_id');
      const fields = ['background_tasks', 'session_crons'];
      // An absent registry observation is unknown, never an observed empty set.
      // Validate each present array even when the other one is unavailable.
      for (const field of fields) {
        if (Object.hasOwn(input, field) && (!Array.isArray(input[field]) || input[field].length > 256
            || input[field].some(item => !record(item) || !text(item.id, 512)))) return unavailable('unknown_event');
      }
      const result = { ...base, event, prompt_id: input.prompt_id };
      if (fields.every(field => Object.hasOwn(input, field))) {
        const ids = fields.flatMap(field => input[field].map(item => item.id));
        if (ids.length > 256) return unavailable('unknown_event');
        result.background_task_ids = ids;
      }
      return result;
    }
    case 'StopFailure':
      if (Object.hasOwn(input, 'prompt_id') && !uuid(input.prompt_id)) return unavailable('invalid_prompt_id');
      return { ...base, event, failure_code: API_ERRORS.has(input.error) ? 'api_error' : 'unknown',
        ...(input.prompt_id === undefined ? {} : { prompt_id: input.prompt_id }) };
    case 'SessionEnd': return { ...base, event };
    default: return unavailable('unknown_event');
  }
}
