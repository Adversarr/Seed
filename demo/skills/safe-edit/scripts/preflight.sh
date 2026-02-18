#!/usr/bin/env bash
set -euo pipefail

echo "[safe-edit] preflight: checking workspace state"
test -f package.json
echo "[safe-edit] preflight: ok"

