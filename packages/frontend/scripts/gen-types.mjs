// Generates TS domain types from the kernel JSON-schema — the SINGLE source of truth.
// Canon `types-from-zod`: hand-written domain interfaces are forbidden; codegen output is the
// allowed exception. The kernel package owns the schema (Pydantic → JSON-schema); the frontend
// only consumes it. Drift between schema and committed output fails the build + a unit test
// (see src/api/generated/schema-sync.test.ts), so it can never reach prod silently.
//
//   node scripts/gen-types.mjs --write   → regenerate the committed file
//   node scripts/gen-types.mjs --check   → exit 1 if the committed file is stale (build gate)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const here = dirname(fileURLToPath(import.meta.url));
// scripts/ → packages/frontend → packages → kernel/schema
const SCHEMA_DIR = resolve(here, "../../kernel/schema");
const GEN_DIR = resolve(here, "../src/api/generated");

// format:false keeps output deterministic (no prettier version drift); biome ignores generated/.
// additionalProperties is left to the schema itself (it declares false on closed objects, true on
// open `input` maps) so untyped nodes like tool-result `output` render as `unknown`, not a forced
// empty object — the view treats arbitrary JSON as unknown and narrows at the edge.
const OPTS = {
  bannerComment: "",
  format: false,
  declareExternallyReferenced: true,
};

const header = (schemaFile) =>
  [
    "// GENERATED — do not edit by hand.",
    `// Source of truth: packages/kernel/schema/${schemaFile} (kernel owns the contract).`,
    "// Regenerate: pnpm --filter @omnifield/brainer-frontend gen:types",
    "",
    "",
  ].join("\n");

// Each schema → its own file: the two schemas both name a `SessionId` alias, so a single
// concatenated module would collide. Separate modules keep each generation self-contained.
const TARGETS = [
  { schema: "events.schema.json", name: "AgentSessionEvent", out: "events.ts" },
  { schema: "handle.schema.json", name: "AgentSessionHandle", out: "handle.ts" },
];

/** Build { filename → module text } from the kernel schemas. Pure — used by CLI and the drift test. */
export async function generate() {
  const files = {};
  for (const t of TARGETS) {
    const schema = JSON.parse(readFileSync(resolve(SCHEMA_DIR, t.schema), "utf8"));
    files[t.out] = header(t.schema) + (await compile(schema, t.name, OPTS));
  }
  return files;
}

async function main() {
  const mode = process.argv[2];
  const files = await generate();
  if (mode === "--check") {
    for (const [name, next] of Object.entries(files)) {
      let current = "";
      try {
        current = readFileSync(resolve(GEN_DIR, name), "utf8");
      } catch {
        /* missing file → stale */
      }
      if (current !== next) {
        console.error(
          `[gen-types] src/api/generated/${name} is stale vs kernel schema. Run: pnpm gen:types`,
        );
        process.exit(1);
      }
    }
    return;
  }
  for (const [name, next] of Object.entries(files)) {
    writeFileSync(resolve(GEN_DIR, name), next);
    console.log(`[gen-types] wrote src/api/generated/${name}`);
  }
}

// Run only when invoked directly (not when imported by the drift test).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
