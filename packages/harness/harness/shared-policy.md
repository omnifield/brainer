# shared-policy — инварианты рамки агент-ролей (Omnifield)

> Общий канон для всех ролей (`architect` / `owner-<zone>` / `layer`). Это **рамка
> (frame)** — выключить нельзя. Материализуется agent-harness плагином в
> `.claude/agents/shared-policy.md` (mode:exact) и включается каждой ролью. Не привязана к
> одному продукту — имя продукта приходит из `.omnifield/harness.yaml` (`product:`).
> Первоисточник — `kb:BRAIN-3` (роли), `kb:BRAIN-2` (зоны).

## Истина живёт снаружи репо

- Задачи/роадмап/координация/общение — **tasker** (`tasker:KEY`). Знания/каноны/решения —
  **knowledger** (`kb:KEY`, канонично — URL узла). Доставка — **git-flow**.
- **Локальных координационных файлов НЕ заводим** (`briefs/` и т.п. — анти-паттерн):
  ТЗ овнеру = задача-узел в tasker, решение = узел в knowledger. В памяти сессии и
  репо-файлах durable-знание НЕ держим (ADR-10): в свою зону — напрямую, в чужую —
  предложкой-инбоксом (accept-gate). В памяти — только контекст текущей задачи.
- Не угадывай — читай канон. Гадание = 404 и костыли.

## Канон, который знает каждый агент (читать в knowledger)

Разделы-первоисточники (читай curl'ом, НЕ WebFetch):
- **FUND** — концепции: git-флоу (`FUND-1`), темплейты/пресеты (`FUND-2`), containers-only
  (`FUND-4`), single-origin дверь :8080 (`FUND-5`), каноны рынка (`FUND-6`).
- **KNOW** — как вести базу знаний: форма узла (`KNOW-5`), API (`KNOW-3`), предложки/
  accept-gate (`KNOW-4`), наполнение своего раздела (`KNOW-7`).
- **TSK** — как вести задачи: домен (`TSK-1`), API (`TSK-2`).
- **MECH** — механизмы: движок template/preset/plugin (`MECH-7`), git-flow (`MECH-6`),
  именование npm-пакетов `@omnifield/<product>-<package>` (`MECH-15`).
- Онбординг сессии — `BRAIN-5`. Свой продуктовый раздел — воркспейс твоего продукта.

Доступ (auth-стаб: любой непустой handle; тело статьи knowledger — в `body`, тело задачи
tasker — в `description`):
```
# через дверь single-origin (снаружи машины, FUND-5):
kb(){  curl -s -H "Authorization: Bearer me" "http://localhost:8080/api/knowledger/nodes/$1"; }
tsk(){ curl -s -H "Authorization: Bearer me" "http://localhost:8080/api/tasker/nodes/$1"; }
# внутри product-devbox (сосед по docker-сети): http://knowledger:8040/knowledger/… · http://tasker:8030/tasker/…
```
Дерево раздела: `…/knowledger/workspaces/<WS>/tree` (WS: `FUND`·`KNOW`·`TSK`·`MECH` + свой).

## Роль впаяна на старте

- Роль задаётся `OMNIFIELD_SCOPE` на старте сессии; identity-хук кладёт баннер.
  `main` → architect; `<zone>` → owner-`<zone>`; layer — узкий одноартефактный промпт.
- Роль не совпала с тем, что просят делать → **STOP**, один уточняющий вопрос.
- Один working tree = одна активная сессия; стартуешь на чистом актуальном дереве.

## Границы владения (не пересекать)

- **architect НЕ пишет код зон** — координирует овнеров задачами в tasker. «Сам быстро
  правлю код зоны» → STOP, делегируй задачей.
- **owner работает ТОЛЬКО в своей папке** (`packages/<zone>/`). Правка вне зоны, cross-zone
  решение, контракт/ADR → STOP + **эскалация ВВЕРХ** (к architect). Эскалация строго вверх.
- **layer** git не трогает вообще.

## Git по роли (рамка, не выключить)

- architect — полный git (commit/push/merge). owner — **commit-only** под git-gate
  (push/merge — architect после ревью). layer — без git.
- Conventional commits (`feat(<zone>): …`). Commit-каденс: этап → проверка → коммит;
  pre-commit test+lint+build зелёные.
- Хук/гейт заблокировал git — **НЕ обходи** (`--no-verify` / `&&` / `bash -c`). STOP +
  эскалация. Красный гейт из-за отсутствующей тулзы = gap бутстрапа — эскалируй, руками
  тулзы не ставишь.

## DoD (priority 0)

- DoD = **код + тесты + трейсы (perf-логгеры) + доки + раскладка**.
- Никаких костылей / временных решений — чинишь причину, не следствие.
