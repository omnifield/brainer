# Owner-бриф — backend: OpenAPI v1 (версия + публикация) + approval-эндпойнт

| | |
|---|---|
| **Адресат** | owner-`backend` |
| **От** | brainer-архитектор, 2026-07-13 |
| **Спека/основание** | `briefs/contract-api-v1.md` (Решение 1 — версия; A2/A4 — формы). Родитель — `api-first-engine-face.md` v2 |
| **Тип** | поднять API из BFF в **опубликованный версионированный контракт** + поверхность approval-reply |
| **Запуск** | **ПОСЛЕ** `owner-kernel-canonical-event-forms.md` (опирается на новые kernel-формы) |

## Зачем (одной строкой)
DoD родителя: API brainer = **опубликованный версионированный OpenAPI-контракт**, формы каноничны
(харвест). Kernel-слайс уже сделал формы каноничными; здесь — версионируем, публикуем артефакт и даём
контракт-поверхность approval-reply.

## ⛳️ Разрешения ревью (2026-07-13, architect) — по фидбэку owner-`backend`
Owner сверился с закоммиченным kernel (`c30bb85`) и поднял 2 блокера + 2 уточнения. Решения:
- **Блокер 1 (kernel не экспортит `PermissionResponsePayload`):** чинит owner-`kernel` фикс-форвардом
  (добавлен в его бриф, addendum) — импорт из подмодуля в обход `__all__` НЕ делаем (POLICY p0). Твой
  §2 стартует **после** того, как kernel до-экспортит; тогда `from omnifield_kernel import
  PermissionResponsePayload` работает штатно.
- **Блокер 2 (backend держит выпиленный `waiting` → гейт красный): миграция ВХОДИТ в этот бриф** (см.
  новый §0 ниже). Маппинг проекции — **подтверждён** (это контракт-семантика, не угадайка):
  `hub.py:141` `done`(non-stopped) → **`waiting_input`** (тёрн завершён, ждём юзера);
  `hub.py:226` `reconcile_waiting()` (resume после рестарта, тёрн не пережил) → **`resumable`**
  (ровно по докстрингу «no in-flight turn survives a restart»). Метод можно переименовать в
  `reconcile_resumable()` — это backend-внутреннее, на твоё усмотрение.
- **Уточнение 3 (место артефакта): ОК** на `packages/backend/schema/openapi.json` + `app/schema.py`-
  генератор + `tests/test_openapi_sync.py` (клон kernel `test_schema_sync.py`) — зеркалим kernel-идиому
  в СВОЕЙ зоне (в `kernel/schema/` backend не кладёт).
- **Уточнение 4 (коммит-очерёдность):** §0 (миграция `waiting`) зеленит гейт → **коммит 1**;
  `decouple`-работа (готова, не закоммичена) → **коммит 2** (её не откатываем, забираешь ты, не architect);
  §1–§3 этого брифа → **коммит 3+**. Каждый коммит — зелёный pre-commit.

## §0 — Мигрировать backend-проекцию статуса на новый kernel-словарь (Блокер 2)
Перед остальным. `c30bb85` выпилил bare `waiting`:
- `app/channel/hub.py:141` → `"waiting_input"` (было `"waiting"`).
- `app/channel/hub.py:226` (`reconcile_waiting`) → `"resumable"` (было `"waiting"`).
- Тесты: `tests/test_channel.py:103/108/109/244` (ждут новых значений вместо `waiting`),
  `tests/test_api_smoke.py:87` (энум-ассерт → `starting|running|waiting_approval|waiting_input|
  resumable|stopped`).
- Проверь `SessionSummary`/проекцию на предмет других зашитых `"waiting"`-строк.
DoD §0: pre-commit зелёный, статус-проекция говорит новым каноничным словарём.

## Границы (жёстко)
- Правишь **только** `packages/backend/`. Формы событий берёшь из `kernel` (`omnifield_kernel`) —
  **не дублируешь локально**. Нужна новая форма события → это зона `kernel`, **STOP + эскалация**.
- **Форма, не функционал:** реализуешь контракт-поверхность и валидацию входа по kernel-моделям.
  Runtime approval-forwarding (проброс `permission-response` в adapter `can_use_tool` + resume) —
  **отложенный трек**, сюда не лезь. Здесь — эндпойнт принимает, валидирует, кладёт в channel как вход.
- Расцепка «shapes shared with frontend» идёт **отдельным брифом** (`owner-backend-decouple-api-frontend.md`).
  Если он уже прошёл — хорошо; здесь на него не завязывайся, но не откатывай.

## Что сделать

### 1. Версия + публикация OpenAPI (спека, Решение 1)
- `FastAPI(..., version="1.0.0")` — семвер в `info.version`.
- Сгенерить **`openapi.json` артефакт**, закоммитить в репо (место — рядом с event-schema артефактом,
  спроси конвенцию в `packages/backend` / повтори её).
- **Drift-тест**: генерит OpenAPI из приложения и сравнивает с закоммиченным артефактом — падает при
  расхождении. Механика — как у существующего event-schema drift-guard (одна идиома на весь контракт).
- **`/v1/` в путь НЕ вводить** — пути остаются под `/api/brainer/`; версия живёт в `info.version`.
  Path-версия зарезервирована под будущий breaking-major.

### 2. Approval control-эндпойнт (спека A2)
- `POST /sessions/{id}/permissions/{request_id}` — параллель существующему `/messages`.
- Тело = `PermissionResponsePayload` **из kernel** (`decision: approve_once|approve_always|reject`,
  `scope?`, `feedback?`). Валидация входа по kernel-модели, не по локальной копии.
- Кладёт ответ в `ChannelHub` как вход сессии (как `/messages` кладёт текст). **Эмиссия
  `permission-response`-события в стрим и проброс в adapter — отложенный трек**, здесь только приём.
- Отрази в OpenAPI (пункт 1 подхватит автоматически).

### 3. Fleet-конфиг политики аппрува (спека A4) — минимальная форма
- Типизированная конфиг-форма пер-тул `allow | ask | deny` (можно с заделом под паттерн-правила à la
  Continue `ToolPermissionPolicy[]` / OpenCode `Action`-map, но **без реализации применения**).
- Это control-plane (подавление `permission-request`), живёт в конфиге backend, не в kernel-событиях.
  **Wiring в рантайм — отложенный трек.** Здесь — только форма + место в конфиге + валидация.

## DoD
- **§0:** статус-проекция мигрирована на новый словарь (`waiting_input`/`resumable`), гейт зелёный;
  `decouple`-работа закоммичена отдельным коммитом.
- `info.version="1.0.0"`; `openapi.json` артефакт (`packages/backend/schema/`) сгенерён и закоммичен;
  `test_openapi_sync.py` drift-тест зелёный.
- `POST /sessions/{id}/permissions/{request_id}` в OpenAPI, принимает kernel `PermissionResponsePayload`,
  валидирует, кладёт в channel; в стриме формы событий = kernel-канон (локально не дублируются).
- Форма fleet-политики аппрува в конфиге (типизирована, валидируется); применение — отложено.
- pre-commit (test+lint+build) зелёный.

## Связь
- Спека + харвест: `contract-api-v1.md`. Предшественник: `owner-kernel-canonical-event-forms.md`.
- Отложено (НЕ сюда): runtime approval-forwarding, sub-agent/checkpoint события, опционалы O1–O5.
