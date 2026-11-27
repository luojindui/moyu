#!/usr/bin/env bash
# 用 .secrets/github-token 的 PAT 走 HTTPS 推送；token 不进 git config、不进命令行/输出
set -euo pipefail
cd "$(dirname "$0")/.."

TOKEN_FILE=".secrets/github-token"
[ -f "$TOKEN_FILE" ] || { echo "缺少 $TOKEN_FILE" >&2; exit 1; }
chmod 600 "$TOKEN_FILE" 2>/dev/null || true
URL="${1:-https://github.com/luojindui/moyu.git}"
BRANCH="${2:-main}"

export GIT_TOKEN="$(tr -d '\n' < "$TOKEN_FILE")"
ASKPASS="$(mktemp)"
trap 'rm -f "$ASKPASS"' EXIT
cat > "$ASKPASS" <<'HELPER'
#!/usr/bin/env bash
case "$1" in
  *Username*) printf '%s\n' "luojindui" ;;
  *Password*) printf '%s\n' "$GIT_TOKEN" ;;
  *) printf '\n' ;;
esac
HELPER
chmod 700 "$ASKPASS"

GIT_TERMINAL_PROMPT=0 GIT_ASKPASS="$ASKPASS" \
  git push "$URL" "HEAD:refs/heads/$BRANCH"
