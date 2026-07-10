# Brief — frontend за gateway: base `/brainer/`, порт 3500, single-origin как единственный флоу

| | |
|---|---|
| **Scope** | `frontend` (`packages/frontend/`) |
| **Owner** | owner-frontend (запускает user) |
| **Класс** | parity-фикс (решение user 2026-07-11: dev = prod-флоу через nginx, прямые порты уходят из UX) |
| **Поглощает** | `fix-frontend-port-3500.md` (порт-часть вшита сюда, тот бриф закрыт этим) |
| **Параллельно** | devopser поднимает gateway-стек (`devopser/briefs/gateway-hub-single-origin.md`), backend — `gateway-parity-backend.md` |

## Целевая картина

Браузер ходит ТОЛЬКО на `http://localhost:8080` (nginx gateway):
- `/brainer/` → vite dev-сервер (host.docker.internal:3500);
- `/api/brainer/*` → backend.
Прямое открытие `:3500`/`:5173` — не рабочий флоу (порт остаётся внутренним
target'ом gateway).

## Fix (vite.config.ts + api base)

1. `base: "/brainer/"` — ассеты и index за префиксом. Проверить, что роутинг
   экрана (если появится) уважает base.
2. `server: { port: 3500, strictPort: true }` + `preview` так же. `strictPort`
   обязателен: без него занятый порт молча уводит vite на соседний — контракт
   рвётся тихо (канон: громкий отказ).
3. HMR через gateway: websocket идёт на тот же origin `/brainer/` — при
   дефолтах vite обычно достаточно `base`; если HMR не подключится, задать
   `server.hmr = { path, clientPort: 8080 }` осознанно, НЕ отключать HMR.
4. `VITE_API_BASE`: дефолт в dev — `/api/brainer` (same-origin через gateway).
   Vite-прокси `/sessions`+`/api` → `localhost:8000` УДАЛИТЬ — это и есть
   двойной флоу, который ловил parity-грабли. `api/backend/base.ts` не трогать
   (env-шов уже правильный).
5. Актуализировать `packages/frontend/README.md` (запуск/URL — только через
   gateway).

## Verify (DoD)

- Через gateway: `http://localhost:8080/brainer/` — дашборд живой, HMR
  работает, Launch→SessionDetail→SSE-стрим идут через `/api/brainer/*`
  (проверить в Network: ни одного запроса на `:3500`/`:8000` напрямую).
- `pnpm test` / `pnpm build` зелёные; build-артефакт тоже собран с
  `base=/brainer/`.
- Если gateway ещё не поднят devopser'ом — STOP после кода+тестов, e2e-проверку
  отметить блокированной, эскалация architect'у (НЕ городить обходной прокси).

## Заметки

- Git: commit-only, `fix(frontend): ...`; push — architect.
- Работа — в контейнере (`./scripts/devbox-session.sh frontend` из WSL-шелла).
