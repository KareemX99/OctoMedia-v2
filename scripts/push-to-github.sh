#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${1:-}"
BRANCH="${2:-$(git branch --show-current)}"

if [[ -z "$BRANCH" ]]; then
  echo "❌ Could not detect branch name. Pass it as second arg."
  exit 1
fi

if [[ -n "$REPO_URL" ]]; then
  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "$REPO_URL"
    echo "✅ Updated origin to: $REPO_URL"
  else
    git remote add origin "$REPO_URL"
    echo "✅ Added origin: $REPO_URL"
  fi
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "❌ origin is not configured."
  echo "Usage: bash scripts/push-to-github.sh <repo_url> [branch]"
  exit 1
fi

echo "➡️ Pushing branch '$BRANCH' to origin..."
git push -u origin "$BRANCH"

echo "🎉 Done. Changes are now on GitHub."
