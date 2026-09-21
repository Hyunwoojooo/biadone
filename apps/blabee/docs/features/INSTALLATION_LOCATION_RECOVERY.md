# Installation location recovery

The r36 tester report showed an installed app launching from a macOS-randomized
path. An implicit GUI launch entered the installer, and opening the installed
app failed the exact bundle/executable path check. Retrying repeated the failure.
The same installation code shipped in notarized r39.

## Behavior

- An inspected existing installation is described as installed, rather than
  missing. Bundle identity and version still determine open/upgrade actions.
- Launch Services is asked for a new process if no application at the installed
  destination is currently observed. This avoids reuse of the installer, which
  shares the bundle identifier. If an installed process is observed, a new
  instance is not forced. This observation is not a lock against external launches.
- Returned bundle path, executable path, kernel executable path, and dynamic
  runtime identity must still match the requested installed app. Presence in the
  workspace is never used as trust evidence.
- A mismatched location, early exit, launch callback failure or timeout changes the
  primary action to `Finder에서 설치 복구`. It reveals the inspected destination;
  repeated clicks or refreshes do not launch or copy again. An existing receipt
  and backup are retained. These errors are not labelled proof of translocation.
- The recovery screen asks the user to save work and close Blabee/connected
  sessions, then use Finder to move the app to a temporary folder and back to
  Applications before opening it. A fresh notarized DMG dragged into Applications
  is an alternative. The app does not move the installed bundle for the user.

## Boundaries

Quarantine, Gatekeeper, signature verification, active-process guards and the
installed-only entry are preserved. No private translocation API, Apple Events
automation permission, direct-executable launch fallback, or quarantine removal
is introduced. A new Launch Services instance does not guarantee that macOS will
stop randomizing its path. The Finder roundtrip is derived from Apple's documented
move example; the affected macOS version still needs a real installation test.

## Validation

Automated coverage: matching installed app heading; new instance versus observed
installed instance; unchanged dynamic identity rejection; mismatch and early-exit
recovery for existing, newly published and upgraded apps; retained receipt and backup; no repeated
launch, replacement or copy. Existing quarantine preservation tests still apply.

Human acceptance must use a clean Mac or VM snapshot, download the notarized DMG
through a quarantining downloader such as Safari, and follow the actual install
path. Verify the installed process path, service response, and a fresh Codex
selection roundtrip separately. Test both a fresh install and the Finder recovery
flow. Do not treat a unit test or local codesign verification as this evidence.

## Apple references

- [App Translocation Notes](https://developer.apple.com/forums/thread/724969)
- [Finder preserves quarantine](https://developer.apple.com/forums/thread/777189)
- [New application instances](https://developer.apple.com/documentation/appkit/nsworkspace/openconfiguration/createsnewapplicationinstance)
- [Testing a Notarised Product](https://developer.apple.com/forums/thread/130560)
