# Brief — Repo Skeleton (эталон продукт-репо: pnpm + nx + uv workspace + CI)

> ✅ **ЗАКРЫТ** (2026-07-08, PR `feat/repo-skeleton`). Все шаги выполнены, DoD пройден:
> run-many зелёный (обе экосистемы), повторный прогон из nx-кэша, чистый клон проверен,
> husky-гейты живые, CI на PR. Отклонения от плана — в описании PR (ruff 120 колонок +
> immutable-calls для FastAPI; механическая lint-база по коду зон).

| | |
|---|---|
| **Scope** | shared infra (root-конфиги + `.github/` + минимальные правки package-конфигов зон) — зона **architect** |
| **Owner** | brainer-архитектор сам (cross-zone, код зон не трогаем кроме config-строк) |
| **Порядок** | Параллельно фиче-брифам, но мержится первым (CI станет гейтом для остальных) |
| **Канон** | `omnifield/commons/standards/` + оракул `capsuleTech/docs/_meta/migration/infra.md` (аудит-первоисточник решений ниже) |

## Цель

brainer = **эталон скелета продукт-репо** Omnifield: pnpm workspace + nx (affected/cache) +
uv workspace + biome + GitHub Actions CI + husky. Практики берём из оракула (capsule), но
**фильтруем**: продукт релизится деплоем, не публикацией пакетов — publish-пайплайн не тащим.
Вся runtime-инфра (gateway/observability/деплой) — зона репо **`devopser`**, не сюда.

## Факты (собраны, не гипотезы)

- Root: нет `package.json` / `nx.json` / `pnpm-workspace.yaml` / `biome.json` / `.github/`.
- `packages/frontend`: живёт на **npm** (`package-lock.json`), `lint` = `tsc --noEmit`
  (заглушка, реального линтера нет). Vite 6 + Vitest 3 + Solid.
- `packages/backend`: uv + pytest есть; **ruff отсутствует** в dev-deps.
- `packages/kernel` / `packages/orchestrator`: README-стабы (по backend-mvp: не дробим
  преждевременно — только wiring на будущее, пакеты НЕ создаём).
- Оракул-референсы: `nx.json` (targetDefaults: build/lint cached, namedInput `pythonSources`),
  `.github/workflows/ci.yml` + `pr-title.yml`, `.husky/` (pre-push = affected test+build).
- ⚠️ Грабли оракула, НЕ повторять: (1) **CC-7** — ci.yml ссылается на удалённый пакет
  `shared-file-manager`, никаких таких ref'ов; (2) biome-ignore без `.venv` → локальный lint
  видел 6257 ошибок vs 1463 в CI — сразу класть `.venv`/`dist`/`.vite` в ignore.
- ⚠️ Инцидент 2026-07-08: новая машина без uv/python → ручная установка + настройка путей.
  Причина: тулчейн нигде не задекларирован. Закрывается шагом 1 (пины) + devopser
  `briefs/workstation-bootstrap.md` (bootstrap базового слоя машины — НЕ этот бриф).

## Шаги

1. **Пины тулчейна (машина = cattle).** Канон — commons `workflow/toolchain-pins.md`
   (дыры 1–3 эскалации `escalation-toolchain-pins.md` закрыты решениями ниже):
   - `.python-version` в корне uv-workspace → uv **сам** качает managed CPython (системный
     Python не нужен в принципе; если кто-то ставит Python руками — STOP, это решено uv).
   - `[tool.uv] required-version = ">=0.11,<0.12"` в root `pyproject.toml` — пин **самого uv**
     (self-enforcing; без него дрейф резолвера/lock-формата между машинами и CI).
   - `packageManager: "pnpm@<x.y.z>"` в root `package.json` — пин исполняет **сам pnpm ≥10**
     (`manage-package-manager-versions`, дефолт из коробки). **Corepack — НЕ опора**
     (deprecated, выпиливается из Node): никаких `corepack enable`.
   - `engines.node` + root `.npmrc` с `engine-strict=true` — без strict engines это
     warning, не гейт.
   Prerequisites машины после этого — только базовый слой (git/node/**pnpm**/uv/docker/claude),
   его ставит devopser workstation-bootstrap.
2. **pnpm workspace.** Root `package.json` (private, scripts = тонкие обёртки над nx) +
   `pnpm-workspace.yaml` (`packages/*`). Удалить `packages/frontend/package-lock.json`,
   лок — единый `pnpm-lock.yaml` на руте.
3. **nx.** `nx.json`: `defaultBase: main`, targetDefaults по образу оракула (build/lint/test
   cached, `pythonSources` для py-таргетов). Frontend-таргеты: `build` / `test` / `typecheck` /
   `lint`. Backend `project.json`: `test:py` / `lint:py` → `uv run pytest` / `uv run ruff check .`.
4. **uv workspace.** Root `pyproject.toml` c `[tool.uv.workspace]`, members =
   `["packages/backend"]`. `kernel`/`orchestrator` добавятся member'ами при extract — backend
   тогда импортирует их как workspace-пакеты без path-хаков (extract = `git mv`, канон ARCHITECTURE).
5. **biome.** Root `biome.json` (можно свести из оракульного пресета, без капсуло-специфики).
   Ignore: `dist`, `node_modules`, `.venv`, `.vite`. Frontend `lint` = `biome check`
   (заглушку `tsc --noEmit` из lint убрать; `typecheck` остаётся отдельным таргетом).
6. **ruff.** В `packages/backend/pyproject.toml`: ruff в dev-deps + `[tool.ruff]` базовый конфиг.
7. **CI.** `.github/workflows/ci.yml`: job node (pnpm install → `nx affected -t lint,typecheck,test,build`)
   + job python (uv sync → `nx affected -t test:py,lint:py` или напрямую uv run). `pr-title.yml` —
   conventional commits (subjectPattern из оракула).
8. **husky.** pre-commit = affected lint+typecheck; pre-push = affected test+build
   (commit-каденс из POLICY: этап → проверка → коммит).
9. **`tools/` вместо `scripts/`.** Папку-свалку .mjs в корне НЕ заводим. Repo-локальные гейты
   (когда появятся — аналоги check-ownership) живут в `tools/` и дёргаются **nx-таргетами**.
   Сейчас — пусто, не создавать впрок.

## Вне скоупа (осознанно НЕ переносим из оракула)

- **Verdaccio / release-local / build-packages** — brainer ничего не публикует. Publish-пайплайн
  для `kernel`/`orchestrator` родится в `engines`-репо при extract, не здесь.
- **docker / gateway / observability / deploy** — зона `devopser` (см. его `briefs/infra-migration.md`).
- Obsidian-vault и его тулинг — v2-доки чистый markdown (ADR 077/078 оракула).
- `governance.mjs` — уже осознанно отложен (CLAUDE.md), не в этом брифе.

## Deliverable

Репо, где с чистого клона: `pnpm install` → `pnpm nx run-many -t lint,typecheck,test,build`
зелёный; py-таргеты зелёные; PR триггерит CI и он зелёный; повторный прогон бьёт в nx-кэш.

## Verify (DoD)

- Чистый клон → install → run-many зелёный (обе экосистемы).
- **Тест переносимости:** на машине только базовый слой (git/node/pnpm/uv/docker) — `uv sync`
  сам тянет Python из `.python-version` и отказывает при uv вне `required-version`; pnpm сам
  переключается на запиненную `packageManager`-версию. Ни одной ручной установки
  Python/pnpm-версий, ни одной правки PATH.
- `nx affected` на PR-ветке гоняет только затронутое; второй прогон — из кэша.
- CI зелёный на реальном PR; pr-title гейтит неконвенциональный заголовок.
- Dev-флоу из `DEPLOY.md` не сломан: vite :3500 и uvicorn :8010 поднимаются теми же командами
  (пути/порты не трогаем).
- Доки: README §статус обновить (скелет = pnpm/nx/uv), этот бриф закрыть галочкой.

## Заметки

- Порты в `DEPLOY.md` станут **ссылкой** на `devopser/registry/ports.md` (source of truth
  переезжает туда) — TODO после founding-миграции devopser, не в этом брифе.
- Контракт фронт↔бэк, код зон, фиче-флоу — не трогать; бриф только про скелет/тулинг.
- Git: обычный флоу architect'а; коммиты по шагам (workspace → nx → ci → husky), не одним комом.
