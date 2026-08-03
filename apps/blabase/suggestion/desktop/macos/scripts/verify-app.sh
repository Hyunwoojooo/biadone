#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

blabase_assert_macos
blabase_require_command codesign
blabase_require_command plutil

APP_PATH="${1:-${BLABASE_BUILD_ROOT}/${BLABASE_APP_NAME:-Blabase}.app}"
[[ -d "$APP_PATH" ]] || blabase_die "app bundle does not exist: $APP_PATH"
[[ -f "${APP_PATH}/Contents/Info.plist" ]] || blabase_die "app Info.plist is missing"
/usr/bin/plutil -lint "${APP_PATH}/Contents/Info.plist" >/dev/null

EXECUTABLE_NAME="$(/usr/bin/plutil -extract CFBundleExecutable raw -o - "${APP_PATH}/Contents/Info.plist")"
[[ "$EXECUTABLE_NAME" != */* && -n "$EXECUTABLE_NAME" ]] || blabase_die "unsafe CFBundleExecutable"
[[ -x "${APP_PATH}/Contents/MacOS/${EXECUTABLE_NAME}" ]] || blabase_die "app executable is missing"

blabase_validate_runtime_payload "${APP_PATH}/Contents/Resources/runtime"
if [[ "${BLABASE_ALLOW_UNSIGNED:-0}" != "1" ]]; then
  /usr/bin/codesign --verify --deep --strict --verbose=2 "$APP_PATH" >/dev/null
fi

FORBIDDEN_PATH="$(
  find "$APP_PATH" \
    \( -name '.local' -o -name '.env' -o -name '.env.*' -o -name 'credentials.json' -o -name 'tokens.json' -o -name '*.pem' -o -name '*.key' \) \
    -print -quit
)"
[[ -z "$FORBIDDEN_PATH" ]] || blabase_die "private or development artifact was embedded: $FORBIDDEN_PATH"

if find "$APP_PATH" -type l -print -quit | grep -q .; then
  blabase_die "app bundle contains symbolic links; runtime payload must be fixed"
fi

blabase_note "Verified app bundle: $APP_PATH"
