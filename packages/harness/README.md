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
| `harness.config.example.yaml` | `.omnifield/harness.yaml` | seed | пресет-сид роль-модели |

**Рамка (exact)** — инварианты, выключить нельзя. **Сид (seed)** — продукт заполняет под
себя (зоны, пины моделей, число архитекторов); дальше файлом владеет продукт (не drift).

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
