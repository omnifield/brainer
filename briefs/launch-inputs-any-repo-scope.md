# Brief — 🕳 fix: Launch — repo/scope как combobox (любое значение), не жёсткий select

| | |
|---|---|
| **Scope** | `frontend` (`packages/frontend/`) |
| **Owner** | owner-frontend (запускает user) |
| **Класс** | дыро-фикс функционала пульта (роль brainer = пульт, `plan-sync-framework-migration.md`) |
| **Параллельно** | owner-backend исполняет `fix-backend-repo-registry.md` (реестр env-first) |

## Факты

- `screens/Launch.tsx` — repo и scope рендерятся `<select>` из `KNOWN_REPOS` /
  `KNOWN_SCOPES` (`api/mock/fixtures.ts`): захардкоженные списки МОКА диктуют,
  чем можно управлять в проде. User сейчас управляет weber- и chater-агентами —
  их выбрать невозможно.
- Скоупы у каждого репо свои (у weber/chater — не brainer'овские kernel/backend/…),
  фиксированный список неверен в принципе.

## Fix

1. Repo и scope → **`<input>` + `<datalist>`**: любое значение руками, известные —
   подсказками. Подсказки оставить из текущих констант, ПЕРЕИМЕНОВАВ в
   `SUGGESTED_*` и переместив из `api/mock/fixtures.ts` в код экрана (или
   локальный конст-модуль): mock-фикстуры не источник прод-данных.
   В подсказки repo добавить `omnifield/weber`, `omnifield/chater`.
2. Валидация минимальная: непустой repo/scope; ошибку запуска и так показывает
   backend (`404 unknown repo` уже читаемо прилетает в форму).
3. Пометка «(architect)/(owner)» у scope: держать по правилу `main → architect,
   иначе owner` для ЛЮБОГО введённого значения (см. `role_for_scope` backend).
4. TODO-коммент у подсказок: источник — реестр backend'а (будущий endpoint),
   не константы; продукт-беклог architect'а.

## Verify (DoD)

- В Launch можно ввести произвольные repo/scope и заспавнить; подсказки работают.
- Спавн на невключённый в реестр repo → ошибка backend'а видна в форме (не тихо).
- `pnpm test` / `lint` / `build` зелёные; тесты Launch (если есть) обновлены.

## Заметки

- Git: commit-only, `fix(frontend): ...`; push — architect.
- Работа — в контейнере; можно спавнить ЧЕРЕЗ ПУЛЬТ (repo `omnifield/brainer`,
  scope `frontend`, brief `briefs/launch-inputs-any-repo-scope.md`).
