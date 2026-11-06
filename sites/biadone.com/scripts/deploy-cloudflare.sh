#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 || ( $# -eq 1 && "$1" != "--prepare-only" ) ]]; then
  echo "Usage: $0 [--prepare-only]" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPLOAD_DIR="$(node "$ROOT_DIR/tools/blabee-dashboard/scripts/prepare-site.mjs")"

cleanup() {
  rm -rf "$UPLOAD_DIR"
}
trap cleanup EXIT

if [[ "${1:-}" == "--prepare-only" ]]; then
  trap - EXIT
  echo "$UPLOAD_DIR"
  exit 0
fi

cd "$UPLOAD_DIR"
npx -y wrangler@4.151.1 pages deploy public \
  --project-name biadone \
  --branch main
