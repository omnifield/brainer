#!/usr/bin/env node
// scope-identity.mjs — SessionStart hook: инжектит identity-баннер по OMNIFIELD_SCOPE.
//   - 'main'      → architect (CLAUDE.md описывает роль; кладём лёгкий reminder).
//   - <zone>      → owner-<zone> (иначе агент по умолчанию думает что он architect).
//   - пусто/невалид → no-op / anomaly-баннер.
//
// Contract (SessionStart): stdout { hookSpecificOutput: { hookEventName, additionalContext } }.
// Subagents (Agent tool) SessionStart НЕ триггерят — их identity из subagent_type prompt'а.

import { resolveScope, ZONES } from './scope-resolve.mjs';

function silent() {
  process.stdout.write('{}');
  process.exit(0);
}

function emit(additionalContext) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }),
  );
  process.exit(0);
}

function architectBanner() {
  return [
    `# Session identity — OMNIFIELD_SCOPE=main (architect)`,
    ``,
    `Ты в роли **architect/main** репо \`writer\`. Правила — \`CLAUDE.md\` + канон \`omnifield/commons/standards/\`.`,
    ``,
    `- Триаж запросов user; арх-решения (ADR в оракуле → commons), контракты, координация.`,
    `- **НЕ пиши код зон сам** (\`kernel/ engine/ backend/ frontend/\`) — брифы (\`briefs/\`) → owner-сессии (user запускает через \`claude-scope\`).`,
    `- Git: полный доступ (commit/push/merge) — marker \`.claude/.main-session-id\` даёт права.`,
    `- Owner-субагенты (Agent tool) и user-launched owner-сессии — под git-gate.`,
  ].join('\n');
}

function ownerBanner({ scope, relativePath, name }) {
  return [
    `# Session identity — OMNIFIELD_SCOPE=${scope} (owner-${scope})`,
    ``,
    `Ты в роли **owner-${scope}**, владелец зоны \`${relativePath}/\` (${name}).`,
    `**Ты НЕ architect** — секции CLAUDE.md про architect игнорируй.`,
    ``,
    `## Зона (boundary)`,
    `- Edits — ТОЛЬКО внутри \`${relativePath}/\`. Чужая зона → STOP, верни state architect.`,
    `- Перед первым Edit прочитай \`${relativePath}/README.md\` (+ OWNERSHIP.md если есть).`,
    ``,
    `## Правила (канон commons)`,
    `- Первым читаешь \`omnifield/commons/standards/agents/shared-policy.md\`.`,
    `- **НЕ пиши ADR**, не принимай cross-zone решения — это architect. Упёрлось в чужую зону/контракт → STOP + эскалация.`,
    `- **Git: commit-only** (под git-gate). Push/merge — architect после ревью. Conventional: \`feat(${scope}): ...\`.`,
    `- Хук заблокировал git — НЕ обходи (\`bash -c\`/\`&&\`/\`--no-verify\`). STOP + эскалация.`,
    `- POLICY priority 0: никаких костылей, причина не следствие, DoD = код+тесты+трейсы+доки.`,
    ``,
    `## Скоуп задачи`,
    `Ждёшь brief-файл (\`briefs/...\`) или прямую задачу. Непонятен scope — STOP, спроси. Не угадывай.`,
  ].join('\n');
}

function anomalyBanner(scope) {
  const list = ['main', ...Object.keys(ZONES)].join(', ');
  return [
    `# Session identity — OMNIFIELD_SCOPE=${scope} (UNRESOLVED)`,
    ``,
    `**Аномалия**: scope "${scope}" не резолвится в зону. claude-scope должен был блокировать запуск.`,
    `Доступные: ${list}.`,
    ``,
    `**Action**: STOP. Сообщи user — scope невалидный. Не начинай работу (нет boundary/ownership).`,
  ].join('\n');
}

function main() {
  const scope = process.env.OMNIFIELD_SCOPE;
  if (!scope) {
    silent();
    return;
  }
  if (scope === 'main') {
    emit(architectBanner());
    return;
  }
  const resolved = resolveScope(scope);
  if (!resolved || resolved.kind !== 'zone') {
    emit(anomalyBanner(scope));
    return;
  }
  emit(ownerBanner(resolved));
}

try {
  main();
} catch {
  silent();
}
