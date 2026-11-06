# Blabee UI typography

Product UI uses Pretendard 1.3.9 from the user-provided `Pretendard-1.3.9.zip`.
The original variable font and license are preserved in
`Packaging/macos/Resources/Fonts/Pretendard/` and copied into the app's
`Contents/Resources/Fonts/Pretendard/` by the existing assembler. They are
included in its size limits, assembly manifest and signed resource seal.

`app/ui/PetTypography.swift` registers the font once within the app process.
It does not install system fonts or depend on Downloads, a source checkout,
network access or a preinstalled Pretendard font. The variable file exposes
named PostScript instances (`PretendardVariable-Regular`, `-Medium`,
`-SemiBold`, `-Bold`, etc.); the filename itself is not a usable face name.

Use `Font.blabee(.body)` for semantic styles and
`Font.blabee(size: 18, weight: .semibold)` for existing fixed-size text.
Semantic styles retain macOS's preferred point sizes and relative text style;
fixed-size text retains its previous point size. Commands, technical values
and shortcut labels keep their intentional monospaced system fonts. Explicit
SF Symbol styling and macOS system-owned menus/dialogs remain native.

Offscreen SwiftPM render tests explicitly register the shipped font through
`PetTypographyTestResources`, since their executable is not an assembled app.
Missing resources fall back to the system font for usability, while packaging
and typography tests require the actual font file, faces, weights and glyphs.

Source hashes (SHA-256):

- Font: `3090ccde0442bb347aa7685d9ba8b17436a60682df6e8f92a9a670de14056e22`
- License: `b04538c9abec39a3db75108cf0af0fd9c77032fe8aa2cf38345b4d250e98e38e`

API references: [SwiftUI custom fonts](https://developer.apple.com/documentation/swiftui/applying-custom-fonts-to-text),
[CoreText registration](https://developer.apple.com/documentation/coretext/ctfontmanagerregisterfontsforurl(_:_:_:)).

## Validation — 2026-09-21

- Swift build and 14 selected typography/UI tests across six suites passed.
  The first run found a test expectation issue: CoreText omits the unchanged
  Regular weight axis. After using its declared default, all three typography
  tests passed on a focused rerun; the other 11 UI tests had already passed.
- Offscreen suites generated 112 light/dark and narrow/standard PNGs. Cards,
  settings and onboarding were also visually inspected. Representative images
  are in the ignored `build/pretendard-ui-preview/` directory.
- AppPackaging reported 218 passing checks. The two tests that build Swift or
  launch app processes were excluded from that Node run. The earlier targeted
  packaging run's three nested-sandbox failures passed on the external rerun.
- A disposable app-layout probe compiled the production typography helper and
  loaded the font through `Bundle.main`, without the test registration seam.
- Installed apps, live services and user sessions were not replaced or stopped.
