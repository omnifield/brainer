# OWNERSHIP — packages/harness

- **Зона:** `packages/harness/` — обвес `@omnifield/brainer-harness` (личность `brainer/harness`):
  ролевая рамка + хуки-гейты + сид роль-модели + объявление и доставка.
- **Владелец:** `owner-harness` (`OMNIFIELD_SCOPE=harness`). Full lifecycle зоны:
  код + тесты + трейсы + доки. Commit-only под git-gate; push и `pnpm publish` — architect.
- **Граница:** правки ТОЛЬКО внутри этой папки. Станок, дверь и движок материализации
  (`@omnifield/baser-*`) — зона **baser**, не трогаем; форму менять нельзя, упёрлось →
  STOP + эскалация к architect. `.claude/` и `baser.json` в корне — вне зоны: синхронизацию
  копии и объявление источника делает architect.
- **Публичный шов:** блок `baser` в `package.json` (форма 3) — единственное объявление,
  вендор-зеркала нет. `contentRoot: harness/` — содержимое обвеса.
- **Канон:** README `@omnifield/baser-contracts` (форма), `kb:BASER2-2` (концепт станка и
  классы артефакта), `kb:BRAIN2-12` (роли), `kb:BRAIN2-11` (зоны), `kb:BRAIN2-14` (онбординг),
  `omnifield/commons/standards/agents/`.
- **Соседние вехи:** `tasker:BRAIN2-17` (итерация 2 — пакет становится обвесом),
  `tasker:BRAIN2-41` (этот заход), `tasker:BRAIN2-35` (публикация в `@omnifield`).
