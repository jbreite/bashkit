#!/usr/bin/env bash
# Checks that every AGENTS.md (except root) has a CLAUDE.md symlink.
# Used in CI to catch missing symlinks.

set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
missing=0

find "$root" -name AGENTS.md -not -path "$root/AGENTS.md" | sort | while read -r agents; do
  dir="$(dirname "$agents")"
  link="$dir/CLAUDE.md"
  rel="${link#$root/}"

  if [ ! -L "$link" ]; then
    echo "missing symlink: $rel -> AGENTS.md"
    echo "  run: bun run link-agents"
    missing=1
  fi
done

if [ "$missing" -eq 1 ]; then
  exit 1
fi
