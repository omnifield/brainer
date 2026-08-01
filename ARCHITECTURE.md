# Architecture — Omnifield Brainer

Repo-local north star. Родственные решения — оракул `egor6-66/capsuleTech`
(`docs/01-architecture/adr/`). Дисциплина/канон — `omnifield/commons/standards/`.

## Что это

Продукт оркестрации агентов: **управлять / мониторить / вести agent-сессии** через
интерфейс, а не жонглируя терминалами. Мы — юзер №0 (догфуд: brainer'ом ведём
owner'ов всех продуктов, включая сам brainer).

## Ключевая абстракция — **agent-as-provider** (тот же шов, что kernel writer, ADR 078)

«Работа с внешним агентом (Claude Code)» = ОДИН из провайдеров. Агент/сессия — это
**capability**, за которой стоит **provider**:

- **Capability** — контракт агентной сессии (запустить / статус / активность / бриф / стоп).
- **Provider** — реализация на ресурсе:
  - `claude-code` — внешний Claude Code процесс (headless-адаптер CLI). **MVP: только он.**
  - `self-hosted` — наш agent-loop на `backend/llm` (ADR 065 ф.5 + ADR 074, tool-calling
    ADR 043 MCP-toolbus, встраиваемый примитив ADR 035 web-agent). **Позже, extension.**
  - `peer` — агент на чужой ноде. Позже.
- **Router + entitlement** — ресурсно-тарифный выбор провайдера (free-shared / local /
  pro / peer), ADR 078 §4. MVP = no-op passthrough (только claude-code / local).

**→ brainer и writer делят один kernel-паттерн.** Строим шов один раз; оба продукта
его юзают. Это оправдывает monorepo-first (общий kernel рядом), extract позже.

## Раскладка (packages/<name>/ — extract-ready)

| Пакет | Что | Судьба |
|---|---|---|
| `packages/kernel/` | agent-as-provider шов (capability/provider/router/entitlement) | → общий `engines`-репо |
| `packages/orchestrator/` | lifecycle сессий + реестр провайдеров + агрегация OTEL-телеметрии | → shared |
| `packages/backend/` | продуктовый API/BFF над orchestrator | остаётся |
| `packages/bridge/` | мост претрансляции (агент = участник chater) | остаётся |
| `packages/frontend/` | control-panel дашборд (тот недостающий интерфейс) | остаётся (позже — фреймворк-фронт) |
| `packages/harness/` | agent-harness плагин: роль-рамка + пресет-сид | → обвес (`tasker:BRAIN2-17`) |

**Условие extract-без-боли:** `kernel`/`orchestrator` самодостаточны; `backend` зависит
от них через интерфейс. Вынос = `git mv`, не переписывание.

## Существующий субстрат (переиспользуем, не greenfield)

- **OTEL-телеметрия сессий УЖЕ течёт**: хуки харнесса шлют scope / промпты / tool-детали
  в коллектор (`BRAINER_OTEL_ENDPOINT`, стек observability, Grafana). orchestrator читает
  этот поток → статус/активность сессий бесплатно.
- **Спавн сессий** — headless-адаптер `claude-code` в backend (прежний ps1-лаунчер
  `claude-scope` снят, опись закрытого v1 — `tasker:BRAIN2-37`); роль сессии задаётся
  `OMNIFIELD_SCOPE`.
- **FleetView** (мульти-агент вью харнесса) — свериться до стройки, не изобретать готовое.

## MVP (узко)

Мод №1 = пульт над claude-code-сессиями: список/статус · запуск · бриф · трек задач ·
стоп. Наши-LLM-моды (self-hosted agent-loop) = extension по готовому шву, НЕ в MVP.
Начинаем с **интерфейса** (contract-first: фронт против мок-контракта → backend наполняет).

## Границы (не строим сейчас)
Self-hosted agent-loop, peer-провайдеры, биллинг/entitlement-гейт, auth, docs-продукт.
Всё — фазами по готовому шву.
