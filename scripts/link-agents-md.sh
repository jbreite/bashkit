#!/usr/bin/env bash
# Creates CLAUDE.md symlinks for all AGENTS.md files (except root).
# Re-run whenever you add a new AGENTS.md.

set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

find "$root" -name AGENTS.md -not -path "$root/AGENTS.md" | while read -r agents; do
  dir="$(dirname "$agents")"
  link="$dir/CLAUDE.md"
  if [ -L "$link" ]; then
    echo "exists: ${link#$root/}"
  elif [ -f "$link" ]; then
    echo "skip (real file): ${link#$root/}"
  else
    ln -s AGENTS.md "$link"
    echo "created: ${link#$root/}"
  fi
done
