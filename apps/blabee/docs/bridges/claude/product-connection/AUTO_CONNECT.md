# Claude command auto connection

Status: implementation and isolated regression tests complete, 2026-09-21.
Build 63 is the signed candidate for this feature; installed build 62 does not include it.
Installation and real Claude model acceptance remain separate checks in [ACCEPTANCE](ACCEPTANCE.md).

## Enable once

1. Install the candidate as `/Applications/Blabee.app` when existing Blabee-connected sessions
   have finished. Use the common installer; automatic connection does not bypass update guards.
2. In **설정 → 연결**, connect the app-owned service, then select **Claude 터미널 자동 연결 →
   자동 연결 켜기**.
3. Open a new zsh terminal in the intended project and run `claude` or `claude --resume`.
   Keep Claude's project trust, MCP and development Channels approval prompts intact.
4. Use the same setting's **자동 연결 끄기** to disable future automatic connections.

The setup preserves the original CLI and adds a managed block to `.zshrc` (or a supported
home-local `ZDOTDIR`). It uses `~/Library/Application Support/Blabee/shell/claude-v1/bin`.
Existing conflicting aliases/functions or changed managed files require manual review.
This implementation does not activate itself or modify the current user's shell during tests.

## User behavior

After enabling Claude automatic connection once in Blabee, new zsh terminals route `claude`,
`claude --resume` (including its picker), and `claude --continue` through the installed native
supervisor. Claude selects the conversation itself; Blabee adds neither `--session-id` nor
`--fork-session`. The original Claude executable and its updater are preserved. A separate
Blabee-owned PATH directory supplies the shim. Disabling removes only the managed setup.

CLI maintenance, noninteractive/background/cloud execution, explicit configuration/exclusion
flags and unrecognized option forms bypass automatic connection with their arguments intact.
Existing shells and running conversations
are not changed. A failed Blabee bootstrap does not replay work or restart Claude.

Custom Channels still require Claude's per-session development opt-in flag and native approval.
Automatic configuration does not mean an automatic ACK: readiness requires an actual Channel
probe and the model's acknowledgement. This remains an internal test distribution.

## Implementation boundary

The existing app-button launch remains supported. Automatic CLI launch uses a separate late
binding mode in the same native supervisor. A private per-launch socket is available to its
Hook/MCP children. The trusted Claude process and its command Hooks inherit both bootstrap
credentials, as in the existing Hook boundary. The MCP environment explicitly clears Hook
credentials. Replies provide only the requesting role's session credential; neither temporary
settings nor command-line arguments contain credentials.

The first real `SessionStart` supplies the native session ID, canonical cwd, and source
(`startup`, `resume`, or `fork`). Only then does the signed supervisor call the private owner
endpoint's new `enroll_observed` operation. It uses the existing challenge, one-use anonymous
grant pipe, signed peer verification and owner EOF/lease lifetime. Waiting in the resume picker
creates no Blabee authority. MCP initialization must not depend on the Hook having run first.

`enroll_observed` adds an exact operation shape to `blabee.claude-owner.v1`; existing
enroll/renew/end semantics and common `Contracts/v1` are unchanged. Its extra fields are
`native_session_id` (UUID) and `source` (`startup`, `resume`, `fork`). Its response must bind
that same native ID. The registry creates a fresh scope, incarnation, epoch, core mapping and
role capabilities; no historical scope or credentials are restored. The actual initial source
is consumed through a typed native initialization method, not rewritten to `startup`.

Subsequent Hook calls use the existing session-v2 contract. In-process `/resume`, `/clear`,
source/ID/cwd changes terminate the current Blabee authority; they do not silently rebind it.
The new process may resume Claude history, but requires a new prompt boundary and fresh
readiness. An old proposal, selection or completion cannot acquire the new authority.

## Bootstrap wire (local launcher socket only)

One bounded JSON line per connection, schema `blabee.claude-launch-bootstrap.v1`.
Every request has `request_id` (UUID), `operation` (`start` or `grant`), `role` (`hook` or
`bridge`), `auth_token` (role-specific 64 lowercase hex), `native_session_id` (UUID), and `cwd`.
`start` additionally has `source` and is Hook-only, once per launch. `grant` is read-only.
Responses echo schema and request ID with `ok: true`, `status: pending|ready`; only ready
responses include `environment`, containing the existing session-v2 public bindings and the
requesting role's credential. Errors expose fixed error codes only, never credentials/inputs.

Environment keys: `BLABEE_CLAUDE_BOOTSTRAP_SOCKET`, `BLABEE_CLAUDE_BOOTSTRAP_HOOK_TOKEN`,
`BLABEE_CLAUDE_BOOTSTRAP_BRIDGE_TOKEN`, `BLABEE_CLAUDE_BOOTSTRAP_CWD`.
The MCP configuration explicitly clears the Hook credential. Bootstrap entrypoints are
`src/auto-connect-hook.mjs` and `src/auto-connect-mcp.mjs`.

## Required validation

- Plain/resume picker/explicit resume/continue preserve arguments, cwd, TTY, signals and status.
- Hook-first/MCP-first converge without creating authority before the real start observation.
- Cancelled/long picker creates no scope; repeated start, foreign identity, wrong role and stale
  bootstrap credentials cannot register or retain authority.
- Same native conversation can have independent launch scopes; owner disconnect is scoped.
- SDK initialization is available before registration; no automatic readiness ACK/claim/retry.
- Managed shell edits preserve unrelated bytes, reject symlinks/conflicts, and are reversible.
- Source tests, packaged signed candidate, actual installation and real Claude acceptance are
  separate qualification levels. Never report installed acceptance from fixtures.

## Verified scope

Evidence is under `build/claude-tests/auto-connect/`; these are source and isolated IPC results.

| Check | Result | Evidence |
| --- | --- | --- |
| Native launcher, registry, enrollment, setup and runtime regression | 149 tests in 13 suites passed | `native-tests-verified.log` |
| Final CLI argument handling and freshly prepared runtime | 18 tests in 4 suites passed; subset repeated after the final changes | `native-final-delta.log` |
| Native session, authority, Channel source and wire codec | 48 tests in 4 suites passed | `source-final.log` |
| Node bootstrap, Hook/MCP and existing session-v2 lifecycle | 47 tests passed | `node-final.log`, `node-final-report.json` |
| Runtime/app packaging and owner schema | 223 distinct tests passed across the primary run and the three nested-sandbox reruns | `node-packaging.log`, `packaging-sandbox-recheck.log` |
| Fresh r63 app/DMG and outside-checkout runtime | Developer ID signatures, 532 files, bundled SDK and auto-connect imports passed; public release guard rejected development Channels | `qualification.json`, `qualification-attempt2.log` |

PTY cases use a fake Claude child and real local IPC. They prove startup/resume observation,
cancelled picker and pre-spawn cancellation behavior, not real model or Channel acceptance.
The local Claude 2.1.278 parser was inspected read-only: Channels/MCP flags are variadic and
Claude supplies the native session ID when spawning MCP. Generated arguments preserve those
behaviors. An explicit MCP `CLAUDE_CODE_SESSION_ID` override is intentionally absent.

## References

- [Claude Channels](https://code.claude.com/docs/en/channels)
- [Channel development](https://code.claude.com/docs/en/channels-reference)
- [SessionStart Hook](https://code.claude.com/docs/en/hooks#sessionstart)
- [Resume a session](https://code.claude.com/docs/en/sessions#resume-a-session)
- [CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Native installation updates](https://code.claude.com/docs/en/setup#auto-updates)
