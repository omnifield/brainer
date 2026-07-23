# OWNERSHIP — packages/harness

- **Зона:** `packages/harness/` — плагин `@brainer/agent-harness-plugin` (ролевая рамка +
  пресет-сид + метаданные + доставка).
- **Владелец:** `owner-harness` (`OMNIFIELD_SCOPE=harness`). Full lifecycle зоны:
  код + тесты + трейсы + доки. Commit-only под git-gate; push/merge — architect.
- **Граница:** правки ТОЛЬКО внутри этой папки. Движок/материализатор (`init.mjs`,
  DISPATCH, валидатор контракта) — зона **devopser**, не трогаем. Контракт `kb:DEVOPSER-6`
  — первоисточник; менять контракт нельзя, упёрлось → STOP + эскалация к architect.
- **Публичный шов:** `omnifield`-блок (`package.json` + `plugin.json`, зеркала) — по
  контракту `kb:DEVOPSER-6`. contentRoot `harness/` — контент капабилити.
- **Канон:** `kb:DEVOPSER-6` (контракт), `kb:BRAIN-3` (роли), `kb:BRAIN-2` (зоны),
  `omnifield/commons/standards/agents/`.
- **Соседние вехи:** `tasker:BRAIN-9` (этот пакет), `tasker:BRAIN-10` (рантайм-хуки
  config-driven), `tasker:BRAIN-11` (зависимость от devopser: движок принимает внешний
  target).
