// contract.lib.mjs — валидатор объявления обвеса (`package.json.baser`) против формы baser
// (форма 3, README @omnifield/baser-contracts) И против инвариантов ЭТОГО обвеса.
// Чистая логика, ноль зависимостей — реюзится тестом (contract.test.mjs) и build-гейтом
// (validate.mjs). Loud-fail: возвращает список ошибок, пустой = валидно.
//
// ГРАНИЦА (важно, чтобы не считать это вторым домом формы): авторитетная проверка
// объявления — сама форма, вызывается дверью:  `npx baser check packages/harness`.
// Здесь — то, чего дверь про НАС не знает: раскладка полна (16 записей, ничего не
// потеряно при правке), классы расставлены осознанно, render:false везде. Правила формы
// продублированы ровно в той мере, в какой их перечислило ТЗ (tasker:BRAIN2-41 §7):
// грамматика личности, запрет source.version, contentRoot ≠ ".", словарь классов.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Форма, против которой написано объявление (README @omnifield/baser-contracts). */
export const FORM_VERSION = 3;
/** Словарь классов артефакта (форма §5б). Своё объявление словаря — не импорт формы. */
export const ARTIFACT_CLASSES = new Set(["regenerated", "placed-once"]);
/** Сегмент личности: строчные, первый символ — буква или цифра (форма §1). */
const ID_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;
/** Поля прежней (devopser) формы: разъехавшийся словарь обязан быть громким, не молчать. */
const RETIRED_ENTRY_FIELDS = ["mode", "once"];

/** Ожидаемая раскладка ЭТОГО обвеса: dest → класс. Полнота проверяется по этой карте. */
export const EXPECTED_LAYOUT = {
  ".claude/agents/architect.md": "regenerated",
  ".claude/agents/owner.md": "regenerated",
  ".claude/agents/layer.md": "regenerated",
  ".claude/agents/shared-policy.md": "regenerated",
  ".claude/agents/research.md": "regenerated",
  ".claude/agents/routine.md": "regenerated",
  ".claude/hooks/harness-config.mjs": "regenerated",
  ".claude/hooks/scope-resolve.mjs": "regenerated",
  ".claude/hooks/scope-identity.mjs": "regenerated",
  ".claude/hooks/git-gate.mjs": "regenerated",
  ".claude/hooks/main-session-marker.mjs": "regenerated",
  ".claude/hooks/harness-doctor.mjs": "regenerated",
  ".claude/hooks/governance.mjs": "regenerated",
  ".claude/.gitignore": "regenerated",
  ".claude/settings.json": "placed-once",
  ".omnifield/harness.yaml": "placed-once",
};

export function readJson(relPath) {
  return JSON.parse(readFileSync(join(PKG_ROOT, relPath), "utf8"));
}

/** Личность → имя файла настроек потребителя (форма §6: слеш становится дефисом). */
export function sourceConfigPath(id) {
  return `.omnifield/${String(id).replaceAll("/", "-")}.yaml`;
}

function badPath(p) {
  if (typeof p !== "string" || !p.trim()) return "пуст";
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return "абсолютный (обвес целится наружу)";
  if (p.split("/").includes("..")) return "выходит за корень (`..`)";
  return null;
}

/** Валидация блока `baser` против формы. → string[] ошибок. */
export function validateDeclaration(baser, label) {
  const e = [];
  const p = (m) => e.push(`${label}: ${m}`);
  if (!baser || typeof baser !== "object") {
    p("блок `baser` отсутствует или не объект");
    return e;
  }

  if (baser.formVersion !== FORM_VERSION)
    p(`formVersion должен быть ${FORM_VERSION}, получено ${JSON.stringify(baser.formVersion)}`);

  const src = baser.source;
  if (!src || typeof src !== "object") {
    p("source обязателен (объект)");
  } else {
    // Личность: ровно два сегмента, строчные (форма §1) — она же имя файла настроек.
    const segments = typeof src.id === "string" ? src.id.split("/") : [];
    if (segments.length !== 2 || !segments.every((s) => ID_SEGMENT.test(s)))
      p(`source.id — ровно два строчных сегмента через "/": ${JSON.stringify(src.id)}`);
    if (typeof src.title !== "string" || !src.title.trim()) p("source.title обязателен (строка)");
    // Версия обвеса живёт в манифесте пакета, и только там (форма §1).
    if ("version" in src) p("source.version не бывает — версия обвеса это package.json.version");
    if (typeof src.contentRoot !== "string" || !src.contentRoot.trim())
      p("source.contentRoot обязателен (строка)");
    else if (src.contentRoot === ".")
      p(
        'source.contentRoot не может быть "." — содержимое обязано быть отделимо от обвязки пакета',
      );
    else {
      const bad = badPath(src.contentRoot);
      if (bad) p(`source.contentRoot ${bad}: ${JSON.stringify(src.contentRoot)}`);
    }
  }

  if (!Array.isArray(baser.layout) || baser.layout.length === 0) {
    p("layout обязателен (непустой массив) — обвес, который ничего не кладёт");
    return e;
  }

  const seen = new Set();
  const ownConfig = src?.id ? sourceConfigPath(src.id) : null;
  baser.layout.forEach((entry, i) => {
    const at = `layout[${i}]`;
    for (const field of ["src", "dest"]) {
      const bad = badPath(entry?.[field]);
      if (bad) p(`${at}.${field} ${bad}: ${JSON.stringify(entry?.[field])}`);
    }
    for (const retired of RETIRED_ENTRY_FIELDS)
      if (retired in (entry ?? {}))
        p(`${at}.${retired} — поле прежней формы, снято; права артефакта несёт \`class\``);
    if (!("class" in entry))
      p(`${at}.class не объявлен явно (умолчание молчит — мы говорим вслух)`);
    else if (!ARTIFACT_CLASSES.has(entry.class))
      p(`${at}.class ∉ {${[...ARTIFACT_CLASSES].join(", ")}}: ${JSON.stringify(entry.class)}`);
    if (entry?.render !== false)
      p(`${at}.render должен быть false: подстановки в содержимом нет, файл ложится байт в байт`);
    if (seen.has(entry?.dest)) p(`${at}.dest объявлен дважды: ${entry.dest}`);
    seen.add(entry?.dest);
    if (entry?.dest === "baser.json") p(`${at}.dest целится в перечень поставленного`);
    if (ownConfig && entry?.dest === ownConfig)
      p(`${at}.dest целится в файл настроек обвеса (${ownConfig}) — им владеет человек`);
  });

  return e;
}

/** Каждый layout.src существует внутри contentRoot. → string[] ошибок. */
export function validateLayoutSources(baser, label) {
  const e = [];
  const root = baser?.source?.contentRoot;
  if (!Array.isArray(baser?.layout) || typeof root !== "string") return e;
  for (const entry of baser.layout) {
    if (typeof entry?.src !== "string") continue;
    if (!existsSync(join(PKG_ROOT, root, entry.src)))
      e.push(`${label}: layout.src не найден в contentRoot: ${root}/${entry.src}`);
  }
  return e;
}

/** Раскладка совпадает с ожидаемой картой dest→class (ничего не потеряно и не приписано). */
export function validateExpectedLayout(baser, label) {
  const e = [];
  if (!Array.isArray(baser?.layout)) return e;
  const actual = Object.fromEntries(baser.layout.map((f) => [f.dest, f.class]));
  for (const [dest, cls] of Object.entries(EXPECTED_LAYOUT)) {
    if (!(dest in actual)) e.push(`${label}: раскладка не кладёт ${dest}`);
    else if (actual[dest] !== cls)
      e.push(`${label}: ${dest} объявлен как ${actual[dest]}, ожидался ${cls}`);
  }
  for (const dest of Object.keys(actual))
    if (!(dest in EXPECTED_LAYOUT)) e.push(`${label}: незапланированный артефакт ${dest}`);
  return e;
}

/** contentRoot уезжает в поставку (package.json.files) — иначе обвес приедет пустым. */
export function validateShipping(pkg, label) {
  const root = pkg?.baser?.source?.contentRoot;
  const files = Array.isArray(pkg?.files) ? pkg.files : [];
  if (!root) return [];
  return files.includes(root)
    ? []
    : [`${label}: contentRoot "${root}" не объявлен в package.json.files — содержимое не уедет`];
}

/** Полная проверка пакета: объявление + существование src + полнота раскладки + поставка. */
export function validatePackage() {
  const pkg = readJson("package.json");
  const baser = pkg.baser;
  const errors = [
    ...validateDeclaration(baser, "package.json.baser"),
    ...validateLayoutSources(baser, "package.json.baser"),
    ...validateExpectedLayout(baser, "package.json.baser"),
    ...validateShipping(pkg, "package.json"),
  ];
  return { errors, pkg, baser };
}
