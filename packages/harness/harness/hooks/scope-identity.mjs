#!/usr/bin/env node
// scope-identity.mjs — SessionStart hook: инжектит identity-баннер по OMNIFIELD_SCOPE.
// Роль-модель (зоны/пины моделей/число архитекторов) — ДАННЫЕ из `.omnifield/harness.yaml`
// (kb:BRAIN-3), НЕ хардкод. Роли-рамка (инварианты) — .claude/agents/{architect,owner,layer}.md.
//   - 'main'         → architect;  <zone> → owner-<zone>;  пусто → no-op;  невалид → anomaly.
//
// Contract (SessionStart): stdout { hookSpecificOutput: { hookEventName, additionalContext } }.
// Subagents (Agent tool) SessionStart НЕ триггерят — их identity из subagent_type prompt'а.

import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { knownScopes, loadConfig, resolveScope } from "./harness-config.mjs";

function silent() {
  process.stdout.write("{}");
  process.exit(0);
}

function emit(additionalContext) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }),
  );
  process.exit(0);
}

function modelLine(config, role) {
  const pin = config.models?.[role];
  return pin ? ` (модель-пин: \`${pin}\`)` : "";
}

function architectBanner(config) {
  return [
    `# Session identity — OMNIFIELD_SCOPE=main (architect)${modelLine(config, "architect")}`,
    ``,
    `Ты в роли **architect/main** репо \`brainer\`. Правила — \`CLAUDE.md\` + \`.claude/agents/architect.md\`.`,
    `Роль-модель — данные \`.omnifield/harness.yaml\` (архитекторов сконфигурено: ${config.architects}).`,
    ``,
    `- Триаж запросов user; арх-решения/контракты (в knowledger), координация овнеров брифами.`,
    `- **НЕ пиши код зон сам** — брифы (\`briefs/\`) → owner-сессии (user запускает).`,
    `- Git: полный доступ (commit/push/merge) — marker \`.claude/.main-session-id\` даёт права.`,
    `- Owner-субагенты (Agent tool) и user-launched owner-сессии — под git-gate.`,
  ].join("\n");
}

function ownerBanner(config, { scope, relativePath, name }) {
  return [
    `# Session identity — OMNIFIELD_SCOPE=${scope} (owner-${scope})${modelLine(config, "owner")}`,
    ``,
    `Ты в роли **owner-${scope}**, владелец зоны \`${relativePath}/\` (${name}).`,
    `**Ты НЕ architect** — секции CLAUDE.md про architect игнорируй.`,
    ``,
    `## Зона (boundary)`,
    `- Edits — ТОЛЬКО внутри \`${relativePath}/\`. Чужая зона → STOP, верни state architect.`,
    `- Перед первым Edit прочитай \`${relativePath}/README.md\` (+ OWNERSHIP.md если есть).`,
    ``,
    `## Правила (канон)`,
    `- Первым читаешь \`.claude/agents/shared-policy.md\`.`,
    `- **НЕ пиши ADR**, не принимай cross-zone решения — это architect. Упёрлось → STOP + эскалация.`,
    `- **Git: commit-only** (под git-gate). Push/merge — architect после ревью. Conventional: \`feat(${scope}): ...\`.`,
    `- Хук заблокировал git — НЕ обходи (\`bash -c\`/\`&&\`/\`--no-verify\`). STOP + эскалация.`,
    `- POLICY priority 0: никаких костылей, причина не следствие, DoD = код+тесты+трейсы+доки.`,
    ``,
    `## Скоуп задачи`,
    `Ждёшь brief-файл (\`briefs/...\`) или прямую задачу. Непонятен scope — STOP, спроси. Не угадывай.`,
  ].join("\n");
}

function anomalyBanner(config, scope) {
  const list = knownScopes(config).join(", ");
  return [
    `# Session identity — OMNIFIELD_SCOPE=${scope} (UNRESOLVED)`,
    ``,
    `**Аномалия**: scope "${scope}" не резолвится в зону (нет в \`.omnifield/harness.yaml\`).`,
    `devbox-session.sh должен был блокировать запуск. Доступные: ${list}.`,
    ``,
    `**Action**: STOP. Сообщи user — scope невалидный. Не начинай работу (нет boundary/ownership).`,
  ].join("\n");
}

function main() {
  const scope = process.env.OMNIFIELD_SCOPE;
  if (!scope) return silent();
  const config = loadConfig(process.cwd());
  if (scope === "main") return emit(architectBanner(config));
  const resolved = resolveScope(scope, config);
  if (resolved?.kind !== "zone") return emit(anomalyBanner(config, scope));
  return emit(ownerBanner(config, resolved));
}

// Исполняем main() ТОЛЬКО как скрипт (main вызывает process.exit) — при import безопасно.
if (fileURLToPath(import.meta.url) === argv[1]) {
  try {
    main();
  } catch {
    silent();
  }
}
