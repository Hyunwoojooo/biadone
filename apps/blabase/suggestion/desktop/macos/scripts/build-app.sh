#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

blabase_assert_macos
blabase_prepare_build_root
blabase_require_command swift
blabase_require_command codesign
blabase_require_command ditto
blabase_require_command plutil

APP_NAME="${BLABASE_APP_NAME:-Blabase}"
EXECUTABLE_NAME="${BLABASE_LAUNCHER_EXECUTABLE:-BlabaseLauncher}"
PACKAGE_ROOT="$BLABASE_MACOS_ROOT"
INFO_PLIST="${BLABASE_INFO_PLIST:-${PACKAGE_ROOT}/Resources/Info.plist}"
SWIFT_BUILD_DIR="${BLABASE_BUILD_ROOT}/swift"
APP_PATH="${BLABASE_BUILD_ROOT}/${APP_NAME}.app"
CONTENTS_PATH="${APP_PATH}/Contents"
MACOS_PATH="${CONTENTS_PATH}/MacOS"
RESOURCES_PATH="${CONTENTS_PATH}/Resources"
RUNTIME_PATH="${RESOURCES_PATH}/runtime"
NODE_SOURCE="$(blabase_resolve_node_binary)"
NODE_LICENSE_SOURCE="$(blabase_resolve_node_license "$NODE_SOURCE")"
SWIFT_EXTRA_ARGS=()

if [[ -n "${BLABASE_SWIFT_SDKROOT:-}" ]]; then
  [[ "$BLABASE_SWIFT_SDKROOT" == /* ]] \
    || blabase_die "BLABASE_SWIFT_SDKROOT must be an absolute path"
  [[ -d "$BLABASE_SWIFT_SDKROOT" ]] \
    || blabase_die "Swift SDK root does not exist: $BLABASE_SWIFT_SDKROOT"
  export SDKROOT
  SDKROOT="$(blabase_canonical_existing_path "$BLABASE_SWIFT_SDKROOT")"
fi

if [[ -n "${BLABASE_SWIFT_BUILD_ARGUMENTS_FILE:-}" ]]; then
  [[ "$BLABASE_SWIFT_BUILD_ARGUMENTS_FILE" == /* ]] \
    || blabase_die "BLABASE_SWIFT_BUILD_ARGUMENTS_FILE must be an absolute path"
  [[ -f "$BLABASE_SWIFT_BUILD_ARGUMENTS_FILE" ]] \
    || blabase_die "Swift build arguments file does not exist"
  while IFS= read -r swift_arg || [[ -n "$swift_arg" ]]; do
    [[ -n "$swift_arg" && "$swift_arg" != \#* ]] || continue
    [[ ! "$swift_arg" =~ [[:cntrl:]] ]] \
      || blabase_die "Swift build argument contains a control character"
    case "$swift_arg" in
      --package-path|--package-path=*|--scratch-path|--scratch-path=*|\
      --configuration|--configuration=*|--product|--product=*|--show-bin-path)
        blabase_die "Swift build argument is owned by the packaging script: $swift_arg"
        ;;
    esac
    SWIFT_EXTRA_ARGS+=("$swift_arg")
  done < "$BLABASE_SWIFT_BUILD_ARGUMENTS_FILE"
fi

export CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-${BLABASE_BUILD_ROOT}/clang-module-cache}"
export SWIFTPM_MODULECACHE_OVERRIDE="${SWIFTPM_MODULECACHE_OVERRIDE:-${BLABASE_BUILD_ROOT}/swiftpm-module-cache}"
mkdir -p -- "$CLANG_MODULE_CACHE_PATH" "$SWIFTPM_MODULECACHE_OVERRIDE"

[[ -f "${PACKAGE_ROOT}/Package.swift" ]] || blabase_die "Swift package manifest is missing: ${PACKAGE_ROOT}/Package.swift"
[[ -f "$INFO_PLIST" ]] || blabase_die "Info.plist is missing: $INFO_PLIST"
/usr/bin/plutil -lint "$INFO_PLIST" >/dev/null

SWIFT_BUILD_ARGS=(
  --package-path "$PACKAGE_ROOT"
  --configuration release
  --scratch-path "$SWIFT_BUILD_DIR"
  --product "$EXECUTABLE_NAME"
)
SWIFT_BIN_PATH_ARGS=(
  --package-path "$PACKAGE_ROOT"
  --configuration release
  --scratch-path "$SWIFT_BUILD_DIR"
)
if (( ${#SWIFT_EXTRA_ARGS[@]} > 0 )); then
  SWIFT_BUILD_ARGS+=("${SWIFT_EXTRA_ARGS[@]}")
  SWIFT_BIN_PATH_ARGS+=("${SWIFT_EXTRA_ARGS[@]}")
fi
SWIFT_BIN_PATH_ARGS+=(--show-bin-path)

blabase_note "Building SwiftPM release executable..."
/usr/bin/swift build "${SWIFT_BUILD_ARGS[@]}" 1>&2

SWIFT_BIN_DIR="$(/usr/bin/swift build "${SWIFT_BIN_PATH_ARGS[@]}")"
SWIFT_EXECUTABLE="${SWIFT_BIN_DIR}/${EXECUTABLE_NAME}"
[[ -x "$SWIFT_EXECUTABLE" ]] || blabase_die "Swift executable was not produced: $SWIFT_EXECUTABLE"

AGENT_OUTPUT="$(${SCRIPT_DIR}/build-agent.sh)"
AGENT_METAFILE="$(dirname -- "$AGENT_OUTPUT")/launcher-agent.meta.json"
AGENT_PROVENANCE="$(dirname -- "$AGENT_OUTPUT")/launcher-code-provenance.json"
THIRD_PARTY_NOTICES="$(dirname -- "$AGENT_OUTPUT")/THIRD_PARTY_NOTICES.txt"
[[ -s "$AGENT_PROVENANCE" ]] || blabase_die "launcher code provenance is missing"
"$NODE_SOURCE" "${SCRIPT_DIR}/collect-notices.mjs" \
  "$AGENT_METAFILE" \
  "$BLABASE_SUGGESTION_ROOT" \
  "$THIRD_PARTY_NOTICES"

blabase_remove_build_child "$APP_PATH"
mkdir -p -- "$MACOS_PATH" "${RUNTIME_PATH}/bin"
/usr/bin/ditto "$SWIFT_EXECUTABLE" "${MACOS_PATH}/${EXECUTABLE_NAME}"
/usr/bin/ditto "$INFO_PLIST" "${CONTENTS_PATH}/Info.plist"
/usr/bin/ditto "$NODE_SOURCE" "${RUNTIME_PATH}/bin/node"
/usr/bin/ditto "$NODE_LICENSE_SOURCE" "${RUNTIME_PATH}/LICENSE.node"
/usr/bin/ditto "$THIRD_PARTY_NOTICES" "${RUNTIME_PATH}/THIRD_PARTY_NOTICES.txt"
/usr/bin/ditto "$AGENT_OUTPUT" "${RUNTIME_PATH}/launcher-agent.mjs"
chmod 0755 "${MACOS_PATH}/${EXECUTABLE_NAME}" "${RUNTIME_PATH}/bin/node"
chmod 0644 \
  "${CONTENTS_PATH}/Info.plist" \
  "${RUNTIME_PATH}/launcher-agent.mjs" \
  "${RUNTIME_PATH}/LICENSE.node" \
  "${RUNTIME_PATH}/THIRD_PARTY_NOTICES.txt"

while IFS= read -r resource_bundle; do
  [[ -n "$resource_bundle" ]] || continue
  /usr/bin/ditto "$resource_bundle" "${RESOURCES_PATH}/$(basename -- "$resource_bundle")"
done < <(find "$SWIFT_BIN_DIR" -mindepth 1 -maxdepth 1 -type d -name '*.bundle' -print | sort)

ICON_NAME="$(/usr/bin/plutil -extract CFBundleIconFile raw -o - "$INFO_PLIST" 2>/dev/null || true)"
if [[ -n "$ICON_NAME" ]]; then
  case "$ICON_NAME" in
    *.icns) ;;
    *) ICON_NAME="${ICON_NAME}.icns" ;;
  esac
  [[ "$ICON_NAME" != */* && "$ICON_NAME" != .* ]] || blabase_die "unsafe CFBundleIconFile value"
  [[ -f "${PACKAGE_ROOT}/Resources/${ICON_NAME}" ]] || blabase_die "Info.plist icon is missing: ${PACKAGE_ROOT}/Resources/${ICON_NAME}"
  /usr/bin/ditto "${PACKAGE_ROOT}/Resources/${ICON_NAME}" "${RESOURCES_PATH}/${ICON_NAME}"
fi

/usr/bin/plutil -create xml1 "${RUNTIME_PATH}/manifest.json"
/usr/bin/plutil -insert contract -string "blabase-launcher-runtime-manifest-v1" "${RUNTIME_PATH}/manifest.json"
/usr/bin/plutil -insert codeRootStrategy -string "manifest_parent_directory" "${RUNTIME_PATH}/manifest.json"
/usr/bin/plutil -insert nodeRelativePath -string "bin/node" "${RUNTIME_PATH}/manifest.json"
/usr/bin/plutil -insert agentRelativePath -string "launcher-agent.mjs" "${RUNTIME_PATH}/manifest.json"
/usr/bin/plutil -insert nodeLicenseRelativePath -string "LICENSE.node" "${RUNTIME_PATH}/manifest.json"
/usr/bin/plutil -insert thirdPartyNoticesRelativePath -string "THIRD_PARTY_NOTICES.txt" "${RUNTIME_PATH}/manifest.json"
/usr/bin/plutil -insert requiredArguments -json '["--data-root", "<absolute-data-root>"]' "${RUNTIME_PATH}/manifest.json"
/usr/bin/plutil -insert defaultDataRootRelativeToHome -string "Library/Application Support/Blabase" "${RUNTIME_PATH}/manifest.json"
/usr/bin/plutil -insert dataRootOverrideEnvironment -string "BLABASE_LAUNCHER_DATA_ROOT" "${RUNTIME_PATH}/manifest.json"
/usr/bin/plutil -insert defaultSourceMode -string "managed" "${RUNTIME_PATH}/manifest.json"
/usr/bin/plutil -insert dataRootOverrideSourceMode -string "read_only" "${RUNTIME_PATH}/manifest.json"
/usr/bin/plutil -insert minimumNodeMajor -integer 20 "${RUNTIME_PATH}/manifest.json"
CODE_STATE="$(/usr/bin/plutil -extract codeState raw -o - "$AGENT_PROVENANCE")"
case "$CODE_STATE" in
  clean_commit|declared_commit)
    CODE_COMMIT_SHA="$(/usr/bin/plutil -extract codeCommitSha raw -o - "$AGENT_PROVENANCE")"
    [[ "$CODE_COMMIT_SHA" =~ ^[a-f0-9]{40}$ ]] \
      || blabase_die "invalid launcher commit provenance"
    /usr/bin/plutil -insert codeState -string "$CODE_STATE" "${RUNTIME_PATH}/manifest.json"
    /usr/bin/plutil -insert codeCommitSha -string "$CODE_COMMIT_SHA" "${RUNTIME_PATH}/manifest.json"
    ;;
  dirty_worktree)
    CODE_FINGERPRINT_SHA256="$(/usr/bin/plutil -extract codeFingerprintSha256 raw -o - "$AGENT_PROVENANCE")"
    [[ "$CODE_FINGERPRINT_SHA256" =~ ^[a-f0-9]{64}$ ]] \
      || blabase_die "invalid launcher fingerprint provenance"
    /usr/bin/plutil -insert codeState -string "$CODE_STATE" "${RUNTIME_PATH}/manifest.json"
    /usr/bin/plutil -insert codeFingerprintSha256 -string "$CODE_FINGERPRINT_SHA256" "${RUNTIME_PATH}/manifest.json"
    ;;
  *) blabase_die "launcher code provenance is unavailable" ;;
esac
AGENT_SHA256="$(
  "$NODE_SOURCE" -e \
    'const {createHash}=require("node:crypto");const {readFileSync}=require("node:fs");process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"));' \
    "$AGENT_OUTPUT"
)"
[[ "$AGENT_SHA256" =~ ^[a-f0-9]{64}$ ]] || blabase_die "could not hash launcher agent"
/usr/bin/plutil -insert agentSha256 -string "$AGENT_SHA256" "${RUNTIME_PATH}/manifest.json"
/usr/bin/plutil -convert json "${RUNTIME_PATH}/manifest.json"
chmod 0644 "${RUNTIME_PATH}/manifest.json"

PLIST_EXECUTABLE="$(/usr/bin/plutil -extract CFBundleExecutable raw -o - "${CONTENTS_PATH}/Info.plist")"
[[ "$PLIST_EXECUTABLE" == "$EXECUTABLE_NAME" ]] || blabase_die "Info.plist CFBundleExecutable is $PLIST_EXECUTABLE, expected $EXECUTABLE_NAME"
[[ "$(/usr/bin/plutil -extract CFBundlePackageType raw -o - "${CONTENTS_PATH}/Info.plist")" == "APPL" ]] \
  || blabase_die "Info.plist CFBundlePackageType must be APPL"

case "${BLABASE_CODESIGN_MODE:-adhoc}" in
  adhoc)
    blabase_note "Applying ad-hoc signatures..."
    /usr/bin/codesign --force --sign - --timestamp=none "${RUNTIME_PATH}/bin/node"
    /usr/bin/codesign --force --sign - --timestamp=none "${MACOS_PATH}/${EXECUTABLE_NAME}"
    /usr/bin/codesign --force --sign - --timestamp=none "$APP_PATH"
    ;;
  none) ;;
  *) blabase_die "BLABASE_CODESIGN_MODE must be adhoc or none" ;;
esac

if [[ "${BLABASE_CODESIGN_MODE:-adhoc}" == "none" ]]; then
  BLABASE_ALLOW_UNSIGNED=1 "${SCRIPT_DIR}/verify-app.sh" "$APP_PATH"
else
  "${SCRIPT_DIR}/verify-app.sh" "$APP_PATH"
fi
blabase_note "App bundle: $APP_PATH"
printf '%s\n' "$APP_PATH"
