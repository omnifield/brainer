# Brief — Backend MVP (server-side: контракт + провайдер + телеметрия)

| | |
|---|---|
| **Scope** | `backend` (`packages/backend/`). `kernel`/`orchestrator` — стабы, наполним extract'ом ПОЗЖЕ (не дробим преждевременно) |
| **Owner** | owner-backend (запускает user; refine — brainer-архитектор) |
| **Порядок** | ВТОРОЙ. Наполняет контракт, который фронт уже пишет по мок-адаптеру (`interface-mvp.md`) |
| **Канон** | `omnifield/commons/standards/agents/shared-policy.md` (первым) + `ARCHITECTURE.md` |

## Цель

Реальный сервер под тот же контракт, что фронт уже кодит по мок-адаптеру: **запуск /
мониторинг / стоп agent-сессий** (провайдер `claude-code`). Swap на фронте мок→реал =
смена адаптера, не переписывание. Данные — **из уже существующего субстрата** (OTEL-стек
оракула), не greenfield.

## Стек — РЕШЕНО (architect)

**FastAPI + uv, Python 3.12.** Обоснование: паттерн бэков оракула (`backend/lang` и др.);
process-spawn + HTTP-запросы к Loki/Prometheus ложатся на python; будущий extract
`orchestrator`/`kernel` уедет в `engines`-репо к остальным python-движкам. Owner стек не выбирает.

## Контракт — ИСТОЧНИК ПРАВДЫ = `interface-mvp.md` §Контракт

Реализуй **ровно** тот shape (`GET/POST /api/sessions`, `/api/sessions/:id[/stream|/stop|/brief]`,
`/api/tasks`). Контракт делят фронт и бэк — **менять только через architect** (обе стороны зависят).
`/stream` = SSE поток событий активности сессии.

## Внутренняя раскладка `packages/backend/`

```
api/          # FastAPI-роуты = контракт (тонкие, без логики)
providers/    # IAgentProvider (интерфейс — БАЗА на расширение) + ClaudeCodeProvider (единственный MVP)
sessions/     # реестр запущенных сессий (in-memory MVP), spawn/stop, маппинг session↔scope
telemetry/    # чтение Loki (активность/статус) + Prometheus (метрики) по scope
```

`kernel`/`orchestrator` пакеты пока НЕ трогаем — `providers/`+`sessions/`+`telemetry/` = будущий
extract в них, когда шов устоится / появится второй провайдер. Внутренние модули = чистая граница.

## Провайдер-шов (agent-as-provider, ADR 078) — БАЗА на расширение

`IAgentProvider`: `launch(repo, scope, brief?) -> session` · `status(session)` ·
`activity(session)` · `stop(session)`. **Реализуй только `ClaudeCodeProvider`.** Router/entitlement
= НЕ строим (один провайдер, dormant). Провайдер `self-hosted` (наш agent-loop) — потом, по этому шву.

## Session control — РЕШЕНО (MVP)

- **launch** = спавн `claude-scope.ps1 -Scope <scope> "<brief-as-initial-prompt>"` как child-процесс
  в cwd целевого репо (`Start-Process`/`subprocess`). Каждый управляемый репо (brainer/writer/capsule)
  имеет свой `claude-scope.ps1`+`scope-resolve` — backend держит **конфиг список репо** (path+имя).
- **брифа передача** = brief идёт **начальным промптом** при спавне (launcher прокидывает ClaudeArgs).
  Инъекция сообщений в живую сессию (headless-драйв) — НЕ MVP (эра self-hosted-провайдера).
- **stop** = kill по PID. Реестр session→PID in-memory.
- **⚠️ OTEL-инъекция (важно):** brainer/writer launcher'ы БЕЗ OTEL-блока (лин). Чтобы монитор
  работал на любой сессии — **backend сам выставляет OTEL-env перед спавном**: `OTEL_*` на коллектор
  `:4317` + `OTEL_RESOURCE_ATTRIBUTES=scope=<scope>,package=<name>,repo=<repo>`. Тогда телеметрия
  течёт независимо от лаунчера репо. (Референс env — оракул `docker/observability/claude-scope.ps1`.)

## Телеметрия — РЕШЕНО (запросы проверены, дашборд «Agent Fleet» их гоняет)

- **Активность / статус** ← **Loki** LogQL: `{scope="<scope>"}` (HTTP `http://localhost:3100/loki/api/v1/query_range`).
  Свежие события (промпты/тулзы) → `lastActivity`; есть события за N сек → `working`, иначе `idle`.
- **Метрики** ← **Prometheus** (`http://localhost:9090`): `claude_code_token_usage_tokens_total`,
  `claude_code_cost_usage_USD_total`, `claude_code_active_time_seconds_total`, `claude_code_session_count_total`
  — по лейблам `scope`/`package`.
- **Активные сессии** ← реестр спавна (наши) + Loki label-values `scope` (что светилось недавно).
- **Prereq:** стек поднят (`cd docker/observability && docker compose up -d`); коллектор :4317, Loki :3100, Prometheus :9090, Grafana :3333.

## Вне скоупа
`self-hosted`/`peer` провайдеры, router/entitlement/биллинг, auth, персистентный store (in-memory ок),
замена Grafana (мы ЧИТАЕМ те же источники + добавляем control, не заменяем дашборд).

## Deliverable
`packages/backend/` — запускаемый FastAPI-сервер, реализующий контракт против **реальных данных**:
launch реально спавнит claude-scope-сессию (с OTEL-инъекцией), она видна в Loki/Prometheus,
`/api/sessions` её отдаёт с активностью/статусом, `/stop` убивает. Фронт (мок) переключается
на этот backend (смена адаптера) и показывает живые сессии.

## Verify (DoD)
- `uv run uvicorn ... ` → сервер поднят; `curl /api/sessions` отдаёт реальные сессии.
- Реальный e2e: launch репо+scope → сессия стартует, за N сек появляется в `/api/sessions` с
  активностью из Loki; `/stop` завершает; метрики из Prometheus в ответе.
- Тесты: провайдер/телеметрия-парсинг unit (Loki/Prom-ответы замокать); контракт-роуты — smoke.
- Трейсы (perf-логгеры) на горячих путях (spawn, telemetry-poll) — по каноничному DoD.

## Заметки
- Контракт-расхождение с фронтом → **STOP + architect** (обе стороны зависят), не меняй в одну калитку.
- Неясности (interactive-vs-headless глубже MVP, cross-repo cwd) → surface, не угадывай.
- Git: commit-only, `feat(backend): ...`; push/merge — architect после ревью.
