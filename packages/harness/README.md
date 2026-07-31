# @omnifield/brainer-harness

**Обвес baser**: агент-харнесс, в котором роль впаяна в сессию — ролевая рамка
(architect / owner / layer) + машинные гейты-хуки + сид роль-модели, которую дальше ведёт
человек.

- Форма объявления — README пакета `@omnifield/baser-contracts` (форма 3). Разбор класса
  артефакта — `kb:BASER2-2`. Станок раскладывает и обновляет; **что делать с файлом при
  обновлении, решает обвес** — он говорит это классом.
- Роли — `kb:BRAIN2-12`, зоны — `kb:BRAIN2-11`, онбординг сессии — `kb:BRAIN2-14`.
- Итерация переезда на форму — `tasker:BRAIN2-17`, этот заход — `tasker:BRAIN2-41`.

Имя пакета — доставка, **личность обвеса — `brainer/harness`**, и это разные вещи: пакет
может переехать (он уже переехал из `@brainer/agent-harness-plugin`), личность — нет.

## ⚠️ Пилотный выпуск — раскладка полей будет меняться

Ставить можно и нужно, но знай заранее: **состав полей роль-модели (`.omnifield/harness.yaml`)
ещё не устоялся.** Первые потребители (weber, baser) встают на него сейчас, а ближайшее
изменение — разделение должности и полномочий — поменяет конфигурацию: секции `zones` и `git`
получат другую форму.

Что это значит на практике: переезд будет, он плановый и объявленный, а не сюрприз. Файл
конфига твой (`placed-once`, станок его не перезаписывает) — поэтому при обновлении обвеса
**сверяйся с сидом новой версии**: новые поля появятся там, а в твоём файле — нет. Ломающие
изменения поедут минором с описанием перехода.

## Что кладёт (contentRoot `harness/`)

| src (в `harness/`) | dest у потребителя | class | что |
|---|---|---|---|
| `roles/architect.md` | `.claude/agents/architect.md` | regenerated | роль architect |
| `roles/owner.md` | `.claude/agents/owner.md` | regenerated | роль owner-`<zone>` |
| `roles/layer.md` | `.claude/agents/layer.md` | regenerated | роль layer |
| `shared-policy.md` | `.claude/agents/shared-policy.md` | regenerated | инварианты рамки |
| `helpers/research.md` | `.claude/agents/research.md` | regenerated | read-only помощник роли |
| `helpers/routine.md` | `.claude/agents/routine.md` | regenerated | правящий помощник в границах родителя |
| `hooks/harness-config.mjs` | `.claude/hooks/harness-config.mjs` | regenerated | загрузчик роль-модели (config = данные) |
| `hooks/scope-resolve.mjs` | `.claude/hooks/scope-resolve.mjs` | regenerated | резолв scope→зона из конфига |
| `hooks/scope-identity.mjs` | `.claude/hooks/scope-identity.mjs` | regenerated | SessionStart identity-баннер по роли |
| `hooks/git-gate.mjs` | `.claude/hooks/git-gate.mjs` | regenerated | PreToolUse git-gate (доступ по роли) |
| `hooks/governance.mjs` | `.claude/hooks/governance.mjs` | regenerated | PreToolUse: правка вне зоны заблокирована |
| `hooks/main-session-marker.mjs` | `.claude/hooks/main-session-marker.mjs` | regenerated | marker main-сессии |
| `hooks/harness-doctor.mjs` | `.claude/hooks/harness-doctor.mjs` | regenerated | самопроверка установки (запуск руками) |
| `gitignore.claude` | `.claude/.gitignore` | regenerated | что из `.claude/` не коммитить |
| `settings.hooks.json` | `.claude/settings.json` | **placed-once** | регистрация хуков — см. ниже |
| `harness.config.example.yaml` | `.omnifield/harness.yaml` | **placed-once** | роль-модель, её ведёт человек |

16 записей, у всех `render: false`: подстановки в содержимом нет вовсе — рамка и хуки
product-agnostic, всё продуктовое живёт в `harness.yaml`, который читают сами хуки. Файлы
обязаны лечь байт в байт.

### Почему рамка и хуки — `regenerated`

Правило класса: **`placed-once` про то, что заполняет ЧЕЛОВЕК, а не про то, где лежит файл.**
Рамка ролей и хуки инвариантны, потребитель их не редактирует, обновление обязано их
заменять. Объявить их `placed-once` = заморозить харнесс на первой версии у каждого
потребителя — и **молча**, потому что `placed-once` расхождений не называет по построению.

### `.omnifield/harness.yaml` — `placed-once`, и это не «свой конфиг обвеса»

У формы есть штатный файл настроек потребителя — `.omnifield/brainer-harness.yaml` (имя
считается из личности). Роль-модель в него **не уезжает и не может**: у настроек типы
`string · number · boolean · list · map`, карта строго двухэтажная, а наша модель —
`zones.<scope>.paths[]`, то есть карта → объект → список. Третьего этажа в форме нет по
построению. Поэтому `settings` и `presets` мы не объявляем вовсе (это законно, а не
полупустое объявление), а роль-модель остаётся отдельным артефактом со своей схемой.

### `.claude/settings.json` — единственный артефакт, который форма не выражает

Это общий файл клиента: там живут permissions, env, statusline и собственные хуки
пользователя. Наш вклад в него — только регистрация харнесс-хуков (`settings.hooks.json`).

Режимов материализации у формы нет: `merge` отменён вместе со сведением версий, `seed`
выражается классом. Из двух доступных классов `regenerated` снёс бы чужое, поэтому —
**`placed-once` + компенсация проверкой**. Цена класса названа вслух: новые хуки следующих
версий приезжают в `.claude/hooks/`, а их регистрация — нет, потому что живёт в том самом
файле, который мы больше не трогаем.

Молчаливую деградацию делаем громкой в обоих путях установки:

- `node .claude/hooks/harness-doctor.mjs` сверяет эталонный блок регистрации с настоящим
  `settings.json` и печатает **готовую строку**, которую нужно дописать. Эталон он берёт
  там, где в этой раскладке лежит содержимое обвеса: рядом с собой (исходник/бандл) либо
  в установленном пакете, найденном по **личности** среди источников `baser.json`. Не нашёл
  — говорит, что проверка НЕ выполнена: молчаливый зелёный хуже отсутствующего;
- ручная установка (`scripts/install.mjs`) печатает ту же строку сразу, в момент, когда
  видит существующий `settings.json`, — у ручного потребителя пакета нет и доктору эталон
  взять негде.

Это не обход формы: механизм не подменяется, называется то, что механизм назвать не может.
Заявку на класс/механизм дописывания блока в чужой JSON несёт architect в BASER2.

### Config-driven хуки (роль-модель = ДАННЫЕ)

Хуки читают роль-модель из `.omnifield/harness.yaml` (`harness-config.mjs`, zero-dep
YAML-парс), НЕ хардкодят зоны/роли: `scope-resolve` резолвит зоны из конфига,
`scope-identity` строит баннер (роль / пин модели / число архитекторов), `git-gate` — доступ
по роли (architect=full / owner=commit-only / layer=none), `governance` — границу правок по
`paths[]`. Хуки исполняют `main()` только как скрипт (guard `import.meta.url===argv[1]`) —
импортируемы без сайд-эффектов.

## Объявление обвеса

Одно и единственное — блок `baser` в `package.json`. Вендор-зеркала (`plugin.json`) больше
нет: два объявления одного факта разъезжаются, а devopser-путь мы покинули. Версия обвеса
живёт в `package.json.version` и только там — `source.version` форма отвергает названным
отказом.

## Установка у потребителя

**Метод #2 (станок):** объявить пакет в `baser.json` и применить.

```json
{ "formVersion": 2, "sources": [{ "use": "@omnifield/brainer-harness" }] }
```

```sh
npx baser plan     # что положит и что при этом потеряется
npx baser apply
```

**Метод #1 (ручной бандл)** — пока установка обвесом не подтверждена на живом:

```sh
node scripts/pack.mjs                                   # dist/agent-harness-plugin/
node dist/agent-harness-plugin/install.mjs <target-repo>
```

`install.mjs` читает то же объявление и исполняет те же два класса — не «как удобнее
ручному методу». Дальше в обоих случаях: заполнить `.omnifield/harness.yaml` под свой
продукт и прогнать доктора.

## Разработка

```sh
npx baser check packages/harness            # авторитетно: объявление против формы
nx build @omnifield/brainer-harness         # гейт: объявление валидно и раскладка полна
nx test  @omnifield/brainer-harness         # node:test — объявление, хуки, доктор
nx lint  @omnifield/brainer-harness         # biome
node harness/hooks/harness-doctor.mjs       # отчёт по установке в ЭТОМ репо (догфуд)
```

Границы: станок/движок/дверь — зона baser (не трогаем). Владение — см. `OWNERSHIP.md`.
