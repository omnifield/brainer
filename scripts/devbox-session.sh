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
WORKSPACE="$HOME/omnifield/brainer"

if ! docker inspect "$NAME" >/dev/null 2>&1; then
  # Порты наружу: devcontainer-CLI forwardPorts не публикует (README devbox) —
  # публикуем явно. 8000 backend (uvicorn) + 5173 frontend (vite) — фактические
  # порты кода; 8010/3500 — порт-контракт DEPLOY.md (бриф fix-frontend-port-3500),
  # публикуем оба набора до исполнения контракта.
  docker run -d --name "$NAME" \
    -p 8000:8000 -p 5173:5173 -p 8010:8010 -p 3500:3500 \
    -v "$WORKSPACE:/workspaces/brainer" -w /workspaces/brainer \
    -v omnifield-secrets:/home/vscode/.secrets \
    -v omnifield-pnpm-store:/home/vscode/.local/share/pnpm/store \
    -e CLAUDE_CONFIG_DIR=/home/vscode/.secrets/claude \
    -e NPM_CONFIG_USERCONFIG=/home/vscode/.secrets/npmrc \
    -e GIT_CONFIG_GLOBAL=/home/vscode/.secrets/gitconfig \
    -e GH_CONFIG_DIR=/home/vscode/.secrets/gh \
    -e BRAINER_OTEL_ENDPOINT=http://host.docker.internal:4317 \
    --add-host=host.docker.internal:host-gateway \
    "$IMAGE" sleep infinity
  docker exec "$NAME" bash -c \
    'sudo chown -R vscode:vscode /home/vscode/.local/share/pnpm/store /home/vscode/.secrets && pnpm install'
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
