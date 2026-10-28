# Changelog

**English** · [한국어](CHANGELOG.ko.md)

App updates and public integration source updates are recorded separately below.
Entries explicitly marked Unreleased are drafts; a release date and download link are added after
the app is published.

Earlier published app entries were compiled on 2026-10-19. Additional local
build records were reviewed on 2026-10-20 and are listed separately below.
Dates in App updates are GitHub publication dates; dates in Additional build
history are build, validation or work-completion record dates, with KST marked
where used. They do not establish a publication date. Historical entries describe those
versions and their limitations, not current installation or compatibility.
See the [README](README.md) for the current download and setup instructions.

- [Published app updates](#app-updates)
- [Additional build history](#additional-build-history)
- [Public integration source updates](#integration-source-updates)

## App updates

### r88

**Released:** 2026-10-26. **App version:** 0.1.0 (build 88, arm64).
Developer ID signed and Apple notarized.
[Download r88](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.88).

#### Improved

- Added Codex **0.164.0** compatibility for Plugin connections and selection
  delivery, addressing the `codex_native_version_unqualified` rejection that
  previously blocked submission with this exact version.
- Added the official 0.164.0 runtime to managed Codex compatibility checks for
  workspace routing, session resume, and update handling.
- Registered the official 0.164.0 macOS arm64 executable for supported Pet
  permission approvals. Existing trust and request checks remain required.
- Clarified Hook status messages: Codex checks may update existing trust
  metadata, and changed Plugin contents may require review in `/hooks`.

#### Update notes

- Install r88 to apply the new support. Failed selections are not resent
  automatically; request a fresh card or continue explicitly in the original
  conversation.
- This compatibility update does not change the general handling of a
  **Working** status after other delivery failures.

**Validation scope:** 775 focused Swift tests, 233 contract/compatibility checks,
270 packaging checks, the official Codex package's Swift catalog check, and the
actual bundled Claude payload check passed. One optional packaging check was
skipped. Signing, Apple notarization, stapling, and Gatekeeper checks passed.
Clean-Mac installation, installed-app update/relaunch, OAuth, and a live
Hook → Pet → queue → completed-work round trip still require separate validation.

### r87

**Released:** 2026-10-21. **App version:** 0.1.0 (build 87, arm64).
Developer ID signed and Apple notarized.
[Download r87](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.87).

#### Improved

- When connecting Codex for the first time without saved folder settings, use
  the Mac account's home folder and subfolders as the default project scope,
  without a folder picker. Existing folder settings, including an intentionally
  empty list, are preserved.
- Settings shows one Codex connection summary, with detailed checks available
  in connection settings.

#### Fixed

- Allow more time for slow Codex Plugin checks. A read-only query timeout no
  longer leaves a persistent execution block when the query is safely stopped.
- Recheck a new Claude connection while another Claude or Codex card is selected,
  without changing the visible card.
- Stop showing a stale Connected status in Settings after a connection-status
  refresh fails.
- Updated zsh auto-connect setup prioritizes Blabee's launcher when `claude` is
  invoked, including after login startup changes PATH. Existing user aliases
  and functions are preserved.
- If an update lock blocks automatic connection before Claude starts, try the
  verified original Claude CLI once without the Blabee connection.

#### Update notes

- After installing r87, existing Claude auto-connect users should
  choose **Update Auto-Connect Settings** or **Connect Claude** once, then open
  a new zsh window. App installation alone does not update the existing shell
  setup. Later custom shell definitions can still override automatic connection.
- For an existing Codex timeout block, run **Recheck Codex Execution** in
  Settings once. Previous selections are not resent automatically.

Existing user profiles are preserved. Blabee still requires Google or GitHub
sign-in; Codex and Claude Code use their own accounts.

**Validation scope:** Focused isolated regression tests passed. Installation
and real conversation connection, selection and execution still require
separate validation.

### r86

**Released:** 2026-10-19. **App version:** 0.1.0 (build 86).
Developer ID signed and Apple notarized.
[Download r86](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.86).

#### Improved

- First-run Settings identifies service or local storage problems that block
  setup and shows the relevant recovery action.
- Connection guidance distinguishes tools that are ready to connect from tools
  that need attention. An incomplete Claude setup no longer hides the next
  available Codex connection action.
- Service guidance offers an enable action for a disabled service and a separate
  step to remove an outdated service registration before restarting.

#### Fixed

- Choosing Connect can restore a missing Claude auto-connect launcher when the
  existing terminal entry is verified as Blabee-managed. Modified or conflicting
  entries still require review.

**Recovery note:** Starting fresh with local storage requires confirmation and
does not restore lost selection history. Installing this update does not
automatically reset storage.

### r85

**Released:** 2026-10-17. **App version:** 0.1.0 (build 85).
[Original release notes](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.85).

- Replaced repeated searches through card history with a per-session pending-card
  index to reduce Engine lookup work.
- Improved cleanup of selection requests left behind after a Hook response,
  which could block an update, and clarified connection recovery during updates.
- Checked selection-prompt size before registering a card or saving a choice,
  including cards with many special characters.
- Fixed late account responses re-enabling expired UI permissions.
- Hardened Claude diagnostic output handling and recovery of outdated connection
  records.

### r84

**Released:** 2026-10-17. **App version:** 0.1.0 (build 84).
[Original release notes](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.84).

- Showed the selected option's title, objective, constraints and completion
  criteria in the prompt sent to Codex, while retaining ref and Hook validation.
- Sized the decision panel to its content and enabled scrolling only when the
  content exceeded the available screen space.
- Removed Later from the choice panel and kept Skip Choices.
- Made the current selection and next action clearer during onboarding.
- Improved Codex installation-path diagnostics, installation help and connection
  guidance after a recheck.

### r83

**Released:** 2026-10-16. **App version:** 0.1.0 (build 83).
[Original release notes](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.83).

- Started long-lived connection helpers from a separately verified runtime to
  reduce new connections holding files inside the installed app bundle.
- Checked active requests and connections before updating and deferred
  replacement when a safe state could not be verified.
- Included Engine, task-delivery and connection-diagnostic hardening.

**Known limitation at release:** Existing connections were not automatically
moved to the new runtime and could still block installation. Affected apps or
background services needed to disconnect normally before retrying. Replacing
the service while retaining a Claude connection was not supported.

### r81

**Released:** 2026-10-10. **App version:** 0.1.0 (build 81).
[Original release notes](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.81).

- Made English the default app language and added a persistent Korean setting.
  Provider card text, commands and user input retained their original language.
- Added ordinary Hook one-time approval support for signature-verified Codex
  0.162.0 and 0.162.1 arm64 binaries; unregistered or modified binaries remained
  rejected.
- Fixed a wait between app termination and background-service cleanup that could
  leave the updater at "Preparing update".

**Scope at release:** The Codex addition covered ordinary Hook approval, not
full Plugin CLI, managed App Server or session restoration qualification for
those versions. An r80 updater already stuck preparing still required a manual
DMG installation.

### r80

**Released:** 2026-10-06. **App version:** 0.1.0 (build 80).
[Original release notes](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.80).

- Bounded storage-lock waits and allowed one recovery attempt after a temporary
  write failure when the original data remained available, retaining integrity,
  permission and duplicate-execution checks.
- Strengthened date/time input validation and timing checks when Hook and
  delivery records arrived in a different order.
- Included Codex 0.159.3 and 0.160.0 support and the Claude MCP/Hook connection.

**Known limitation at release:** Automatic recovery after restart was not
provided for older interrupted records whose original data had been lost.

### r75

**Released:** 2026-09-27. **App version:** 0.1.0 (build 75).
[Original release notes](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.75).

- Required Google or GitHub sign-in to use Blabee.
- Added server-managed account suspension, resumption and service-wide access
  control without forcibly terminating ongoing Codex or Claude work. Access was
  checked every 60 seconds while connected; an existing grant lasted at most
  five minutes during a connection failure.
- Shipped the combined Codex/Claude app with ordinary Claude MCP/Hook integration,
  without requiring development Channels options.

### r57

**Released:** 2026-09-17. **App version:** 0.1.0 (build 57).
[Original release notes](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.57).

- Introduced the Air UI and bee menu-bar icon, with revised card titles,
  shortcut hints and detail previews.
- Added navigation between tasks and skipping choices. Fixed older approval
  responses overwriting the current task after a new prompt or reconnection.
- Reduced unnecessary UI refreshes and improved service waiting and session
  history memory handling.
- Included optional error diagnostics, usage statistics and a feedback screen.
  Automatic reporting followed consent, expanded statistics required renewed
  consent, and feedback text could be reviewed before submission.

### r42

**Released:** 2026-09-16. **App version:** 0.1.0 (build 42).
[Original release notes](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.42).

- Added a direct Update button for an available installer, starting download and
  signature, notarization and checksum verification inside Blabee.
- Kept an explicit confirmation before closing managed work and installing the
  update. Offered the release page as a fallback when the installer was missing
  or invalid.
- Retained r41's managed Codex 0.154.0 session save/restore flow. This did not
  extend restoration to arbitrary external Codex sessions or unsent drafts.

### r41

**Released:** 2026-09-16. **App version:** 0.1.0 (build 41).
[Original release notes](https://github.com/Hyunwoojooo/biadone/releases/tag/blabee-v0.1.0%2Bbuild.41).

- Added GitHub Release downloads with signature, notarization and checksum
  verification.
- Added save, shutdown and post-update restoration for Blabee-managed Codex
  0.154.0 sessions using their exact session IDs and working folders.
- Deferred automatic shutdown while work or approval was pending, or when saving
  could not be confirmed.

**Scope at release:** Unsent drafts were not restored. The complete update
between two notarized app versions and restoration through a real terminal had
not been validated in that release work.

## Additional build history

The following records document changes in local, internal or notarized builds.
Public distribution of these builds was **not confirmed in the reviewed records**;
they are not additional download releases. Signing, notarization and test results
do not by themselves establish publication or successful real-user operation.
Only changes tied to a build or artifact identifier by release notes, validation reports or
contemporaneous work records are included. Undated records remain undated.

### r82

**Record date:** 2026-10-11. **Type:** Notarized candidate.

- Rechecked final time-based card authority after slow storage/validation and prevented identity and validity windows from different concurrent revisions being mixed.
- Allowed queued work with verified delivery and an exact claim to record its result without reopening a closed boundary.
- Extended checks for known secret values to JSON arrays, root strings and object keys.
- Hardened separate runtime copies for long-lived connections and the locking boundary between request processing and update replacement.

**Scope at the time:** Updates that retained real user sessions and the handoff to the separate runtime still required additional validation.

### r79

**Record date:** 2026-09-30. **Type:** Notarized candidate.

- Reduced repeated full-candidate searches and JSON parsing in SQLite verification while retaining integrity, freshness, expiry, session binding and single-claim checks.
- Stopped describing internal Hook validation failures as necessarily being caused by a late user selection.
- Added per-attempt Hook error/timing and service-processing diagnostics without logging prompts, refs, choices or user paths.
- Included Codex 0.159.2 support and ordinary Claude MCP/Hook integration.

**Scope at the time:** Delivery and execution of a new card still required verification after installation; previously failed work was not automatically resent.

### r78

**Record date:** 2026-09-30. **Type:** Notarized candidate.

- Removed new registrations of the legacy auto-start service that could not forward login authorization; existing registrations could be removed before switching to the app-launched service.
- Offered an explicit service restart action on the same connection screen after removing a legacy registration.
- Fixed false positives from unrelated ancestor-directory changes in managed Codex executable checks, retaining replacement, permission and integrity validation.
- Updated Claude connection guidance for ordinary MCP/Hook integration.

**Scope at the time:** Status checks or removing a registration did not themselves restart the service. Automatic shutdown and restoration of ordinary Codex/Claude sessions was not assumed.

### r77

**Record date:** 2026-09-30. **Type:** Notarized candidate.

- Distinguished selection-delivery failures during executable validation, command invocation and response validation.
- Separated slow diagnostic writes from selection responses and Hook validation.
- Checked the next Codex installation candidate when a file could not be read, retaining signature and execution-protection checks.
- Preserved delivery-failure guidance after transient status errors and kept rechecks from automatically resending failed work.

**Scope at the time:** The exact cause of an intermittent runtime path-check failure was still under investigation; live card delivery and update flows required separate verification.

### r76

**Record date:** 2026-09-28. **Type:** Notarized candidate.

- Updated support information for Codex 0.157.0 and 0.157.1 connections, one-time approval, managed sessions and update restoration.
- Fixed unnecessary UI refreshes when repeatedly observing the same connection error.
- Retained Google/GitHub sign-in, account access control and the ordinary Claude MCP/Hook connection.

**Scope at the time:** Live Hook approval, choice delivery and execution in the same conversation, and terminal restoration after an update still required post-installation validation.

### r74

**Record date:** 2026-09-27. **Type:** Notarized candidate.

- Moved the Claude connection from development Channels to standard MCP and Hooks, adding a signing and notarization path for public distribution.
- Validated the exact session, card, and new prompt context when resuming a selection, and canceled prior unexecuted selections on regular new input.
- Kept data-sharing settings separate and avoided creating placeholder terms-consent records while actual terms registration was deferred.

**Scope at the time:** This candidate was notarized in public-distribution mode, but that work did not publish a GitHub Release or replace the installed app. Fresh installation on a VM or another Mac, other Claude versions, long-running repetition, and direct interaction with the installed app remained unverified.

### r73

**Record date:** 2026-09-25 (KST). **Type:** Notarized internal test build.

- Created and Apple-notarized a new internal test package retaining r72's functionality.
- Updated installer guidance so it remained accurate after notarization and separated the internal-preview notarization path.

**Scope at the time:** Product sources were identical to r72; this was not a separate functional update. This notarized internal test build still used development Claude Channels, was not eligible for general public distribution at the time, and was not published through GitHub Releases or automatic updates in that work.

### r72

**Record date:** 2026-09-24. **Type:** Internal test build.

- Added Skip Choices for regular Claude suggestion cards, closing only the current card without sending work, approval, or a prompt.
- Blocked late responses after card, session, or service replacement and improved expiry and clock-rollback checks during dismissal.

**Scope at the time:** This was an unnotarized internal test build with the development Claude connection. Skipping a real Claude card and checking selection delivery for other cards in the installed app remained pending.

### r71

**Record date:** 2026-09-24. **Type:** Internal test build.

- Limited automatic focus retries for the same card and connection context, keeping successful status polling separate from failed focus confirmation.
- Prevented late expiry work or storage retries from expiring a newer card revision, and rechecked expiry and clock rollback after slow processing.

**Scope at the time:** Existing integrity, session binding, and single-claim checks were preserved; failed work was not automatically resent or executed. This was an unnotarized internal build; live Hook round trips and latency with a large history required separate validation.

### r70

**Record date:** 2026-09-24. **Type:** Internal test build.

- Added opt-in diagnostics for Codex and Claude connection-check, setup, and launch errors.
- Distinguished diagnostics by tool, stage, cause, and version, and improved submission-status display and first-run consent handling.

**Scope at the time:** This was an unnotarized internal test build with the development Claude connection. Backend deployment did not prove receipt of real app errors; live submission from a consenting account after installation remained to be checked.

### r69

**Record date:** 2026-09-23. **Type:** Internal test build.

- Unified Codex and Claude connection setup and improved the automatic check-and-setup flow.
- Improved connection error guidance and first-run connection handling.

**Scope at the time:** This was an unnotarized internal test build with the development Claude connection. First connection on a new Mac and live Codex/Claude selection delivery remained to be checked after installation.

### r68

**Record date:** 2026-09-23. **Type:** Internal test build.

- Added a unified inbox for Codex and connected Claude sessions, showing cards in arrival order and identifying their source with provider symbols.
- Made Codex and Claude connection status and settings available at the same level in Settings.

**Scope at the time:** This was an unnotarized signed internal build with development Claude Channels. App UI, service startup, and card delivery through user sessions were outside that package verification.

### r67

**Record date:** 2026-09-23. **Type:** Internal test build.

- Added a suggestion type to distinguish follow-ups for the current task from new ideas in the UI.
- Added card-writing guidance that prioritizes the user's requested language and conversation language, with new suggestions offered only when at least two distinct useful next items are available.

**Scope at the time:** Language behavior was model-writing guidance, not automatic translation or enforced validation of every card's language. This was an unnotarized internal build; live model language compliance and selection delivery remained unverified.

### r66

**Record date:** 2026-09-22. **Type:** Internal test build.

- Fixed approval shortcuts being blocked merely because a feedback window remained open in the background.
- Paused shortcuts only while the feedback window had input focus and restored them after switching applications or minimizing the window.

**Scope at the time:** This was an unnotarized internal build; live window-switching validation after installing r66 remained pending. The contemporaneous physical ⌘1 approval check used r64 after minimizing feedback and did not validate an installed r66.

### r65

**Record date:** 2026-09-22. **Type:** Internal test build.

- Kept the ⌘1, ⌘2, and ⌘3 shortcut labels visible on approval buttons.
- Dimmed unavailable shortcuts and explained why they were paused.

**Scope at the time:** This build changed shortcut presentation; the feedback-window focus suppression fix followed in r66. This was an unnotarized internal build and did not replace the installed app during verification.

### r64

**Record date:** 2026-09-22. **Type:** Internal test build.

- Bundled Pretendard 1.3.9 for the product UI.
- Registered the font within the app without a separate system installation, while retaining monospaced commands and shortcuts and native macOS menus.

**Scope at the time:** This was an unnotarized internal test build with the development Claude connection. Package verification did not replace the installed app or start its UI or service.

### r63

**Record date:** 2026-09-21. **Type:** Internal test build.

- Added opt-in automatic connection for regular `claude` and `claude --resume` commands in new zsh terminals.
- Gave resumed conversations a fresh connection context without replaying old selections, while preserving the original Claude executable and explicit user arguments.

**Scope at the time:** This signed internal candidate included development Claude Channels and was not notarized or publicly distributed. User shell settings were not changed automatically; installation and live use through regular commands remained separate validation steps.

### r62

**Record date:** Not established. **Type:** Internal test build.

- Unified Codex and Claude in one Blabee app and DMG with shared UI, account, settings, shortcuts, and updates.
- Allowed Claude-only users to skip Codex setup during first run and showed setup guidance instead of starting Claude before the service was ready.

**Scope at the time:** This unnotarized internal candidate included development Claude Channels and was not intended for public distribution. Installation, live model execution, simultaneous provider use, and long-running validation remained pending.

### r61

**Record date:** 2026-09-18. **Type:** Internal test build.

- Extended the decision window for new regular choice cards from two minutes to ten minutes.
- Kept remaining-time, selection, dismissal, and expiry checks aligned without extending the lifetime of existing two-minute cards.

**Scope at the time:** This change did not alter Codex permission-approval waiting or post-selection delivery limits. This was an unnotarized internal build; a real ten-minute wait in the installed app remained to be checked.

### r60

**Record date:** 2026-09-18. **Type:** Internal test build.

- Added an explicit archive-and-restart recovery path for startup failures caused by missing storage and authentication keys with an existing validation record.
- Separated Codex Plugin installation from Hook trust, with project-specific checks and protection against reusing late results.

**Scope at the time:** This was an unnotarized internal build. Recovery of affected user storage, installed-app approval round trips, and installation on another Mac remained unverified.

### r59

**Record date:** 2026-09-18. **Type:** Internal test build.

- Reduced repeated history reads when skipping choices and gave slow dismissal responses a separate waiting window.
- Kept a running service alive during response delays, displayed a delayed-service state, and blocked selections and approvals until the connection was confirmed.

**Scope at the time:** This was an unnotarized internal test build. Installed-app skip-choice validation remained pending, and some dark-mode OCR checks did not pass.

### r58

**Record date:** Not established. **Type:** Internal test build.

- Added an app icon using the same bee silhouette as the menu-bar icon.
- Included standard icon sizes on a light Air background in app metadata and signing, with icon checks in package validation.

**Scope at the time:** This ad-hoc-signed review candidate reused the Debug binary validated for r57. That work did not perform a distribution Release rebuild, Developer ID signing or notarization; the public release remained r57.

### r56

**Record date:** 2026-09-17. **Type:** Internal test build.

- Added opt-in card-presentation, response and response-time-bucket metrics with renewed consent.
- Added a separate feedback window for ratings, use purpose and comments, with deletion of the user's own submissions.
- Sharing conversation text requires redaction, a preview and separate confirmation; submitted text and ratings are retained for 30 days.

**Scope at the time:** Conversation text is not uploaded automatically. Live-account submission, listing, deletion and card-observation collection were unverified; this was not a notarized distribution package.

### r55

**Record date:** 2026-09-17. **Type:** Internal test build.

- Expanded optional usage metrics with setup progress, interaction acceptance results and response-time buckets, button versus shortcut use and app-update outcomes.
- Requires renewed opt-in for expanded collection instead of automatically inheriting earlier consent.

**Scope at the time:** Functional-response metrics do not prove completed AI work or exact success rates for all users. Live app use followed by server aggregation remained unchecked; this was an ad-hoc-signed review build.

### r54

**Record date:** 2026-09-17. **Type:** Internal test build.

- Added error-diagnostic reporting as a separate opt-in setting, disabled by default.
- Reports limited observed error codes and app/OS version information for a consenting signed-in account, without raw logs, conversations or commands.

**Scope at the time:** This is not whole-app automatic crash reporting. Live installed-app-to-server reporting remained pending; this was not a notarized distribution package.

### r53

**Record date:** 2026-09-17. **Type:** Local build.

- Reduced repeated image and title assignments triggered by menu-bar appearance notifications.
- Released large completed-task data and bounded sessions needed for state snapshots while preserving active delivery and exact-retry recovery.
- Improved slow socket waits so they do not block other work and prevented duplicate error responses after a partially sent response fails.

**Scope at the time:** CPU improvements in a menu-bar-only harness do not establish whole-app memory, battery or long-term stability results. This was an ad-hoc-signed local build without notarization, GitHub publication or installed-app replacement in that work.

### r52

**Record date:** 2026-09-17 (KST). **Type:** Local build.

- Removed choice-card icons and placed titles at the top so the option text is read first.
- Moved keyboard shortcuts to the lower-right corner while retaining recommended badges and existing selection behavior.

**Scope at the time:** Seven checks covered two to four choices, long titles, appearance variants and selection state, and signature verification passed. The installed app had not been replaced at that point.

### r51

**Record date:** 2026-09-17 (KST). **Type:** Local build.

- Adjusted the shared panel's outer corner radius from 38pt to 26pt using the System Settings window as a visual reference.

**Scope at the time:** Nine rendering/size checks and signature verification passed, but the installed app was not replaced. The visual reference was not a universal macOS window metric.

### r50

**Record date:** 2026-09-17 (KST). **Type:** Local build.

- Extended the Blabee approval waiting window from 50 seconds to five minutes.
- Added remaining-time and Codex handoff guidance to approval cards, along with expired-approval rejection and reason-coded diagnostics.

**Scope at the time:** The contemporaneous completion report records 318 Swift checks, 16 Node checks and successful signature verification. This local build required an updated app/plugin and Hook review. Whether the original request had been displayed at all remained unresolved; this was not established as a fix for every missing-approval case.

### r49

**Record date:** 2026-09-17 (KST). **Type:** Local build.

- Fixed missing approval cards for child-agent follow-up work when no new task-start Hook registration is emitted.
- Preserved exact session and command binding, including rejection of wrong-session responses and stale requests.

**Scope at the time:** The record confirms 84 checks covering concurrent approvals, session matching and stale-request rejection, plus local assembly. The installed app was still an earlier version, and live child-agent approval validation in the new build remained pending.

### r48

**Record date:** 2026-09-17. **Type:** Internal test build.

- Added opt-in usage statistics for accepted choices, approvals and dismissals, including activity days and last observed use.
- Excluded conversation, code, commands and choice text from automatic usage statistics, keeping reporting failures separate from functional results.

**Scope at the time:** Different candidates reused r48; this entry covers only the documented usage-statistics candidate and does not establish that the separate card-UI candidate contained the same changes. Metrics observe accepted interactions, not completed AI work or all historical use. The live sign-in-to-server-receipt flow was unverified.

### r47

**Record date:** 2026-09-17 (KST). **Type:** Local build.

- Matched the menu-bar icon to the panel's bee symbol while retaining appearance adaptation and the red notification dot.

**Scope at the time:** The contemporaneous completion report records four passing appearance/menu-click checks and successful build/signature verification. These records do not establish public distribution.

### r46

**Record date:** 2026-09-17. **Type:** Local build.

- Applied the Air design to the native panel with two-column choice cards, multiline titles, recommendation badges and a refreshed waiting view.
- Added General, Shortcuts, Projects and Connection settings tabs, scrolling adapted to card count and screen height, and fixed footer actions.
- A follow-up assembly using the same build number supplemented compatibility information for the previous installation.

**Scope at the time:** The initial and compatibility-supplemented r46 candidates used the same UI and binary. These were ad-hoc-signed local review builds without notarization or upload in that work; live session flows, global shortcuts, VoiceOver and glass compositing remained separate checks.

### r45

**Record date:** 2026-09-16. **Type:** Internal test build.

- Fixed an app crash when macOS delivered the login-browser callback on a different thread.
- Transferred login results safely to the UI thread while preserving cancellation, timeout and stale-attempt protections.

**Scope at the time:** Callback regression checks passed for success, cancellation, failure and empty results; this did not establish successful live Google or GitHub authentication.

### r44

**Record date:** 2026-09-16. **Type:** Internal test build.

- Fixed a packaging check that lost the earlier app's signing context by inspecting its executable alone, omitting compatibility information.
- Compatibility inspection now preserves the signed app bundle, distinguishing helpers using an older executable from processes using the current installed file.

**Scope at the time:** Protection against replacement while processes use the current installed files remains. A login-browser callback crash in this build was subsequently observed and addressed in r45.

### r43

**Record date:** 2026-09-16. **Type:** Internal test build.

- Added native Google and GitHub sign-in from Settings, returning to the app after browser authentication.
- Added verified account display, sign-in restoration across launches and sign-out for the current device.

**Scope at the time:** At this stage, sign-in identified the account without billing, subscription entitlements or app-access restrictions. This internal review build had not verified real-account native sign-in, relaunch persistence or sign-out.

### r40

**Record date:** 2026-09-13. **Type:** Notarized candidate.

- Corrected installed-app status headings and added Finder recovery guidance when the installer is reused or launch-location checks repeatedly fail.
- Made regular Plugin connection checks the default Codex diagnostic profile, separating managed-package checks, the first failure and checks blocked by an earlier error.

**Scope at the time:** Developer ID signing and Apple notarization were verified, but did not establish public publication. Finder recovery on the affected Mac and a successful live connection required separate validation.

### r39

**Record date:** 2026-09-12. **Type:** Notarized candidate.

- Prepared a Developer ID-signed, Apple-notarized DMG distribution candidate.
- Added a resumable notarization workflow that continues the same submission after interruption and verifies the ticket, Gatekeeper result and final checksum after acceptance.

**Scope at the time:** That work did not publish a GitHub Release. Installation and first launch on a clean Mac and a live Codex connection remained separate checks.

### r38

**Record date:** 2026-09-12. **Type:** Local build.

- Added navigation across pending choices and approvals with Option+Left/Right or Previous/Next buttons, showing the current position and total count.
- Keeps the item being reviewed when new requests arrive and permits selection, approval or dismissal only after confirming the current request.

**Scope at the time:** Navigation is blocked during approval delivery and acknowledgement. Global-shortcut navigation and selection in the installed app remained to be checked.

### r37

**Record date:** 2026-09-12. **Type:** Local build.

- Separated parent and child Codex thread approval contexts so a child request is not recorded as a new parent turn.
- Reduced blocking communication paths that delayed other work while multiple approvals were waiting.
- Added Skip Choices to regular decision cards, dismissing only the exact visible pending card without sending a prompt or approval response.

**Scope at the time:** Validation used synthetic requests and isolated integration checks, not real user-command execution. It did not establish every child-agent follow-up card lifecycle.

### r36

**Record date:** 2026-09-12. **Type:** Internal test build.

- Fixed overlapping approval number keys unintentionally handling a subsequent request when only one held key was released.
- Preserved the original working-directory spelling in approval display and final responses while using a normalized path only for session lookup.

**Scope at the time:** This was an ad-hoc-signed internal tester package. Notarization, first installation on another Mac and physical approval shortcuts were unverified; that work did not publish a GitHub release.

### r35

**Record date:** 2026-09-12. **Type:** Local build.

- Added Codex 0.154.0 arm64 support for one-time approvals through the regular Codex Hook while retaining 0.153.4 support.
- Expanded the former single-line, 120-character command limit, preserving line breaks and tabs for scrolling through the full approval command.
- Bound Command+1–3 to the visible approval request and prevented a held number key from immediately handling the next request.

**Scope at the time:** Requests already handed back to Codex's approval dialog and unsupported requests still require action in Codex. Physical shortcut approval round trips in the installed app had not yet been verified.

### r34

**Record date:** Not established. **Type:** Local build.

- Adjusted the panel radius from 12pt to 20.2pt using Apple's MacBook Air display artwork as a visual reference.

**Scope at the time:** This was an estimated design value for a particular display scale, not an exact hardware specification or a match guaranteed on every display.

### r33

**Record date:** Not established. **Type:** Local build.

- Reduced the outer panel corner radius from 30pt to 12pt, using the same shape for Liquid Glass, earlier macOS materials and reduced-transparency surfaces.

**Scope at the time:** The 12pt radius was a Blabee design choice, not a system-wide macOS window measurement. Live Liquid Glass inspection in the installed app was separate.

### r32

**Record date:** Not established. **Type:** Local build.

- Kept details previews at the regular choice panel's 460pt width instead of widening the panel.
- Long content wraps and scrolls vertically, with preview dimensions constrained to smaller screens.

**Scope at the time:** Regression checks and rendering passed; these were separate from physical shortcut checks in the installed app.

### r31

**Record date:** 2026-09-11. **Type:** Local build.

- Added Control+1–4 as a details-preview shortcut option. Releasing the number keeps the preview open; releasing Control closes it.
- Preserves existing shortcut settings and defaults, and retains a newly saved combination across launches.

**Scope at the time:** The combination can conflict with macOS or other apps; system shortcuts are not changed automatically. Physical keyboard validation in the installed app remained pending.

### r30

**Record date:** 2026-09-11. **Type:** Local build.

- Added explicit update checks from the menu bar and Settings for public stable GitHub Releases, with a link to a newer release page.
- Distinguished the current version, available updates, no published release and lookup failures.

**Scope at the time:** This stage provided version lookup and release-page navigation only; it did not download or install updates automatically.

### r29

**Record date:** Not established. **Type:** Local build.

- Added configurable details-preview shortcuts for each choice's full title, objective, constraints and completion criteria.
- Preview shortcuts can be changed or disabled, with conflict and registration-failure handling that preserves selection shortcuts. Opening a preview does not execute the action.

**Scope at the time:** Automated checks and rendering were completed; physical shortcut input, panel restoration and VoiceOver reading order in the installed app remained separate checks.

### r28

**Record date:** Not established. **Type:** Local build.

- A local build providing choice-details previews with a fixed Command+Shift shortcut combination.

**Scope at the time:** Only the fixed shortcut and details-preview behavior could be reconstructed from the r29 follow-up record. The exact date and independent validation results were not established.

### r27

**Record date:** 2026-09-11. **Type:** Local build.

- Extended the initial service-start wait to up to two minutes for macOS access confirmation, while retaining the existing 12-second deadline for response failures after connection.

**Scope at the time:** The local check confirmed card acceptance through the regular Codex Plugin, but not the selection-return round trip or installation on another Mac.

### r26

**Record date:** 2026-09-11 (KST). **Type:** Internal test build.

- Added startup diagnostics to identify where app initialization or background-service startup stops.

**Scope at the time:** This was a local diagnostic build; the service-startup timeout fix followed in r27. The historical record confirms Release compilation, ad-hoc-signed assembly and emitted startup events, not successful service readiness.

### r25

**Record date:** 2026-09-11. **Type:** Local build.

- Added a one-attempt replacement confirmation for legacy installations when only some process executable paths cannot be resolved, with shutdown acknowledgement and backup review.
- A failed post-installation launch can reopen the installed app without reinstalling it.

**Scope at the time:** Known app use, incomplete process inspection, runtime leases and integrity failures still block replacement. The acknowledgement does not prove that every process exited. Local installation completed, but other-Mac installation and live Codex approval round trips remained separate checks.

### r24

**Record date:** 2026-09-10. **Type:** Local build.

- Added Codex 0.154.0 to the supported Plugin CLI connection versions.
- Kept unlisted adjacent versions and managed App Server qualification separate, preventing unqualified 0.154.0 requests from gaining one-time approval.

**Scope at the time:** The full live Hook-to-card-to-selection-to-task flow remained unverified. One-time approval for 0.154.0 was not enabled; this was a local ad-hoc internal-test app.

### r23

**Record date:** 2026-09-10. **Type:** Local build.

- Introduced runtime-use locks for verified compatible app replacement, protecting installation based on actual use of Blabee files.
- Kept app files protected through installation, backup and recovery, distinguishing active use, unknown process state and lock-check failures.

**Scope at the time:** The first replacement of older installations still required the legacy guard, so this did not immediately remove every update block. Native integration, installed-app migration and other-Mac validation remained incomplete.

### r22

**Record date:** 2026-09-10. **Type:** Local build.

- Applied consistent status dots and descriptions to connection, project, service and Plugin settings, keeping status visible when sections were collapsed.
- Distinguished confirmed status, required action, actual failures and unknown states, with separate indicators for Plugin installation and Hook trust.

**Scope at the time:** Regression checks, rendering and the installer window were checked, but installed-app status, interaction, VoiceOver and card return remained unverified. Permission policies were unchanged; no DMG or ZIP was created.

### r21

**Record date:** 2026-09-10. **Type:** Internal test build.

- Fixed the order of one-time approval, deny and decide-in-Codex choices, explaining why approval was unavailable.
- Corrected lookup of the running official Codex executable's signing information and blocked duplicate selections during delivery.
- Included the Settings connection summary and next-action guidance in the internal-tester package.

**Scope at the time:** One-time approval remained limited to qualified Codex 0.153.4 and a verified Hook caller relationship. The installer window was observed; completed installation, service/permission round trips and other Macs remained unverified.

### r20

**Record date:** 2026-09-09. **Type:** Local build.

- Placed a connection summary and next action at the top of Settings, kept project folders nearby, and collapsed detailed installation and service controls.
- Distinguished configuration readiness from actual card receipt and guided users when saved project settings had not yet reached the service.

**Scope at the time:** Build and integrity checks passed, but installed-app replacement was deferred, leaving live interaction and Codex selection return unverified. No DMG or ZIP was produced.

### r19

**Record date:** 2026-09-09. **Type:** Internal test build.

- Added installation-location guidance and an Install in Applications and Start action when opening the app from a DMG or Downloads.
- Added destination/version review and separate backup-and-replace confirmation, stopping replacement while the app or connected helpers were in use.

**Scope at the time:** Installation guidance and in-use replacement blocking were observed; completed installation, launching the replacement and other-Mac card flows remained unverified. Installing the app did not itself complete Codex Plugin installation or Hook trust approval.

### r18

**Record date:** 2026-09-09. **Type:** Internal test build.

- Added conditional one-time approval for regular Codex Hook permission requests, limited to the then-qualified Codex 0.153.4 executable and verified Hook caller relationship.
- Clearly labeled the session location on permission cards and retained denial or direct Codex decisions for unverified requests.

**Scope at the time:** Installation and service connectivity were confirmed, but live validation of all three decision routes and one-time scope was incomplete. This was an unnotarized internal app; other Macs and long-running stability required separate checks.

### r17

**Record date:** 2026-09-09. **Type:** Internal test build.

- Packaged explicit legacy Codex connection recovery, recheck feedback and diagnostic copying in an internal-tester DMG.
- Included installation instructions, a getting-started guide, a test result form and file-integrity information.

**Scope at the time:** User-modified legacy wrappers were outside automatic recovery. This was an internal app before notarization; live installation, other-Mac flows and long-running stability still required verification.

### r16

**Record date:** 2026-09-09. **Type:** Local build.

- Added recovery that backs up and disables an exactly identified legacy Codex shell connection after user confirmation.
- Added distinct progress, completion and result feedback for Codex rechecks, with copying of redacted diagnostics.

**Scope at the time:** Modified or ambiguously identified shell connections were not cleaned up automatically. Local installation and service communication were confirmed; complete settings interaction and other-Mac recovery remained unverified.

### r15

**Record date:** 2026-09-08. **Type:** Internal test build.

- Prepared an internal-tester package containing the app, checksum and HTML installation guide.
- Documented the app-owned service, Codex Plugin setup, follow-up suggestion modes, troubleshooting and manual updates.

**Scope at the time:** This records the tester package, not new app features over r14. It was an internal package without notarization or automatic updates; other-Mac installation and long-running stability remained unverified.

### r14

**Record date:** 2026-09-08. **Type:** Internal test build.

- Packaged the app-owned service, manual connection recovery and selection completion improvements in an internal-test DMG.
- Applied native Codex verification, remembered failures and explicit rechecks to setup and follow-up delivery, with Codex 0.153.4 Plugin CLI compatibility and Korean installation guidance.

**Scope at the time:** This was an internal ad-hoc app without Apple notarization. Live installation, updating and use on other Macs remained unverified, alongside existing auto-start and long-running stability concerns.

### r13

**Record date:** 2026-09-08. **Type:** Local build.

- Added an opt-in service mode that starts and stops with the Blabee app.
- Added service failure guidance, manual restart and stale-response protection, distinguished panel closing from app termination, and preserved the service mode across launches.

**Scope at the time:** The card-to-task flow was confirmed for one Codex session on one development Mac. This did not validate multiple sessions, permission cards or other Macs; existing auto-start, first-connection guidance and long-running memory stability concerns remained.

### r12

**Record date:** 2026-09-07. **Type:** Local build.

- Stored selection transport completion and boundary closure together to reduce repeated history reads and writes during completion handling.
- Improved recovery from lost responses and partial legacy completion records without resending queued work.

**Scope at the time:** App installation and panel relaunch were confirmed, but the service's automatic-start issue prevented completion of the live card flow. Integrity and freshness checks remained in place; this did not guarantee Hook response times or task completion.

### r11

**Record date:** 2026-09-07. **Type:** Local build.

- Separated the time budgets for executable trust checks and queue dispatch so verification could not consume the entire dispatch budget.
- Adjusted the response wait for selection requests while preserving the rule against automatically retransmitting timed-out or uncertain work.

**Scope at the time:** A new turn reached the same Codex session, but subsequent Hook verification failed and the selected task did not execute. The background service's automatic-start issue also remained unresolved.

### r8

**Record date:** 2026-09-05. **Type:** Internal test build.

- Separated service connectivity from macOS auto-start registration, showing a runtime check notice when a registered service did not respond.
- Reduced repeated idle updates of identical UI snapshots, menu-bar icons, and shortcut registration.
- Bounded shutdown waits when cleaning up managed Codex child processes.

**Scope at the time:** Installation and service recovery were observed on one development Mac; clean-Mac installation and the full Hook and selection flow remained unverified. This was an internal ad-hoc build without public-distribution signing or Apple notarization.

### r4

**Record date:** 2026-09-04. **Type:** Internal test build.

- Qualified Codex 0.153.2 for Plugin CLI connections and improved handling of installation records from remote marketplaces.
- Reused executable verification evidence within a single connect or disconnect operation to reduce repeated full-file checks.

**Scope at the time:** r4 identifies the historical internal DMG; it has not been verified as the app's bundle build number. This did not qualify the managed App Server or verify the full Hook and selection flow on a clean Mac.

**Records not reconstructed:** r1, r2, r3, r5, r6, r7, r9, r10. The reviewed evidence did not
reliably connect specific changes to these build numbers. A missing entry does
not mean that a build never existed or was never distributed.

## Integration source updates

### Initial public integration snapshot — 2026-10-18

- Published selected Codex plugin and current Claude MCP/Hook client sources.
- Added frozen v1 contracts, synthetic fixtures and isolated regression tests.
- Added English and Korean product/setup documentation and offline examples.
- Kept the macOS app, Swift Engine and operational backend outside this source
  scope. At the time of this source snapshot, the app download was the signed
  and notarized r85 release.

The integration snapshot remains r85; its version and the app build number are
separate. See
`PUBLIC_SOURCES.json` for the exact published file inventory.
