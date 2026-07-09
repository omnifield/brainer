# Brief — kernel: `current_handle` в контракт AgentProvider (микро)

> **ЗАКРЫТ** — `04c0aa8`, принят architect 2026-07-09 (37/37, purity ок).

| | |
|---|---|
| **Scope** | `kernel` (`packages/kernel/`) |
| **Owner** | owner-kernel |
| **Основание** | `review-control-channel-backend.md` П2 (ратифицировано) |
| **Размер** | микро: один метод + юнит + докстринг |

## Что

`AgentProvider` получает **неабстрактный** метод:

```python
def current_handle(self, handle: AgentSessionHandle) -> AgentSessionHandle:
    """Отрази накопленное in-memory состояние провайдера (например, поздно
    узнанный id сессии провайдера) в персистируемый handle. Дефолт — handle as-is."""
    return handle
```

Зачем: hub backend'а после каждого события переперсистирует handle, когда адаптер
поздно узнаёт `sdk_session_id` (без него resume невозможен). Сейчас hub делает это
через `getattr`-fallback — временная мера из ревью; метод обязан быть частью шва,
чтобы любой провайдер участвовал в persist-циклe без утиных проверок.

## Verify

- Юнит: дефолт возвращает handle без изменений; FakeProvider из существующих тестов
  может переопределить и обогатить `provider_state`.
- Существующие тесты kernel зелёные; purity-тест не задет (метод не знает о Claude).
- README kernel: одна строка в описание контракта.

## Заметки

- Backend `hub._maybe_persist_sid` можно НЕ трогать (getattr продолжит работать) —
  зачистку getattr → прямой вызов заберёт owner-backend попутно со своим микро-брифом.
- Git: commit-only, `feat(kernel): ...`.
