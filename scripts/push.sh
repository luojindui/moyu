#!/usr/bin/env bash
# 用 .secrets/github-token 里的 PAT 以 HTTPS 推送到 GitHub（不把 token 写进 git config / 不进入命令历史）
set -euo pipefail
cd "$(dirname "$0")/.."

TOKEN_FILE=".secrets/github-token"
if [ ! -f "$TOKEN_FILE" ]; then
  echo "缺少 $TOKEN_FILE（一行内容：github_pat_xxx）" >&2
  exit 1
fi
chmod 600 "$TOKEN_FILE" 2>/dev/null || true

REPO="${1:-https://github.com/luojindui/moyu.git}"
BRANCH="${2:-main}"

# GIT_ASKPASS 提供用户名/密码，避免 token 出现在命令行
ASKPASS="$(mktemp)"
trap 'rm -f "$ASKPASS"' EXIT
cat > "$ASKPASS" <<'HELPER'
#!/usr/bin/env bash
case "$1" in
  *Username*) echo "luojindui" ;;
  *Password*) cat "$(dirname "$0")/.token" ;;
  *) echo "" ;;
esac
HELPER
cp "$TOKEN_FILE" "$(dirname "$ASKPASS")/.token"
chmod 700 "$ASKPASS" "$(dirname "$ASKPASS")/.token"

GIT_TERMINAL_PROMPT=0 \
GIT_ASKPASS="$ASKPASS" \
  git push "$REPO" "HEAD:refs/heads/$BRANCH" "$@" 2>&1 | grep -v "^Everything up-to-date$" || true

echo "done."
