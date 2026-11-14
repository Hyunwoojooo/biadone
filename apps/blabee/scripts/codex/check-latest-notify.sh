#!/bin/zsh
# Daily maintainer check for new Codex releases (audit CDX-7). Runs
# check-latest.mjs and shows a macOS notification when a stable Codex release
# newer than the newest registered one exists, or when the check itself fails.
# Read-only: it never registers, builds or downloads anything.
#
# Installed per machine as a LaunchAgent (see docs/features/CODEX_LATEST_SUPPORT.md).
# Usage: check-latest-notify.sh [path-to-node]

set -u
repo="${0:A:h:h:h}"
node="${1:-node}"
output="$("$node" "$repo/scripts/codex/check-latest.mjs" --fail-on-new 2>&1)"
code=$?
print -r -- "$(date '+%Y-%m-%d %H:%M:%S') exit=$code"
print -r -- "$output"

notify() {
  /usr/bin/osascript - "$1" "$2" <<'OSA'
on run argv
  display notification (item 2 of argv) with title (item 1 of argv)
end run
OSA
}

if (( code == 2 )); then
  versions="$(print -r -- "$output" | awk '/^  [0-9]+\.[0-9]+\.[0-9]+/ {print $1}' | paste -sd ',' - | sed 's/,/, /g')"
  notify "Blabee: 새 Codex 버전 미등록" "${versions} — npm run codex:register 로 등록하세요"
elif (( code != 0 )); then
  notify "Blabee: Codex 버전 확인 실패" "로그: ~/Library/Logs/blabee-codex-check-latest.log"
fi
exit 0
