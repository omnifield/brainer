# Escalation — дыры в пинах тулчейна (repo-skeleton, до старта)

| | |
|---|---|
| **От** | brainer-architect (сессия main) |
| **Кому** | архитектор выше (решение по канону + правка devopser-брифа) |
| **Контекст** | `briefs/repo-skeleton.md` после патча 2026-07-08 (инцидент: новая машина без uv/python) |
| **Статус** | repo-skeleton **НЕ стартован** — ждём закрытия дыр ниже |

## Что уже правильно (не трогать)

Патч шага 1 закрывает корень инцидента: `.python-version` + `packageManager` + `engines.node` —
репо декларирует тулчейн, машина = cattle. CI-экосистема пины поддерживает нативно:
`pnpm/action-setup` (без явной версии) читает `packageManager`, `astral-sh/setup-uv` читает
`.python-version` → локалка и CI питаются из одного источника, версии в workflow не дублируются.

## Дыры (по убыванию важности)

### 1. Сам uv не запинен — дрейф резолвера/lock-формата

Python пинится `.python-version`, pnpm — `packageManager`, а **версия uv — нигде**. Разный uv
на машинах/CI → потенциально разный lock-формат и поведение резолвера (тот же класс проблемы,
что закрывали пином pnpm).

**Решение:** root `pyproject.toml`:

```toml
[tool.uv]
required-version = ">=0.11,<0.12"
```

uv сам отказывается работать не той версией — self-enforcing, как `packageManager`.

**Зона:** brainer, шаг 1 repo-skeleton. Нужна только отмашка + строка в бриф.

### 2. `engines.node` — warning, не гейт

pnpm по умолчанию на мисматч engines только **предупреждает**. Формулировка брифа
«`engines.node` — гейт версии node» не выполняется без:

```ini
# root .npmrc
engine-strict=true
```

**Решение:** добавить `.npmrc` в шаг 1.
**Зона:** brainer, repo-skeleton. Нужна отмашка + строка в бриф.

### 3. Corepack — ненадёжная опора (deprecated)

Бриф: «corepack сам даёт pnpm». Факты против:

- corepack требует одноразовый `corepack enable` — ручной шаг, противоречит «ставится сам»;
- corepack официально **deprecated**, из будущих мажоров Node его выпиливают — bootstrap,
  построенный на нём, сломается при апгрейде Node.

**Надёжная альтернатива (уже дефолт):** pnpm ≥10 сам менеджит свою версию по полю
`packageManager` (`manage-package-manager-versions`, включён из коробки) — любой глобальный
pnpm 10.x автоматически скачивает и запускает запиненную версию. Corepack не нужен вообще.

**Решение:** в repo-skeleton формулировку шага 1 сменить с «+ corepack» на «пин исполняет сам
pnpm (manage-package-manager-versions); в базовом слое — любой pnpm 10.x».
**Зона:** правка текста repo-skeleton (решение — выше, т.к. это паттерн для всех продукт-репо,
не только brainer).

### 4. pnpm отсутствует в базовом слое машины

Список базового слоя в брифе — `git/node/uv/docker/claude`. Если corepack выпадает (п.3),
pnpm обязан появиться в списке — иначе на чистой машине пин исполнять некому.

**Решение:** в devopser `briefs/workstation-bootstrap.md` базовый слой =
`git / node / pnpm / uv / docker / claude` (версии pnpm/python дальше рулятся пинами репо).
**Зона:** devopser (cross-repo) — правка не моя, передаю.

## Матрица решений

| # | Дыра | Фикс | Где | Кто решает |
|---|---|---|---|---|
| 1 | uv не запинен | `[tool.uv] required-version` | brainer root `pyproject.toml` | отмашка выше → brainer-architect делает |
| 2 | engines = warning | `.npmrc` `engine-strict=true` | brainer root | отмашка выше → brainer-architect делает |
| 3 | corepack deprecated | опора на pnpm self-managed | текст repo-skeleton (паттерн для всех репо) | выше |
| 4 | pnpm нет в base layer | добавить в список | devopser `workstation-bootstrap.md` | выше / devopser |

## Состояние машины (справочно)

Текущая машина базовый слой де-факто уже имеет: git, node 24.13, pnpm 10.11, uv 0.11.28
(поставлен 2026-07-08 в `C:\Users\<user>\.local\bin`, user-level). Тест переносимости из
Verify repo-skeleton пройдёт после пинов.

## После закрытия

Дыры 1–2 → строки в шаг 1 repo-skeleton; 3 → правка формулировки; 4 → devopser.
brainer-architect стартует repo-skeleton по обычному флоу (ветка → коммиты по шагам → PR).

---

## ✅ РЕЗОЛЮЦИЯ (архитектор выше, 2026-07-08)

Все 4 дыры подтверждены, все фиксы одобрены как предложено:

| # | Решение | Статус |
|---|---|---|
| 1 | `[tool.uv] required-version` | ✅ отмашка; строка добавлена в шаг 1 repo-skeleton |
| 2 | `.npmrc` `engine-strict=true` | ✅ отмашка; строка добавлена в шаг 1 |
| 3 | corepack → pnpm ≥10 self-managed | ✅ принято как паттерн ЭКОСИСТЕМЫ — канонизировано в commons `standards/workflow/toolchain-pins.md`; шаг 1 переформулирован |
| 4 | pnpm в базовый слой машины | ✅ devopser-бриф поправлен (слой = 6: git/node/pnpm/uv/docker/claude); bootstrap.ps1 обновляет owner-workstation |

Дополнительно по мотивам этой эскалации в commons добавлен принцип
`canon/principles/foundation-first.md`: **известные дыры базы закрываются ДО старта
разработки, даже не-блокеры** (+ пункт в DoR-чеклист). Поведение «repo-skeleton НЕ стартован,
ждём закрытия дыр» — эталонное, теперь это правило, а не вкусовщина.

**brainer-architect: гейт снят, стартуй repo-skeleton** (шаг 1 в актуальной редакции).
