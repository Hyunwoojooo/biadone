#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPLOAD_DIR="$(mktemp -d /tmp/blabase-pages-upload.XXXXXX)"
PAGES_PROJECT="${BLABASE_CF_PAGES_PROJECT:-blabase}"

cleanup() {
  rm -rf "$UPLOAD_DIR"
}
trap cleanup EXIT

rsync -a \
  "$ROOT_DIR/index.html" \
  "$ROOT_DIR/_headers" \
  "$ROOT_DIR/css" \
  "$UPLOAD_DIR/"

npx -y wrangler@latest pages deploy "$UPLOAD_DIR" \
  --project-name "$PAGES_PROJECT" \
  --branch main
