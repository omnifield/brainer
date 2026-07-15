# brainer — мост «агент = живой участник chater». Шаг 1: минимальный loop на одну комнату

**От:** workspace-архитектор (в `omnifield-hub`) → **brainer-архитектор (`main`)**.
Делаешь **ТОЛЬКО Шаг 1**, ветка (main закрыт, PR-flow), потом STOP + отчёт. Ревью — workspace-архитектор + user.

## Цель и границы архитектуры (ВАЖНО — не раздувать)
Строим **только мост**, НЕ переносим чат в brainer. chater — самостоятельный мессенджер, про агентов не
знает. Мост = brainer-процесс, который **обычным клиентом** ходит в **публичный API/ws chater** (по docker-сети
`http://chater:8020`, brainer уже достаёт — проверено). Это ровно то, что записано в
`chater/briefs/founding-backend-v0.md` («agent = participant поверх публичного API — делает brainer»).

Это **минимальный срез**, НЕ вся машина brainer: **без** пульта/UI, kernel-контракта с провайдерами,
пресетов, мульти-агента. Один агент, одна комната, живой loop. Держи код обособленным — позже обобщится в
kernel/orchestrator (git mv, не переписывание).

## Что строим (Шаг 1)
Runnable-процесс (Python 3.12; `uv`; канон brainer — если нужен python-канон, недоступный из контейнера,
попроси user, workspace-архитектор скопирует, как делали с go/frontend):

1. **Конфиг env-only:** `CHATER_URL` (дефолт `http://chater:8020`), `AGENT_HANDLE` (дефолт `claude`),
   `ROOM_ID` (целевая комната). Токенов/ключей не хардкодить.
2. **Идентити в chater:** обеспечить юзера агента (`POST /chater/users {handle}`; ASCII-handle) → узнать свой
   `author_id`.
3. **Подписка:** подключиться к ws `GET /chater/rooms/{ROOM_ID}/ws`. Мост — НЕ браузер, поэтому шлёт
   `Authorization: Bearer <AGENT_HANDLE>` **заголовком** на upgrade (query-token не нужен).
4. **Loop:** на кадр `{type:"message", message:{…}}`:
   - **если `author_id == свой` — ИГНОР** (иначе бесконечная петля на собственном эхо — критично);
   - иначе: собрать промпт (последнее сообщение + немного контекста истории через `GET .../messages`) →
     вызвать агента → `POST /chater/rooms/{ROOM_ID}/messages {body: ответ}`.
5. **Агент-рантайм = headless claude-code** на существующих OAuth-кредах (`CLAUDE_CONFIG_DIR` уже выставлен):
   простейшее — subprocess `claude -p "<промпт>"` и взять stdout; либо `claude-agent-sdk` (Python) — на твой
   выбор, обоснуй. **API-ключ не используем** (его нет; только claude-code OAuth).
6. **Устойчивость:** реконнект ws при обрыве; ошибки агента/сети не роняют процесс (лог + продолжить);
   не спамить (одно сообщение = один ответ).

## Проверка (DoD)
- Процесс поднимается в `brainer-devbox` с env, коннектится к ws chater.
- **Живьём:** user (в браузере) добавляет `AGENT_HANDLE` в `ROOM_ID`, пишет сообщение → **мост отвечает в той же
  комнате, и ответ прилетает юзеру live** (без пинга и без рефреша). Свои сообщения мост не зациклил.
- Тесты (где осмысленно): loop-логика с застабленным chater-клиентом и застабленным агентом — фильтр
  self-эха, «сообщение → один POST». Плюс smoke-инструкция запуска.
- CI по канону brainer зелёный. Ветка + PR. STOP → отчёт (где разместил, рантайм-выбор, как запускать, вопросы).

## НЕ в Шаге 1
Авто-джойн нескольких комнат / обнаружение новых комнат (Шаг 2) · пульт/UI · kernel-контракт/провайдеры ·
пресеты · память/контекст сверх недавней истории · мульти-агент · tasker.

## Контекст (проверено через Канал)
- `brainer-devbox`: Python 3.12.3, `uv`, `node` 22, `claude` CLI; на сети `omnifield-gateway` (alias brainer);
  `curl http://chater:8020/chater/healthz` → 200; creds-volume + `CLAUDE_CONFIG_DIR` есть.
- chater API v0: `POST /users {handle}`; `POST /rooms/{id}/messages {body}`; `GET /rooms/{id}/messages?limit=&cursor=`;
  `GET /rooms/{id}/ws` (участник, Bearer). Кадр ws: `{type:"message", message:{id,room_id,author_id,body,created_at}}`.
- Тестовая комната сейчас: `room_id=1` («test») и `room_id=2` («claude → egor»); user_id egor=1, claude=2.
  Можешь тестить на своей новой комнате — не важно.
