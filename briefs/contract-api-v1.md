# Контракт-бриф — brainer API v1: версия + каноничные формы (второй трек)

| | |
|---|---|
| **Адресат** | owner-`kernel` (слайс A) + owner-`backend` (слайс B); координация — architect |
| **От** | brainer-архитектор, 2026-07-13 |
| **Родитель** | `briefs/api-first-engine-face.md` v2 (DoD: опубликованный версионированный OpenAPI + каноничные формы) |
| **Основание форм** | харвест Cline / Roo / Continue / Kilo (см. §«Харвест» ниже) — плагины как **референсы**, не клиенты |

## Граница — РЕШЕНО (brainer-архитектор, по делегированию)
Каноничные формы живут в `kernel/events.py` (single-source, 9 типов событий). Значит «каноничность
форм» = правки `kernel/events.py`. **Решение:** это заказанная «каноничность форм», не запрещённое
«переписывание движка» — архитектура провайдера/рантайма/адаптеров не трогается; docstring `events.py`
прямо относит изменение типов событий к решению architect. Концепт workspace-архитектора этим не
разворачивается (движок как провайдер-агностик шов остаётся), только уточняется словарь форм. Последнее
слово по этой зоне — за brainer-архитектором (делегировано). Отревьюим с workspace-архитектором постфактум.

## Что это НЕ (держим честность к брифу «форма, не функционал»)
Этот бриф **канонизирует и публикует ФОРМЫ** (схема + версия + расцепка). Он **НЕ реализует рантайм**:
полный approval-forwarding-цикл (`can_use_tool` → событие → ответ → resume), sub-agent lifecycle-эмиссия,
checkpoint-механика — это **отдельные функциональные треки** (см. §«Отложено»). Здесь — только форма,
которую эти треки потом наполнят. Часть форм уже «reserved» в `events.py` — мы их достраиваем до
каноничных, а не изобретаем функционал.

---

## Решение 1 — версионирование (открытый вопрос из v2, закрываю как architect)
**Идиома — как уже сделано для event-schema** (`events.py` → JSON Schema артефакт + drift-тест, фронт
генерит TS). Переносим ту же механику на весь API:
- `FastAPI(... version="1.0.0")` — **семвер в `info.version`** OpenAPI.
- **Закоммитить сгенерированный `openapi.json` как артефакт** + **drift-тест** (падает, если код разошёлся
  с артефактом) — ровно как event-schema drift-guard. Это и есть «опубликован и версионирован»: любое
  изменение контракта громкое и ревьюится.
- **`/v1/` в путь НЕ вводим сейчас.** Пути уже под `/api/brainer/`; префикс-версия — премьючур-churn при
  одном потребителе. Резервируем path-версию под будущий breaking-major (тогда `/v2`). Мажор в семвере
  ведём с этого дня.

*Обоснование:* совпадает с существующим паттерном репо (POLICY — без костылей, одна механика на весь
контракт), а не вводит второй способ версионировать.

## Решение 2 — каноничные формы (дельта к `events.py`), с обоснованием из харвеста
Что харвест **подтвердил как уже каноничное — НЕ трогаем:** `tool-call.call_id ↔ tool-result.call_id`
(4/4), `message.partial` (4/4, семейство Cline), `thinking` (4/4), `limit{scope,resets_at}` (2–3/4).
Наша база хороша. Дельта — только там, где 3–4 независимых семейства сходятся, а у нас дыра:

### A1. `permission-request` += `call_id` и `risk` (харвест M2 — 4/4 risk-split, 3/4 call-link)
```python
class PermissionRequestPayload(_Strict):
    request_id: str
    call_id: str                       # NEW — та самая tool-call, что гейтим (== ToolCallPayload.call_id)
    tool: str
    input: dict[str, Any]
    risk: Literal["read","write","execute","network","other"] | None = None   # NEW
```
*Почему:* все 4 (Cline `readFiles/editFiles`, Roo `alwaysAllowReadOnly/Write/Execute`, Continue
read=allow / Edit·Write·Bash=ask, OpenCode per-tool `Action`) различают read (авто-аппрув) от
write/execute. `call_id` даёт лицу отрисовать pending-аппрув прямо на строке tool-call (OpenCode
`tool:{callID}`, Continue `toolCallId`).

### A2. Новый тип события `permission-response` (харвест M1 — 4/4 имеют reply-канал; у нас — ноль)
```python
class PermissionResponsePayload(_Strict):
    request_id: str                    # ↔ permission-request
    decision: Literal["approve_once","approve_always","reject"]
    scope: Literal["call","tool","session"] | None = None   # что запоминает approve_always
    feedback: str | None = None        # reject-с-причиной / стиринг — 4/4 несут причину назад
# + PermissionResponseEvent(type="permission-response"), в Event-union и EVENT_TYPES
```
*Почему:* каноничные глаголы ответа `{approve_once | approve_always | reject}` + **reject-с-фидбеком**
(отказ ≠ тупик: Cline `messageResponse`, Roo `objectResponse`, OpenCode `CorrectedError`, Continue
стиринг — 4/4). Эмитим resolution как **событие** (а не только принимаем на вход), чтобы каждый
потребитель стрима видел развязку (так делают Cline и OpenCode).

### A3. `status.state` — расщепить `waiting`, добавить `resumable` (харвест M4 — 3/4)
```python
state: Literal["starting","running","waiting_approval","waiting_input","resumable","stopped"]
```
*Почему:* 3/4 (Cline `TurnPhase`, Roo `TaskStatus`, OpenCode) отделяют «блокирован на аппруве» от
«блокирован на вопросе» и имеют явный `resumable`. Наш общий `waiting` эту разницу теряет → лицо не
знает, рисовать Approve / Answer / Resume. **Убираем `waiting`, вводим три.** Это осознанный
pre-1.0 breaking-cleanup формы — **делаем ДО заморозки v1**, потребитель один (дашборд), момент верный.

### A4. `approve_always` = запись в control-plane политику (харвест M3 — 4/4), НЕ событие на тул
*Не добавляем* пер-тул boolean-события. Документируем: **когда политика авто-аппрувит тул —
`permission-request` НЕ эмитится** (агент идёт прямо в `tool-call`); `permission-response.decision=
"approve_always"` со `scope` — это то, что мутирует политику. Сам объект политики (пер-тул
`allow|ask|deny` + опц. паттерн-правила, à la Continue `ToolPermissionPolicy[]` / OpenCode `Action`-map)
живёт в **fleet-API-конфиге** (слайс B), не в kernel-контракте.

## Отложено (НЕ в этом DoD — функционал/отдельные треки, назвать в беклоге)
- **Runtime approval-forwarding** — сам `can_use_tool`-цикл через adapter/channel. Формы (A1–A4) его
  ждут; эмиссия — отдельный трек.
- **Sub-agent / subtask события** (харвест M5 — 3/4, и это **ядро тезиса brainer** «иерархия агентов»).
  Заслуживает своего дизайн-прохода, ключить по `session_id` (parent/child), не bespoke-стек.
- **Checkpoint / snapshot / undo** (M6 — 3/4).
- **Опционал:** cache-токены/context-window в `done.usage` (O1), структурный retry (O2), reserved
  error-codes для context-length / mistake-loop (O3), context-compaction событие (O4), структурный
  file-diff в tool-result (O5). Всё — потом, по потребности лица.
- **Не принимать:** замену `partial`-флага на part-delta протокол — наша декомпозиция по `type` уже даёт
  то же, что OpenCode `Part`-union; смена идиомы = churn без выгоды.

---

## Owner-нарезка (эта спека → два launchable owner-брифа)
Эта спека — **основание форм и решений**, не сессия. Реализация нарезана на два самодостаточных
owner-брифа (каждый цитирует эту спеку за «почему»):
- **Слайс A → `owner-kernel-canonical-event-forms.md`** (zone `kernel`) — формы A1–A3 в `events.py` + A4
  в docstring, JSON Schema артефакт + drift-тест.
- **Слайс B → `owner-backend-openapi-v1-publish.md`** (zone `backend`, ПОСЛЕ A) — approval control-эндпойнт,
  OpenAPI версия+публикация артефакта, fleet-конфиг политики (форма).

## Порядок и связь
- **Сначала** `owner-backend-decouple-api-frontend.md` (расцепка, независим) — можно параллельно.
- **Слайс A → слайс B** (B опирается на новые kernel-формы).
- Основание форм: харвест (ниже). Контекст решения: `feedback-api-first-engine-face.md`.

## Харвест (краткая выжимка, полное — в сессии architect)
Плагины кластеризуются в **3 независимых семейства форм**: A=`ClineMessage` (Cline+Roo), B=Continue
(`ChatMessage`+`ToolCallState`), C=OpenCode/SST (Kilo — **съехал с Roo/Cline**, независим). Сильнейшие
конвергенции (4/4 независимо): (1) call-id корреляция тул-колла↔результата — **у нас уже есть ✅**;
(2) approval = пер-тул политика с read-vs-write risk-split; (3) reply-глаголы {approve-once /
approve-always / reject} + reject-с-фидбеком; (4) авто-аппрув = control-plane, подавляет запрос;
(5) thinking — отдельный типизированный канал ✅. 3/4: turn/session граница с `resumable`;
sub-agent lifecycle; checkpoints; context-compaction. Наибольшая наша дыра — **approval reply-канал
(A2) и risk/call-link (A1)**; отсюда приоритет дельты.
