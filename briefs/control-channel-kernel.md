# Brief — Control-канал, шаг 1: kernel-контракт

| | |
|---|---|
| **Scope** | `kernel` (`packages/kernel/`) |
| **Owner** | owner-kernel (запускает user; refine — brainer-архитектор) |
| **Порядок** | ПЕРВЫЙ в очереди control-канала: kernel → backend → frontend |
| **Источник правды** | `briefs/blueprint-control-channel-presets.md` §1 (утверждён user+оракулом) — здесь только скоуп и DoD, словарь/операции НЕ дублируются |
| **Канон** | shared-policy (первым) + языковой канон зоны (`knowledger/standards/canon/languages/`) + `ARCHITECTURE.md` |

## Цель

Kernel просыпается: провайдер-агностик контракт агент-сессии — словарь событий,
операции канала, персистируемый handle, реестр сессий. Это НАШ контракт
(ecosystem-native): интеграции (claude-code и будущие) мапятся в него, не наоборот.

## Стек — РЕШЕНО (architect)

Python + uv, как backend — единый extract-путь в `engines`-репо. Owner стек не выбирает.

## Deliverables

1. **Типы контракта** — по blueprint §1.2–1.3 as-is:
   - envelope события (`session_id/seq/ts/type/payload`) + 9 типов событий
     (`message`, `thinking`, `tool-call`, `tool-result`, `status`, `done`, `error`,
     `limit`, `permission-request`);
   - операции capability: `launch / send / stream / resume / stop` (интерфейс
     провайдера — эволюция `IAgentProvider`, живёт теперь здесь);
   - permission-словарь контракта: `readonly | standard | trusted`;
   - `AgentSessionHandle`: наш `session_id` + `provider` + `provider_state`
     (opaque, kernel внутрь не смотрит).
2. **JSON-схема wire-формата** — событий и handle, как артефакт пакета.
   Это ЕДИНСТВЕННЫЙ источник для типов потребителей (фронт генерит TS из неё — З3
   ревью); Python-типы и схема не должны мочь разъехаться (одно генерится из
   другого либо сверяется тестом — механизм на твой выбор, требование «один источник»).
3. **Реестр сессий** — персистентное хранилище handle'ов (sqlite) в data-dir
   brainer'а (НЕ в управляемом репо): CRUD handle'ов, выжившие сессии для
   resume-on-start backend'а. Провайдер-агностик: хранит opaque `provider_state`.
4. **Доки** — README пакета: контракт, инварианты границы, схема как источник типов.

## Граница (жёстко)

- **Ноль знаний о Claude, ноль deps на вендорские SDK** (З1 ревью): адаптеры живут
  у потребителя шва (backend). Тест на чистоту: новый провайдер = регистрация
  адаптера, kernel не трогается.
- Kernel самодостаточен: не импортит `backend`/`frontend`/`orchestrator`
  (extract = git mv, go-ahead §4).
- Событие/операцию в контракт добавляет только architect — упёрся в нехватку →
  STOP + эскалация, не расширяй сам.

## Вне скоупа

Реализация адаптеров (backend, следующий бриф); транспорт наружу (SSE — backend);
router/entitlement (dormant — `account` в `launch` остаётся резервом-параметром);
схема пресетов (отдельный трек).

## Verify (DoD)

- Юнит: JSON-схема ↔ типы согласованы (round-trip/сверка); реестр переживает
  рестарт процесса (записал handle → новый процесс читает).
- Фейковый провайдер в тестах реализует контракт целиком (launch→stream→send→
  resume→stop) — доказательство, что интерфейс реализуем без знаний о kernel-внутренностях.
- Тесты + lint зелёные; трейсы (perf-логгеры) на горячих путях реестра; доки.

## Заметки

- Git: commit-only, `feat(kernel): ...`; push/merge — architect после ревью.
- Неясность семантики события/операции → surface к architect, не интерпретируй сам:
  у контракта три будущих потребителя (backend, frontend, мост chater).
