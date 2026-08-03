#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

APP_PATH="$(${SCRIPT_DIR}/build-app.sh)"
BLABASE_APP_PATH="$APP_PATH" "${SCRIPT_DIR}/create-dmg.sh"
