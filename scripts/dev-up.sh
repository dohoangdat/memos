#!/usr/bin/env bash
# Build the frontend and (re)start the local memos-dev container on http://localhost:5231
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# OrbStack's docker CLI, in case its shell integration is not enabled
export PATH="$PATH:/Applications/OrbStack.app/Contents/MacOS/xbin"

(cd web && pnpm install --frozen-lockfile && pnpm release)

MEMOS_VERSION="$(bash scripts/release_version.sh development-version)"
MEMOS_COMMIT="$(git rev-parse HEAD)"
export MEMOS_VERSION MEMOS_COMMIT

docker compose -f compose.dev.yaml up -d --build

# The release build overwrites this tracked placeholder; keep the tree clean.
git checkout -- server/frontend/dist

echo "memos-dev $MEMOS_VERSION -> http://localhost:5231"
