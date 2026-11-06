#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 || ( $# -eq 1 && "$1" != "--prepare-only" ) ]]; then
  echo "Usage: $0 [--prepare-only]" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The canonical admin URL belongs to the existing biadone Pages project.
# Root script performs allowlisted packaging and requires approval for upload.
exec "$ROOT_DIR/../../scripts/deploy-cloudflare.sh" "$@"
