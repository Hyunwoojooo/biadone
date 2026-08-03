#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

blabase_assert_macos
blabase_require_command hdiutil
blabase_require_command codesign
blabase_require_command shasum

APP_NAME="${BLABASE_APP_NAME:-Blabase}"
DMG_PATH="${1:-${BLABASE_BUILD_ROOT}/${APP_NAME}-dev-beta.dmg}"
DMG_SHA256_PATH="${DMG_PATH}.sha256"
[[ -f "$DMG_PATH" ]] || blabase_die "DMG does not exist: $DMG_PATH"
[[ -f "$DMG_SHA256_PATH" ]] || blabase_die "DMG SHA-256 sidecar does not exist: $DMG_SHA256_PATH"
EXPECTED_SHA256="$(/usr/bin/awk 'NR == 1 { print $1 }' "$DMG_SHA256_PATH")"
EXPECTED_NAME="$(/usr/bin/awk 'NR == 1 { print $2 }' "$DMG_SHA256_PATH")"
[[ "$EXPECTED_SHA256" =~ ^[a-f0-9]{64}$ ]] || blabase_die "invalid DMG SHA-256 sidecar"
[[ "$EXPECTED_NAME" == "$(basename -- "$DMG_PATH")" ]] || blabase_die "DMG SHA-256 filename mismatch"
ACTUAL_SHA256="$(/usr/bin/shasum -a 256 "$DMG_PATH" | /usr/bin/awk '{print $1}')"
[[ "$ACTUAL_SHA256" == "$EXPECTED_SHA256" ]] || blabase_die "DMG SHA-256 mismatch"
/usr/bin/hdiutil verify "$DMG_PATH" >/dev/null
/usr/bin/codesign --verify --verbose=2 "$DMG_PATH" >/dev/null

MOUNT_DIR="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/blabase-dmg-verify.XXXXXX")"
MOUNTED=0
cleanup_mount() {
  if [[ "$MOUNTED" -eq 1 ]]; then
    /usr/bin/hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
  fi
  /bin/rmdir "$MOUNT_DIR" >/dev/null 2>&1 || true
}
trap cleanup_mount EXIT INT TERM

/usr/bin/hdiutil attach \
  -readonly \
  -nobrowse \
  -mountpoint "$MOUNT_DIR" \
  "$DMG_PATH" >/dev/null
MOUNTED=1

[[ -d "${MOUNT_DIR}/${APP_NAME}.app" ]] || blabase_die "mounted DMG does not contain ${APP_NAME}.app"
[[ -L "${MOUNT_DIR}/Applications" && "$(readlink "${MOUNT_DIR}/Applications")" == "/Applications" ]] \
  || blabase_die "mounted DMG does not contain the Applications shortcut"
"${SCRIPT_DIR}/verify-app.sh" "${MOUNT_DIR}/${APP_NAME}.app"

/usr/bin/hdiutil detach "$MOUNT_DIR" -quiet >/dev/null
MOUNTED=0
/bin/rmdir "$MOUNT_DIR"
trap - EXIT INT TERM

blabase_note "Verified mounted DMG: $DMG_PATH"
