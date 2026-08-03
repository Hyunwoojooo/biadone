#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

[[ "${BLABASE_ENABLE_NOTARIZATION:-0}" == "1" ]] \
  || blabase_die "set BLABASE_ENABLE_NOTARIZATION=1 for this explicit release operation"
[[ -n "${BLABASE_DEVELOPER_ID_APPLICATION:-}" ]] \
  || blabase_die "BLABASE_DEVELOPER_ID_APPLICATION is required"
[[ -n "${BLABASE_NOTARY_PROFILE:-}" ]] \
  || blabase_die "BLABASE_NOTARY_PROFILE is required"
[[ -n "${BLABASE_NODE_CODESIGN_ENTITLEMENTS:-}" ]] \
  || blabase_die "BLABASE_NODE_CODESIGN_ENTITLEMENTS is required for hardened Node.js"
[[ -n "${BLABASE_CODESIGN_ENTITLEMENTS:-}" ]] \
  || blabase_die "BLABASE_CODESIGN_ENTITLEMENTS is required for Apple Events"

blabase_assert_macos
blabase_prepare_build_root
blabase_require_command xcrun
blabase_require_command codesign
blabase_require_command ditto
/usr/bin/xcrun notarytool --help >/dev/null 2>&1 \
  || blabase_die "notarytool is unavailable; install and select full Xcode"

APP_NAME="${BLABASE_APP_NAME:-Blabase}"
IDENTITY="$BLABASE_DEVELOPER_ID_APPLICATION"
PROFILE="$BLABASE_NOTARY_PROFILE"
APP_PATH="$(BLABASE_CODESIGN_MODE=none "${SCRIPT_DIR}/build-app.sh")"
INFO_PLIST="${APP_PATH}/Contents/Info.plist"
EXECUTABLE_NAME="$(/usr/bin/plutil -extract CFBundleExecutable raw -o - "$INFO_PLIST")"
NODE_PATH="${APP_PATH}/Contents/Resources/runtime/bin/node"
EXECUTABLE_PATH="${APP_PATH}/Contents/MacOS/${EXECUTABLE_NAME}"
[[ "$BLABASE_NODE_CODESIGN_ENTITLEMENTS" == /* ]] \
  || blabase_die "BLABASE_NODE_CODESIGN_ENTITLEMENTS must be an absolute path"
[[ -f "$BLABASE_NODE_CODESIGN_ENTITLEMENTS" ]] \
  || blabase_die "Node codesign entitlements file does not exist"
/usr/bin/plutil -lint "$BLABASE_NODE_CODESIGN_ENTITLEMENTS" >/dev/null
[[ "$(/usr/bin/plutil -extract com.apple.security.cs.allow-jit raw -o - "$BLABASE_NODE_CODESIGN_ENTITLEMENTS" 2>/dev/null || true)" == "true" ]] \
  || blabase_die "Node entitlements must enable com.apple.security.cs.allow-jit"
[[ "$(/usr/bin/plutil -extract com.apple.security.cs.allow-unsigned-executable-memory raw -o - "$BLABASE_NODE_CODESIGN_ENTITLEMENTS" 2>/dev/null || true)" == "true" ]] \
  || blabase_die "Node entitlements must enable com.apple.security.cs.allow-unsigned-executable-memory"
[[ "$(/usr/bin/plutil -extract com.apple.security.automation.apple-events raw -o - "$BLABASE_NODE_CODESIGN_ENTITLEMENTS" 2>/dev/null || true)" == "true" ]] \
  || blabase_die "Node entitlements must enable com.apple.security.automation.apple-events"
[[ "$BLABASE_CODESIGN_ENTITLEMENTS" == /* ]] \
  || blabase_die "BLABASE_CODESIGN_ENTITLEMENTS must be an absolute path"
[[ -f "$BLABASE_CODESIGN_ENTITLEMENTS" ]] \
  || blabase_die "codesign entitlements file does not exist"
/usr/bin/plutil -lint "$BLABASE_CODESIGN_ENTITLEMENTS" >/dev/null
[[ "$(/usr/bin/plutil -extract com.apple.security.automation.apple-events raw -o - "$BLABASE_CODESIGN_ENTITLEMENTS" 2>/dev/null || true)" == "true" ]] \
  || blabase_die "host entitlements must enable com.apple.security.automation.apple-events"

/usr/bin/codesign \
  --force \
  --sign "$IDENTITY" \
  --options runtime \
  --timestamp \
  --entitlements "$BLABASE_NODE_CODESIGN_ENTITLEMENTS" \
  "$NODE_PATH"
/usr/bin/codesign --force --sign "$IDENTITY" --options runtime --timestamp --entitlements "$BLABASE_CODESIGN_ENTITLEMENTS" "$EXECUTABLE_PATH"
/usr/bin/codesign --force --sign "$IDENTITY" --options runtime --timestamp --entitlements "$BLABASE_CODESIGN_ENTITLEMENTS" "$APP_PATH"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$APP_PATH" >/dev/null

APP_ZIP="${BLABASE_BUILD_ROOT}/${APP_NAME}-notarization.zip"
if [[ -e "$APP_ZIP" ]]; then
  blabase_remove_build_child "$APP_ZIP"
fi
/usr/bin/ditto -c -k --keepParent "$APP_PATH" "$APP_ZIP"
/usr/bin/xcrun notarytool submit "$APP_ZIP" --keychain-profile "$PROFILE" --wait
/usr/bin/xcrun stapler staple "$APP_PATH"
/usr/bin/xcrun stapler validate "$APP_PATH"

DMG_PATH="${BLABASE_BUILD_ROOT}/${APP_NAME}.dmg"
BLABASE_APP_PATH="$APP_PATH" \
BLABASE_DMG_PATH="$DMG_PATH" \
BLABASE_DMG_SIGN_IDENTITY="$IDENTITY" \
  "${SCRIPT_DIR}/create-dmg.sh" >/dev/null
/usr/bin/xcrun notarytool submit "$DMG_PATH" --keychain-profile "$PROFILE" --wait
/usr/bin/xcrun stapler staple "$DMG_PATH"
/usr/bin/xcrun stapler validate "$DMG_PATH"
blabase_write_sha256_sidecar "$DMG_PATH"
"${SCRIPT_DIR}/verify-dmg.sh" "$DMG_PATH"

blabase_note "Notarized release DMG: $DMG_PATH"
printf '%s\n' "$DMG_PATH"
