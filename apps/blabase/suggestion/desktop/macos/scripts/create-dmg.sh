#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

blabase_assert_macos
blabase_prepare_build_root
blabase_require_command hdiutil
blabase_require_command codesign
blabase_require_command ditto

APP_NAME="${BLABASE_APP_NAME:-Blabase}"
APP_PATH="${BLABASE_APP_PATH:-${BLABASE_BUILD_ROOT}/${APP_NAME}.app}"
DMG_PATH="${BLABASE_DMG_PATH:-${BLABASE_BUILD_ROOT}/${APP_NAME}-dev-beta.dmg}"
DMG_SHA256_PATH="${DMG_PATH}.sha256"
DMG_ROOT="${BLABASE_BUILD_ROOT}/dmg-root"
VOLUME_NAME="${BLABASE_DMG_VOLUME_NAME:-Blabase}"
DMG_SIGN_IDENTITY="${BLABASE_DMG_SIGN_IDENTITY:--}"

[[ -d "$APP_PATH" ]] || blabase_die "app bundle does not exist: $APP_PATH"
blabase_assert_build_child "$DMG_PATH"
blabase_remove_build_child "$DMG_ROOT"
mkdir -p -- "$DMG_ROOT"
/usr/bin/ditto "$APP_PATH" "${DMG_ROOT}/${APP_NAME}.app"
ln -s /Applications "${DMG_ROOT}/Applications"

if [[ -e "$DMG_PATH" ]]; then
  blabase_remove_build_child "$DMG_PATH"
fi
if [[ -e "$DMG_SHA256_PATH" ]]; then
  blabase_remove_build_child "$DMG_SHA256_PATH"
fi

blabase_note "Creating compressed DMG..."
/usr/bin/hdiutil create \
  -volname "$VOLUME_NAME" \
  -srcfolder "$DMG_ROOT" \
  -format UDZO \
  -ov \
  "$DMG_PATH" >/dev/null

if [[ "$DMG_SIGN_IDENTITY" == "-" ]]; then
  /usr/bin/codesign --force --sign - --timestamp=none "$DMG_PATH"
else
  /usr/bin/codesign --force --sign "$DMG_SIGN_IDENTITY" --timestamp "$DMG_PATH"
fi
/usr/bin/hdiutil verify "$DMG_PATH" >/dev/null
blabase_write_sha256_sidecar "$DMG_PATH"
"${SCRIPT_DIR}/verify-dmg.sh" "$DMG_PATH"

blabase_note "DMG: $DMG_PATH"
blabase_note "SHA-256: $DMG_SHA256_PATH"
printf '%s\n' "$DMG_PATH"
