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
  grabliTarget,
  knownScopes,
  loadConfig,
  normalizeConfig,
  parseYaml,
  resolveScope,
  roleOf,
  serviceBase,
  validateConfig,
  zonePaths,
} from "../harness/hooks/harness-config.mjs";
import { needsOnboarding } from "../harness/hooks/scope-identity.mjs";
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

test("parseYaml отрезает хвостовой inline-комментарий на не-quoted скаляре", () => {
  const y = parseYaml("product: acme  # имя\nzones:\n  api:\n    path: packages/api  # ядро\n");
  assert.equal(y.product, "acme"); // не "acme  # имя"
  assert.equal(y.zones.api.path, "packages/api"); // не "packages/api  # ядро"
});

test("parseYaml НЕ трогает `#` без пробела перед ним (часть значения)", () => {
  const y = parseYaml("frag: a/b#c\n");
  assert.equal(y.frag, "a/b#c");
});

test("parseYaml разбирает inline flow-массив paths[] (+ хвостовой коммент)", () => {
  const y = parseYaml("zones:\n  api:\n    paths: [packages/a, packages/b]  # ядро\n");
  assert.deepEqual(y.zones.api.paths, ["packages/a", "packages/b"]);
  const empty = parseYaml("zones:\n  x:\n    paths: []\n");
  assert.deepEqual(empty.zones.x.paths, []);
});

test("normalizeConfig отвергает зоны с зарезервированными именами (main/layer)", () => {
  const n = normalizeConfig({
    zones: { layer: { path: "p1" }, main: { path: "p2" }, api: { path: "p3" } },
  });
  assert.deepEqual(Object.keys(n.zones), ["api"]); // layer/main выброшены
});

test("loadConfig читает зоны/пины/архитекторов из ДАННЫХ (не хардкод)", () => {
  assert.equal(cfg.architects, 2);
  assert.equal(cfg.models.architect, "model-arch");
  assert.equal(cfg.models.owner, "model-own");
  assert.deepEqual(Object.keys(cfg.zones).sort(), ["alpha", "beta"]);
  assert.deepEqual(zonePaths(cfg.zones.alpha), ["packages/alpha", "packages/alpha-shared"]);
});

// --- grabli-слот (BRAIN2-7) --------------------------------------------------

test("grabliTarget: ws из слота; пусто/не задан → null", () => {
  assert.equal(grabliTarget(normalizeConfig({ grabli: { workspace: "GRABLI2" } })), "GRABLI2");
  assert.equal(grabliTarget(normalizeConfig({})), null); // слот не задан
  assert.equal(grabliTarget(normalizeConfig({ grabli: { workspace: "  " } })), null); // пустой
  assert.equal(grabliTarget(cfg), "GRABLI2"); // из фикстуры
});

// --- services-слот (BRAIN2-9): доступ curl'ом, база из конфига --------------

test("serviceBase: база из слота (хвостовой / срезан); нет/пусто → null", () => {
  const c = normalizeConfig({
    services: { tasker: "http://tasker:8030/tasker/", knowledger: " " },
  });
  assert.equal(serviceBase(c, "tasker"), "http://tasker:8030/tasker"); // трейлинг-слеш срезан
  assert.equal(serviceBase(c, "knowledger"), null); // пустой
  assert.equal(serviceBase(normalizeConfig({}), "tasker"), null); // слот не задан
  assert.equal(serviceBase(cfg, "knowledger"), "http://knowledger:8040/knowledger"); // фикстура
});

// --- zonePaths: paths[] канон ∪ legacy path ∪ голая строка --------------------

test("zonePaths: paths[] массив, legacy path одиночный, голая строка — всё в массив", () => {
  assert.deepEqual(zonePaths({ paths: ["a", "b"] }), ["a", "b"]);
  assert.deepEqual(zonePaths({ path: "a" }), ["a"]); // back-compat одиночный
  assert.deepEqual(zonePaths("a"), ["a"]); // голая строка
  assert.deepEqual(zonePaths(cfg.zones.beta), ["services/beta"]); // фикстура: legacy beta
  assert.deepEqual(zonePaths({}), []); // без путей
  assert.deepEqual(zonePaths({ paths: ["a", "", "  "] }), ["a"]); // пустые отброшены
});

// --- validateConfig: relative / непустой / disjoint --------------------------

test("validateConfig: валидная роль-модель → нет ошибок", () => {
  assert.deepEqual(validateConfig(cfg), []);
});

test("validateConfig: пересечение путей разных зон (disjoint) → ошибка", () => {
  const errs = validateConfig(
    normalizeConfig({ zones: { a: { paths: ["packages/x"] }, b: { paths: ["packages/x/sub"] } } }),
  );
  assert.equal(errs.length, 1);
  assert.match(errs[0], /пересека/);
});

test("validateConfig: абсолютный путь / '..'-escape / пустой paths[] → ошибки", () => {
  const errs = validateConfig(
    normalizeConfig({
      zones: { a: { paths: ["/etc"] }, b: { paths: ["../out"] }, c: { paths: [] } },
    }),
  );
  assert.ok(errs.some((e) => /абсолют/.test(e)));
  assert.ok(errs.some((e) => /\.\./.test(e)));
  assert.ok(errs.some((e) => /нет путей/.test(e)));
});

test("validateConfig: одна зона с несколькими НЕпересекающимися папками — ок", () => {
  const errs = validateConfig(
    normalizeConfig({ zones: { a: { paths: ["packages/a", "services/a"] } } }),
  );
  assert.deepEqual(errs, []);
});

test("loadConfig без файла → DEFAULT_CONFIG (degraded, зоны пусты, git-инвариант)", () => {
  const d = loadConfig(join(HERE, "fixtures", "does-not-exist"));
  assert.deepEqual(d.zones, {});
  assert.equal(d.git.owner, "commit-only");
  assert.equal(d.architects, DEFAULT_CONFIG.architects);
});

test("normalizeConfig достраивает недостающие секции (+ дефолт-пины моделей)", () => {
  const n = normalizeConfig({ zones: { x: { path: "p" } } });
  assert.equal(n.models.architect, "claude-opus-5"); // дефолт-пин (MECH-7 preset)
  assert.equal(n.models.owner, "claude-opus-4-8");
  assert.match(n.models.layer, /haiku/);
  assert.equal(n.git.architect, "full");
});

test("models: дефолт-пины применяются, продукт переопределяет частично", () => {
  const n = normalizeConfig({ models: { owner: "custom-own" } });
  assert.equal(n.models.architect, "claude-opus-5"); // не задан → дефолт
  assert.equal(n.models.owner, "custom-own"); // переопределён продуктом
  assert.match(n.models.layer, /haiku/); // не задан → дефолт
});

// --- Резолв scope (config-driven) -------------------------------------------

test("resolveScope: main → architect", () => {
  assert.deepEqual(resolveScope("main", cfg), { kind: "main", scope: "main", role: "architect" });
});

test("resolveScope: зона из конфига → owner + paths[] из ДАННЫХ", () => {
  const r = resolveScope("alpha", cfg);
  assert.equal(r.kind, "zone");
  assert.equal(r.role, "owner");
  assert.deepEqual(r.paths, ["packages/alpha", "packages/alpha-shared"]);
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
  assert.match(out, /продукта `acme`/); // product из ДАННЫХ, НЕ хардкод "brainer"
  assert.doesNotMatch(out, /brainer/); // регресс: имя продукта не захардкожено
});

test("identity: owner-баннер перечисляет ВСЕ папки paths[] + пин", () => {
  const out = JSON.parse(runIdentity("alpha")).hookSpecificOutput.additionalContext;
  assert.match(out, /owner-alpha/);
  assert.match(out, /packages\/alpha\//); // первая папка
  assert.match(out, /packages\/alpha-shared\//); // вторая папка из массива
  assert.match(out, /model-own/);
});

test("identity: неизвестный scope → UNRESOLVED-аномалия", () => {
  const out = JSON.parse(runIdentity("gamma")).hookSpecificOutput.additionalContext;
  assert.match(out, /UNRESOLVED/);
});

// --- онбординг: незаполненный сид (BRAIN2-8) ---------------------------------

test("needsOnboarding: my-product/пусто → true; заданный продукт → false", () => {
  assert.equal(needsOnboarding({ product: "my-product" }), true); // placeholder шаблона
  assert.equal(needsOnboarding({ product: null }), true); // не задан
  assert.equal(needsOnboarding({ product: "baser" }), false); // заполнен под продукт
  assert.equal(needsOnboarding(cfg), false); // фикстура: product=acme
});

// --- settings-block: идемпотентный splice ------------------------------------

test("settings-block: регистрирует git-gate + governance (PreToolUse) + SessionStart-хуки", () => {
  const merged = mergeSettingsBlock({}, block);
  const cmds = JSON.stringify(merged);
  assert.match(cmds, /git-gate\.mjs/);
  assert.match(cmds, /governance\.mjs/); // BRAIN2-2: машинная граница правок
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
    "governance",
    "main-session-marker",
  ]) {
    const entry = hookDests.find((f) => f.dest === `.claude/hooks/${name}.mjs`);
    assert.ok(entry, `frame не кладёт ${name}.mjs`);
    assert.equal(entry.mode, "exact");
    assert.ok(existsSync(join(HERE, "..", "harness", entry.src)), `нет src ${entry.src}`);
  }
});
