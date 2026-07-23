// contract.lib.mjs — валидатор omnifield-блока плагина против plugin-контракта движка
// (kb:DEVOPSER-6 §1/§4). Чистая логика, ноль зависимостей — реюзится тестом
// (contract.test.mjs) и build-гейтом (validate.mjs). Loud-fail: возвращает список
// ошибок, пустой = валидно.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const VALID_STACKS = new Set(["node", "go", "frontend", "python", "any"]);
const VALID_MODES = new Set(["exact", "seed", "block", "pins"]);

/** Рекурсивно выкидывает $-префиксные ключи ($comment) — не контрактные поля. */
export function stripMeta(v) {
  if (Array.isArray(v)) return v.map(stripMeta);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !k.startsWith("$"))
        .map(([k, val]) => [k, stripMeta(val)]),
    );
  }
  return v;
}

export function readJson(relPath) {
  return JSON.parse(readFileSync(join(PKG_ROOT, relPath), "utf8"));
}

/** Валидация одного omnifield-блока против контракта плагина. → string[] ошибок. */
export function validateOmnifield(omni, label) {
  const e = [];
  const p = (m) => e.push(`${label}: ${m}`);
  if (!omni || typeof omni !== "object") {
    p("omnifield-блок отсутствует или не объект");
    return e;
  }
  // Обязательные поля плагина (kb:DEVOPSER-6 §1).
  if (omni.kind !== "plugin") p(`kind должен быть "plugin", получено ${JSON.stringify(omni.kind)}`);
  if (typeof omni.target !== "string" || !omni.target) p("target обязателен (непустая строка)");
  if (!VALID_STACKS.has(omni.stack))
    p(`stack ∉ {${[...VALID_STACKS].join(",")}}: ${JSON.stringify(omni.stack)}`);
  if (typeof omni.contentRoot !== "string" || !omni.contentRoot)
    p("contentRoot обязателен (непустая строка)");
  // ПРАВИЛО контракта: у плагина mechanism НЕ объявляется.
  if ("mechanism" in omni) p("mechanism у плагина объявляться НЕ должен (правило kb:DEVOPSER-6)");
  // frame — непустой массив записей { src, dest, mode, stack? }.
  if (!Array.isArray(omni.frame) || omni.frame.length === 0) {
    p("frame обязателен (непустой массив)");
  } else {
    omni.frame.forEach((f, i) => {
      const at = `frame[${i}]`;
      if (typeof f.src !== "string" || !f.src) p(`${at}.src обязателен (строка)`);
      if (typeof f.dest !== "string" || !f.dest) p(`${at}.dest обязателен (строка)`);
      if (!VALID_MODES.has(f.mode))
        p(`${at}.mode ∉ {${[...VALID_MODES].join(",")}}: ${JSON.stringify(f.mode)}`);
      if ("stack" in f && !VALID_STACKS.has(f.stack))
        p(`${at}.stack невалиден: ${JSON.stringify(f.stack)}`);
    });
  }
  return e;
}

/** Каждый frame.src существует внутри contentRoot. → string[] ошибок. */
export function validateFrameSources(omni, label) {
  const e = [];
  if (!omni || !Array.isArray(omni.frame) || typeof omni.contentRoot !== "string") return e;
  for (const f of omni.frame) {
    if (typeof f.src !== "string") continue;
    const abs = join(PKG_ROOT, omni.contentRoot, f.src);
    if (!existsSync(abs))
      e.push(`${label}: frame.src не найден в contentRoot: ${omni.contentRoot}/${f.src}`);
  }
  return e;
}

/** Полная проверка пакета: npm + вендор блоки, консистентность, существование src. */
export function validatePackage() {
  const pkg = readJson("package.json");
  const vendor = readJson("plugin.json");
  const npmOmni = pkg.omnifield;
  const vendorOmni = vendor.omnifield;

  const errors = [
    ...validateOmnifield(npmOmni, "package.json.omnifield"),
    ...validateOmnifield(vendorOmni, "plugin.json.omnifield"),
    ...validateFrameSources(npmOmni, "package.json.omnifield"),
  ];

  // Дуальная доставка: блоки консистентны (без учёта $comment).
  const a = JSON.stringify(stripMeta(npmOmni));
  const b = JSON.stringify(stripMeta(vendorOmni));
  if (a !== b)
    errors.push(
      "дуальная доставка: package.json.omnifield ≠ plugin.json.omnifield (зеркала разошлись)",
    );

  return { errors, npmOmni, vendorOmni };
}
