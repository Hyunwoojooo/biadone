# Blabee Air landing demo

An independent static design demo. The production `blabee/` source, signup API, analytics, redirects, and deployment configuration are untouched.

## Preview

Run from this directory:

```sh
python3 -m http.server 8879 --bind 127.0.0.1
```

Open <http://127.0.0.1:8879/>. No package installation or build is required. Use a local HTTP server rather than opening `index.html` with `file://`.

## Included

- Interactive HTML/CSS Blabee panel: four choices, selected/progress states, restart, and Option + 1–4 when the panel has keyboard focus.
- Existing real macOS demo video, English captions, native playback controls, and a direct video link.
- Email form preview with native validation and an explicit simulated result. It never sends, stores, logs, or echoes the email.
- Keyboard-accessible FAQ, visible focus, responsive layout, reduced-motion and reduced-transparency treatments.
- Locally copied original brand/video assets and the app's Pretendard Variable font with its OFL license. There are no external dependencies or analytics scripts.

## Design references

The three section concepts in `design/` were generated with built-in Image Gen before implementation: `01-experience.png`, `02-real-demo.png`, and `03-beta.png`. They are design references, not images used as the functioning page.

Direction: the native app's Air surfaces (`app/ui/PetAirStyle.swift`), cool-gray `#f5f6f8` canvas, `#202c3b` ink, pale-blue `#e4f4fd` emphasis, yellow `#fee715` primary actions, 26px panel corners, and 22px choice corners. The original brand mark is reused instead of the concept generator's illustrative bee. The original video and native controls are retained rather than recreating generated media chrome.

Section order: experience → three-step workflow → real video → beta-form preview → FAQ → footer. There are no invented testimonials, usage metrics, prices, invitation deadlines, or supported integrations.

## Above-the-fold copy

- Blabee; Experience; Demo; Request beta access
- Your flow. / With a little help / from Blabee.
- Keep working in any window. Blabee brings Codex’s next steps to you, so you can choose and carry on.
- Watch the 36-sec demo; For Codex on macOS. Private beta.
- Ready for you; The landing page is ready. / What would you like to do next?
- Preview the page; Review the changes; Check mobile layout; Plan the next step; Recommended; ⌥1–4
- Click a choice to try it; Interactive illustration · no task is executed

The background document is an illustration. Its notes explain the same Codex workflow; it does not claim that a real task ran. Interaction results and the no-JavaScript notice appear only in their corresponding states.

## Isolation

All runtime resources are relative to this directory. The content security policy denies network connections and form submission; the form is disabled until its local handler is attached. No production config or RPC client is imported.

The current production packaging allowlist excludes the root-level `demos/` directory. This demo is not deployed, and adding it to production is a separate decision.

## Validation

Checked with isolated Playwright Chromium 1.62.1 at 1505×1045 (the concepts' native size), 1440×900, 768×1024, 390×844, and 320×740. The Browser plugin and in-app browser were unavailable in this session.

Verified all four choices, panel-local Option shortcuts, restart during a pending transition, restored two-line heading, CTA anchors, invalid email rejection, simulated form submission/reset, restored button icon, FAQ, no-JavaScript protection, reduced motion, and real video playback (35.8 seconds, one English caption track). There were no console errors, missing asset responses, external requests, write requests, or storage entries in these checks.

The concepts and browser screenshots were visually compared for composition, copy, typography, palette, card geometry, spacing, media, and mobile continuation. Intentional differences are the original brand mark, app-native Pretendard typeface, original uncropped video/native controls, and honest local-only interaction messages. A panel/caption overlap found during visual QA was fixed and covered by a browser assertion.

SHA-256 comparison confirmed all 32 files under the production `blabee/` directory were unchanged. No commit or deployment was performed.
