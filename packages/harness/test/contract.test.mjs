// contract.test.mjs — объявление обвеса (`package.json.baser`) валидно против формы baser
// (форма 3) и полно против раскладки этого обвеса. node:test, ноль зависимостей.
// Авторитетная проверка формы — `npx baser check packages/harness` (см. contract.lib.mjs).

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ARTIFACT_CLASSES,
  EXPECTED_LAYOUT,
  FORM_VERSION,
  PKG_ROOT,
  readJson,
  sourceConfigPath,
  validateDeclaration,
  validateExpectedLayout,
  validateLayoutSources,
  validatePackage,
} from "./contract.lib.mjs";

const decl = () => readJson("package.json").baser;

test("package.json.baser валиден против формы", () => {
  const errs = validateDeclaration(decl(), "pkg");
  assert.deepEqual(errs, [], errs.join("\n"));
});

test("обязательные поля: formVersion / source.{id,title,contentRoot} / layout", () => {
  const b = decl();
  assert.equal(b.formVersion, FORM_VERSION);
  assert.equal(b.source.id, "brainer/harness");
  assert.ok(b.source.title.trim());
  assert.equal(b.source.contentRoot, "harness");
  assert.ok(Array.isArray(b.layout) && b.layout.length > 0);
});

test("грамматика личности: ровно два строчных сегмента (id ≠ имя пакета)", () => {
  const b = decl();
  assert.match(b.source.id, /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/);
  assert.notEqual(b.source.id, readJson("package.json").name); // личность отдельно от доставки
  for (const bad of ["brainer", "Brainer/harness", "brainer/harness/roles", "-brainer/harness"]) {
    const errs = validateDeclaration({ ...b, source: { ...b.source, id: bad } }, "x");
    assert.ok(
      errs.some((e) => e.includes("source.id")),
      `личность "${bad}" должна быть отвергнута`,
    );
  }
});

test("файл настроек обвеса считается из личности и НЕ совпадает с нашим артефактом", () => {
  const b = decl();
  assert.equal(sourceConfigPath(b.source.id), ".omnifield/brainer-harness.yaml");
  const dests = b.layout.map((f) => f.dest);
  assert.ok(!dests.includes(sourceConfigPath(b.source.id)));
  assert.ok(dests.includes(".omnifield/harness.yaml")); // роль-модель — свой артефакт
});

test("source.version не объявляется — версия обвеса живёт в манифесте пакета", () => {
  const b = decl();
  assert.ok(!("version" in b.source));
  // Контракт — что версия ЕСТЬ в манифесте и она валидный семвер. НЕ какая именно:
  // поднятие версии — штатное действие architect при публикации, и тест, который на нём
  // краснеет, спорит с правилом вместо того, чтобы его защищать (tasker:BRAIN2-48).
  assert.match(readJson("package.json").version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/);
  const errs = validateDeclaration({ ...b, source: { ...b.source, version: "1.2.3" } }, "x");
  assert.ok(errs.some((e) => e.includes("source.version")));
});

test('contentRoot не "." — содержимое отделимо от обвязки пакета', () => {
  const b = decl();
  const errs = validateDeclaration({ ...b, source: { ...b.source, contentRoot: "." } }, "x");
  assert.ok(errs.some((e) => e.includes("contentRoot")));
});

test("раскладка полна по карте, все render:false, класс объявлен явно у каждой", () => {
  const b = decl();
  // Сверяемся с ОЖИДАЕМОЙ картой, а не с числом: магическая «16» в двух местах — это
  // состояние, а правило звучит «объявлено ровно то, что мы задумали». Состав раскладки
  // меняется осознанно, и краснеть на этом должен один EXPECTED_LAYOUT, а не счётчик.
  assert.equal(b.layout.length, Object.keys(EXPECTED_LAYOUT).length);
  for (const entry of b.layout) {
    assert.equal(entry.render, false, `${entry.dest}: подстановки нет — render:false`);
    assert.ok(ARTIFACT_CLASSES.has(entry.class), `${entry.dest}: класс не объявлен`);
  }
});

test("классы: placed-once ровно у двух — то, что дальше заполняет ЧЕЛОВЕК", () => {
  const byDest = Object.fromEntries(decl().layout.map((f) => [f.dest, f.class]));
  const placedOnce = Object.entries(byDest)
    .filter(([, c]) => c === "placed-once")
    .map(([d]) => d)
    .sort();
  assert.deepEqual(placedOnce, [".claude/settings.json", ".omnifield/harness.yaml"]);
  // Рамка ролей и хуки — regenerated: потребитель их не редактирует, обновление обязано
  // их заменять. placed-once заморозил бы харнесс на первой версии, и МОЛЧА.
  for (const dest of Object.keys(byDest))
    if (dest.startsWith(".claude/agents/") || dest.startsWith(".claude/hooks/"))
      assert.equal(byDest[dest], "regenerated", `${dest} обязан быть regenerated`);
});

test("режимов прежней формы (mode/once) в записях нет — словарь не разъехался", () => {
  for (const entry of decl().layout) {
    assert.ok(!("mode" in entry), `${entry.dest}: mode снят формой`);
    assert.ok(!("once" in entry), `${entry.dest}: класс объявляется словом, не флагом`);
  }
});

test("раскладка полна: рамка ролей + помощники + все хуки + сид роль-модели", () => {
  const errs = validateExpectedLayout(decl(), "pkg");
  assert.deepEqual(errs, [], errs.join("\n"));
});

test("каждый layout.src существует внутри contentRoot", () => {
  const errs = validateLayoutSources(decl(), "pkg");
  assert.deepEqual(errs, [], errs.join("\n"));
});

test("вендор-зеркала plugin.json больше нет (одно объявление одного факта)", () => {
  assert.ok(!existsSync(new URL("../plugin.json", import.meta.url)));
  assert.ok(!("omnifield" in readJson("package.json")));
});

test("research = read-only тулсетом (нет Edit/Write/Bash); routine правит (гейт режет)", () => {
  const read = (p) => readFileSync(new URL(`../harness/helpers/${p}`, import.meta.url), "utf8");
  const rTools = /tools:\s*(.+)/.exec(read("research.md"))[1];
  for (const forbidden of ["Edit", "Write", "Bash"]) {
    assert.ok(!rTools.includes(forbidden), `research НЕ должен иметь ${forbidden}: ${rTools}`);
  }
  assert.match(rTools, /Read/);
  const routineTools = /tools:\s*(.+)/.exec(read("routine.md"))[1];
  assert.match(routineTools, /Edit/); // routine правит — но governance режет по paths[] родителя
});

test("contentRoot уезжает в поставку (package.json.files)", () => {
  const pkg = readJson("package.json");
  assert.ok(pkg.files.includes(pkg.baser.source.contentRoot));
  assert.ok(existsSync(new URL(`../${pkg.baser.source.contentRoot}`, import.meta.url)));
  assert.ok(PKG_ROOT.endsWith("harness"));
});

test("validatePackage() — сквозная проверка без ошибок", () => {
  const { errors } = validatePackage();
  assert.deepEqual(errors, [], errors.join("\n"));
});
