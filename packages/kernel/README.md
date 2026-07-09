# kernel — agent-as-provider шов

Provider-агностик **контракт агентной сессии**: словарь событий, операции канала,
персистируемый handle, реестр сессий. Это НАШ ecosystem-native контракт (ARCHITECTURE,
ADR 078-паттерн) — интеграции (`claude-code` и будущие) мапятся **в** него, не наоборот.
Самодостаточный пакет (общий с writer-kernel по идее → переедет в `engines`-репо: вынос = `git mv`).

Источник правды по «что»: `briefs/blueprint-control-channel-presets.md` §1. Здесь — как это
реализовано и где границы.

## Что внутри (`src/omnifield_kernel/`)

| Модуль | Роль |
|---|---|
| `events.py` | Словарь событий (blueprint §1.2): envelope + 9 типов (`message`, `thinking`, `tool-call`, `tool-result`, `status`, `done`, `error`, `limit`, `permission-request`). Дискриминируемый union `Event` + `event_adapter` для валидации wire-формата. |
| `contract.py` | Операции провайдера `AgentProvider` (`launch/send/stream/resume/stop` + неабстрактный `current_handle` — свернуть накопленное in-memory состояние адаптера, напр. поздно узнанный `sdk_session_id`, в персистируемый handle) — эволюция старого `backend` `IAgentProvider`; `AgentSessionHandle`; словарь permission `readonly \| standard \| trusted`; `LaunchRequest`. |
| `registry.py` | `SessionStore` — sqlite-реестр handle'ов (CRUD, resume-on-start). |
| `schema.py` | Генератор JSON-схемы из Pydantic-моделей → артефакты `schema/`. |
| `paths.py` | Где живёт реестр (data-dir brainer'а, НЕ в управляемом репо). |
| `trace.py` | perf-логгер `span()` на горячих путях реестра (DoD «трейсы»). |

## Wire-формат и единый источник типов

Pydantic-модели — **единственный источник** wire-формата. JSON-схема **генерится** из них в
`schema/events.schema.json` + `schema/handle.schema.json` и коммитится как артефакт пакета — это
источник, из которого фронт генерит TypeScript (blueprint deliverable 2, ревью Z3). Типы и схема
**не могут разъехаться**: `tests/test_schema_sync.py` регенерит из моделей и сравнивает с
закоммиченным — дрейф красит билд.

Casing wire-формата — **snake_case**, ровно как в envelope блюпринта (`session_id`, `call_id`,
`is_error`, `input_tokens`, …). Это отдельный ecosystem-native контракт, не legacy camelCase
`interface-mvp` моделей в `backend`.

Регенерация после изменения контракта:

```bash
uv run python -m omnifield_kernel.schema
```

## Реестр сессий

`SessionStore` — sqlite в **data-dir brainer'а** (`BRAINER_DATA_DIR`, иначе per-user вне репо;
см. `paths.py`), не в управляемом репо. Хранит `AgentSessionHandle` + `LaunchRequest` +
таймстемпы; `provider_state` — **opaque JSON адаптера**, kernel внутрь не смотрит. Переживает
рестарт процесса (resume-on-start backend'а). Один writer — backend.

```python
from omnifield_kernel import SessionStore, AgentSessionHandle, LaunchRequest

with SessionStore() as store:              # или SessionStore(path) для теста
    store.put(handle, request)
    survivors = store.all()                # что реплеить на старте backend'а
```

## Граница (жёстко)

- **Ноль знаний о провайдере, ноль deps на вендорские SDK.** Адаптеры (claude-code и будущие)
  живут у потребителя шва (backend). Новый провайдер = новая реализация `AgentProvider`,
  зарегистрированная в backend — **kernel не трогается**.
- Kernel не импортит `backend`/`frontend`/`orchestrator` (extract = `git mv`).
- Границу статически стережёт `tests/test_purity.py` (запрет импортов + запрет вендор-deps);
  реализуемость контракта без kernel-внутренностей доказывает `tests/test_fake_provider.py`
  (fake-провайдер гоняет весь lifecycle launch→stream→send→resume→stop).
- **Событие/операцию/поле контракта добавляет только architect.** Упёрся в нехватку → STOP +
  эскалация, не расширяй сам (у контракта три потребителя: backend, frontend, мост chater).

## Тесты / линт

```bash
uv run pytest -q         # nx: test:py
uv run ruff check .      # nx: lint:py
```

Пакет **пока не член** корневого uv-workspace (корневой `pyproject` комментирует, что
kernel/orchestrator станут members при extract) — тестируется в собственном изолированном
окружении; wiring kernel↔backend — шаг backend-брифа.
