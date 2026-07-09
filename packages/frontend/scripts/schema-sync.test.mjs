import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generate } from "./gen-types.mjs";

// Drift guard (brief DoD): the committed generated types MUST equal a fresh generation from the
// kernel schema. Edit the schema without running `pnpm gen:types` and this test goes red — so the
// schema/types split breaks CI, never prod. Lives in scripts/ (plain .mjs) so tsc doesn't try to
// typecheck the JS generator import; vitest picks it up via the default test glob.

const genDir = resolve(dirname(fileURLToPath(import.meta.url)), "../src/api/generated");

describe("generated domain types are in sync with the kernel JSON-schema", () => {
  it("committed files match a fresh generation", async () => {
    const files = await generate();
    for (const [name, expected] of Object.entries(files)) {
      const committed = readFileSync(resolve(genDir, name), "utf8");
      expect(committed, `src/api/generated/${name} is stale — run: pnpm gen:types`).toBe(expected);
    }
  });
});
