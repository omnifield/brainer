# CLAUDE.md — Omnifield Brainer

Guidance для Claude Code в репо `brainer`. Канон-первоисточник — **`omnifield/commons/standards/`**.
Вижн/раскладка — `ARCHITECTURE.md`. Здесь — repo-специфика.

## Старт сессии

Сессии — через `.\claude-scope.ps1 -Scope <name>` (ставит `OMNIFIELD_SCOPE`, SessionStart-хук
кладёт identity-баннер):
- `-Scope main` → **architect** (full git).
- `-Scope <zone>` → **owner-<zone>** (commit-only под git-gate).

Перед первым действием: этот файл, `ARCHITECTURE.md`, (owner) `packages/<zone>/README.md`.

## Роли (флоу как в оракуле, канон `commons/standards/agents/`)

| Роль | Что | Git |
|---|---|---|
| **architect** (main) | триаж, контракты, координация, **брифы** (`briefs/`), ревью | полный |
| **owner-\<zone\>** | код зоны + тесты + доки | commit-only (gate) |

- Architect НЕ пишет код зон — брифы → owner-сессии (user запускает). Owner НЕ пишет
  cross-zone / контракты — упёрлось → STOP + эскалация к architect. Эскалация ВВЕРХ.

## Зоны (packages/<name>/)

| Scope | Path | Что |
|---|---|---|
| `kernel` | `packages/kernel/` | agent-as-provider шов |
| `orchestrator` | `packages/orchestrator/` | lifecycle сессий + провайдеры + телеметрия |
| `backend` | `packages/backend/` | API/BFF |
| `frontend` | `packages/frontend/` | control-panel дашборд |
| `content` | `content/` | doc-эталоны (догфуд) |

## POLICY (priority 0, из commons)

- Никаких костылей / временных решений — причина, не следствие.
- **DoD** = код + тесты + трейсы (perf-логгеры) + доки + раскладка.
- Commit-каденс: этап → проверка → коммит; pre-commit test+lint+build зелёные.
- **agent-as-provider** (ARCHITECTURE): моды агента = провайдеры за одним швом; MVP =
  провайдер `claude-code`. Не хардкодить один мод — расширяемся провайдером.

## Git-инфра (harness)

- `.claude/hooks/git-gate.mjs` — hard-gate git-write для не-main. `main-session-marker.mjs`
  пишет `.claude/.main-session-id` только для scope main. `scope-identity.mjs` — баннер роли.
- **TODO (как в writer):** нет `governance.mjs` (hard-block правок вне зоны) и `agents/*.md`
  (Agent-tool субагенты) — границу держит git-gate + промпт; добавим при параллельных owner'ах.
