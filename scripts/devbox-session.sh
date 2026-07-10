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
  docker run -d --name "$NAME" \
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
exec docker exec -it -e "OMNIFIELD_SCOPE=$SCOPE" "$NAME" "$@"
