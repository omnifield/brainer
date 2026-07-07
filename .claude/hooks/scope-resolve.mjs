#!/usr/bin/env node
// scope-resolve.mjs — единый маппинг scope → зона brainer. Двойной режим:
//   - CLI: `node scope-resolve.mjs <scope>` → stdout JSON, exit 0 (OK) | exit 1 (unknown).
//   - import: `import { resolveScope } from './scope-resolve.mjs'`.
//
// scope = leaf-имя зоны (либо 'main' = architect). Зоны brainer (packages/<name>/).

export const ZONES = {
  kernel: { relativePath: 'packages/kernel', name: 'kernel — agent-as-provider seam (capability/provider/router/entitlement)' },
  orchestrator: { relativePath: 'packages/orchestrator', name: 'orchestrator — session lifecycle + provider registry + telemetry aggregation' },
  backend: { relativePath: 'packages/backend', name: 'backend — product API/BFF over orchestrator' },
  frontend: { relativePath: 'packages/frontend', name: 'frontend — control-panel dashboard (the interface)' },
  content: { relativePath: 'content', name: 'content — doc etalons (dogfood)' },
};

export function resolveScope(scope) {
  if (scope === 'main') return { kind: 'main', scope: 'main' };
  const zone = ZONES[scope];
  if (!zone) return null;
  return { kind: 'zone', scope, relativePath: zone.relativePath, name: zone.name };
}

import { fileURLToPath } from 'node:url';
import { argv } from 'node:process';

if (fileURLToPath(import.meta.url) === argv[1]) {
  const scope = argv[2];
  const resolved = resolveScope(scope);
  if (!resolved) {
    const list = ['main', ...Object.keys(ZONES)].join(', ');
    process.stderr.write(`ERROR: unknown scope "${scope}". Доступные: ${list}\n`);
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(resolved));
  process.exit(0);
}
