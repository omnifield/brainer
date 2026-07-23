// contract.test.mjs — omnifield-блок валиден против plugin-контракта (kb:DEVOPSER-6),
// дуальная доставка консистентна, каждый frame.src существует. node:test, ноль зависимостей.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readJson,
  stripMeta,
  validateFrameSources,
  validateOmnifield,
  validatePackage,
} from "./contract.lib.mjs";

test("package.json.omnifield валиден против контракта плагина", () => {
  const pkg = readJson("package.json");
  const errs = validateOmnifield(pkg.omnifield, "pkg");
  assert.deepEqual(errs, [], errs.join("\n"));
});

test("plugin.json.omnifield (вендор-зеркало) валиден против контракта", () => {
  const vendor = readJson("plugin.json");
  const errs = validateOmnifield(vendor.omnifield, "vendor");
  assert.deepEqual(errs, [], errs.join("\n"));
});

test("обязательные поля присутствуют: kind/target/stack/contentRoot/frame", () => {
  const { omnifield } = readJson("package.json");
  assert.equal(omnifield.kind, "plugin");
  assert.equal(omnifield.target, "agent-harness");
  assert.equal(omnifield.stack, "any");
  assert.equal(omnifield.contentRoot, "harness");
  assert.ok(Array.isArray(omnifield.frame) && omnifield.frame.length > 0);
});

test("mechanism у плагина НЕ объявлен (правило контракта)", () => {
  assert.ok(!("mechanism" in readJson("package.json").omnifield));
  assert.ok(!("mechanism" in readJson("plugin.json").omnifield));
});

test("дуальная доставка консистентна (npm-блок === вендор-блок без $comment)", () => {
  const { omnifield: npm } = readJson("package.json");
  const { omnifield: vendor } = readJson("plugin.json");
  assert.deepEqual(stripMeta(npm), stripMeta(vendor));
});

test("каждый frame.src существует внутри contentRoot", () => {
  const { omnifield } = readJson("package.json");
  const errs = validateFrameSources(omnifield, "pkg");
  assert.deepEqual(errs, [], errs.join("\n"));
});

test("рамка покрывает все три роли + shared-policy + settings-регистрацию + config-сид", () => {
  const dests = readJson("package.json").omnifield.frame.map((f) => f.dest);
  for (const d of [
    ".claude/agents/architect.md",
    ".claude/agents/owner.md",
    ".claude/agents/layer.md",
    ".claude/agents/shared-policy.md",
    ".claude/settings.json",
    ".omnifield/harness.yaml",
  ]) {
    assert.ok(dests.includes(d), `frame не кладёт ${d}`);
  }
});

test("роли — mode:exact, settings-регистрация — mode:merge, config-сид — mode:seed", () => {
  const byDest = Object.fromEntries(
    readJson("package.json").omnifield.frame.map((f) => [f.dest, f.mode]),
  );
  assert.equal(byDest[".claude/agents/architect.md"], "exact");
  assert.equal(byDest[".claude/agents/owner.md"], "exact");
  assert.equal(byDest[".claude/agents/layer.md"], "exact");
  assert.equal(byDest[".claude/agents/shared-policy.md"], "exact");
  assert.equal(byDest[".claude/settings.json"], "merge");
  assert.equal(byDest[".omnifield/harness.yaml"], "seed");
});

test("settings.json-регистрация — mode:merge (deep-merge, НЕ block/exact) в обоих зеркалах", () => {
  for (const file of ["package.json", "plugin.json"]) {
    const entry = readJson(file).omnifield.frame.find((f) => f.dest === ".claude/settings.json");
    assert.ok(entry, `${file}: frame не несёт .claude/settings.json`);
    assert.equal(entry.mode, "merge", `${file}: settings.json должен быть mode:merge`);
    assert.equal(entry.src, "settings.hooks.json", `${file}: settings.json src`);
  }
});

test("validatePackage() — сквозная проверка без ошибок", () => {
  const { errors } = validatePackage();
  assert.deepEqual(errors, [], errors.join("\n"));
});
