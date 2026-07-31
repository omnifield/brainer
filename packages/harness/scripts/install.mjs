#!/usr/bin/env node
// install.mjs — РУЧНАЯ установка агент-харнесса в целевой репо (метод #1, без станка baser).
// Читает объявление обвеса из `package.json.baser` (то же самое, что разбирает дверь) и
// раскладывает содержимое по `.claude/` / `.omnifield/` цели.
//
//   node install.mjs [<target-repo>]        # по умолчанию — cwd
//   node install.mjs --dry-run [<target>]   # показать, что сделает, без записи
//
// Классы артефакта (форма baser §5б) — исполняем их ЧЕСТНО, а не «как удобнее ручному методу»:
//   regenerated — артефакт наш, кладём целиком заново;
//   placed-once — кладём, только если места пусто; дальше файл ведёт человек и мы его не трогаем.
// Режимов материализации у формы нет: `merge` отменён вместе со сведением версий. Поэтому
// существующий `.claude/settings.json` мы НЕ дописываем — вместо этого называем расхождение
// вслух и печатаем готовую строку, которую нужно дописать (tasker:BRAIN2-41 §4).
//
// Zero-deps (node:*). Идемпотентно: повторный прогон — no-op на regenerated, placed-once не трогает.

import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url)); // корень бандла (рядом — package.json + harness/)

function parseArgs(a) {
  const dry = a.includes("--dry-run");
  const target = a.find((x) => !x.startsWith("--")) ?? process.cwd();
  return { dry, target };
}

/** Объявление обвеса из манифеста пакета. Ищем манифест рядом (бандл) и на уровень выше (исходник). */
function loadDeclaration() {
  for (const root of [HERE, dirname(HERE)]) {
    const manifestPath = join(root, "package.json");
    if (!existsSync(manifestPath)) continue;
    const baser = JSON.parse(readFileSync(manifestPath, "utf8"))?.baser;
    if (baser?.source?.contentRoot && Array.isArray(baser.layout)) return { root, baser };
  }
  throw new Error("package.json с блоком `baser` не найден (ни в бандле, ни в пакете)");
}

function place(srcPath, destPath) {
  mkdirSync(dirname(destPath), { recursive: true });
  cpSync(srcPath, destPath);
}

/**
 * Существующий `.claude/settings.json` мы не трогаем (placed-once) — значит регистрация хуков
 * могла не приехать. Считаем расхождение и печатаем готовую строку ТУТ ЖЕ: доктору у ручного
 * потребителя эталон взять негде (пакета нет, бандл лежит вне репо), а у нас он в руках.
 * Логику расхождения берём у доктора — второй её реализации не заводим.
 */
async function registrationHint(contentRoot, srcPath, destPath) {
  const doctor = await import(pathToFileURL(join(contentRoot, "hooks", "harness-doctor.mjs")).href);
  const block = JSON.parse(readFileSync(srcPath, "utf8"));
  let settings;
  try {
    settings = JSON.parse(readFileSync(destPath, "utf8"));
  } catch {
    return "`.claude/settings.json` есть, но не читается как JSON — хуки не подключены.";
  }
  const missing = doctor.missingRegistrations(settings, block);
  if (!missing.length) return null;
  return [
    "`.claude/settings.json` уже был — он твой, и обвес его не переписывает (merge у формы нет).",
    `  Не зарегистрировано хуков: ${missing.length}. Допиши в \`hooks\`:`,
    ...doctor.registrationFix(missing).map((l) => `    ${l}`),
    "  Проверить потом: `node .claude/hooks/harness-doctor.mjs`.",
  ].join("\n");
}

async function main() {
  const { dry, target } = parseArgs(argv.slice(2));
  const { root, baser } = loadDeclaration();
  const contentRoot = join(root, baser.source.contentRoot);
  const actions = [];
  const planned = [];
  const notes = [];

  for (const entry of baser.layout) {
    const cls = entry.class ?? "regenerated";
    const srcPath = join(contentRoot, entry.src);
    const destPath = join(target, entry.dest);
    if (!existsSync(srcPath)) throw new Error(`layout.src не найден в бандле: ${entry.src}`);
    if (dry) {
      planned.push(`${cls.padEnd(11)} ${entry.src}  →  ${entry.dest}`);
      continue;
    }
    if (cls === "regenerated") {
      place(srcPath, destPath);
      actions.push(`regenerated  ${entry.dest}`);
    } else if (cls === "placed-once") {
      if (existsSync(destPath)) {
        actions.push(`placed-once  ${entry.dest}  (уже есть — не трогаю, им владеет человек)`);
        if (entry.dest.endsWith(".claude/settings.json")) {
          const hint = await registrationHint(contentRoot, srcPath, destPath);
          if (hint) notes.push(hint);
        }
      } else {
        place(srcPath, destPath);
        actions.push(`placed-once  ${entry.dest}  (создан — заполни под себя)`);
      }
    } else {
      throw new Error(`неизвестный класс "${cls}" для ${entry.dest}`);
    }
  }

  if (dry) {
    process.stdout.write(
      `${baser.source.id} — сухой прогон (${baser.layout.length} записей) в ${target}:\n`,
    );
    process.stdout.write(`${planned.map((l) => `  ${l}`).join("\n")}\n`);
    return;
  }
  process.stdout.write(`${baser.source.id} установлен в ${target} (${actions.length} записей):\n`);
  process.stdout.write(`${actions.map((l) => `  ${l}`).join("\n")}\n`);
  if (notes.length) process.stdout.write(`\n⚠ ${notes.join("\n⚠ ")}\n`);
  process.stdout.write(
    "\nДальше: заполни `.omnifield/harness.yaml` под свой продукт (product/zones/models/grabli),\n" +
      "затем `node .claude/hooks/harness-doctor.mjs` — проверка установки.\n",
  );
}

try {
  await main();
} catch (e) {
  process.stderr.write(`✖ install провалился: ${e.message}\n`);
  process.exit(1);
}
