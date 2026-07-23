# @brainer/agent-harness-plugin

Продукт-owned **plugin-капабилити** brainer для движка skeleton: **ролевая рамка**
(architect / owner / layer) + **пресет-сид** роль-модели, доставляемые движком вслепую
через plugin-target `agent-harness`.

Контракт шва — `kb:DEVOPSER-6` (Plugin-контракт движка). Роли/зоны — `kb:BRAIN-3` /
`kb:BRAIN-2`. Эпик — `tasker:BRAIN-8`; эта веха — `tasker:BRAIN-9` (рантайм-хуки — `BRAIN-10`).

## Что внутри (contentRoot `harness/`)

| src (в contentRoot) | dest у потребителя | mode | что |
|---|---|---|---|
| `roles/architect.md` | `.claude/agents/architect.md` | exact | роль architect |
| `roles/owner.md` | `.claude/agents/owner.md` | exact | роль owner-`<zone>` |
| `roles/layer.md` | `.claude/agents/layer.md` | exact | роль layer |
| `shared-policy.md` | `.claude/agents/shared-policy.md` | exact | инварианты рамки |
| `hooks/harness-config.mjs` | `.claude/hooks/harness-config.mjs` | exact | загрузчик роль-модели (config = данные) |
| `hooks/scope-resolve.mjs` | `.claude/hooks/scope-resolve.mjs` | exact | резолв scope→зона из конфига |
| `hooks/scope-identity.mjs` | `.claude/hooks/scope-identity.mjs` | exact | SessionStart identity-баннер по роли |
| `hooks/git-gate.mjs` | `.claude/hooks/git-gate.mjs` | exact | PreToolUse git-gate (доступ по роли из конфига) |
| `hooks/main-session-marker.mjs` | `.claude/hooks/main-session-marker.mjs` | exact | marker main-сессии |
| `harness.config.example.yaml` | `.omnifield/harness.yaml` | seed | пресет-сид роль-модели |

**Рамка (exact)** — инварианты, выключить нельзя. **Сид (seed)** — продукт заполняет под
себя (зоны, пины моделей, число архитекторов); дальше файлом владеет продукт (не drift).

### Config-driven хуки (роль-модель = ДАННЫЕ)

Хуки читают роль-модель из `.omnifield/harness.yaml` (`harness-config.mjs`, zero-dep
YAML-парс), НЕ хардкодят зоны/роли: `scope-resolve` резолвит зоны из конфига,
`scope-identity` строит баннер (роль / пин модели / число архитекторов), `git-gate` —
доступ по роли (architect=full / owner=commit-only / layer=none). Хуки исполняют `main()`
только как скрипт (guard `import.meta.url===argv[1]`) — импортируемы без сайд-эффектов.

**settings-регистрация** (`settings.hooks.json` + идемпотентный `settings-block.mjs`) —
готова, но НЕ заведена в `frame`: движковый `mode:block` сейчас line-splice `#`-коммент-блока
(gitignore-only) и в JSON даёт невалид. Wiring ждёт JSON-aware block/merge-хендлера в движке
(эскалация к architect, зона devopser) — см. `OWNERSHIP.md`.

## Метаданные плагина

Объявлены в `omnifield`-блоке — `package.json.omnifield` (npm-сторона) и его **зеркало**
`plugin.json.omnifield` (вендор-сторона, language-agnostic для go/не-npm потребителей).
`{ kind:"plugin", target:"agent-harness", stack:"any", contentRoot:"harness", frame:[…] }`.
**`mechanism` не объявляется** — материализацию несёт per-entry `frame[].mode` (правило
контракта). Оба блока обязаны быть консистентны (проверяет тест).

## Биндинг у потребителя

Потребитель не редактирует движок — объявляет плагин в своём `omnifield.yaml`:

```yaml
plugins:
  - "@brainer/agent-harness-plugin@^0.1.0"
```

## Доставка

Двойная (как git-flow-пресет): **npm** (`node_modules`, метаданные из `package.json.omnifield`)
и **вендор** (файлами, метаданные из `plugin.json.omnifield`). Версия пиннится в `omnifield.yaml`;
bump → потребитель краснеет на drift-check → синкает `init`'ом.

## Разработка

```sh
nx build @brainer/agent-harness-plugin   # gate: omnifield-блок валиден против контракта
nx test  @brainer/agent-harness-plugin   # node:test — контракт + существование frame.src
nx lint  @brainer/agent-harness-plugin   # biome
```

Границы: движок/материализатор — зона devopser (не трогаем). Рантайм-хуки — `BRAIN-10`.
Владение — см. `OWNERSHIP.md`.
