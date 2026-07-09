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

## Запуск

```bash
pnpm --filter @omnifield/brainer-frontend dev     # :5173, проксирует /sessions + /api → :8000
```

Нужен запущенный backend (`packages/backend`, :8000) для реальных сессий и стрима. В проде фронт
ходит на backend через `VITE_API_BASE` (см. `api/backend/base.ts`), в dev — через Vite-proxy.

Тесты: `pnpm --filter @omnifield/brainer-frontend test`. Lint: `... lint`. Build: `... build`
(включает `gen:types --check` + `tsc` + `vite build`).

## Границы / эскалация к architect

- Контракт событий/ручек не устраивает → STOP + architect. Типы руками поверх генерированных не пишем.
- `output`/`input` в схеме нетипизированы (arbitrary JSON) → генератор рендерит их открытым
  объектом; вью стрингифаит. Точная типизация — вопрос к kernel-схеме (низкий приоритет).
- Живой e2e со стримом реального агента — browser-eyeball product owner'а (спавнит биллинговую
  сессию + правит файлы в управляемом репо; автономно не запускаем).
