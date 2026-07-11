#!/usr/bin/env sh
# devbox-session.sh — вход в роль-сессию brainer в devbox-контейнере
# (канон containers-only; замена хост-легаси claude-scope.ps1, Д9).
#
# usage: ./scripts/devbox-session.sh <scope> [cmd...]
#   scope: main | kernel | orchestrator | backend | frontend | content
#   cmd:   команда в контейнере (дефолт — интерактивный claude)
#
# Запускается из WSL2-шелла (Ubuntu): на хосте только docker.
# Флаги = зеркало .devcontainer/devcontainer.json (правишь там — правь тут):
# IDE-пути (VS Code / Gateway) идут через devcontainer.json, CLI-путь — сюда.
set -eu

SCOPE="${1:?usage: devbox-session.sh <scope> [cmd...]}"
shift
NAME=brainer-devbox
IMAGE=ghcr.io/omnifield/devbox:v2026.07.10
# Рабочая копия — от пути самого скрипта (не прибивать к $HOME: место клона свободно).
WORKSPACE="$(cd "$(dirname "$0")/.." && pwd)"
# Родитель рабочей копии монтируется ЦЕЛИКОМ в /workspaces: backend управляет
# соседними репо (weber, …) — им нужно быть видимыми из контейнера тем же слоем.
OMNIFIELD_DIR="$(dirname "$WORKSPACE")"

if ! docker inspect "$NAME" >/dev/null 2>&1; then
  # Порты наружу: devcontainer-CLI forwardPorts не публикует (README devbox) —
  # публикуем явно. 8010 backend + 3500 frontend — внутренние targets gateway
  # (single-origin, DEPLOY.md); в UX — только gateway :8080.
  docker run -d --name "$NAME" \
    -p 8010:8010 -p 3500:3500 \
    -v "$OMNIFIELD_DIR:/workspaces" -w /workspaces/brainer \
    -v omnifield-secrets:/home/vscode/.secrets \
    -v omnifield-pnpm-store:/home/vscode/.local/share/pnpm/store \
    -e CLAUDE_CONFIG_DIR=/home/vscode/.secrets/claude \
    -e NPM_CONFIG_USERCONFIG=/home/vscode/.secrets/npmrc \
    -e GIT_CONFIG_GLOBAL=/home/vscode/.secrets/gitconfig \
    -e GH_CONFIG_DIR=/home/vscode/.secrets/gh \
    -e BRAINER_OTEL_ENDPOINT=http://host.docker.internal:4317 \
    -e 'BRAINER_REPOS=omnifield/brainer=/workspaces/brainer;omnifield/weber=/workspaces/weber;omnifield/chater=/workspaces/chater' \
    --add-host=host.docker.internal:host-gateway \
    "$IMAGE" sleep infinity
  # Fail-fast PAT-проба (класс Д3: без неё pnpm install на свежем volume висит без намёка);
  # зеркало postCreate из devcontainer.json.
  docker exec "$NAME" bash -c \
    'sudo chown -R vscode:vscode /home/vscode/.local/share/pnpm/store /home/vscode/.secrets && (timeout 20 npm whoami --registry=https://npm.pkg.github.com >/dev/null 2>&1 || { echo "✖ нет валидного PAT в $NPM_CONFIG_USERCONFIG (volume omnifield-secrets) — занос кредов: devopser devbox/README §Пост-шаги"; exit 1; }) && pnpm install'
elif [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" != "true" ]; then
  docker start "$NAME" >/dev/null
fi

if [ "$#" -eq 0 ]; then
  set -- claude
fi
# -t только на живом терминале: скрипт зовут и не-интерактивно (оркестратор/CI).
TTY_FLAGS='-i'
[ -t 0 ] && TTY_FLAGS='-it'
exec docker exec $TTY_FLAGS -e "OMNIFIELD_SCOPE=$SCOPE" "$NAME" "$@"
