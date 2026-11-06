# Adaptive decision panel

## Behavior

Collapsed Codex and Claude decision cards use the rendered content height at
the actual panel width. The window includes the header, queue navigation,
summary, option rows, secondary controls, and status messages. The secondary
controls follow the last content row with the existing 14-point section gap.
The former 500/650-point estimates are only initial fallbacks before measurement.
The redundant `Later` button is omitted: outside clicks and the header close
button hide the panel, while `Skip Choices` dismisses the current choice set.

The panel stops growing at the display's visible bounds. Fitting content has
scrolling disabled and no scroll indicators. Only overflowing content scrolls;
that fallback includes the full stack so long text and controls remain reachable.
Changing the interaction/revision/session resets scrolling to the top. Countdown
or status changes on the same card preserve the reading position.

Settings, permission requests, expanded details, choice previews, and the ready
screen retain their existing layout policies. Selection, shortcuts, transport,
and authorization are unchanged.

## Measurement boundary

- Measure the natural content height, independently of the viewport height.
- Include all rendered chrome and the outer border; do not estimate text height
  from character count or add a count-based minimum after measurement.
- Bind measurements to the interaction identity, provider/service context,
  effective UI language, rendered text and presentation state, and actual width.
  The polling expiry countdown is deliberately excluded.
- Recheck identity and width when the deferred callback reaches the controller.
  Reject non-finite, non-positive, and stale measurements.
- The controller owns window sizing and display clamping. Hosting intrinsic-size
  updates are disabled; sub-point repeat measurements do not trigger resizing.

## Validation

Focused Swift checks use fake transports and temporary storage. Render tests
create hidden/offscreen windows without activating or changing the installed app.

Coverage includes normal and narrow panels, two through four options, English
and Korean text, long content overflow, pixel-derived footer spacing, same-count
content replacement, stale measurements, and existing fixed-screen policies.
Additional transition checks cover one window narrowing and widening, a new
card after scrolling, and decision/settings/approval transitions through the
production panel controller.

On 2026-10-17 the initial focused run passed 20 tests (including parameterized
render cases); after the new-card scroll reset, the final adaptive/measurement
run passed 9 tests. These runs overlap. Both used the repository's serial
`npm run test:swift -- --filter ...` command and shared lock. `git diff --check`
also passed. Logs and render artifacts are in
`/private/tmp/blabee-adaptive-panel-20261017-0pdma516/`.
The supplied example's body and two option labels rendered at 460 × 434 points,
including the footer, with no content overflow.

The installed compositor, live VoiceOver, product packaging and installation
remain separate checks.
