# Claude command auto connection

Current product contract: [ordinary MCP and Stop Hook](PUBLIC_MCP_HOOK.md), reviewed 2026-10-03.
Connection update, 2026-10-11: see [Claude Code compatibility](COMPATIBILITY.md) for the latest
release review, admission regressions and the separate native/installed qualification limits.
The installed-product path uses `blabee.claude-session.v3`: connection checks return a probe
and nonce through MCP, and selected actions arrive through the same session's Stop Hook.
Use the current prompts at the top of [ACCEPTANCE](ACCEPTANCE.md). Source review and Node tests
do not establish that the installed app contains these changes.

Historical status, 2026-09-21: one-click connection source updated. The new UI/terminal flow had
regression test sources and syntax checks; it had **not been built or run** at the user's request.
The r63 results below describe the earlier automatic CLI implementation, not this new flow.
Installation and real Claude model acceptance remain separate checks in [ACCEPTANCE](ACCEPTANCE.md).

## Enable once

The following flow requires a later app containing these source changes. This task did not
create, install or publish a candidate.

1. In **설정 → 연결 → Claude 연결**, select **Claude 연결** and choose a project folder.
   Blabee inspects the environment, saves supported automatic connection settings and starts
   its service if disabled. A blocked or failed active service is not automatically restarted.
2. A connected new conversation opens in the recommended terminal. A running supported Ghostty
   is preferred; Terminal is also available in the picker. Ghostty requires version 1.3 or newer.
3. Confirm any native macOS Automation, Claude login, project trust and MCP requests.
   **설정 저장됨** and **Claude 연결 확인 완료** are separate states. The latter requires an
   explicit successful `ack_readiness_probe_v1` using the same server's `check_connection_v1`
   response. Current product launches do not request development Channels approval.
4. After saving automatic zsh setup, future new zsh terminals can use ordinary `claude` or
   `claude --resume`. Existing shells and conversations remain unchanged. Opening the first
   connected conversation from the app does not require sourcing a profile or changing PATH by hand.
5. **터미널 자동 연결 설정 → 터미널 자동 연결 끄기** removes only owned setup for future shells.

The setup preserves the original CLI and adds a managed block to `.zshrc` (or a supported
home-local `ZDOTDIR`). It uses `~/Library/Application Support/Blabee/shell/claude-v1/bin`.
Changed managed files are left intact; a conflicting alias/function takes precedence and the
managed block skips itself. Unsupported/custom shell setups can still open a connected
conversation directly from the app, with automatic CLI setup shown separately as unavailable.
This implementation does not activate itself or modify the current user's shell during tests.

## One-click connection evidence

The new settings action uses observed-session launch with a fresh explicit `--session-id` for
this new conversation only. The ordinary terminal/resume route below still lets Claude select
its own native conversation. Neither route resumes old Blabee authority.

The launcher returns the requested native UUID, canonical project and selected terminal. An
unconfirmed terminal request preserves that receipt for observation and is never automatically
retried or rerouted. Ghostty uses its official AppleScript surface configuration/new window API;
both terminals quote each argument as data. Existing windows receive no input or close command.

Pet retains the directory's existing native-session UUID and fresh authenticated service evidence
in its in-process model; no wire schema or core contract changes. The controller matches UUID,
project, service generation/incarnation, scope, session incarnation and authority epoch. It
selects that session at most once, then requires its current projection generation, connected
bridge and readiness ACK. Another selected session's failure cannot block finding the new row.
Directory failure invalidates fresh evidence even if cached rows remain visible.

Readiness expiry, service replacement, closed sessions and read failures remove success. A bounded
wait exposes recovery, including after a previously successful connection. Probe retry is an
explicit action for the same selected session; it does not run alongside the initial pending probe.
Settings inspection re-discovers available original CLI paths on each refresh, preserves updater
symlinks in the managed shim and never executes startup scripts merely to inspect the environment.

New regression sources cover these branches plus chooser cancellation, changed shell and terminal
argument/version handling. They have not been executed: Swift testing requires a build, which the
user excluded. Syntax-only checks do not prove type correctness or actual terminal/model behavior.
The initial Channel-turn check belonged to that earlier development candidate. Current product
acceptance uses the MCP probe/ACK and Stop Hook selection path in [PUBLIC_MCP_HOOK](PUBLIC_MCP_HOOK.md).

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

Automatic configuration does not acknowledge readiness on the model's behalf. The model calls
`check_connection_v1` and passes that successful response's `probe_id` and `nonce` to
`ack_readiness_probe_v1` once. No Channel notification is expected in the current product path.
The historical r63 development-Channel qualification below does not qualify this new path.

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

After valid SDK initialization, a tool arriving before the actual SessionStart grant waits for
the same admission and single bridge open. Initialize and tools/list remain immediately available;
calls before initialization remain rejected. At most 32 tools can wait for admission. Cancelling
one releases its slot without cancelling shared bootstrap or starting a service request. Cancellation
while bridge.open is pending also releases the tool slot, while that original open RPC retains its
own slot until its outcome is known. EOF, output failure and rejected admission retire waiting tools.
This creates no probe retry, automatic ACK, claim or restored authority.

`enroll_observed` adds an exact operation shape to `blabee.claude-owner.v1`; existing
enroll/renew/end semantics and common `Contracts/v1` are unchanged. Its extra fields are
`native_session_id` (UUID) and `source` (`startup`, `resume`, `fork`). Its response must bind
that same native ID. The registry creates a fresh scope, incarnation, epoch, core mapping and
role capabilities; no historical scope or credentials are restored. The actual initial source
is consumed through a typed native initialization method, not rewritten to `startup`.

Subsequent Hook calls use `blabee.claude-session.v3` (the internal source filenames retain `session-v2`). In-process `/resume`, `/clear`,
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

- [Ghostty AppleScript API](https://ghostty.org/docs/features/applescript)
- [Claude Channels](https://code.claude.com/docs/en/channels)
- [Channel development](https://code.claude.com/docs/en/channels-reference)
- [SessionStart Hook](https://code.claude.com/docs/en/hooks#sessionstart)
- [Resume a session](https://code.claude.com/docs/en/sessions#resume-a-session)
- [CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Native installation updates](https://code.claude.com/docs/en/setup#auto-updates)
