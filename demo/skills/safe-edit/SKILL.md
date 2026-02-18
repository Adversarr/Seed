---
name: safe-edit
description: Apply surgical file edits with explicit verification before and after each patch.
---

# Safe Edit

Use this skill when file changes are risky or broad.

## Workflow

1. Reproduce or describe the target behavior before editing.
2. Make the smallest patch that changes behavior.
3. Re-run focused checks after each meaningful edit.
4. Stop if unrelated file changes appear unexpectedly.

## Resources

- `scripts/preflight.sh` runs a quick local hygiene check in the demo workspace.

