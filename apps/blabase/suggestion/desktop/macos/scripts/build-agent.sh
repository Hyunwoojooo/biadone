#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

blabase_prepare_build_root

AGENT_ENTRY="${BLABASE_SUGGESTION_ROOT}/tools/launcher-agent.ts"
AGENT_BUILD_DIR="${BLABASE_BUILD_ROOT}/agent"
AGENT_OUTPUT="${AGENT_BUILD_DIR}/launcher-agent.mjs"
AGENT_METAFILE="${AGENT_BUILD_DIR}/launcher-agent.meta.json"
AGENT_PROVENANCE="${AGENT_BUILD_DIR}/launcher-code-provenance.json"
ESBUILD_PACKAGE="${BLABASE_SUGGESTION_ROOT}/node_modules/esbuild/package.json"
BUNDLE_SCRIPT="${SCRIPT_DIR}/bundle-agent.mjs"
PROVENANCE_TOOL="${BLABASE_SUGGESTION_ROOT}/tools/print-launcher-code-provenance.ts"
VITE_NODE="${BLABASE_SUGGESTION_ROOT}/node_modules/.bin/vite-node"
NODE_BINARY="$(blabase_resolve_node_binary)"

[[ -f "$AGENT_ENTRY" ]] || blabase_die "launcher agent entry is missing: $AGENT_ENTRY"
[[ -f "$ESBUILD_PACKAGE" ]] || blabase_die "install suggestion dependencies before bundling the launcher agent"
[[ -f "$BUNDLE_SCRIPT" ]] || blabase_die "launcher bundling helper is missing"
[[ -f "$PROVENANCE_TOOL" ]] || blabase_die "launcher provenance helper is missing"
[[ -x "$VITE_NODE" ]] || blabase_die "vite-node is required to capture launcher provenance"

blabase_remove_build_child "$AGENT_BUILD_DIR"
mkdir -p -- "$AGENT_BUILD_DIR"

blabase_note "Bundling launcher JSONL agent with esbuild..."
"$NODE_BINARY" "$BUNDLE_SCRIPT" \
  "$AGENT_ENTRY" \
  "$AGENT_OUTPUT" \
  "$AGENT_METAFILE" \
  "$BLABASE_SUGGESTION_ROOT"

[[ -s "$AGENT_OUTPUT" ]] || blabase_die "esbuild did not produce the launcher agent"
[[ -s "$AGENT_METAFILE" ]] || blabase_die "esbuild did not produce bundle provenance"
"$NODE_BINARY" --check "$AGENT_OUTPUT" >/dev/null

blabase_note "Capturing launcher source provenance..."
"$VITE_NODE" "$PROVENANCE_TOOL" "$BLABASE_SUGGESTION_ROOT" \
  > "$AGENT_PROVENANCE"
[[ -s "$AGENT_PROVENANCE" ]] || blabase_die "launcher code provenance was not produced"
chmod 0600 "$AGENT_PROVENANCE"

blabase_note "Launcher agent: $AGENT_OUTPUT"
printf '%s\n' "$AGENT_OUTPUT"
