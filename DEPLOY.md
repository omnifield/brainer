# DEPLOY (dev) — как запускать Omnifield Brainer

## Принципы (канон)

1. **Containers-only** (фундамент user 2026-07-10, devopser
   `briefs/containers-only-and-management.md`): на машине — только Docker и
   файлы. Backend, frontend и claude-сессии (их спавнит backend; claude CLI +
   креды живут в секрет-volume) исполняются в devbox-контейнере. Хост-путь —
   легаси (чекпойнт `container-sessions-default`).
2. **Single-origin, dev = prod** (ADR 068; решение user 2026-07-11): всё
   проксится через nginx-gateway — и в dev тоже. Прямые порты — внутренняя
   деталь (targets gateway, реестр — devopser `registry/ports.md`), из UX и
   доков они убраны. Грабля «в dev на портах ок, в прод через nginx — нет»
   закрыта классом: другого флоу нет.
3. **Одна дверь — хаб**: `http://localhost:8080/` (gateway, стек devopser) —
   индекс всего живого; дашборд brainer — `http://localhost:8080/brainer/`.

## Запуск (dev)

```sh
# из WSL-шелла (Ubuntu), рабочая копия ~/omnifield/brainer
cd ~/omnifield/brainer

# 1. gateway-стек devopser поднят (одна команда их README, живёт постоянно)

# 2. backend (в контейнере)
./scripts/devbox-session.sh main bash -c \
  'cd packages/backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8010'

# 3. frontend (в контейнере)
./scripts/devbox-session.sh main bash -c \
  'cd packages/frontend && pnpm dev --host 0.0.0.0'
```

Открываешь `http://localhost:8080/brainer/` — дашборд на реальном backend'е
(фронт → `/api/brainer/*` → gateway → backend, same-origin; SSE через gateway
без буферизации).

## Контракт-база (frontend ↔ backend)

- Backend отдаёт контракт под **нативным префиксом `/brainer/`**
  (`:8010/brainer/sessions` работает и без gateway — префикс в коде, не в прокси).
- Frontend: `VITE_API_BASE=/api/brainer` (same-origin через gateway),
  vite `base=/brainer/`. Пути контракта — относительно base, owner'ы держат
  base конфигом, не хардкодят.

Parity-брифы исполнены 2026-07-11 (frontend `385ef7b`, backend `0a29b9c`,
gateway-стек devopser поднят) — single-origin флоу живой end-to-end, временные
порты 8000/5173 сняты.

## Prerequisites / observability (опционально для функционального dev)

Observability-стек (Loki/Prometheus/Grafana/OTEL-collector `:4317`) — стек
devopser; без него продукт работает, телеметрия сессий уходит в никуда.
`BRAINER_OTEL_ENDPOINT` уже прокинут в контейнер
(`http://host.docker.internal:4317`, см. `.devcontainer/devcontainer.json`).

## Контейнеризация полным compose (потом, ADR 072)

Отдельная фаза: frontend+backend как контейнеры compose-стека вместо
devbox-процессов. Упирается в решение «где крутятся агенты» — после стаба
local-agents (слой B). Не сейчас.
