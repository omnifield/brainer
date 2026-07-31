#!/usr/bin/env node
// pack.mjs — собирает self-contained бандл агент-харнесса для РУЧНОЙ установки (метод #1,
// без npm-публикации и без станка baser). Кладёт в dist/agent-harness-plugin/:
//   harness/       — contentRoot (роли/хуки/helpers/shared-policy/settings.hooks/example)
//   package.json   — манифест обвеса (блок `baser`) — источник раскладки src→dest→class
//   install.mjs    — раскладывает layout по .claude/ / .omnifield/ цели (см. его шапку)
//   INSTALL.md     — инструкция
//
//   node scripts/pack.mjs            # собрать в dist/agent-harness-plugin
//
// Имя папки бандла оставлено прежним осознанно: на него ссылается рамка ролей (gitignore
// бандла и демо). Переименование — отдельный заход, два ломающих в один не идут.
//
// Zero-deps. dist/ гитигнорится; бандл user уносит в другой репо и ставит там.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = dirname(HERE); // packages/harness
const manifest = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8"));
const { baser } = manifest;
const contentRoot = baser.source.contentRoot;

const OUT = join(PKG, "dist", "agent-harness-plugin");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

cpSync(join(PKG, contentRoot), join(OUT, contentRoot), { recursive: true });
cpSync(join(PKG, "package.json"), join(OUT, "package.json"));
cpSync(join(HERE, "install.mjs"), join(OUT, "install.mjs"));

const layoutRows = baser.layout
  .map((f) => `| \`${f.src}\` | \`${f.dest}\` | ${f.class} |`)
  .join("\n");

const INSTALL = `# ${baser.source.title} — ручная установка (метод #1)

Self-contained бандл обвеса \`${baser.source.id}\` (роль-рамка + хуки-гейты + сид роль-модели).
Ставится БЕЗ публикации и без станка. Метод #2 (\`baser apply\` по \`baser.json\`) — когда
установка обвесом подтвердится на живом.

## Установка

\`\`\`bash
# из корня ЦЕЛЕВОГО репо (или укажи путь аргументом):
node /путь/к/agent-harness-plugin/install.mjs .
# сухой прогон — что положит, без записи:
node /путь/к/agent-harness-plugin/install.mjs --dry-run .
\`\`\`

Раскладывает содержимое по \`.claude/\` и \`.omnifield/\` цели (карта ниже). Идемпотентно:
\`regenerated\` перезапишет managed-рамку, \`placed-once\` не тронет существующий файл.

**Если \`.claude/settings.json\` у тебя уже есть** — он твой (permissions, env, свои хуки), и
обвес его не переписывает. Значит регистрацию наших хуков надо дописать руками: готовую строку
печатает \`node .claude/hooks/harness-doctor.mjs\`.

## После установки

1. Заполни \`.omnifield/harness.yaml\` под свой продукт: \`product\`, \`zones\` (\`paths[]\`),
   \`models\`, \`grabli.workspace\`.
2. Проверка: \`node .claude/hooks/harness-doctor.mjs\` (зоны, валидатор, роль, регистрация хуков).
3. Запусти сессию с \`OMNIFIELD_SCOPE=main\` (architect) или \`=<zone>\` (owner) — SessionStart-хук
   впаяет identity; на незаполненном сиде architect стартует в ОНБОРДИНГ-режим (заполните
   \`harness.yaml\` вместе), иначе governance/git-gate сразу держат границы.
4. **Коммить обвязку, НЕ артефакты:** \`.claude/\` + \`.omnifield/harness.yaml\` → в репу; папку
   этого бандла (\`agent-harness-plugin/\`) и демо — в \`.gitignore\`, в репу не клади.

## Раскладка (что куда, на каких правах)

| src (в \`${contentRoot}/\`) | dest у потребителя | class |
|---|---|---|
${layoutRows}

> \`regenerated\` = артефакт наш, перегенерируется целиком · \`placed-once\` = кладём один раз,
> дальше файл ведёт человек.
`;
writeFileSync(join(OUT, "INSTALL.md"), INSTALL);

process.stdout.write(
  `✓ бандл собран: ${OUT}\n` +
    `  ${contentRoot}/ (contentRoot) · package.json · install.mjs · INSTALL.md\n` +
    `  установка в другой репо: node ${join(OUT, "install.mjs")} <target-repo>\n`,
);
