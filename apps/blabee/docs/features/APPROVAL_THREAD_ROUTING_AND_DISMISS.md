# Hook thread routing, concurrent approvals, and skipping a decision

## Native Hook identity

Codex 0.154.0 shares the root `session_id` with spawned threads. Their Hook
payloads include `agent_id` with the actual thread ID. The Hook adapter validates
these identifiers and uses `agent_id`, when present, as the coordinator session
key before forwarding the event. A root event without agent metadata retains its
`session_id`. Partial or malformed agent identities do not fall back to the root.

The same effective thread is used for prompt authority, permission requests,
bound responses, delivery acknowledgements, and `codex queue --thread` targets.
The adapter preserves command, working directory, and turn bytes. Agent metadata
does not qualify an approval: existing live caller qualification and exact
request/response checks still control whether `allow` can be returned.

This applies to the four registered Hook events. Native `SubagentStart` and
`SubagentStop` registration is not added; child next-action suggestion lifecycle
support is outside this change.

Codex 0.154.0 `InterAgentCommunication` turns (including `followup_task`) skip
`UserPromptSubmit`. Requiring prompt registration for every child approval
therefore dropped these requests before they reached the Pet. An otherwise
unregistered child can now present a permission-only request when its routed
session ID exactly matches `agent_id`, the adapter has qualified the live Codex
caller, its cwd belongs to an enabled project, and a Pet consumer is live.
This does not register a session, create a prompt/episode, or authorize suggestions
or queued commands. Existing sessions still require their exact current turn and
cwd; a stale known session never receives this fallback.

Only these snapshots add `binding_source: "native_subagent"` to the permission
object. The Pet requires the explicit marker, allow-once qualification, absence
of a conflicting session, and the most-specific enabled project containing cwd.
Prompt-bound snapshots retain their session/turn validation while awaiting a
choice. Focus and resolution use the coordinator's stored binding kind, never
a client-supplied marker. New prompt/session registration cancels undelivered native-only requests;
peer cancellation, request timeout, Pet lease expiry, exact response identity,
and delivery acknowledgements retain their existing behavior. Disabling or
changing project ownership also expires undelivered native-only requests. Once
a response is exposed, the delivery-pending snapshot retains its original
project binding until its exact ACK or timeout, even if a new prompt registers
the child in the meantime; it cannot be selected again. Concurrent native child
requests stay independently bound; arrival order is not turn authority.

Root approvals also retain their original turn while delivery is pending. A new
prompt can advance the session before the previous response is acknowledged.
The Pet still validates the project, canonical cwd and session, but compares the
latest session turn only for requests awaiting a choice. A pending delivery
cannot be selected again, and its ACK must still match the original request,
session, turn and delivery token. An ACK using the newer turn is rejected.

## Retained successor cards

The session projection describes the latest prompt, not the binding of every
active card. A verified Blabee queued prompt can advance that projection while
the coordinator preserves a staged successor from the previous turn. The Pet
joins a card to its exact active routing identity (including packet, revision
and the complete binding) and verifies its project, cwd and session. It does
not replace the card's binding with the latest prompt or reject the snapshot
solely because those prompt identities differ. An ordinary human prompt still
supersedes the old successor in the coordinator.

## Native approval review window

The coordinator allows five minutes to review each native permission request.
`remaining_milliseconds` is an optional integer from 0 through 300000 in both
root and native-child snapshots. The Pet shows the remaining time and explains
that an unanswered request returns to Codex. Older snapshots without this field
remain readable. Countdown changes refresh presentation without changing the
identity used by click/hotkey selection. Delivery-pending cards hide the countdown.

Deadlines use the coordinator's monotonic clock, beginning at admission, and are
checked before request dispatch as well as by the expiry task. A delayed timer
therefore cannot authorize a late selection. Expiry returns `defer_to_codex`;
it never implies approval or rejection. A response selected before expiry keeps
its separate delivery barrier until exact ACK or delivery timeout. The live Pet
lease, peer cancellation, current binding, and eight-request capacity stay in
force throughout the longer review window.

The ordered budgets are coordinator 300 seconds, socket response 305 seconds,
launcher 315 seconds, and Codex Hook 320 seconds. The outer margins include
connection and delivery ACK time; the launcher still buffers output until its
child exits successfully. Its emergency override may only shorten the limit.

Plugin 0.1.1 carries the new Hook deadline. Updating only the app binary does not
refresh a previously installed plugin cache: use Blabee's Codex plugin update
flow, then review the changed Hook in Codex `/hooks`. The timeout participates in
Codex's trusted Hook identity, so existing trusted hashes must not be rewritten
automatically. Already pending approvals keep the configuration they started
with; validate a new request after plugin refresh and Hook review.

Fixed diagnostic events under OSLog subsystem `com.biadone.blabee`, category
`permission`, distinguish admission, decision timeout, lost Pet lease, changed
binding, peer cancellation and delivery ACK/timeout. Adapter failures use an
allowlist. These diagnostics omit command text, paths, session IDs and tokens.
Admission or ACK is not proof of UI presentation, native consumption, or execution.

In the reported root-session case, the screenshot was taken about 111 seconds
after the request, beyond the previous 50-second coordinator wait. A fresh live
root request was observed in the coordinator and the user confirmed approving
it in Blabee. Historical logs cannot establish whether the original card was
initially displayed. Regression tests cover review past 50 seconds, rejection at
the five-minute deadline, and preservation of a delivery selected just before it.

## Concurrent waits

Approval peer monitoring performs nonblocking readiness checks and suspends
between them. Pending approvals therefore do not monopolize Swift's cooperative
executor. The Pet's synchronous, deadline-bounded socket I/O runs on a Dispatch
worker so heartbeat reads can continue while a user response is being delivered.
Existing timeouts, admission limits, default FIFO ordering, and peer cancellation
remain. Explicit event navigation can select a later request; see
[event navigation](EVENT_NAVIGATION.md) for its focus and delivery constraints.

## Ordinary decision dismissal

The ordinary ranked-card footer offers `선택 건너뛰기`. Unlike hiding the panel
with `나중에 결정`, this permanently closes the displayed unselected decision.
It sends no selected action, queued prompt, or native approval response. The user
can continue by typing a prompt in Codex.

The operational `dismiss_interaction` request uses `schema_version: "1.0"`,
`kind: "blabee_pet_dismiss_request"`, and the same complete identity fields as
`focus_interaction`: interaction/packet/revision, project/session/source turn/source
prompt, episode/root prompt/baseline checkpoint, decision boundary and sequence.
It requires the exact waiting ranked card and compatible foreground. Without
explicit event navigation it retains the FIFO and approval-precedence guards.
An explicitly focused later decision may be skipped while earlier events remain.
Native approvals themselves, stale packets, and selected or in-flight actions
cannot be dismissed through this operation.

Success is `{dismissed:true, interaction_id, packet_id, revision}`. The coordinator
persists `close_reason: "user_dismissed"` and verifies the terminal journal state.
Exact retries are idempotent; a lost response cannot target the next card. The UI
checks the returned identity and does not automatically retry an ambiguous result.

Dismissal shares one authenticated authority projection for exact target checks
and its CAS close, instead of repeatedly replaying the whole history. SQLite's
commit authentication and freshness checks remain intact. Sequence conflicts
revalidate the full dismissal conditions, including monotonic expiry, before a
bounded retry; an ambiguous append is accepted only after an authenticated read
proves the exact unselected packet was closed with `user_dismissed`.

The Pet gives `dismiss_interaction` its own 60-second response budget to allow
durable commits to finish. Ordinary snapshot reads keep their 2-second budget
and approval response budgets are unchanged. A late snapshot response no longer
causes a previously verified, still-running service to be terminated at the
reconnect deadline; see [runtime stability](RESOURCE_STABILITY.md).

Regression coverage includes real Hook adapters with one root and two siblings,
simultaneous approvals and mismatched response rejection, wrong-thread queued
reference rejection followed by correct-thread delivery, constrained-executor
responsiveness, and dismissal replay/no-dispatch/stale-identity behavior.
