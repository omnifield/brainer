# frontend — control-panel дашборд

Пульт над agent-сессиями: список сессий + **живой чат с сессией** поверх control-канала backend'а.
Solid + Vite. Сессионная поверхность (список / launch / чат) — на **реальном backend** (SSE + REST);
task-board пока на мок-адаптере (параллельный трек).

## Поток данных чата

```
kernel/schema/events.schema.json         ← ЕДИНЫЙ источник домена (contract)
   │  build-шаг (pnpm gen:types)
   ▼
src/api/generated/events.ts              ← сгенерированные TS-типы (ноль ручных доменных типов)
   │
GET /sessions/:id/events (SSE) ──▶ api/backend/stream.ts (EventSource + reconnect)
   │                                    parseEvent → AgentSessionEvent
   ▼
store/chat/reducer.ts (чистый TS)  ── seq-дедуп · reconnect-склейка · пары tool-call/result по
   │                                   call_id · «агент работает» · оптимистичный user-эхо
   ▼  store/chat/useChat.ts (тонкая Solid-обёртка: signal + подписка)
components/chat/*  (props-only, по компоненту на тип события)  ← ChatFeed диспатчит по kind
   ▲
screens/SessionDetail.tsx  ── только композиция (ChatFeed + SendBox), ноль рендера сущностей
```

Отправка: `SendBox → useChat.send` — оптимистичный эхо в ленту + `POST /sessions/:id/messages`.
Backend эмиттит `message{role:user}` в стрим (Ф2), редьюсер при его приходе вытесняет оптимистичный
элемент → после reconnect/replay реплика юзера цела и не дублируется.
Reconnect: нативный `EventSource` сам шлёт `Last-Event-ID` (последний `seq`) → backend отдаёт
пропущенное; редьюсер дедупит по `seq` → без потерь и без дублей.

## Генерация типов (types-from-schema)

Домен (события + handle) генерится из JSON-схемы kernel-пакета — **ручных доменных типов нет**
(канон `types-from-zod`: codegen-типы = разрешённое исключение).

```bash
pnpm gen:types     # регенерит src/api/generated/ из packages/kernel/schema/
```

Гард рассинхрона (DoD): committed-файлы обязаны совпадать со свежей генерацией.
- `build` зовёт `gen-types.mjs --check` → **падает** при разъезде схемы и типов;
- `scripts/schema-sync.test.mjs` — тот же гард юнит-тестом (CI ловит намеренную поломку).

Меняется контракт → правит **kernel** (схема), фронт регенерит. Локальные ручные типы поверх
генерированных — запрещены (STOP + architect).

BFF-транспорт (`SessionSummary`, `LaunchInput`) схемы не имеет — зеркалится вручную в
`api/backend/contract.ts` (граница «менять только через architect», backend README).

## Раскладка (заготовка под HCA-переезд)

Код разложен так, чтобы переезд на `@omnifield/*`-kit был пере-домовкой файлов, не переписыванием:

```
src/
  api/
    generated/      # СГЕНЕРИРОВАННЫЕ типы событий/handle (заготовка Entity-слоя) — не править руками
    backend/        # side-effects control-канала: base(fetch) · sessions(REST) · stream(SSE) · contract
    mock/           # мок-адаптер (только task-board)
  store/
    chat/           # reducer.ts — чистая логика ленты (future Controller, тестируется без DOM)
                    # useChat.ts — тонкая Solid-обёртка (реактивность ON TOP)
    fleet.tsx       # реальные сессии (list/launch/stop + poll) + task-board (mock)
  components/chat/   # props-only компоненты по типам событий (future View/Shape) + ChatFeed (Widget)
  screens/          # композиция (SessionDetail = чат-вью; Fleet; Launch; TaskBoard)
  index.css         # прото-токены (--chat-*) — компоненты ссылаются на переменные, ноль инлайн-стилей
```

## Роутинг и неймспейсы (single-origin через gateway)

Единственный флоу — **nginx gateway на `http://localhost:8080`**; прямые порты (`:3500` фронта,
`:8010` backend) — внутренние target'ы gateway, не UX. Фронт живёт под `base = /brainer/`
(`vite.config.ts`), control-канал зовётся same-origin через `VITE_API_BASE = /api/brainer`
(дефолт в `api/backend/base.ts`). Развод неймспейсов структурен (не Accept-sniffing), одинаков
в dev и prod, потому что оба — за одним gateway:

- `/brainer/*` → фронт (dev: vite `host.docker.internal:3500`; prod: статика SPA-fallback на `index.html`).
- `/api/brainer/*` → backend (gateway `proxy_pass …:8010/brainer/`; см. `gateway-parity-backend.md`).

**SPA-роут сессии живёт под `/s/:id`** (т.е. `/brainer/s/:id`), не под `/sessions/:id` — hard-refresh
клиентского роута не должен уходить в backend-неймспейс. Vite-proxy на `:8000` удалён — это и был
двойной флоу, ловивший parity-грабли.

## Запуск

Только через gateway (dev = prod-флоу). В devbox-контейнере:

```bash
pnpm --filter @omnifield/brainer-frontend dev     # vite :3500 (strictPort), target gateway → :8080/brainer/
```

Открывать **`http://localhost:8080/brainer/`** (не `:3500` напрямую — это внутренний target).
Нужен поднятый gateway (`devopser stacks/gateway`, :8080) и — для реальных сессий/стрима — backend
под `/api/brainer/*`. Env-override: `VITE_API_BASE` целит backend напрямую (не-gateway раскладки).

Тесты: `pnpm --filter @omnifield/brainer-frontend test`. Lint: `... lint`. Build: `... build`
(включает `gen:types --check` + `tsc` + `vite build`; артефакт собран с `base=/brainer/`).

## Границы / эскалация к architect

- Контракт событий/ручек не устраивает → STOP + architect. Типы руками поверх генерированных не пишем.
- `output`/`input` в схеме нетипизированы (arbitrary JSON) → генератор рендерит их открытым
  объектом; вью стрингифаит. Точная типизация — вопрос к kernel-схеме (низкий приоритет).
- Живой e2e со стримом реального агента прогнан архитектором на ревью (haiku-сессия: стрим →
  send → reconnect без дублей → stop). Owner автономно не спавнит биллинговую сессию, правящую
  управляемый репо — это browser-eyeball product owner'а.
