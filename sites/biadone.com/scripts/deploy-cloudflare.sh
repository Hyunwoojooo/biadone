#!/usr/bin/env bash
set -euo pipefail

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
  "$ROOT_DIR/tiv" \
  "$UPLOAD_DIR/"

npx -y wrangler@latest pages deploy "$UPLOAD_DIR" \
  --project-name biadone \
  --branch main
