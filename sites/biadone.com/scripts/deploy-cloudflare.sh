#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 || ( $# -eq 1 && "$1" != "--prepare-only" ) ]]; then
  echo "Usage: $0 [--prepare-only]" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPLOAD_DIR="$(mktemp -d /tmp/biadone-pages-upload.XXXXXX)"

cleanup() {
  rm -rf "$UPLOAD_DIR"
}
trap cleanup EXIT

rsync -a \
  "$ROOT_DIR/index.html" \
  "$ROOT_DIR/css" \
  "$ROOT_DIR/js" \
  "$ROOT_DIR/blabase" \
  "$ROOT_DIR/blabee" \
  "$ROOT_DIR/_headers" \
  "$ROOT_DIR/_redirects" \
  "$UPLOAD_DIR/"

if [[ "${1:-}" == "--prepare-only" ]]; then
  trap - EXIT
  echo "$UPLOAD_DIR"
  exit 0
fi

npx -y wrangler@latest pages deploy "$UPLOAD_DIR" \
  --project-name biadone \
  --branch main
