# Фидбэк — по брифу «backend: OpenAPI v1 (версия + публикация) + approval-эндпойнт»

| | |
|---|---|
| **Адресат** | brainer-архитектор |
| **От** | owner-`backend`, 2026-07-13 |
| **По** | `briefs/owner-backend-openapi-v1-publish.md` |
| **Вердикт** | бриф исполним, gate снят — но 2 cross-zone блокера и 2 уточнения до старта |

## Коротко
Предшественник (`owner-kernel-canonical-event-forms`) **закоммичен** (`c30bb85`), запуск-gate снят.
При сверке с реально закоммиченной kernel-поверхностью нашёл 2 блокера, которые упираются в чужую
зону/контракт-семантику → **STOP + эскалация** (канон). §3 (fleet-политика) вопросов не вызывает —
сделаю сам. Пока не коммичу, движок/kernel не трогаю.

## 🛑 Блокер 1 — kernel НЕ экспортирует `PermissionResponsePayload`
Бриф §2/DoD: тело approval-эндпойнта валидировать по kernel `PermissionResponsePayload` — **«не по
локальной копии»**. Модель в kernel ЕСТЬ (`events.py:104`, поля ровно как в брифе:
`decision: approve_once|approve_always|reject`, `scope?`, `feedback?`), **но её нет в публичном
экспорте** пакета: `omnifield_kernel/__init__.py __all__` отдаёт `PermissionRequestPayload`, а
`PermissionResponsePayload`/`PermissionResponseEvent` — **не отдаёт** (живут только в подмодуле
`omnifield_kernel.events`).

→ **Решение architect:** owner-kernel добавляет их в публичный экспорт (чисто, но чужая зона),
**или** мне разрешить `from omnifield_kernel.events import PermissionResponsePayload` в обход
curated-`__all__`? Второе — обход публичного API (POLICY p0 «без костылей»); я за первое.

## 🛑 Блокер 2 — backend уже сломан о закоммиченный kernel (`waiting`-split): scope + семантика
Коммит `c30bb85` **выпилил bare `waiting`** (→ `waiting_approval`/`waiting_input`/`resumable`).
Backend всё ещё говорит старым словарём — **pre-commit СЕЙЧАС красный** (1 тест падает на
`StatusPayload(state="waiting")`), независимо от новой работы:
- `app/channel/hub.py:141` (после `done`, non-stopped) → `self._status = "waiting"`
- `app/channel/hub.py:226` (resume-reconcile после рестарта) → `"waiting"`
- `tests/test_channel.py:103/108/109/244`, `tests/test_api_smoke.py:87`
- (адаптер `claude_code.py:190` эмиттит только `starting`/`running` — ОК; новый required
  `PermissionRequestPayload.call_id` не бьёт — claude-code не эмиттит permission-request в MVP.)

→ **Вопрос А (scope):** миграция backend-проекции статуса на новый словарь — часть ЭТОГО брифа (он
«опирается на новые kernel-формы»), или отдельный migration-бриф? Без неё DoD (pre-commit зелёный)
недостижим.
→ **Вопрос Б (семантика — НЕ угадываю, это контракт):** маппинг проекции. Моё чтение по
kernel-комментам: после `done` (тёрн завершён, ждём юзера) → **`waiting_input`**; resume-после-
рестарта (тёрн не пережил) → **`resumable`**. Подтвердить намеренный маппинг.

## Уточнение 3 — где лежит `openapi.json` артефакт
Бриф §1: класть «рядом с event-schema артефактом, спроси конвенцию в `packages/backend`». Но
event-schema артефакты — в `packages/kernel/schema/` (**чужая зона**, туда backend не кладёт), а в
backend **своей конвенции schema-артефактов НЕТ**. Предлагаю завести backend-локальную, зеркаля
kernel-идиому: `packages/backend/schema/openapi.json` + `app/schema.py`-генератор +
`tests/test_openapi_sync.py` (клон `tests/test_schema_sync.py` из kernel). Подтвердить размещение.

## Уточнение 4 — коммит-очерёдность decouple
Работа по предыдущему брифу (`owner-backend-decouple-api-frontend`: переописание владения в
`sessions.py`/`main.py`/`README`) **готова, но не закоммичена** (gate был красный из-за kernel-churn,
теперь красный из-за Блокера 2). Этот бриф её не откатывать велит. Коммичу decouple отдельным
коммитом первым (как gate позеленеет), потом работу этого брифа? Или decouple забираешь сам.

## Что мне нужно, чтобы сдвинуться
1. **Блокер 1** — где брать `PermissionResponsePayload`: kernel-экспорт (предпочтительно) или
   импорт из подмодуля.
2. **Блокер 2** — (а) миграция статуса в этом брифе или отдельно; (б) подтвердить маппинг
   `done→waiting_input`, `resume→resumable`.
3. **Уточнение 3** — ОК на `packages/backend/schema/openapi.json` + drift-тест-клон.
4. **Уточнение 4** — очерёдность коммита decouple.

С 1–2 (решения architect) и «ОК» на 3–4 — исполняю бриф целиком: версия+публикация OpenAPI,
approval-эндпойнт по kernel-модели, fleet-политика форма.

## Что я НЕ оспариваю
Формы беру из kernel, локально не дублирую — согласен. Runtime approval-forwarding и wiring
fleet-политики отложены — согласен. Спор только про **доступность kernel-модели** (Блокер 1) и
**кто чинит `waiting`-долг и с каким маппингом** (Блокер 2) — этого бриф не покрыл.
