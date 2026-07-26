// governance.test.mjs — машинная граница правок (BRAIN2-2): governance-хук режет
// Edit/Write/NotebookEdit вне paths[] owner'а. Пути (обход `..`/симлинк), роли, subagent.
// node:test, ноль зависимостей.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  editViolation,
  isEditTool,
  ownedRoots,
  targetPath,
  within,
} from "../harness/hooks/governance.mjs";
import { normalizeConfig } from "../harness/hooks/harness-config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOV_HOOK = join(HERE, "..", "harness", "hooks", "governance.mjs");
// Реальная фикстура-продукт с зонами (alpha: packages/alpha[-shared], beta: services/beta) —
// для e2e через stdin, где хук сам loadConfig(cwd).
const PRODUCT_FIXTURE = join(HERE, "fixtures", "product");

// Конфиг: alpha владеет ДВУМЯ папками, beta — одной. repoRoot фиктивный (пути резолвятся,
// файлам существовать не обязательно — resolveTarget поднимается до реального предка `/`).
const config = normalizeConfig({
  zones: {
    alpha: { paths: ["packages/alpha", "packages/alpha-shared"] },
    beta: { paths: ["services/beta"] },
  },
});
const REPO = "/repo";

function violate(scope, rawPath, cfg = config) {
  return editViolation({ scope, config: cfg, repoRoot: REPO, rawPath });
}

// --- базовые helpers ---------------------------------------------------------

test("isEditTool: Edit/Write/NotebookEdit/MultiEdit — да, Bash/Read — нет", () => {
  for (const t of ["Edit", "Write", "NotebookEdit", "MultiEdit"]) assert.equal(isEditTool(t), true);
  for (const t of ["Bash", "Read", "Grep"]) assert.equal(isEditTool(t), false);
});

test("targetPath: file_path (Edit/Write) и notebook_path (NotebookEdit)", () => {
  assert.equal(targetPath({ tool_input: { file_path: "a.js" } }), "a.js");
  assert.equal(targetPath({ tool_input: { notebook_path: "n.ipynb" } }), "n.ipynb");
  assert.equal(targetPath({ tool_input: {} }), null);
});

test("within: точное совпадение и вложенность — да; ложный префикс — нет", () => {
  assert.equal(within("/repo/packages/alpha", "/repo/packages/alpha"), true);
  assert.equal(within("/repo/packages/alpha/x.js", "/repo/packages/alpha"), true);
  assert.equal(within("/repo/packages/alpha-shared/x", "/repo/packages/alpha"), false); // не префикс-сегмент
  assert.equal(within("/repo/packages/beta/x", "/repo/packages/alpha"), false);
});

// --- роли --------------------------------------------------------------------

test("owner: правка ВНУТРИ своей зоны (обе папки) → allow", () => {
  assert.equal(violate("alpha", "packages/alpha/src/x.js"), null);
  assert.equal(violate("alpha", "packages/alpha-shared/util.js"), null); // вторая папка массива
  assert.equal(violate("beta", "services/beta/main.py"), null);
});

test("owner: правка ВНЕ своей зоны → deny с причиной", () => {
  const r = violate("alpha", "services/beta/main.py");
  assert.ok(r, "ожидался deny");
  assert.match(r, /вне зоны owner-alpha/);
});

test("owner: правка чужой папки соседа → deny", () => {
  assert.ok(violate("beta", "packages/alpha/x.js"));
});

test("architect (main): без ограничения по путям → allow всё", () => {
  assert.equal(violate("main", "packages/alpha/x.js"), null);
  assert.equal(violate("main", "any/where/config.json"), null);
});

test("layer: файлы не ограничиваем (узость промптом; git=none) → allow", () => {
  assert.equal(violate("layer", "whatever/file.md"), null);
});

test("неизвестный scope (нерезолвимая зона) → deny всё (нет boundary)", () => {
  const r = violate("gamma", "packages/alpha/x.js");
  assert.ok(r);
  assert.match(r, /не резолвится|boundary/);
});

// --- обход границы -----------------------------------------------------------

test("обход через `..` (относительный escape) → resolve сворачивает → deny", () => {
  const r = violate("alpha", "packages/alpha/../../services/beta/x.py");
  assert.ok(r, "escape через .. должен блокироваться");
});

test("обход через `..` наружу репо → deny", () => {
  assert.ok(violate("alpha", "packages/alpha/../../../etc/passwd"));
});

test("абсолютный путь вне зоны → deny", () => {
  assert.ok(violate("alpha", "/etc/passwd"));
});

// --- ownedRoots --------------------------------------------------------------

test("ownedRoots: architect/layer unrestricted; owner — корни zonePaths; unknown — пусто", () => {
  assert.equal(ownedRoots("main", config, REPO).unrestricted, true);
  assert.equal(ownedRoots("layer", config, REPO).unrestricted, true);
  const own = ownedRoots("alpha", config, REPO);
  assert.equal(own.unrestricted, false);
  assert.deepEqual(own.roots, [`${REPO}/packages/alpha`, `${REPO}/packages/alpha-shared`]);
  assert.deepEqual(ownedRoots("gamma", config, REPO).roots, []);
});

// --- обход через СИМЛИНК (реальный FS) ---------------------------------------

test("обход через симлинк-папку наружу зоны → realpath ловит → deny", () => {
  const root = mkdtempSync(join(tmpdir(), "gov-"));
  mkdirSync(join(root, "packages", "alpha"), { recursive: true });
  const outside = mkdtempSync(join(tmpdir(), "gov-out-"));
  writeFileSync(join(outside, "secret.txt"), "x");
  // симлинк внутри зоны, ведущий НАРУЖУ
  symlinkSync(outside, join(root, "packages", "alpha", "link"));
  const cfg = normalizeConfig({ zones: { alpha: { paths: ["packages/alpha"] } } });
  const r = editViolation({
    scope: "alpha",
    config: cfg,
    repoRoot: root,
    rawPath: "packages/alpha/link/secret.txt",
  });
  assert.ok(r, "правка через симлинк наружу должна блокироваться");
});

test("симлинк ВНУТРИ зоны (не наружу) → allow", () => {
  const root = mkdtempSync(join(tmpdir(), "gov-in-"));
  mkdirSync(join(root, "packages", "alpha", "real"), { recursive: true });
  symlinkSync(join(root, "packages", "alpha", "real"), join(root, "packages", "alpha", "link"));
  const cfg = normalizeConfig({ zones: { alpha: { paths: ["packages/alpha"] } } });
  const r = editViolation({
    scope: "alpha",
    config: cfg,
    repoRoot: root,
    rawPath: "packages/alpha/link/x.js",
  });
  assert.equal(r, null);
});

// --- end-to-end через stdin (main() + matcher + non-edit passthrough) --------

function runGov(input, env = {}) {
  return JSON.parse(
    execFileSync("node", [GOV_HOOK], {
      input: JSON.stringify(input),
      env: { ...process.env, ...env },
      encoding: "utf8",
    }),
  ).hookSpecificOutput;
}

test("e2e: не-edit тул (Bash) → allow (passthrough)", () => {
  const out = runGov(
    { tool_name: "Bash", tool_input: { command: "ls" }, cwd: PRODUCT_FIXTURE },
    { OMNIFIELD_SCOPE: "alpha" },
  );
  assert.equal(out.permissionDecision, "allow");
});

test("e2e: owner Edit вне зоны → deny; внутри → allow (хук сам loadConfig cwd)", () => {
  const deny = runGov(
    { tool_name: "Edit", tool_input: { file_path: "services/beta/x.py" }, cwd: PRODUCT_FIXTURE },
    { OMNIFIELD_SCOPE: "alpha" },
  );
  assert.equal(deny.permissionDecision, "deny");
  assert.match(deny.permissionDecisionReason, /governance/);

  const allow = runGov(
    { tool_name: "Edit", tool_input: { file_path: "packages/alpha/x.js" }, cwd: PRODUCT_FIXTURE },
    { OMNIFIELD_SCOPE: "alpha" },
  );
  assert.equal(allow.permissionDecision, "allow");
});
