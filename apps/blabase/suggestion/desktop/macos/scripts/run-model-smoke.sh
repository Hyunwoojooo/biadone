#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

blabase_assert_macos
blabase_prepare_build_root
blabase_require_command swiftc

SMOKE_ROOT="${BLABASE_BUILD_ROOT}/model-smoke"
SMOKE_EXECUTABLE="${SMOKE_ROOT}/launcher-model-smoke"
MODULE_CACHE="${SMOKE_ROOT}/module-cache"
SWIFTC_ARGS=(-parse-as-library -module-cache-path "$MODULE_CACHE")

if [[ -n "${BLABASE_SWIFT_SDKROOT:-}" ]]; then
  [[ "$BLABASE_SWIFT_SDKROOT" == /* ]] \
    || blabase_die "BLABASE_SWIFT_SDKROOT must be an absolute path"
  [[ -d "$BLABASE_SWIFT_SDKROOT" ]] \
    || blabase_die "Swift SDK root does not exist: $BLABASE_SWIFT_SDKROOT"
  SWIFTC_ARGS+=(
    -sdk "$(blabase_canonical_existing_path "$BLABASE_SWIFT_SDKROOT")"
  )
fi

blabase_remove_build_child "$SMOKE_ROOT"
mkdir -p -- "$MODULE_CACHE"

/usr/bin/swiftc "${SWIFTC_ARGS[@]}" \
  "${BLABASE_MACOS_ROOT}/Sources/BlabaseLauncher/GlobalHotKey.swift" \
  "${BLABASE_MACOS_ROOT}/Sources/BlabaseLauncher/LauncherIPC.swift" \
  "${BLABASE_MACOS_ROOT}/Sources/BlabaseLauncher/LauncherAttentionProjection.swift" \
  "${BLABASE_MACOS_ROOT}/Sources/BlabaseLauncher/LauncherPresentation.swift" \
  "${BLABASE_MACOS_ROOT}/Sources/BlabaseLauncher/LauncherAgentClient.swift" \
  "${BLABASE_MACOS_ROOT}/Sources/BlabaseLauncher/LauncherDataRootPolicy.swift" \
  "${BLABASE_MACOS_ROOT}/Sources/BlabaseLauncher/LauncherSettingsStore.swift" \
  "${BLABASE_MACOS_ROOT}/Sources/BlabaseLauncher/LauncherRuntimeConfiguration.swift" \
  "${BLABASE_MACOS_ROOT}/Sources/BlabaseLauncher/SafeURLPolicy.swift" \
  "${BLABASE_MACOS_ROOT}/Sources/BlabaseLauncher/SupervisorRestartPolicy.swift" \
  "${BLABASE_MACOS_ROOT}/Tests/Smoke/LauncherModelSmoke.swift" \
  -o "$SMOKE_EXECUTABLE"

"$SMOKE_EXECUTABLE"
