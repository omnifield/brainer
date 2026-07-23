// hooks.test.mjs — config-driven хуки (BRAIN-10): резолв зон из конфига (ноль хардкода),
// git-доступ по роли, identity-баннер по роли (subprocess), settings-block splice идемпотентен.
// node:test, ноль зависимостей.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { blockReason, currentAccess } from "../harness/hooks/git-gate.mjs";
import {
  DEFAULT_CONFIG,
  gitAccess,
  knownScopes,
  loadConfig,
  normalizeConfig,
  parseYaml,
  resolveScope,
  roleOf,
} from "../harness/hooks/harness-config.mjs";
import block from "../harness/settings.hooks.json" with { type: "json" };
import { mergeSettingsBlock } from "../harness/settings-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PRODUCT_FIXTURE = join(HERE, "fixtures", "product");
const MAIN_FIXTURE = join(HERE, "fixtures", "main-session");
const IDENTITY_HOOK = join(HERE, "..", "harness", "hooks", "scope-identity.mjs");

const cfg = loadConfig(PRODUCT_FIXTURE);

// --- YAML-парсер / загрузка конфига -----------------------------------------

test("parseYaml разбирает вложенные map + скаляры + типы", () => {
  const y = parseYaml(
    "architects: 2\nmodels:\n  architect: m1\nzones:\n  alpha:\n    path: packages/alpha\n",
  );
  assert.equal(y.architects, 2);
  assert.equal(y.models.architect, "m1");
  assert.equal(y.zones.alpha.path, "packages/alpha");
});

test("loadConfig читает зоны/пины/архитекторов из ДАННЫХ (не хардкод)", () => {
  assert.equal(cfg.architects, 2);
  assert.equal(cfg.models.architect, "model-arch");
  assert.equal(cfg.models.owner, "model-own");
  assert.deepEqual(Object.keys(cfg.zones).sort(), ["alpha", "beta"]);
  assert.equal(cfg.zones.alpha.path, "packages/alpha");
});

test("loadConfig без файла → DEFAULT_CONFIG (degraded, зоны пусты, git-инвариант)", () => {
  const d = loadConfig(join(HERE, "fixtures", "does-not-exist"));
  assert.deepEqual(d.zones, {});
  assert.equal(d.git.owner, "commit-only");
  assert.equal(d.architects, DEFAULT_CONFIG.architects);
});

test("normalizeConfig достраивает недостающие секции", () => {
  const n = normalizeConfig({ zones: { x: { path: "p" } } });
  assert.deepEqual(n.models, {});
  assert.equal(n.git.architect, "full");
});

// --- Резолв scope (config-driven) -------------------------------------------

test("resolveScope: main → architect", () => {
  assert.deepEqual(resolveScope("main", cfg), { kind: "main", scope: "main", role: "architect" });
});

test("resolveScope: зона из конфига → owner + путь из ДАННЫХ", () => {
  const r = resolveScope("alpha", cfg);
  assert.equal(r.kind, "zone");
  assert.equal(r.role, "owner");
  assert.equal(r.relativePath, "packages/alpha");
  assert.match(r.name, /alpha zone/);
});

test("resolveScope: неизвестный scope → null (аномалия)", () => {
  assert.equal(resolveScope("gamma", cfg), null);
});

test("knownScopes = main + зоны конфига", () => {
  assert.deepEqual(knownScopes(cfg).sort(), ["alpha", "beta", "main"]);
});

// --- Git-доступ по роли (config.git) ----------------------------------------

test("roleOf: main→architect, layer→layer, зона→owner", () => {
  assert.equal(roleOf("main"), "architect");
  assert.equal(roleOf("layer"), "layer");
  assert.equal(roleOf("alpha"), "owner");
});

test("gitAccess из config.git по роли", () => {
  assert.equal(gitAccess("main", cfg), "full");
  assert.equal(gitAccess("alpha", cfg), "commit-only");
  assert.equal(gitAccess("layer", cfg), "none");
});

// --- git-gate: правила блокировки по уровню ---------------------------------

test("commit-only: режет push/merge/switch, пускает commit/add/status", () => {
  assert.equal(blockReason("git push origin main", "commit-only"), "git push");
  assert.equal(blockReason("git merge feat", "commit-only"), "git merge");
  assert.equal(blockReason("git switch main", "commit-only"), "git switch");
  assert.equal(blockReason("git commit -m x", "commit-only"), null);
  assert.equal(blockReason("git add .", "commit-only"), null);
  assert.equal(blockReason("git status", "commit-only"), null);
});

test("commit-only: checkout <branch> режется, path-restore пускается", () => {
  assert.equal(blockReason("git checkout main", "commit-only"), "git checkout <branch>");
  assert.equal(blockReason("git checkout -- file.txt", "commit-only"), null);
});

test("none (layer): режет ещё и commit/add", () => {
  assert.equal(blockReason("git commit -m x", "none"), "git commit");
  assert.equal(blockReason("git add .", "none"), "git add");
});

test("full: пускает всё", () => {
  assert.equal(blockReason("git push --force", "full"), null);
  assert.equal(blockReason("git merge x", "full"), null);
});

// --- git-gate: уровень доступа сессии ----------------------------------------

test("currentAccess: marker-сессия → full (единственный источник full)", () => {
  const access = currentAccess({ session_id: "S-MAIN-1", cwd: MAIN_FIXTURE }, cfg);
  assert.equal(access, "full");
});

test("currentAccess: env-зона без marker → commit-only", () => {
  const saved = process.env.OMNIFIELD_SCOPE;
  try {
    process.env.OMNIFIELD_SCOPE = "alpha";
    assert.equal(currentAccess({ session_id: "OTHER", cwd: MAIN_FIXTURE }, cfg), "commit-only");
    process.env.OMNIFIELD_SCOPE = "layer";
    assert.equal(currentAccess({ session_id: "OTHER", cwd: MAIN_FIXTURE }, cfg), "none");
  } finally {
    if (saved === undefined) delete process.env.OMNIFIELD_SCOPE;
    else process.env.OMNIFIELD_SCOPE = saved;
  }
});

test("currentAccess: env=main без marker (subagent) → commit-only, НЕ full", () => {
  const saved = process.env.OMNIFIELD_SCOPE;
  try {
    process.env.OMNIFIELD_SCOPE = "main";
    assert.equal(currentAccess({ session_id: "SUBAGENT", cwd: MAIN_FIXTURE }, cfg), "commit-only");
  } finally {
    if (saved === undefined) delete process.env.OMNIFIELD_SCOPE;
    else process.env.OMNIFIELD_SCOPE = saved;
  }
});

// --- scope-identity: баннер по роли (subprocess, config из cwd) --------------

function runIdentity(scope) {
  return execFileSync("node", [IDENTITY_HOOK], {
    cwd: PRODUCT_FIXTURE,
    env: { ...process.env, OMNIFIELD_SCOPE: scope },
    encoding: "utf8",
  });
}

test("identity: architect-баннер несёт роль, пин модели, число архитекторов", () => {
  const out = JSON.parse(runIdentity("main")).hookSpecificOutput.additionalContext;
  assert.match(out, /architect/);
  assert.match(out, /model-arch/);
  assert.match(out, /архитекторов сконфигурено: 2/);
});

test("identity: owner-баннер несёт зону из конфига + пин", () => {
  const out = JSON.parse(runIdentity("alpha")).hookSpecificOutput.additionalContext;
  assert.match(out, /owner-alpha/);
  assert.match(out, /packages\/alpha/);
  assert.match(out, /model-own/);
});

test("identity: неизвестный scope → UNRESOLVED-аномалия", () => {
  const out = JSON.parse(runIdentity("gamma")).hookSpecificOutput.additionalContext;
  assert.match(out, /UNRESOLVED/);
});

// --- settings-block: идемпотентный splice ------------------------------------

test("settings-block: регистрирует git-gate (PreToolUse) + SessionStart-хуки", () => {
  const merged = mergeSettingsBlock({}, block);
  const cmds = JSON.stringify(merged);
  assert.match(cmds, /git-gate\.mjs/);
  assert.match(cmds, /main-session-marker\.mjs/);
  assert.match(cmds, /scope-identity\.mjs/);
});

test("settings-block: splice идемпотентен (повторный merge = no-op)", () => {
  const once = mergeSettingsBlock({}, block);
  const twice = mergeSettingsBlock(once, block);
  assert.deepEqual(twice, once);
});

test("settings-block: сохраняет пользовательские настройки и его хуки", () => {
  const user = {
    permissions: { allow: ["Read"] },
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node user-hook.mjs" }] }] },
  };
  const merged = mergeSettingsBlock(user, block);
  assert.deepEqual(merged.permissions, { allow: ["Read"] });
  const ss = JSON.stringify(merged.hooks.SessionStart);
  assert.match(ss, /user-hook\.mjs/); // user-хук цел
  assert.match(ss, /scope-identity\.mjs/); // наш добавлен
});

// --- доставка хуков объявлена в frame ---------------------------------------

test("все config-driven хуки объявлены в frame (mode:exact) и существуют", async () => {
  const pkg = JSON.parse(
    (await import("node:fs")).readFileSync(join(HERE, "..", "package.json"), "utf8"),
  );
  const hookDests = pkg.omnifield.frame
    .filter((f) => f.dest.startsWith(".claude/hooks/"))
    .map((f) => ({ dest: f.dest, mode: f.mode, src: f.src }));
  for (const name of [
    "harness-config",
    "scope-resolve",
    "scope-identity",
    "git-gate",
    "main-session-marker",
  ]) {
    const entry = hookDests.find((f) => f.dest === `.claude/hooks/${name}.mjs`);
    assert.ok(entry, `frame не кладёт ${name}.mjs`);
    assert.equal(entry.mode, "exact");
    assert.ok(existsSync(join(HERE, "..", "harness", entry.src)), `нет src ${entry.src}`);
  }
});
