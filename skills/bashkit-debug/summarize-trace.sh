#!/usr/bin/env bash
# Summarize a BashKit debug trace file into a compact, agent-readable format.
# Usage: ./summarize-trace.sh /path/to/trace.jsonl
#
# Requires: jq

set -euo pipefail

TRACE_FILE="${1:?Usage: summarize-trace.sh <trace.jsonl>}"

if ! command -v jq &>/dev/null; then
  echo "Error: jq is required. Install with: brew install jq" >&2
  exit 1
fi

if [[ ! -f "$TRACE_FILE" ]]; then
  echo "Error: File not found: $TRACE_FILE" >&2
  exit 1
fi

TOTAL_EVENTS=$(wc -l < "$TRACE_FILE" | tr -d ' ')
ERROR_COUNT=$(grep -c '"event":"error"' "$TRACE_FILE" || true)
END_COUNT=$(grep -c '"event":"end"' "$TRACE_FILE" || true)
START_COUNT=$(grep -c '"event":"start"' "$TRACE_FILE" || true)

# Extract first and last timestamps for total duration
FIRST_TS=$(head -1 "$TRACE_FILE" | jq -r '.ts')
LAST_TS=$(tail -1 "$TRACE_FILE" | jq -r '.ts')
TOTAL_DURATION_MS=$((LAST_TS - FIRST_TS))
TOTAL_DURATION_S=$(echo "scale=1; $TOTAL_DURATION_MS / 1000" | bc)

echo "== BashKit Debug Trace Summary =="
echo "File: $TRACE_FILE"
echo "Events: $TOTAL_EVENTS ($START_COUNT calls, $ERROR_COUNT errors)"
echo "Duration: ${TOTAL_DURATION_S}s"
echo ""

# Per-tool stats
echo "== Tool Stats =="
echo "Tool           | Calls | Errors | Total ms | Avg ms"
echo "---------------|-------|--------|----------|-------"
jq -r 'select(.event == "end") | [.tool, .duration_ms] | @tsv' "$TRACE_FILE" 2>/dev/null | \
  awk -F'\t' '{
    tool=$1; ms=$2;
    calls[tool]++;
    total[tool]+=ms;
  }
  END {
    for (t in calls) {
      avg = total[t] / calls[t];
      printf "%-15s| %5d | %6s | %8d | %6d\n", t, calls[t], "", total[t], avg;
    }
  }' | sort

# Add error counts
if [[ "$ERROR_COUNT" -gt 0 ]]; then
  echo ""
  jq -r 'select(.event == "error") | .tool' "$TRACE_FILE" 2>/dev/null | \
    sort | uniq -c | sort -rn | while read -r count tool; do
      echo "  $tool: $count error(s)"
    done
fi

echo ""

# Timeline: correlated start/end pairs
echo "== Timeline =="
jq -r '
  if .event == "start" then
    "→ \(.id) \(.tool) " + (
      if .tool == "bash" then (.input.command // "?" | tostring | .[0:120])
      elif .tool == "read" then (.input.file_path // "?")
      elif .tool == "write" then (.input.file_path // "?")
      elif .tool == "edit" then (.input.file_path // "?")
      elif .tool == "grep" then "pattern=" + (.input.pattern // "?") + " " + (.input.path // ".")
      elif .tool == "glob" then "pattern=" + (.input.pattern // "?")
      elif .tool == "task" then (.input.description // "?" | .[0:100])
      elif .tool == "web-search" then (.input.query // "?")
      elif .tool == "web-fetch" then (.input.url // "?")
      else (.input | tostring | .[0:80])
      end
    ) + (if .parent then " [parent=\(.parent)]" else "" end)
  elif .event == "end" then
    "← \(.id) \(.duration_ms)ms " + (
      if .summary then (.summary | to_entries | map("\(.key)=\(.value)") | join(" "))
      else ""
      end
    )
  elif .event == "error" then
    "✗ \(.id) \(.tool): \(.error)"
  else empty
  end
' "$TRACE_FILE" 2>/dev/null

# Slow calls (>5s)
echo ""
SLOW=$(jq -r 'select(.event == "end" and .duration_ms > 5000) | "\(.id) \(.tool) \(.duration_ms)ms"' "$TRACE_FILE" 2>/dev/null)
if [[ -n "$SLOW" ]]; then
  echo "== Slow Calls (>5s) =="
  echo "$SLOW"
else
  echo "== No slow calls (>5s) =="
fi

# Errors with context
if [[ "$ERROR_COUNT" -gt 0 ]]; then
  echo ""
  echo "== Errors =="
  jq -r 'select(.event == "error") | "\(.id) \(.tool): \(.error)"' "$TRACE_FILE" 2>/dev/null
fi
