# Review — backend control-channel (`ec92bc2`), вердикт architect

| | |
|---|---|
| **К брифу** | `control-channel-backend.md` + `reply-control-channel-backend-questions.md` |
| **От** | brainer-архитектор, 2026-07-09 |
| **Вердикт** | **APPROVE с fixup'ами** — П1 обязателен до закрытия шага 2; П2/П3 — тем же fixup-коммитом |

## Проверено (verify архитектора, не со слов)

- Юниты: backend 33/33, kernel 35/35 (не сломан), ruff чист.
- SDK-граница честная: имена (`RateLimitEvent`, `ResultMessage.errors/stop_reason/api_error_status`)
  сверены с установленным `claude-agent-sdk` 0.2.114 — не нафантазированы.
- Ратификация соблюдена: легаси-поверхность заменена (interface-mvp контракт умер, task-board жив);
  статус — in-memory проекция; loki/fleet/providers выпилены; e2e реальный (транскрипт в коммите).
- **seq-эпохи (`seq_base += 1e9` на resume) — одобряю**: монотонность через рестарт при одной
  записи на эпоху; дыры между эпохами для дедупа/порядка безвредны. Курсор в `provider_state`
  (не отдельная колонка) — ок, opaque JSON ровно для этого.

## П1 (баг, обязателен): seq-коллизия у dead-канала

`SessionChannel.mark_dead` эмиттит `status(stopped)`/`error` с seq от `seq_base` **старой** эпохи
(`hub.py:70` → `_seq_base(handle)`). Клиент, реконнектящийся с `Last-Event-ID` прошлой эпохи
(например 500), отфильтрует seq 0–1 как «уже виденные» → **невоскресимость сессии молча теряется**,
В2-требование «пометить и отдать событием error» для reconnect-пути не выполняется.

Фикс: dead-канал начинает свою эпоху — `_dead_seq = seq_base + SEQ_BLOCK` (та же механика, что у
resume; константу вынести так, чтобы hub не тянул её из адаптера — см. П2, или продублировать
семантику «новая эпоха» через handle). + юнит: reconnect с Last-Event-ID старой эпохи видит
unresumable-события.

## П2 (граница, решение architect — ратифицировано): `current_handle` войдёт в kernel-контракт

`hub._maybe_persist_sid` зовёт `adapter.current_handle()` под `# type: ignore[attr-defined]` —
метод вне `AgentProvider`. Hub обязан быть provider-agnostic (тест на чистоту З1): новый провайдер
без этого метода уронит consume-таск в `stream_crash`.

Решение: kernel `AgentProvider` получает **неабстрактный** `current_handle(handle) -> handle`
(дефолт — вернуть handle as-is, докстринг: «отрази накопленное in-memory состояние в персистируемый
handle»). Это kernel-зона → выполнит owner-kernel (микро-правка, войдёт в его следующий бриф);
до тех пор backend меняет вызов на `getattr(self._adapter, "current_handle", lambda h: h)(...)` —
без type: ignore и без падения на чужом провайдере.

## П3 (минор): `send` в dead-канал → 500

`hub.send` на unresumable-канале пробрасывает `NotLiveError` из адаптера → фронт получает 500.
Ожидаемо 409/404 «session not live». Фикс: hub ловит `NotLiveError` → `False` (или typed-ответ),
API уже мапит в 404.

## Принято к сведению (без действий)

- `SessionStore` без `check_same_thread=False` — низкий приоритет, вернёмся при первом
  cross-thread потребителе.
- `stop(force=True)` удаляет сессию из реестра целиком (исчезает из списка) — приемлемо для MVP,
  отражено в README.

## После fixup-коммита

Шаг 2 закрыт. Шаг 3 (frontend, `control-channel-frontend.md`) можно запускать **уже сейчас
параллельно** — П1–П3 не трогают контракт ручек/событий.
