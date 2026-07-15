# Owner-бриф — kernel: каноничные формы событий (approval-петля + status)

| | |
|---|---|
| **Адресат** | owner-`kernel` |
| **От** | brainer-архитектор, 2026-07-13 |
| **Спека/основание** | `briefs/contract-api-v1.md` (Решение 2 + харвест). Родитель — `api-first-engine-face.md` v2 |
| **Тип** | каноничность **форм** словаря событий. НЕ рантайм, НЕ адаптер, НЕ переписывание движка |
| **Запуск** | независим — можно параллельно с `owner-backend-decouple-api-frontend.md` |

## Зачем (одной строкой)
Харвест Cline/Roo/Continue/Kilo: наша база форм хороша (`call_id`, `message.partial`, `thinking`,
`limit` — уже каноничны), но **approval reply-канал отсутствует** (4/4 плагинов его имеют), а
`status.waiting` теряет «почему ждём». Достраиваем словарь форм до каноничного — **до заморозки v1**.

## Границы (жёстко)
- Правишь **только** `packages/kernel/`. Упрёшься в `backend`/`adapters`/рантайм — **STOP + эскалация**.
- Это **форма, не функционал**: реализуешь схему событий, НЕ эмиссию. Runtime approval-forwarding
  (`can_use_tool` → событие → resume) — **отложенный трек**, сюда не лезь.
- Архитектура движка (провайдер/channel/adapter) — не трогаем. Меняем только словарь `events.py`.
- Смена типов/полей контракта — это архитектурное решение; оно **уже принято этим брифом** (спека
  `contract-api-v1.md`). Отклонение от спеки → STOP + эскалация к architect.

## Что сделать (`packages/kernel/src/omnifield_kernel/events.py`)

### A1. `permission-request` += `call_id` + `risk`
```python
class PermissionRequestPayload(_Strict):
    request_id: str
    call_id: str                       # NEW — гейтим именно эту tool-call (== ToolCallPayload.call_id)
    tool: str
    input: dict[str, Any]
    risk: Literal["read", "write", "execute", "network", "other"] | None = None   # NEW
```
*(4/4 плагинов различают read↔write/execute; 3/4 линкуют аппрув к конкретному call.)*

### A2. Новый тип события `permission-response`
```python
class PermissionResponsePayload(_Strict):
    request_id: str                    # ↔ permission-request
    decision: Literal["approve_once", "approve_always", "reject"]
    scope: Literal["call", "tool", "session"] | None = None   # что запоминает approve_always
    feedback: str | None = None        # reject-с-причиной / стиринг (4/4 несут причину назад)


class PermissionResponseEvent(_Envelope):
    type: Literal["permission-response"] = "permission-response"
    payload: PermissionResponsePayload
```
Добавить в `Event`-union (discriminator `type`) и в `EVENT_TYPES` (станет 10 типов).

### A3. `status.state` — расщепить `waiting`, добавить `resumable`
```python
class StatusPayload(_Strict):
    state: Literal["starting", "running", "waiting_approval", "waiting_input", "resumable", "stopped"]
    detail: str | None = None
```
**Убрать** голый `waiting` → `waiting_approval` (блок на аппруве) / `waiting_input` (блок на вопросе);
добавить `resumable` (сессия прервана, можно возобновить). Осознанный pre-1.0 breaking-cleanup формы —
момент верный, потребитель контракта один. Обнови обновлённый комментарий у поля.

### A4. Документировать auto-approve (без изменения схемы)
В docstring модуля / у `PermissionRequestPayload`: **когда политика авто-аппрувит тул —
`permission-request` НЕ эмитится**, агент идёт прямо в `tool-call`; `permission-response.decision=
"approve_always"` — то, что мутирует политику. Сам объект политики живёт в fleet-API-конфиге (зона
`backend`), не здесь.

## Артефакт + тесты
- Перегенерить JSON Schema артефакт из `events.py` (тем же путём, что уже есть — `schema.py`), обновить
  зафиксированный артефакт, **drift-тест зелёный** (фронт генерит TS из него — форма едет дальше сама).
- Тест round-trip нового `permission-response` через `event_adapter` (validate + dump).
- Тест обновлённого `status`-энума (старый `waiting` больше не валиден; три новых валидны).
- `extra="forbid"` уже держит строгость — новые поля опциональны только там, где помечено выше.

## ⛳️ Addendum (ревью, 2026-07-13) — фикс-форвард после `c30bb85`
Ревью backend-owner нашёл: `c30bb85` добавил `PermissionResponsePayload`/`PermissionResponseEvent` в
`events.py`, но **НЕ в публичный экспорт** — `omnifield_kernel/__init__.py __all__` отдаёт
`PermissionRequest*`, а `PermissionResponse*` нет (живут только в подмодуле). Тип без экспорта =
неполный публичный контракт, потребитель (backend) не может валидировать вход по kernel-модели, не
обходя `__all__`. **Доделать:** добавить `PermissionResponsePayload` и `PermissionResponseEvent` в
`__init__.py` (import + `__all__`), рядом с `PermissionRequest*`. Тривиально, но обязательно — это
исходный DoD этого брифа (новый тип события должен быть usable из публичного API).

## DoD
- A1–A3 в `events.py`, A4 в docstring; `EVENT_TYPES` = 10, union обновлён.
- **`PermissionResponsePayload` + `PermissionResponseEvent` в публичном `__init__.py __all__`** (addendum).
- JSON Schema артефакт перегенерён и закоммичен; drift-тест + новые тесты зелёные.
- Движок-логика (provider/channel/adapter) байт-в-байт как была — тронут только словарь форм.
- pre-commit (test+lint+build) зелёный.

## Связь
- Спека форм + харвест-обоснование: `contract-api-v1.md`. За ним — `backend`-слайс
  (`owner-backend-openapi-v1-publish.md`) опубликует эти формы в OpenAPI.
- Отложено (НЕ сюда): runtime forwarding, sub-agent/checkpoint события, опционалы O1–O5 (см. спеку).
