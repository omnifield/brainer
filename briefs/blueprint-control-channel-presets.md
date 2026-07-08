# Blueprint — control-канал (kernel-контракт) + схема флоу-пресетов

| | |
|---|---|
| **Статус** | на ревью: user (весь документ) + оракул-архитектор (контракт §1, пресеты §2) |
| **От** | brainer-архитектор, 2026-07-08 |
| **Основание** | `product-direction-chater-tasker-presets.md` §1/§2 + `answers-product-direction-open-questions.md` (В1=(a)+резерв, В2=(b), reframe §0: ядро ≠ Claude) |
| **После апрува** | нарезка owner-брифов по очереди §7 direction-брифа |

Blueprint фиксирует «как» до исполнения. Реализуемость маппинга claude-code проверена
против актуальных доков Claude Agent SDK (Python) — ссылки в §1.4.

---

## Часть 1 — Control-канал

### 1.1 Место контракта: `packages/kernel/` просыпается

Контракт канала — **наш, ecosystem-native, живёт в kernel** (reframe §0). Следствия:

- `packages/kernel/` из README-заглушки становится Python-пакетом: типы событий,
  операции, `AgentSessionHandle`. **Ноль знаний о Claude.**
- `IAgentProvider` переезжает из `packages/backend/app/providers/base.py` в kernel и
  расширяется каналом (это был MVP-шорткат; ARCHITECTURE и так требует шов в kernel —
  «вынос = git mv»).
- `ClaudeCodeProvider` становится **адаптером** в backend (или `kernel/adapters/` —
  решу при нарезке): реализует kernel-контракт, внутри — SDK.
- **Wire-формат событий = JSON** (envelope ниже). Контракт описан типами Python +
  JSON-схемой события — чтобы фронт (TS) и будущие потребители не зависели от Python.

Тест на чистоту (из answers-брифа): появление self-hosted провайдера = регистрация
нового адаптера, ничего больше.

### 1.2 Словарь событий

Envelope каждого события:

```json
{ "session_id": "...", "seq": 42, "ts": "2026-07-08T12:00:00Z", "type": "...", "payload": { } }
```

`seq` — монотонный номер внутри сессии: дедуп при reconnect'е стрима и порядок для
моста в chater (история там, у нас — только доставка).

| type | payload | Примечания |
|---|---|---|
| `message` | `role: agent\|user`, `text`, `partial?: bool` | Реплики. `partial` — для токен-стриминга (v0 может слать только целые, поле в схеме сразу) |
| `thinking` | `text` | **Добавлен сверх словаря оракула** — обоснование ниже |
| `tool-call` | `call_id`, `tool`, `input` | |
| `tool-result` | `call_id`, `output`, `is_error` | |
| `status` | `state: starting\|running\|waiting\|stopped`, `detail?` | lifecycle; `waiting` = ждёт ввода |
| `done` | `reason: completed\|max-turns\|stopped\|error`, `usage {input_tokens, output_tokens, cost_usd?}` | конец хода (turn), НЕ конец сессии |
| `error` | `code`, `message`, `retryable: bool` | |
| `limit` | `scope: account\|rate`, `resets_at?` | typed — router-фейловер §5 провайдер-агностик |
| `permission-request` | `request_id`, `tool`, `input` | **Зарезервирован** (В1). claude-code в MVP не эмиттит |

**Единственное отступление от словаря оракула — событие `thinking`.** Reasoning-поток
есть и у claude-code (ThinkingBlock), и будет у нашего agent-loop; UI хочет рендерить
его отдельно от реплик (сворачиваемый), а мост в chater — возможно не пересылать вовсе.
Склеивать его в `message` = потеря информации, которую потом не вернуть. Дешёвая строка
сейчас — ровно логика резерва `permission-request`.

### 1.3 Операции контракта

```
launch(role, repo, brief?, model?, account?)  -> AgentSessionHandle
send(handle, text)                            # сообщение в живую сессию
stream(handle)                                -> AsyncIterator[Event]
resume(handle)                                -> AgentSessionHandle   # после рестарта backend (В2)
stop(handle, force=False)                     # мягкий interrupt / жёсткий kill
```

- `launch` берёт **роль пресета** (§2) → из неё permission-уровень, model по умолчанию,
  persona. `account` — резерв под мульти-акк §5 (в MVP один профиль).
- `resume` — операция контракта (уточнение оракула); как исполняется — дело адаптера.
- **Permission-уровни — наш словарь**, не SDK-строки: `readonly | standard | trusted`.
  Адаптер мапит на свои механизмы. Причина та же, что у всего reframe: SDK-значения
  (`acceptEdits`, `bypassPermissions`) не должны утечь в пресет — пресет читают и хуки,
  и UI, и будущий agent-loop.

`AgentSessionHandle` — персистируемый (В2): `session_id` (наш) + `provider` +
`provider_state` (opaque JSON адаптера). Реестр сессий — **sqlite в data-dir brainer'а**
(не в управляемом репо): переживает рестарт, один writer — backend, минимализм ок
по answers-брифу.

### 1.4 Адаптер claude-code (деталь реализации, за границу не течёт)

База — `claude-agent-sdk` (Python), `ClaudeSDKClient`: держит живую сессию,
`query()` = follow-up в тот же контекст, `interrupt()` = мягкий стоп. Спавн headless,
терминал не нужен. Маппинг (сверено с доками SDK):

| SDK | Наше событие |
|---|---|
| `AssistantMessage` → `TextBlock` | `message {role: agent}` |
| `AssistantMessage` → `ThinkingBlock` | `thinking` |
| `AssistantMessage` → `ToolUseBlock` | `tool-call` |
| `UserMessage` → tool_result-блоки | `tool-result` |
| `SystemMessage (init, …)` | `status` |
| `ResultMessage` | `done` (+ `error`, если `is_error`; usage/cost оттуда же) |
| limit-ошибка API | `limit` (детект по ошибке — v0 реактивный, как решено) |
| `StreamEvent` (`include_partial_messages=True`) | `message {partial: true}` — вкл. позже, схема готова |

Ключевые факты, проверенные по докам (влияют на дизайн):

1. **Resume реализуем**: SDK персистит транскрипт в
   `$CLAUDE_CONFIG_DIR/projects/<encoded-cwd>/<session_id>.jsonl`;
   `ClaudeAgentOptions(resume=session_id)` поднимает сессию после рестарта процесса.
   **Условие: те же `cwd` и `CLAUDE_CONFIG_DIR`** → в `provider_state` адаптер хранит
   `{sdk_session_id, cwd, config_dir}`. Бонус: `CLAUDE_CONFIG_DIR` — это одновременно
   изоляция акк-профилей §5; шов мульти-акка получается из resume-механики бесплатно.
2. **Форвардинг permission (горизонт В1-(b)) не сломает контракт**: SDK даёт
   `can_use_tool`-callback на каждый непредрешённый tool-вызов — когда дойдём до (b),
   адаптер начнёт эмиттить `permission-request` из callback'а. Резерв события оправдан
   механикой, не только принципом.
3. **Permission-mode маппинг** (`наш уровень → SDK`): `readonly → plan`,
   `standard → acceptEdits + allowed/disallowed_tools из роли`, `trusted → bypassPermissions`.
   Точную настройку `standard` подберу при нарезке. Git-права роли дублируются
   git-gate-хуком — он остаётся второй линией обороны.
4. `env` при спавне: `OMNIFIELD_SCOPE`, OTEL-инъекция — как в `claude-scope.ps1`
   (он остаётся ручным fallback и референсом env).

### 1.5 Наружу (backend → frontend / мост chater)

Backend ретранслирует `stream()` как SSE (`GET /sessions/{id}/events`, `Last-Event-ID`
= `seq` для reconnect-дедупа) + `POST /sessions/{id}/messages` = `send`. События идут
as-is (это уже наш JSON) — BFF ничего не переводит. Мост в chater (шаг 3 очереди)
подпишется на тот же стрим.

OTEL: activity/status в UI пересаживаются на стрим; OTEL остаётся метрикам (решено).

---

## Часть 2 — Схема флоу-пресета

### 2.1 Файл

**`.omnifield/preset.yaml`** в корне управляемого репо. Каталог `.omnifield/` — на
вырост: туда же ляжет вендоренный харнесс (§6, по синку с оракулом) — «пресет = данные,
хуки = интерпретаторы» живут рядом. Версионируется с репо, команда шарит. YAML:
комментируемый (пресет читает человек), схема валидируется.

Материализация **копией** при init (решено): brainer поставляет `presets/*.yaml`
(дефолт-3-архитектора, solo, flat), «brainer init» кладёт выбранный в репо. Репо
самодостаточен — принцип §0.

### 2.2 Схема (v1)

```yaml
version: 1
preset: default-3arch          # из какого поставочного материализован (для sync позже)

roles:
  main:                        # ИНВАРИАНТ: роль main обязательна в любом пресете
    persona: >                 # system-prompt append роли
      Ты architect/main: триаж, контракты, брифы, ревью. Код зон не пишешь.
    model: opus                # дефолт; при запуске переопределяем (UI, §2 direction)
    git: full                  # full | commit | none  → git-gate
    permissions: trusted       # readonly | standard | trusted → канал (§1.3)
    kb: [standards]            # KB-доступ (пока декларативно)
  owner:
    persona: >
      Ты owner зоны {match}: код + тесты + доки. Cross-zone — STOP, эскалация к main.
    model: sonnet
    git: commit
    permissions: standard

rules:                         # папка → агент; UI сканит и матчит
  - match: "packages/*"        # glob относительно корня репо
    role: owner
    per_match: true            # агент на каждый смэтченный каталог
  - match: "."                 # корень всегда за main
    role: main

flow:                          # рёбра: кто кому брифует, где ревью
  - from: main
    to: owner
    type: brief
  - from: owner
    to: main
    type: review
```

- **`{match}`** в persona — подстановка смэтченного пути (owner знает свою зону).
- Роли — словарь, не enum: пресет юзера волен завести `architect-frontend`,
  `architect-backend` (дефолт-3arch так и делает) или один `main` + `owner` (solo).
- `flow` в MVP — декларация для UI (визуализация ростера/рёбер) и для брифов;
  enforcement рёбер — не сейчас.

### 2.3 Валидация «папки ↔ пресет» (детерминированная, в UI)

Три класса диагностик, все вычислимы без LLM:

1. **unmatched-dir** — каталог верхнего уровня (и `packages/*`) не покрыт ни одним rule;
2. **dead-rule** — rule не матчит ни одной папки;
3. **schema-error** — нет роли `main`, `flow` ссылается на несуществующую роль,
   неизвестные значения enum'ов.

Backend отдаёт список диагностик ручкой; UI показывает при выборе репо/пресета.

### 2.4 Хуки — читатели пресета

`scope-resolve.mjs` / `scope-identity.mjs` / `git-gate.mjs` перестают носить хардкод
зон: резолвят `OMNIFIELD_SCOPE` против `rules`, права git — из `roles[].git`, баннер —
из `persona`. Хуки остаются в `.claude/hooks/` до харнесс-синка §6 (не двигаю их
в одиночку).

---

## Решения, которые утверждает этот blueprint

1. Контракт канала — в `packages/kernel/` (Python-типы + JSON-схема wire-формата);
   провайдеры backend'а становятся адаптерами под ним.
2. Словарь событий = словарь оракула **+ `thinking`** (единственное добавление).
3. Permission-уровни контракта: `readonly | standard | trusted` — наш словарь, SDK-строки
   не пересекают границу адаптера.
4. Session-реестр: sqlite в data-dir brainer'а; `AgentSessionHandle` персистируемый,
   `provider_state` — opaque JSON адаптера (для claude-code: sdk_session_id, cwd, config_dir).
5. Транспорт наружу: SSE + `seq`-дедуп; send — POST.
6. Файл пресета: `.omnifield/preset.yaml`, материализация копией, схема §2.2,
   валидация §2.3.

## Вне blueprint'а (следующие проработки)

Participant-API chater'а (шаг 2, после Go-канона от оракула); мост session↔participant
(шаг 3); tasker-контракт (шаг 4); детали router'а мульти-акка (§5 — шов подготовлен
через `account` в `launch` и `config_dir` в `provider_state`).

## Порядок нарезки owner-брифов после апрува

1. `kernel`: контракт (типы, JSON-схема, реестр сессий).
2. `backend`: claude-code адаптер + SSE/`POST messages` + resume-on-start.
3. `frontend`: чат-вью сессии поверх SSE (терминальный путь НЕ выпиливать — догфуд-
   пересадка только после шагов 1–3 очереди direction-брифа).
4. Пресеты (`kernel`-схема + хуки-читатели + UI-ростер) — параллелизуемо по решению
   direction-брифа.
