#!/usr/bin/env bash
# 构建并部署到 GitHub Pages（gh-pages 分支），零后端
set -euo pipefail
cd "$(dirname "$0")/.."

# 本机 PATH 默认 node16，Vite 需要 node>=20：优先用 nvm 的 v22
if [ -d "$HOME/.nvm/versions/node" ]; then
  NODE22=$(ls -d "$HOME"/.nvm/versions/node/v2[0-9]* 2>/dev/null | sort -V | tail -1)
  if [ -n "${NODE22:-}" ]; then
    export PATH="$NODE22/bin:$PATH"
  fi
fi
echo "使用 node $(node --version)"

TOKEN_FILE=".secrets/github-token"
[ -f "$TOKEN_FILE" ] || { echo "缺少 $TOKEN_FILE" >&2; exit 1; }
REPO="https://github.com/luojindui/moyu.git"

npm run build >/dev/null
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp -r dist/* "$TMP"/
(
  cd "$TMP"
  git init -q
  git checkout -q -b gh-pages
  git add -A
  git -c user.name=luojindui -c user.email=luojiaru00@qq.com commit -qm "deploy: $(date +%Y-%m-%d\ %H:%M)"
  export GIT_TOKEN=$(tr -d '\n' < "$OLDPWD/$TOKEN_FILE")
  ASK=$(mktemp)
  printf '#!/usr/bin/env bash\ncase "$1" in *Username*) printf "luojindui\\n";; *Password*) printf "%%s\\n" "$GIT_TOKEN";; *) printf "\\n";; esac\n' > "$ASK"
  chmod 700 "$ASK"
  GIT_ASKPASS="$ASK" GIT_TERMINAL_PROMPT=0 git -c credential.helper= push -f "$REPO" gh-pages
  rm -f "$ASK"
)
echo "已部署：https://luojindui.github.io/moyu/ （约 30 秒后生效）"
