#!/usr/bin/env sh
# devbox-session.sh — штатный вход в devbox репо одной командой (brief B6 + gateway-network step 4).
#
#   scripts/devbox-session.sh [scope]     # из корня репо; scope по умолчанию — main
#
# Тонкая session-entry (СКЕЛЕТ = чистая инфра): резолвит devbox-контейнер репо → docker exec -it
# с OMNIFIELD_SCOPE (identity-механику — scope-identity/marker/git-gate — заводит сам scope, как
# и раньше), дёргает idempotent `devbox-services up` (A4 safety-net) и запускает claude. Про
# модель/роль НЕ знает — это repo .local-override / агент-харнесс (граница container-sessions-brainer.md).
#
# Канон containers-only: на ХОСТЕ — только docker (node/git может не быть) → launcher завязан ТОЛЬКО
# на `docker`. Контейнер НЕ создаёт (это VS Code «Reopen in Container» через .devcontainer/, либо
# workstation-диспетчер `oa` — follow-up); зато гарантирует gateway-сеть через `docker network
# connect` (single-origin: контейнер в сети omnifield-gateway под alias=имя-репо, наружу — ничего,
# только gateway :8080).
set -eu

SCOPE="${1:-main}"
[ "$#" -gt 0 ] && shift || true   # остаток аргументов уходит в claude
NETWORK="omnifield-gateway"

command -v docker >/dev/null 2>&1 || { echo "✖ нужен docker в PATH"; exit 1; }

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
REPO=$(basename "$REPO_ROOT")

# --- резолвим контейнер репо ----------------------------------------------
# 1) по имени-конвенции (raw-run / workstation-oa); 2) по метке VS Code devcontainer.
CONTAINER="${REPO}-devbox"
if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  CONTAINER=$(docker ps -aq --filter "label=devcontainer.local_folder=$REPO_ROOT" | head -n1 || true)
fi
if [ -z "$CONTAINER" ]; then
  echo "✖ devbox-контейнер для '$REPO' не найден."
  echo "  Подними его одним из путей входа (brief A4):"
  echo "    • VS Code: «Reopen in Container» (.devcontainer/devcontainer.json)"
  echo "    • raw:     docker run … --name ${REPO}-devbox --network $NETWORK --network-alias $REPO … (без -p; см. devbox/README)"
  exit 1
fi

# --- поднять если стоит ----------------------------------------------------
if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)" != "true" ]; then
  echo "[devbox-session] $CONTAINER остановлен — docker start…"
  docker start "$CONTAINER" >/dev/null
fi

# --- гарантируем gateway-сеть + alias (single-origin) ----------------------
docker network inspect "$NETWORK" >/dev/null 2>&1 || {
  echo "[devbox-session] создаю внешнюю docker-сеть $NETWORK (один раз на машину)…"
  docker network create "$NETWORK" >/dev/null
}
# idempotent: если уже подключён — docker ругнётся, глотаем.
docker network connect --alias "$REPO" "$NETWORK" "$CONTAINER" 2>/dev/null || true

# --- safety-net autostart (idempotent no-op если подняты) ------------------
docker exec "$CONTAINER" sh -c 'node scripts/devbox-services.mjs up 2>/dev/null || true' || true

# --- вход агентом ----------------------------------------------------------
echo "[devbox-session] вход: repo=$REPO, scope=$SCOPE"
exec docker exec -it -e "OMNIFIELD_SCOPE=$SCOPE" -w "/workspaces/$REPO" "$CONTAINER" claude "$@"
