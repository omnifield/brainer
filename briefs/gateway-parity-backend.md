# Brief — backend за gateway: нативный префикс `/brainer/`, порт 8010

| | |
|---|---|
| **Scope** | `backend` (`packages/backend/`) |
| **Owner** | owner-backend (запускает user) |
| **Класс** | parity-фикс (решение user 2026-07-11: dev = prod-флоу через nginx, порты — внутренняя деталь) |
| **Параллельно** | devopser поднимает gateway (`devopser/briefs/gateway-hub-single-origin.md`), frontend — `gateway-parity-frontend.md` |

## Целевая картина

Gateway проксирует `location /api/brainer/ { proxy_pass …:8010/brainer/; }` —
backend отдаёт ВЕСЬ контракт под **нативным префиксом `/brainer/`** (как
svc_learn под `/learn/`, DEPLOY-канон изначально это фиксировал; сейчас роуты
живут в корне — расхождение с контрактом).

## Fix

1. Все роуты — под префикс `/brainer` (APIRouter prefix / include_router —
   реализация на owner'е; НЕ `root_path`-магия ради магии: префикс нативный,
   т.е. `curl :8010/brainer/sessions` работает и без gateway).
2. Порт-контракт: канонический запуск `--port 8010` (registry devopser).
   Хардкодов порта в коде быть не должно (сейчас и нет — проверить).
3. SSE `/brainer/…/stream` — перепроверить за прокси: относительные пути
   в событиях/Last-Event-ID не должны зависеть от префикса.
4. Тесты контракта обновить на префикс; `packages/backend/README.md`
   актуализировать (запуск: `uv run uvicorn app.main:app --host 0.0.0.0
   --port 8010`, URL — через gateway `/api/brainer/`).

## Verify (DoD)

- В контейнере: `curl localhost:8010/brainer/sessions` → 200 `[]`;
  старый корневой путь `/sessions` → 404 (двух поверхностей НЕ держим).
- Через gateway (когда поднят): `http://localhost:8080/api/brainer/sessions` →
  200; SSE-стрим живой сессии течёт без буферизации.
- `pnpm test` (py-матрица) зелёная. Gateway не поднят → STOP после
  кода+тестов, эскалация architect'у.

## Заметки

- Git: commit-only, `fix(backend): ...`; push — architect.
- Работа — в контейнере (`./scripts/devbox-session.sh backend` из WSL-шелла).
