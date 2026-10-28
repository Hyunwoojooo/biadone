# App UI language

Blabee defaults to **English** when no app language has been selected, including
existing installations. The macOS language does not change this default.

Choose **Settings → General → Language → 한국어** to use Korean. The same
selector is available throughout first-run onboarding. The choice is saved
immediately and used on the next launch.

## Behavior and scope

- App-owned controls, settings, onboarding, account, feedback, update and
  connection guidance have English and Korean copy.
- Views observe the language preference without replacing their identities.
  Changing language does not clear drafts, change the selected card, restart
  services, rerun connection setup or submit an action.
- Codex/Claude card titles, summaries, command previews, user input and external
  error details remain verbatim. This setting does not request a different
  response language from either provider.
- Previously recorded update/error history remains as recorded. External errors
  and macOS-owned permission dialogs can follow the operating system's language.
  A previously stored status/error message can retain its original language
  until the next status update; switching language does not repeat an operation
  just to regenerate that message.
- Unknown saved language values fall back to English without being overwritten
  until the user explicitly chooses a supported language.

## Implementation

- `app/ui/PetLocalization.swift` owns `PetUILanguage`, the observable preference,
  `PetL10n` for app literals and the shared picker. English/Korean strings are
  compiled into the existing executable target; no translation service or new
  dependency is used.
- Preference: `com.biadone.blabee.pet.ui-language.v1`, values `en` or `ko`, in the
  app's existing `UserDefaults` domain. `AppleLanguages` is never modified.
- `PetLocalizedMessage` defers resolution of transient setup guidance until
  display time. The short update-check result similarly retains its original
  three-second deadline across language changes.
- Menu-bar accessibility text and the existing feedback window title observe
  language changes. Settings tabs keep a single line in narrow panels.
- `Package.swift` explicitly includes the new source once in
  `BlabeeCoordinator`; engine and provider wire contracts are unchanged.
- New consented usage observations resolve the current UI language. In-flight
  operations retain the environment captured at their start. Language selection
  does not change consent or trigger uploads by itself.

## Verification

`PetLocalizationTests` checks default/fallback behavior, persistence,
idempotent publication, unchanged macOS preferences and exact interpolated
content. `PetConnectionSetupTests.languagePreservesSetup` verifies language
changes without additional adapter calls or lost provider choices.

`PetAirViewTests.englishPresentation` renders English settings and choices at
460 and 340 points in offscreen windows. It checks visible labels, single-line
tabs, unchanged card content and the absence of choice submissions. The fixture
uses fake transports/hotkeys and an isolated update journal path.

Existing Korean presentation expectations use `PetLanguageTestTrait`, a scoped
task-local override. Tests do not change the installed app's language preference.
Run Swift tests through `npm run test:swift` to preserve the repository's serial
test lock.

For a subsequently packaged app, manually confirm language switching with a
feedback draft and an active card, then relaunch to verify persistence. This
source change does not itself replace the installed app.

### 2026-10-10 source verification

- The serialized app regression run executed 1,726 tests. Three issues were
  found: two former Korean-only metric expectations and a narrow English tab
  presentation check. The expectations now explicitly test English, and the
  English tab layout adapts to narrow panels.
- After those corrections and the operation-context test were added, all 89
  tests in the eight affected language/setup/usage suites passed. This includes
  the three previously failing checks and the final 340/460-point rendering.
- Earlier settings/onboarding/account/feedback/render checks: 56 tests passed.
- `git diff --check` and `plutil -lint Packaging/macos/Info.plist` passed.
- The app regression excluded installed-bundle auditing, two tests using the
  live analytics store and the unrelated thousand-replay-ID stress test. Live
  runtime/Keychain opt-ins were absent. No distribution packaging, notarization,
  installation, live session acceptance, commit or push was performed.
