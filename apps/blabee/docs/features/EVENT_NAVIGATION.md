# Browsing and processing queued events

The Pet offers previous/next buttons and `Option+Left` / `Option+Right` when
multiple events are available. Navigation wraps at both ends. The row shows the
displayed event's position and the total count. The panel retains its 460-point
width; approval screens reserve 44 additional points vertically for this row.

The queue includes ordinary decisions, native Hook permission requests, and
managed App Server command approvals. Their arrival order is stable. Existing
approval-first/default decision behavior remains until the user browses. Once
an event is explicitly focused, new arrivals do not replace it. The user can
select, respond to, or skip that displayed event before earlier events.

## Focus and response authority

`focus_event` accepts `schema_version: "1.0"`,
`kind: "blabee_pet_event_focus_request"`, `event_kind` (`decision`, `permission`,
or `managed`), and `target`. The target contains the complete existing focus
binding for a decision, or the complete approval resolution binding without
`response_id` and `decision`. Managed targets retain their typed JSON-RPC IDs
and command, working directory, environment, and capability fields.

Successful focus returns `{focused:true}`. It does not send an approval response,
select an action, or queue a prompt. Subsequent mutations must match the focused
event and all their existing binding and revision checks. Approvals are found
and updated by exact request identity, rather than assuming array position zero.
Live caller qualification and native allow/deny semantics are unchanged.

`pet_snapshot` and `get_state` include `event_navigation` with ordered
`events: [{event_kind,event_id}]`, nullable `focused`, a projection `revision`,
and `delivery_pending`. A removed explicit focus stays ungranted until a fresh
focus request validates another event. The UI can preview the next available
event but must confirm its focus before enabling a response. It validates both
the focus reply and the next authoritative snapshot before enabling actions.
Navigation focus and its arrival ledger belong to the running coordinator;
they do not reorder or persist over the existing decision and approval queues.

Any pending approval delivery blocks navigation and fresh responses until its
acknowledgement or cancellation completes. Existing expiry deadlines, heartbeat
requirements, and admission limits remain. Selecting a later decision preserves
earlier pending events and queues its continuation to its own bound session.
`선택 건너뛰기` closes only the displayed ordinary decision, without dispatch.

## Keyboard scope

The Option-arrow pair is registered only while the panel is visible, multiple
events exist, and navigation is eligible. Settings, onboarding, detail preview,
risk confirmation, and focus/selection/response delivery disable it. Registration
failure releases both arrows and leaves the buttons available. Existing action
and detail-preview shortcut settings are preserved.

Each callback captures the exact displayed event context before crossing to the
main actor. Stale callbacks cannot act on a newly displayed event. Holding an
arrow does not advance repeatedly; a physical release is required before the
next navigation press, including after hiding or re-registering the panel keys.

Automated coverage includes mixed queues, third-event-first processing, exact
session delivery, stale/expired focus, delivery acknowledgement barriers,
registration collisions, delayed callbacks, and fixed-width rendering. Tests
with fixture approval requests do not establish installed-app human acceptance.
