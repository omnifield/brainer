#!/usr/bin/env node
// main-session-marker.mjs — SessionStart hook: пишет session_id в marker ТОЛЬКО для scope 'main'.
//
// user запускает каждую сессию через `claude-scope.ps1 -Scope <name>` (ставит OMNIFIELD_SCOPE).
// Destructive git ops по канону — только scope 'main' (architect). Любой другой scope
// (owner-*) НЕ должен трогать marker, иначе перезапишет main marker своим id и main
// потеряет git-доступ. Поэтому marker пишется ТОЛЬКО если OMNIFIELD_SCOPE === 'main'.
//
// Subagents (Agent tool) SessionStart НЕ триггерят → сюда не попадают → всегда gated.
//
// Contract (SessionStart): stdin JSON { session_id, cwd, ... }; stdout {}; exit 0 (fail-open).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function silent() {
  process.stdout.write('{}');
  process.exit(0);
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    silent();
    return;
  }

  const scope = process.env.OMNIFIELD_SCOPE;
  if (scope !== 'main') {
    silent();
    return;
  }

  const sessionId = input.session_id;
  const cwd = input.cwd || process.cwd();
  if (!sessionId) {
    silent();
    return;
  }

  const marker = join(cwd, '.claude', '.main-session-id');
  try {
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, String(sessionId), 'utf8');
  } catch {
    /* fail-open */
  }

  silent();
}

try {
  main();
} catch {
  silent();
}
