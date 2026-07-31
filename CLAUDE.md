# CLAUDE.md — Omnifield Brainer

Guidance для Claude Code в репо `brainer`. Канон-первоисточник — **`omnifield/commons/standards/`**.
Вижн/раскладка — `ARCHITECTURE.md`. Здесь — repo-специфика.

## Старт сессии (контейнер = дефолт, канон containers-only)

Рабочая копия живёт **в томе контейнера** — `/workspaces/brainer` (VS Code «Clone Repository in
Container Volume», `kb:ADR-16`). Хостового пути у неё нет: с хоста доступна только через VS Code.
Креды — в машинном volume `omnifield-secrets`, переживают пересоздание (занос один раз).

Запуск: VS Code → **Reopen in Container**, дальше **в терминале контейнера**:

```sh
OMNIFIELD_SCOPE=main claude       # architect (full git)
OMNIFIELD_SCOPE=<zone> claude     # owner-<zone> (commit-only под git-gate)
```

`OMNIFIELD_SCOPE` — единственный вход роли: по нему SessionStart-хуки кладут identity-баннер и
маркер main-сессии. Забыл переменную — роли нет, гейты считают сессию неизвестной.

Скрипта-лаунчера в репо нет и не будет: `docker` **внутри** контейнера отсутствует, а девбокс
поднимает сама спека Dev Containers (`.devcontainer/devcontainer.json` — артефакт обвеса
`@omnifield/baser-devbox`, руками не правится: настройки — `.omnifield/omnifield-devbox.yaml`,
применение — `npx baser apply`).

Перед первым действием: этот файл, `ARCHITECTURE.md`, (owner) `packages/<zone>/README.md`.

## Роли (флоу как в оракуле, канон `commons/standards/agents/`)

| Роль | Что | Git |
|---|---|---|
| **architect** (main) | триаж, контракты, координация, **ТЗ задачами в tasker**, ревью | полный |
| **owner-\<zone\>** | код зоны + тесты + доки | commit-only (gate) |

- Architect НЕ пишет код зон — ТЗ узлом-задачей в tasker (`tasker:KEY`) → owner-сессию запускает
  user. Owner НЕ пишет cross-zone / контракты — упёрлось → STOP + эскалация к architect.
  Эскалация ВВЕРХ. **Локальных `briefs/`-файлов не заводим** — истина снаружи репо (`kb:ADR-10`);
  папка `briefs/` в корне — легаси прежнего флоу, разбирается этапом 10.

## Зоны

**Источник истины — `.omnifield/harness.yaml`** (`zones.<scope>.paths[]`): по нему резолвится роль
и по нему же `governance.mjs` режет правки вне зоны. Таблица ниже — читаемый слепок, при
расхождении прав yaml.

| Scope | Path | Что |
|---|---|---|
| `kernel` | `packages/kernel/` | agent-as-provider шов |
| `orchestrator` | `packages/orchestrator/` | lifecycle сессий + провайдеры + телеметрия |
| `backend` | `packages/backend/` | API/BFF |
| `bridge` | `packages/bridge/` | мост претрансляции |
| `frontend` | `packages/frontend/` | control-panel дашборд |
| `harness` | `packages/harness/` | agent-harness плагин (роль-рамка + пресет-сид) |

## POLICY (priority 0, из commons)

- Никаких костылей / временных решений — причина, не следствие.
- **DoD** = код + тесты + трейсы (perf-логгеры) + доки + раскладка.
- Commit-каденс: этап → проверка → коммит; pre-commit test+lint+build зелёные.
- **agent-as-provider** (ARCHITECTURE): моды агента = провайдеры за одним швом; MVP =
  провайдер `claude-code`. Не хардкодить один мод — расширяемся провайдером.

## Git-инфра (harness)

Обвязка материализуется плагином из `packages/harness/` в `.claude/` (хуки + `agents/*.md`);
данные роль-модели — `.omnifield/harness.yaml`. Правим в ИСТОЧНИКЕ (зона `harness`), в `.claude/` —
синхронизированная копия.

- `git-gate.mjs` (PreToolUse Bash) — hard-gate git-write для не-main; `main-session-marker.mjs`
  пишет `.claude/.main-session-id` только при `OMNIFIELD_SCOPE=main`; `scope-identity.mjs` —
  баннер роли на SessionStart.
- `governance.mjs` (PreToolUse Edit/Write) — hard-block правок вне `paths[]` своей зоны.
- `agents/*.md` — роль-рамка (`shared-policy` + architect/owner/layer) и помощники
  (`research` read-only, `routine` в границах родителя).
- `harness-doctor.mjs` — проверка раскладки: `OMNIFIELD_SCOPE=<scope> node .claude/hooks/harness-doctor.mjs`
  покажет, кем сессия окажется при этом scope и какие папки ей открыты.
