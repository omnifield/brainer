#!/usr/bin/env node
// git-gate.mjs — PreToolUse hook: hard-gate на write-операции git/gh.
//
// Несколько agent'ов (owner-сессии) могут работать в одном shared working tree
// (одна .git). Неконтролируемая смена HEAD (`git switch`) или публикация (`git push`)
// размазывает работу соседей и ведёт к мусорным коммитам / конфликтам.
//
// Промпт-уровень под нагрузкой задачи игнорится. Этот хук — hard-gate: режет все
// write-операции независимо от того, помнит agent правило или нет.
//
// Контракт (Claude Code PreToolUse):
//   stdin  = JSON { tool_name, tool_input: { command }, session_id, cwd, ... }
//   stdout = JSON { hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason } }
//   exit 0 всегда; решение — через permissionDecision (deny|allow). FAIL-OPEN на внутренних ошибках.
//
// Main session (architect) — full git access. Owner-сессии/subagents — gated.
// Различение через marker `.claude/.main-session-id` (пишет main-session-marker.mjs
// в SessionStart ТОЛЬКО для scope 'main'). session_id совпал с маркером → main → allow всё.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function allow() {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
    }),
  );
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

// Префикс, после которого может идти git/gh: начало строки, пробел, `;`, `&&`, `||`, `|`, кавычка.
const PFX = '(?:^|[\\s;|&"\'`])';
// `git` может идти с global-options перед verb'ом (git -C path --no-pager <verb>).
const GIT_PFX = `${PFX}git\\s+(?:[^\\s]+\\s+){0,6}`;

const DENY_RULES = [
  { rx: new RegExp(`${GIT_PFX}switch(?:\\s|$)`, 'i'), label: 'git switch' },
  { rx: new RegExp(`${GIT_PFX}checkout\\s+-b\\b`, 'i'), label: 'git checkout -b' },
  { rx: new RegExp(`${GIT_PFX}push(?:\\s|$)`, 'i'), label: 'git push' },
  { rx: new RegExp(`${GIT_PFX}merge(?:\\s|$)`, 'i'), label: 'git merge' },
  { rx: new RegExp(`${GIT_PFX}rebase(?:\\s|$)`, 'i'), label: 'git rebase' },
  { rx: new RegExp(`${GIT_PFX}reset\\s+--(?:hard|keep)\\b`, 'i'), label: 'git reset --hard/--keep' },
  { rx: new RegExp(`${GIT_PFX}branch\\s+-(?:D|f|m|M)\\b`), label: 'git branch -D/-f/-m' },
  {
    rx: new RegExp(`${GIT_PFX}worktree\\s+(?:add|remove|move)\\b`, 'i'),
    label: 'git worktree add/remove/move',
  },
  { rx: new RegExp(`${PFX}gh\\s+pr\\s+(?:create|merge|close|reopen|edit)\\b`, 'i'), label: 'gh pr write' },
];

// `git checkout <branch>` режется ТОЛЬКО если нет ` -- ` (path-restore форма пускается).
function matchesCheckoutBranch(cmd) {
  const rx = new RegExp(`${GIT_PFX}checkout(?!\\s+-b\\b)\\b`, 'i');
  if (!rx.test(cmd)) return null;
  if (/\s--(?:\s|$)/.test(cmd)) return null;
  return 'git checkout <branch>';
}

function blockReason(cmd) {
  for (const { rx, label } of DENY_RULES) {
    if (rx.test(cmd)) return label;
  }
  return matchesCheckoutBranch(cmd);
}

function buildMessage(cmd, label) {
  return [
    `❌ Команда \`${cmd}\` заблокирована harness-хуком (git-gate).`,
    '',
    `Причина: \`${label}\` меняет HEAD / публикует / переписывает историю на shared \`.git\`.`,
    '',
    'Действие: STOP. Не пытайся обойти (через `bash -c`, `&&`, кавычки — хук видит полную команду).',
    'Верни state architect. Architect либо сделает операцию сам, либо выдаст отдельный worktree.',
  ].join('\n');
}

function isMainSession(input) {
  const sessionId = input?.session_id;
  if (!sessionId) return false;
  const cwd = input.cwd || process.cwd();
  try {
    const marker = readFileSync(join(cwd, '.claude', '.main-session-id'), 'utf8').trim();
    return marker.length > 0 && marker === String(sessionId);
  } catch {
    return false;
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    allow();
    return;
  }

  if (input.tool_name !== 'Bash') {
    allow();
    return;
  }

  const cmd = String(input.tool_input?.command ?? '');
  if (!cmd) {
    allow();
    return;
  }

  const reason = blockReason(cmd);
  if (!reason) {
    allow();
    return;
  }

  if (isMainSession(input)) {
    allow();
    return;
  }

  deny(buildMessage(cmd, reason));
}

try {
  main();
} catch {
  // FAIL-OPEN: внутренняя ошибка хука не должна ломать read-only команды.
  allow();
}
