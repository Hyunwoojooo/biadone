# Resource and runtime stability

The menu-bar presenter compares the final visual state before assigning an
image. Idle icons use one reusable template; attention icons are replaced only
when attention or their resolved foreground changes. Appearance notifications
are coalesced because AppKit temporarily changes appearance while drawing status
item snapshots. Writing an image/title for each notification can create a
continuous redraw loop.

## Runtime history

- A service instance admits up to 1,024 distinct registered sessions. Existing
  sessions continue to work at capacity; new registrations return
  `session_capacity_exceeded`. The Hook edge treats this as unavailable and
  leaves the native Codex workflow in control. Registering additional sessions
  requires a safe service restart after pending work is resolved.
- `get_state.sessions` is a presentation list: the most recent 64 sessions plus
  every session needed by active choices, approvals, pending delivery ACKs and
  recovery. Absence from that list does not remove a session's authority.
- Terminal boundaries release their proposal object, packet and full acceptance
  response when no active, staged, dispatch or recovery work still references
  them. Proposal digests and binding metadata continue to reject conflicting
  retries. An exact terminal retry reconstructs the original response from the
  durable packet instead of caching its large payload again.

The Hook protocol does not provide an authoritative session-end signal. Idle
sessions therefore cannot safely be evicted solely by age: doing so would lose
current prompt authority and known-session project fences. The registration
limit is an explicit admission boundary, not an automatic session expiry.

Small deduplication records and authenticated journal/replay history remain.
This change does not implement journal compaction, bound all possible active
card/project payloads, or guarantee every snapshot fits the 1 MiB transport
limit. Authenticated history compaction requires a separate design and recovery
validation.

## UI request lifetime

A verified app-owned service that misses the 12-second reconnect budget now
enters `unresponsive` (서비스 응답 지연) without terminating its running child.
The existing snapshot poller continues with bounded backoff. Actions stay
disabled until a verified response from the same generation restores `ready`;
neither timeout nor recovery resends a selection, dismissal, or approval.
Startup remains time-bounded, actual child exit still fails, and explicit
restart/shutdown still stop only the owned child. A permanently hung child
requires a manual restart; this policy does not infer health from process liveness.

A reply belongs to the service generation in which its request began. After an
explicit restart or shutdown, an older action must not change the replacement
service's foreground card, busy controls, error state, usage acceptance or return
application. Approval, selection, event focus and dismissal paths check ownership
after suspension points; cleanup must only release the state owned by that action.
Resetting busy flags alone is insufficient because an old completion could then
clear a newly started action's flags.

Focus also needs an individual operation identity. A transient snapshot failure
can invalidate focus without restarting the service, and the same durable card
may be focused again. Waiters belong to the original focus operation, so releasing
them must not resume waiters for its replacement. A same-generation reconnect
does not otherwise discard a valid approval or selection response.

Session rows in a snapshot describe the latest prompt. A selected approval can
still be awaiting an ACK on its original turn, and a staged successor can retain
its original binding while a verified queued prompt advances the session. The
Pet validates the stored approval or exact active routing identity instead of
using the latest session prompt as a replacement authority. See
[approval routing](APPROVAL_THREAD_ROUTING_AND_DISMISS.md) for the preserved
project/session/cwd checks and delivery restrictions.

## Socket backpressure

Connected and accepted sockets remain nonblocking. Partial reads/writes retain
their offsets and retry `EAGAIN`/`EINTR` within the original deadline. Server
readiness waits suspend their Swift task, with checks no more than 20 ms apart,
so incomplete requests and slow readers do not hold cooperative executor
threads. This is bounded readiness polling, not an event-driven I/O design.

If a response write times out after sending part of a frame, the server closes
the connection without appending a second error frame. Client and approval
delivery acknowledgment rules are unchanged.

## Regression coverage

- `PetAppServiceTests.swift`: delayed reconnect without child termination,
  verified recovery, bounded startup, real exit, manual restart/shutdown and
  generation fencing; no automatic mutation replay.
- `PetTransportConcurrencyTests.swift`: dismissal can outlive a snapshot's
  short read deadline and is sent only once, while ordinary polling keeps its
  deadline and can run alongside a blocked selection.
- `blabeePetStatusItemAppearanceDoesNotRedraw`: real image/title setter counts,
  repeated transient appearance changes, final theme change and stop behavior.
- `operationalRuntimeRetention*`: legal history exceeding 1 MiB under the old
  projection, bounded recent history, capacity, old session authority, pending
  ACK joins, and exact/modified retries after compaction.
- `Tests/CoordinatorOperational/uds-transport.test.mjs`: partial requests under
  a constrained executor, large client write timeout, slow response timeout,
  normal backpressure recovery, concurrent approvals and delivery ACKs.
- `PetPermissionDeliveryIntegrationTests.swift`: real coordinator snapshots with
  a selected root approval, a new prompt and another session's pending approval;
  exact original ACK, wrong-turn rejection and duplicate-selection suppression.
- `PetQueuedSuccessorParsingTests.swift`: retained binding with a newer session
  projection and rejection of mismatched routing/project/session/cwd joins.
- `PetActionGenerationTests.swift` and `PetEventActionGenerationTests.swift`:
  suspended old requests, service restart, replacement actions and late replies.

Menu-bar CPU measurements need an actual `NSStatusBarButton` in the macOS menu
bar; offscreen image rendering alone cannot detect the AppKit feedback loop.
Short fixture and menu-bar probes do not establish long-duration battery life,
sleep/wake behavior or stability of an installed app across all environments.
