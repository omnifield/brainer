# Brief — Interface MVP (control-panel дашборд)

| | |
|---|---|
| **Scope** | `frontend` (`packages/frontend/`) — ТОЛЬКО фронт |
| **Owner** | owner-frontend (запускает user; refine — brainer-архитектор) |
| **Порядок** | ПЕРВЫЙ билд продукта. Backend/orchestrator — отдельными брифами ПОТОМ |
| **Канон** | `omnifield/commons/standards/agents/shared-policy.md` (читать первым) + `ARCHITECTURE.md` |

## Цель

Тот самый недостающий **интерфейс**: пульт над agent-сессиями (Claude Code owner/architect),
чтобы вести их без жонглирования терминалами. Это боль, ради которой затеян brainer —
поэтому первый билд именно интерфейс.

**Contract-first:** фронт пишется против **заданного API-контракта через мок-адаптер**
(фейк-данные + симуляция активности). Реальный backend наполняет тот же контракт отдельным
брифом. Так UX доводим сразу, не дожидаясь бэка, и swap мок→реал = смена адаптера, не переписывание.

## Экраны MVP

1. **Fleet (список сессий)** — главный. Таблица/карточки всех сессий: `scope · repo · role ·
   status (idle/working/blocked/done/error) · model · uptime · последняя активность`. Это
   ядро «не потерять контроль» — вижу всех разом.
2. **Launch** — форма/кнопка запуска сессии: выбрать `repo` + `scope` (+ опц. бриф) → спавн.
3. **Session detail** (drawer/страница) — по сессии: live-лента активности (телеметрия:
   промпты/тулзы), назначенный бриф, задачи, контролы `stop / restart`.
4. **Task board** — задачи по всем сессиям (`title · session · status: todo/in-progress/blocked/done`),
   канбан или список; интерактивный (создать/сменить статус).

## Контракт (мок-first; backend наполняет позже — тот же shape)

REST + поток для live. Это ЗАДАЁТ форму, а не финальная спека — brainer-архитектор доведёт.

```
GET   /api/sessions            -> [{ id, repo, scope, role, status, model, startedAt,
                                     lastActivity: { tool, at, summary } }]
POST  /api/sessions            { repo, scope, briefPath? }  -> { id }        # спавн claude-scope
GET   /api/sessions/:id        -> { ...session, brief, tasks: [...] }
GET   /api/sessions/:id/stream -> SSE: события активности (tool/prompt/status)
POST  /api/sessions/:id/stop   -> { ok }
POST  /api/sessions/:id/brief  { briefPath | briefText } -> { ok }
GET   /api/tasks               -> [{ id, sessionId, title, status }]
POST  /api/tasks / PATCH /api/tasks/:id
```

**Ключ:** мок-адаптер и реальный API — за ОДНИМ интерфейсом (`ApiClient`); выбор — конфиг/env,
не разветвление в компонентах. Это extract-без-боли шов (канон).

## Стек

Временный-но-чистый SPA, **без бэк-зависимости** (мок-адаптер). Предложение: **Vite + Solid**
(ляжет на будущий фреймворк-фронт), минимальные стили. brainer-архитектор может выбрать иначе —
это не догма, но обоснуй отклонение. Реальный фронт из фреймворка — позже.

## Вне скоупа
Реальный backend/orchestrator, self-hosted agent-провайдеры, entitlement/биллинг, auth,
персистентность. Всё — отдельными брифами/фазами.

## Deliverable
`packages/frontend/` — запускаемый дашборд (`npm run dev`): 4 экрана против мок-данных;
Launch/Stop/assign-brief дёргают контракт (мок отвечает, состояние меняется видимо);
task board интерактивен.

## Verify (DoD)
- `npm run dev` → дашборд рендерится, мок-сессии в списке с (симулированной) live-активностью.
- Все 4 экрана навигабельны; действия бьют в мок-адаптер с видимым эффектом.
- Тесты: компонент-логика (не-UI) unit; контракт-адаптер покрыт. Трейсы — по мере смысла.
- UI **тупой** (читает контракт), бизнес-логики в компонентах нет.

## Заметки
- Резидуалы / неясности контракта → **surface architect'у**, не глуши, не угадывай.
- Git: commit-only, `feat(frontend): ...`; push/merge — architect после ревью.
