# backend — продуктовый API/BFF (control-channel)

FastAPI-сервер, реализующий **control-канал** над kernel-контрактом (`omnifield-kernel`): сессии
агента живут **headless** (Claude Agent SDK), а не в терминале. Backend спавнит сессию, стримит её
события наружу как SSE, принимает сообщения в живую сессию и воскрешает сессии после рестарта.
Стек — FastAPI + uv, Python 3.12.

Амендит `briefs/backend-mvp.md` по `briefs/control-channel-backend.md` (шаг 2 очереди): терминальный
спавн `claude-scope.ps1` заменён headless-адаптером, Loki-путь для activity убран, interface-mvp
контракт сессий умер (task-board остался).

## Поток

```
POST /sessions ──▶ ChannelHub.launch ──▶ ClaudeCodeAdapter.launch ──▶ ClaudeSDKClient (headless)
                        │                        │
                        │                 receive_messages()  ── SDK-сообщения
                        │                        │  map_sdk_message (§1.4): SDK → contract Event
                        ▼                        ▼
                  SessionChannel ◀──── adapter.stream() (Event с seq в envelope)
                   ├─ ring-буфер (replay по Last-Event-ID, intra-process)
                   ├─ fan-out подписчикам
                   ├─ проекция статуса (для GET /sessions)
                   └─ persist sdk_session_id → kernel SessionStore (sqlite)
                        │
GET /sessions/{id}/events ◀── SSE (id: = seq; события as-is, snake_case, BFF не переводит)
POST /sessions/{id}/messages ──▶ adapter.send() = query() в тот же контекст
POST /sessions/{id}/stop ──▶ adapter.stop() = interrupt (soft) / disconnect (hard)
```

На старте `ChannelHub.resume_all()` поднимает живые handle'ы из реестра; невоскресимую сессию
помечает и отдаёт событием `error`, не падает (В2).

## Запуск

```bash
cd packages/backend
uv sync
uv run uvicorn app.main:app --reload      # :8000
curl http://localhost:8000/sessions
```

Prereq: Claude Code CLI установлен и авторизован (SDK спавнит его headless). Реестр сессий — sqlite
в data-dir brainer'а (`BRAINER_DATA_DIR`, по умолчанию `%LOCALAPPDATA%/omnifield/brainer`), НЕ внутри
управляемого репо.

Тесты: `uv run pytest`. Реальный e2e (не в suite): `uv run python tests/e2e_control_channel.py`.

## Раскладка

```
app/
  main.py            # app-factory; lifespan: hub.resume_all() на старте, shutdown на выходе
  config.py          # Settings (OTEL-эндпоинт, claude_config_dir, buffer) + реестр управляемых репо
  deps.py            # object-graph: SessionStore(kernel) → ClaudeCodeAdapter → ChannelHub
  api/
    sessions.py      # control-канал: GET/POST /sessions, /:id/{events(SSE),messages,stop}
    tasks.py         # task-board (interface-mvp, оставлен) — /api/tasks
  adapters/
    claude_code.py   # ClaudeCodeAdapter(AgentProvider) над claude-agent-sdk + map_sdk_message
  channel/
    hub.py           # ChannelHub + SessionChannel: буфер/fan-out/seq/проекция/resume
  sessions/
    models.py        # только task-board модели (Session-модели удалены)
    tasks.py         # in-memory TaskStore
  lib/trace.py       # perf-логгеры (трейсы DoD) на горячих путях (launch/stream/resume/stop)
```

Контракт (типы событий, операции, handle, sqlite-реестр) живёт в `packages/kernel/` — адаптер
реализует его, SDK-типы границу адаптера НЕ пересекают.

## Контракт наружу

- **События** — kernel envelope as-is (snake_case: `session_id`, `seq`, `ts`, `type`, `payload`).
  9 типов: `message` · `thinking` · `tool-call` · `tool-result` · `status` · `done` · `error` ·
  `limit` · `permission-request` (зарезервирован, claude-code в MVP не эмиттит).
- **Ручки** `launch/stop/events/messages` делят фронт+бэк — **менять только через architect**.
- `POST /sessions {repo, scope, brief?, model?}`. Пре-пресеты: `scope` = zone-identity (идёт в
  `OMNIFIELD_SCOPE` + OTEL + определяет role/permission). `role_for_scope`: `main → architect`
  (permission `trusted`), иначе `owner` (permission `standard`). Персона/tool-списки — с пресетами
  (отдельный трек), пока не задаются.

## Permission-маппинг (наш словарь → SDK)

`readonly → plan` · `standard → acceptEdits` · `trusted → bypassPermissions`. `standard` — массовый
режим owner'ов; основную нагрузку в дальнейшем несут tool-списки из пресетов, git-права дублирует
git-gate-хук (вторая линия обороны, грузится через `setting_sources`).

## seq и границы reconnect

Адаптер владеет `seq` (envelope контракта требует его на выходе `stream()`). Курсор — `seq_base` в
`provider_state` (kernel хранит его verbatim в sqlite — «одно число на сессию в реестре»). На `resume`
база прыгает на `SEQ_BLOCK` (1e9): **одна запись в реестр на эпоху**, `seq` монотонен через рестарт,
без per-event I/O; gap'ы между эпохами безвредны для дедупа и порядка.

- **Reconnect-replay** (`Last-Event-ID` → отдача пропущенного из ring-буфера) — **intra-process**.
- **Монотонность `seq`** — на всю жизнь сессии (через `seq_base` в реестре).
- **История событий НЕ персистится** — delivery-only; история у моста в chater (шаг 3 очереди).

## Телеметрия

- **OTEL-инъекция** остаётся: адаптер выставляет `OTEL_*` + `OTEL_RESOURCE_ATTRIBUTES` перед спавном
  (лаунчеры brainer/writer без OTEL-блока) — метрики (токены/кост) текут на любой сессии.
- **Per-turn usage** (input/output токены, cost) теперь едет в событии `done.usage` канала.
- **Убрано:** Loki-reader (activity) и Prometheus-reader BFF — они обслуживали умерший interface-mvp
  `SessionDetail`. OTEL→Prometheus как субстрат для дашбордов не тронут (вне BFF).

## Границы / эскалация к architect

- `claude-scope.ps1` — ручной fallback юзера + референс env, из репо НЕ выпиливается.
- `current_handle` войдёт в kernel `AgentProvider` неабстрактным дефолтом (owner-kernel, ратифицировано):
  hub зовёт его через `getattr(..., lambda h: h)` — provider-agnostic до kernel-правки.
- SDK отдаёт что-то вне словаря контракта → STOP + architect (расширение словаря — его решение).
- `SessionStore` (kernel) открыт без `check_same_thread=False` → в проде ок (один event-loop-тред),
  но cross-thread (threadpool/мульти-воркер) споткнётся; тесты гоняем в одном event-loop'е
  (`httpx.ASGITransport`). Возможный kernel-хардненинг — низкий приоритет, за architect.
- Форвардинг `permission-request` (В1-(b)), пресеты, мост в chater — вне скоупа этого шага.
