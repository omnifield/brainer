# Brief — 🕳 fix: реестр репо без path-угадывания (config.py `parents[4]`)

| | |
|---|---|
| **Scope** | `backend` (`packages/backend/`) |
| **Owner** | owner-backend (запускает user) |
| **Класс** | дыро-фикс (foundation-first) — идёт до любой фичевой работы |
| **Происхождение** | заметка architect'а в PR#2 (repo-skeleton): 3 теста красные при чекауте в папку с другим именем |

> **⚠️ АПДЕЙТ architect 2026-07-11 (контейнер-реальность, приоритет ПОДНЯТ)** —
> бриф разблокирует управление weber через пульт (план оракула
> `plan-sync-framework-migration.md`), исполнять с поправками:
> 1. Раскладка теперь контейнерная: рабочие копии в `/workspaces/*`
>    (bind-mount `~/omnifield` целиком, лаунчер `devbox-session.sh`).
>    `_OMNIFIELD_ROOT`-угадайка и имена-хардкоды — те же дыры, направление фикса
>    не меняется.
> 2. **Маркер discovery — `.claude/` (каталог харнесса), НЕ `claude-scope.ps1`**:
>    ps1-лаунчер после пересадки — легаси (в новых репо его не будет никогда);
>    `.claude/` — фактический признак «репо живёт под agent-харнессом».
> 3. `BRAINER_REPOS` (env-first, приоритет над discovery) — БЕЗ маркер-фильтра:
>    явное перечисление = доверенное. Пример боевого значения:
>    `omnifield/brainer=/workspaces/brainer;omnifield/weber=/workspaces/weber`
>    (weber пока без `.claude` — до его пересадки входит только через env).
> 4. Env в контейнер прокидывает лаунчер (правка architect после этого фикса) —
>    в коде дефолты не прибивать.
> 5. Упоминание `BRAINER_LOKI_URL` в фактах — атавизм, такого env больше нет;
>    паттерн env-first смотреть по живому `config.py` (`BRAINER_OTEL_ENDPOINT`).

## Факты

- `app/config.py:15` — `_OMNIFIELD_ROOT = Path(__file__).resolve().parents[4]`: корень
  экосистемы **угадывается счётом родителей** файла. Это hardcoded-path из стоп-каталога
  канона (root-cause-not-symptom: стоп-сигналы костыля).
- `app/config.py:30-40` (`_default_repos`) — кандидаты захардкожены **по именам папок**:
  `_OMNIFIELD_ROOT / "brainer"`, `_OMNIFIELD_ROOT / "writer"`.
- Отказ: чекаут в `brainer-clone` (или любой не-канон layout) → `<родитель>/brainer` не
  существует → реестр **молча пуст** → 3 теста красные, спавн сессий невозможен.
- Уже правильное рядом (не сломать): маркер спавнабельности `claude-scope.ps1` уже
  используется как фильтр (`config.py:39`); все остальные настройки Settings — env-first
  (`BRAINER_LOKI_URL` и т.д.) — реестр должен жить по тому же паттерну.

## Fix (направление)

1. **Env-first:** `BRAINER_REPOS` — явный список `name=path` (разделитель `;`), приоритет
   над discovery. Формат задокументировать в docstring + README зоны.
2. **Default-discovery без имён и без счёта родителей:**
   - свой корень = walk **вверх** от `__file__` до первой директории с маркером
     `claude-scope.ps1` (не `parents[N]`, не имя папки);
   - соседи = скан родителя своего корня: любая директория с `claude-scope.ps1` = managed
     repo (имя — из самой директории или конвенции `omnifield/<dirname>`).
3. **Тесты не зависят от layout машины:** фикстуры на `tmp_path` с фейковыми
   `claude-scope.ps1`; `Settings(repos=...)` инжект уже возможен (dataclass field) — юзать.

## Verify (DoD)

- Клон репо в папку с **любым** именем (проверить буквально: `brainer-clone`) → `uv run pytest`
  зелёный без env-переменных.
- `BRAINER_REPOS` переопределяет discovery (unit).
- Реальный e2e спавна не сломан: backend поднимается, `/api/sessions` живой, launch работает
  (флоу из `briefs/backend-mvp.md` §Verify).

## Вне скоупа

Перенос карты репо в devopser `registry/products.md` как runtime-источник — будущее решение
architect'ов (отметить TODO в docstring), сейчас env+discovery достаточно.

## Заметки

- Git: commit-only, `fix(backend): ...`; push/merge — architect после ревью.
