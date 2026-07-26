#!/usr/bin/env node
// pack.mjs — собирает self-contained бандл agent-harness-плагина для РУЧНОЙ установки
// (метод #1, без npm-публикации). Кладёт в dist/agent-harness-plugin/:
//   harness/        — contentRoot (роли/хуки/helpers/shared-policy/settings.hooks/example)
//   plugin.json     — манифест (omnifield.frame) — источник карты src→dest
//   install.mjs     — раскладывает frame по .claude/ / .omnifield/ цели (см. его шапку)
//   INSTALL.md      — инструкция
//
//   node scripts/pack.mjs            # собрать в dist/agent-harness-plugin
//
// Zero-deps. dist/ гитигнорится; бандл user уносит в другой репо и ставит там.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = dirname(HERE); // packages/harness
const manifest = JSON.parse(readFileSync(join(PKG, "plugin.json"), "utf8"));
const contentRoot = manifest.omnifield.contentRoot;

const OUT = join(PKG, "dist", "agent-harness-plugin");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// contentRoot целиком (несёт и settings-block.mjs, который импортит install.mjs).
cpSync(join(PKG, contentRoot), join(OUT, contentRoot), { recursive: true });
cpSync(join(PKG, "plugin.json"), join(OUT, "plugin.json"));
cpSync(join(HERE, "install.mjs"), join(OUT, "install.mjs"));

const frameRows = manifest.omnifield.frame
  .map((f) => `| \`${f.src}\` | \`${f.dest}\` | ${f.mode} |`)
  .join("\n");

const INSTALL = `# agent-harness — ручная установка (метод #1)

Self-contained бандл plugin-капабилити \`agent-harness\` (роль-рамка + пресет-сид). Ставится
БЕЗ публикации/движка. Метод #2 (движковый \`skeleton init\`) — когда доставка будет готова.

## Установка

\`\`\`bash
# из корня ЦЕЛЕВОГО репо (или укажи путь аргументом):
node /путь/к/agent-harness-plugin/install.mjs .
# сухой прогон — что положит, без записи:
node /путь/к/agent-harness-plugin/install.mjs --dry-run .
\`\`\`

Раскладывает контент по \`.claude/\` и \`.omnifield/\` цели (карта frame ниже). Идемпотентно:
\`exact\` перезапишет managed-рамку, \`seed\` не тронет существующий \`.omnifield/harness.yaml\`,
\`merge\` вольёт хук-регистрацию в \`.claude/settings.json\` без потери твоих настроек.

## После установки

1. Заполни \`.omnifield/harness.yaml\` под свой продукт: \`product\`, \`zones\` (\`paths[]\`),
   \`models\`, \`grabli.workspace\`.
2. Проверка: \`node .claude/hooks/harness-doctor.mjs\` (зоны, валидатор, роль, grabli).
3. Запусти сессию с \`OMNIFIELD_SCOPE=main\` (architect) или \`=<zone>\` (owner) — SessionStart-хук
   впаяет identity; governance/git-gate начнут держать границы.

## Карта frame (что куда, режим)

| src (в \`harness/\`) | dest у потребителя | mode |
|---|---|---|
${frameRows}

> \`exact\` = managed-рамка (перезапись) · \`seed\` = создать-если-нет (владеет продукт) ·
> \`merge\` = JSON deep-merge (settings.json).
`;
writeFileSync(join(OUT, "INSTALL.md"), INSTALL);

process.stdout.write(
  `✓ бандл собран: ${OUT}\n` +
    `  harness/ (contentRoot) · plugin.json · install.mjs · INSTALL.md\n` +
    `  установка в другой репо: node ${join(OUT, "install.mjs")} <target-repo>\n`,
);
