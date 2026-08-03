#!/bin/bash

set -euo pipefail

BLABASE_MACOS_SCRIPTS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
BLABASE_MACOS_ROOT="$(cd -- "${BLABASE_MACOS_SCRIPTS_DIR}/.." && pwd -P)"
BLABASE_SUGGESTION_ROOT="$(cd -- "${BLABASE_MACOS_ROOT}/../.." && pwd -P)"
BLABASE_BUILD_ROOT="${BLABASE_BUILD_ROOT:-${BLABASE_SUGGESTION_ROOT}/.local/build/macos}"
BLABASE_BUILD_MARKER="${BLABASE_BUILD_ROOT}/.blabase-macos-build-root-v1"

blabase_die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

blabase_note() {
  printf '%s\n' "$*" >&2
}

blabase_require_command() {
  command -v "$1" >/dev/null 2>&1 || blabase_die "required command not found: $1"
}

blabase_assert_macos() {
  [[ "$(uname -s)" == "Darwin" ]] || blabase_die "macOS is required for this packaging step"
}

blabase_canonical_existing_path() {
  /bin/realpath "$1"
}

blabase_canonical_child_path() {
  local parent
  local name
  parent="$(cd -- "$(dirname -- "$1")" && pwd -P)"
  name="$(basename -- "$1")"
  printf '%s/%s\n' "$parent" "$name"
}

blabase_prepare_build_root() {
  local canonical_root

  mkdir -p -- "$BLABASE_BUILD_ROOT"
  canonical_root="$(blabase_canonical_existing_path "$BLABASE_BUILD_ROOT")"
  case "$canonical_root" in
    /|"${HOME:-/nonexistent}"|"$BLABASE_SUGGESTION_ROOT"|"$BLABASE_MACOS_ROOT")
      blabase_die "refusing unsafe build root: $canonical_root"
      ;;
  esac

  if [[ ! -e "$BLABASE_BUILD_MARKER" ]]; then
    if find "$canonical_root" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
      blabase_die "build root is non-empty and has no Blabase safety marker: $canonical_root"
    fi
    : > "$BLABASE_BUILD_MARKER"
  fi
  [[ -f "$BLABASE_BUILD_MARKER" ]] || blabase_die "invalid build-root safety marker"
}

blabase_assert_build_child() {
  local target
  local canonical_root

  blabase_prepare_build_root
  canonical_root="$(blabase_canonical_existing_path "$BLABASE_BUILD_ROOT")"
  mkdir -p -- "$(dirname -- "$1")"
  target="$(blabase_canonical_child_path "$1")"
  case "$target" in
    "$canonical_root"/*) ;;
    *) blabase_die "refusing path outside the validated build root: $target" ;;
  esac
  [[ "$target" != "$canonical_root" ]] || blabase_die "refusing to target the build root itself"
}

blabase_remove_build_child() {
  blabase_assert_build_child "$1"
  /bin/rm -rf -- "$1"
}

blabase_write_sha256_sidecar() {
  local artifact="$1"
  local sidecar="${artifact}.sha256"
  local checksum

  [[ -f "$artifact" ]] || blabase_die "artifact does not exist: $artifact"
  blabase_assert_build_child "$sidecar"
  blabase_require_command shasum
  checksum="$(/usr/bin/shasum -a 256 "$artifact" | /usr/bin/awk '{print $1}')"
  [[ "$checksum" =~ ^[a-f0-9]{64}$ ]] || blabase_die "could not hash artifact"
  printf '%s  %s\n' "$checksum" "$(basename -- "$artifact")" > "$sidecar"
  chmod 0644 "$sidecar"
}

blabase_resolve_node_binary() {
  local candidate
  local resolved
  local version
  local major
  local node_arch
  local host_arch
  local unexpected_dependencies

  if [[ -n "${BLABASE_NODE_BINARY:-}" ]]; then
    candidate="$BLABASE_NODE_BINARY"
    [[ "$candidate" == /* ]] || blabase_die "BLABASE_NODE_BINARY must be an absolute path"
  else
    candidate="$(command -v node 2>/dev/null || true)"
    [[ -n "$candidate" ]] || blabase_die "set BLABASE_NODE_BINARY or place Node.js on PATH"
  fi

  resolved="$(blabase_canonical_existing_path "$candidate" 2>/dev/null || true)"
  [[ -n "$resolved" && -f "$resolved" && -x "$resolved" ]] || blabase_die "Node binary is not an executable file: $candidate"
  [[ ! "$resolved" =~ [[:cntrl:]] ]] || blabase_die "Node binary path contains control characters"

  version="$($resolved -p 'process.versions.node' 2>/dev/null || true)"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]] || blabase_die "could not validate Node.js version"
  major="${version%%.*}"
  (( major >= 20 )) || blabase_die "Node.js 20 or newer is required; found v$version"

  node_arch="$($resolved -p 'process.arch' 2>/dev/null || true)"
  host_arch="$(uname -m)"
  case "$host_arch:$node_arch" in
    arm64:arm64|x86_64:x64) ;;
    *) blabase_die "Node architecture $node_arch does not match build host $host_arch" ;;
  esac

  blabase_require_command otool
  unexpected_dependencies="$(
    otool -L "$resolved" \
      | tail -n +2 \
      | awk '{print $1}' \
      | grep -Ev '^(/usr/lib/|/System/Library/)' \
      || true
  )"
  [[ -z "$unexpected_dependencies" ]] || blabase_die "Node binary has non-system dynamic dependencies: $unexpected_dependencies"

  printf '%s\n' "$resolved"
}

blabase_resolve_node_license() {
  local node_binary="$1"
  local node_dir
  local candidate

  if [[ -n "${BLABASE_NODE_LICENSE:-}" ]]; then
    [[ "$BLABASE_NODE_LICENSE" == /* ]] || blabase_die "BLABASE_NODE_LICENSE must be an absolute path"
    candidate="$(blabase_canonical_existing_path "$BLABASE_NODE_LICENSE" 2>/dev/null || true)"
    [[ -n "$candidate" && -f "$candidate" ]] || blabase_die "Node license file does not exist: $BLABASE_NODE_LICENSE"
    printf '%s\n' "$candidate"
    return
  fi

  node_dir="$(dirname -- "$node_binary")"
  for candidate in "${node_dir}/../LICENSE" "${node_dir}/../../LICENSE"; do
    if [[ -f "$candidate" ]]; then
      blabase_canonical_existing_path "$candidate"
      return
    fi
  done

  blabase_die "Node LICENSE was not found beside the distribution; set BLABASE_NODE_LICENSE explicitly"
}

blabase_validate_runtime_payload() {
  local runtime_root="$1"
  local node_binary="${runtime_root}/bin/node"
  local agent_module="${runtime_root}/launcher-agent.mjs"
  local manifest="${runtime_root}/manifest.json"
  local node_license="${runtime_root}/LICENSE.node"
  local third_party_notices="${runtime_root}/THIRD_PARTY_NOTICES.txt"
  local validator="${BLABASE_MACOS_SCRIPTS_DIR}/validate-runtime.mjs"

  [[ -x "$node_binary" ]] || blabase_die "bundled Node binary is missing or not executable"
  [[ -f "$agent_module" ]] || blabase_die "bundled launcher agent is missing"
  [[ -f "$manifest" ]] || blabase_die "launcher runtime manifest is missing"
  [[ -s "$node_license" ]] || blabase_die "bundled Node license is missing"
  [[ -s "$third_party_notices" ]] || blabase_die "bundled third-party notices are missing"
  [[ -f "$validator" ]] || blabase_die "launcher runtime validator is missing"
  "$node_binary" --check "$agent_module" >/dev/null
  "$node_binary" "$validator" "$runtime_root"
}
