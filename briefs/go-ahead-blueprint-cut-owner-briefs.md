# Go-ahead — blueprint утверждён, режь owner-брифы

| | |
|---|---|
| **Адресат** | brainer-архитектор |
| **От** | user + оракул-архитектор, 2026-07-08 |
| **Re** | `blueprint-control-channel-presets.md` + `review-blueprint-control-channel-presets.md` |

## 1. Blueprint утверждён (обе стороны)

Апрув user + оракула. **З1–З3 из ревью — обязательны** при нарезке:
- **З1** — адаптер claude-code ТОЛЬКО в backend (вариант `kernel/adapters/` снят: deps-чистота kernel'а);
- **З2** — семантика `rules` пресета запинена в схеме v1 (most-specific wins; `.` = fallback корня; scope-id = смэтченный путь = `OMNIFIELD_SCOPE`; +overlap-диагностика в валидатор);
- **З3** — TS-типы событий/DTO — только генерацией из JSON-схемы (один источник).

Порядок нарезки подтверждён: **kernel (контракт) → backend (адаптер+SSE+resume) → frontend (чат-вью) ‖ пресеты**.

## 2. Go-канон ГОТОВ — блокер chater снят (Q7 → Done)

`knowledger/standards/canon/languages/go.md` (+ строка Go в `workflow/toolchain-pins.md`).
Покрывает: go.mod toolchain-пин · раскладка `cmd/internal/migrations` (свой go.mod = граница
extract) · стиль (5 правил + golangci-lint baseline) · stdlib-first HTTP + coder/websocket ·
goose+sqlc (types-from-schema) · slog/env-only · table-driven+`-race` · CI-гейт.
**В owner-бриф chater — обязательным чтением.** Канон-гэп найдёшь — эскалация оракулу, не
локальное решение.

## 3. Архитекторы = language-agnostic (правило user, уже в KB)

Owner-брифы пишем про **функционал / архитектуру / структуру / контракты / DoD** — БЕЗ
синтаксиса и языковых идиом. Язык-детали закрывают owner + языковой канон
(`knowledger/standards/canon/languages/`). Ревью-нагрузка по языку — на детерминированных
гейтах (lint/CI), архитектор смотрит контракт/структуру/тесты/поведение. Разрез архитекторов
остаётся доменным (продукт/фронт/бэк), не по языкам.

## 4. Уточнение по kernel (вопрос user разобран)

Kernel = универсальный шов «возможность → исполнитель» (capability/provider/router/entitlement),
агент-сессия — одна из capabilities. Судьба «→ общий engines-репо» = ПО ТРИГГЕРУ второго
реального потребителя (writer с его llm/tts на том же шве; ресурсный тариф = свойство
экосистемы: один юзер — одна подписка/пул во всех продуктах). **Сейчас ничего не переезжает** —
держи kernel самодостаточным (extract = git mv), и только.
