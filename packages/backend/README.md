# backend — продуктовый API/BFF

FastAPI-сервер над agent-as-provider швом. Реализует контракт `briefs/interface-mvp.md`
§Контракт (тот же shape, что фронт кодит по мок-адаптеру) против **реальных данных**:
`ClaudeCodeProvider` спавнит claude-scope-сессии, телеметрия читается из существующего
OTEL-субстрата (Loki — активность/статус, Prometheus — метрики). Стек — FastAPI + uv,
Python 3.12 (решение architect, `briefs/backend-mvp.md`).

## Запуск

```bash
cd packages/backend
uv sync
uv run uvicorn app.main:app --reload      # :8000
curl http://localhost:8000/api/sessions
```

Prereq для живых данных — поднятый observability-стек (коллектор :4317, Loki :3100,
Prometheus :9090). Без него сервер стартует нормально, телеметрия деградирует в пусто
(сессии из реестра спавна видны, discovered — нет).

Тесты: `uv run pytest`.

## Раскладка

```
app/
  main.py            # app-factory + ASGI entrypoint (create_app), CORS для дашборда
  config.py          # Settings (env-override) + реестр управляемых репо (path+launcher)
  deps.py            # сборка object-graph (Deps); инъектируемо для тестов
  api/               # роуты = контракт (тонкие, логики нет)
    sessions.py      # GET/POST /api/sessions, /:id, /:id/{stream,stop,brief}
    tasks.py         # GET/POST /api/tasks, PATCH /api/tasks/:id
  providers/         # IAgentProvider (БАЗА на расширение) + ClaudeCodeProvider (единственный MVP)
  sessions/          # models (контракт-shape) · registry (in-memory) · tasks · fleet (композиция)
  telemetry/         # loki (активность/статус) · prometheus (метрики) · service (композиция+деградация)
  lib/trace.py       # perf-логгеры (трейсы DoD) на горячих путях
```

`kernel`/`orchestrator` пакеты не трогаем — `providers/`+`sessions/`+`telemetry/` = будущий
extract туда, когда шов устоится / появится второй провайдер.

## Провайдер-шов

`IAgentProvider` (`providers/base.py`): `launch / status / activity / stop` — БАЗА на
расширение (self-hosted / peer — потом). MVP реализует только `ClaudeCodeProvider`:
- **launch** — спавн `claude-scope.ps1 -Scope <scope> "<brief-as-initial-prompt>"` child-процессом
  в cwd репо, в своём консольном окне (Windows `CREATE_NEW_CONSOLE`), PID запоминается.
- **OTEL-инъекция** — backend сам выставляет `OTEL_*` + `OTEL_RESOURCE_ATTRIBUTES=scope,package,repo`
  перед спавном (лаунчеры brainer/writer без OTEL-блока), чтобы телеметрия текла на любой сессии.
- **status/activity** — композиция liveness процесса + телеметрии (для внешнего процесса
  активность наблюдаема только через OTEL; self-hosted-провайдер источал бы их из своего loop'а).
- **stop** — `taskkill /T /F` по PID (дерево powershell→claude).

## Статус-деривация (MVP)

Процесс мёртв → `done`; свежая телеметрия (< `working_threshold_s`) → `working`; иначе `idle`.
`blocked`/`error` — семантические, в MVP НЕ выводятся (граница задокументирована).

## Открытые вопросы → architect (эскалация)

- **Метрики в контракте.** Бэк-бриф требует «метрики из Prometheus в ответе», но фронт-контракт
  (`types.ts`, источник правды) не объявляет поле метрик на `Session`/`SessionDetail`. Реализовано
  **аддитивно**: опциональное `metrics` на `SessionDetail` (non-breaking — фронт игнорит лишние
  ключи, существующие поля не тронуты). **Требуется ратификация контракта + апдейт `types.ts`**
  фронтом. Не менял shared shape «в одну калитку» — surface вверх.
- **Loki line-shape.** Парсер `telemetry/loki.py` best-effort (JSON-record ИЛИ plain line,
  предпочитает `tool_name`). Точный маппинг полей может требовать тюнинга по реальным данным Loki —
  парсеры чистые и покрыты юнитами, тюнинг локальный.
- **repo у discovered-сессий.** `repo`-атрибут ненадёжно доходит лейблом в Loki-стриме →
  discovered-сессии отдаются с `repo="unknown"`. Уточнить конфиг коллектора при необходимости.
