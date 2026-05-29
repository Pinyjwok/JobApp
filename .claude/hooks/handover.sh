#!/bin/bash
# Injects docs/handover.md into session context on startup
HANDOVER="/Users/piny/JobApp/docs/handover.md"
if [[ -f "$HANDOVER" ]]; then
  echo "# Handover Context (docs/handover.md)"
  echo ""
  cat "$HANDOVER"
fi
