#!/usr/bin/env node
// install.mjs — РУЧНАЯ установка agent-harness-плагина в целевой репо (метод #1, без
// публикации/движка devopser). Читает frame из plugin.json (тот же контракт, что движок
// материализует вслепую) и раскладывает контент по `.claude/` / `.omnifield/` цели.
//
//   node install.mjs [<target-repo>]        # по умолчанию — cwd
//   node install.mjs --dry-run [<target>]   # показать, что сделает, без записи
//
// Режимы frame[].mode:
//   exact — перезаписать dest содержимым src (managed-рамка).
//   seed  — создать dest ТОЛЬКО если его нет (продукт заполняет сам; не трогаем существующий).
//   merge — JSON deep-merge src в существующий dest (или создать) — для .claude/settings.json.
//
// Zero-deps (node:*). Идемпотентно: повторный запуск — no-op на exact/merge, seed не трогает.

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { mergeSettingsBlock } from "./harness/settings-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url)); // корень бандла (рядом лежат plugin.json + harness/)

function parseArgs(a) {
  const dry = a.includes("--dry-run");
  const target = a.find((x) => !x.startsWith("--")) ?? process.cwd();
  return { dry, target };
}

function loadFrame() {
  const manifest = JSON.parse(readFileSync(join(HERE, "plugin.json"), "utf8"));
  const omni = manifest.omnifield;
  if (!omni?.contentRoot || !Array.isArray(omni.frame)) {
    throw new Error("plugin.json: нет omnifield.contentRoot / frame");
  }
  return omni;
}

function writeLf(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.replace(/\r\n/g, "\n"));
}

function applyExact(srcPath, destPath, actions) {
  mkdirSync(dirname(destPath), { recursive: true });
  cpSync(srcPath, destPath);
  actions.push(`exact  ${destPath}`);
}

function applySeed(srcPath, destPath, actions) {
  if (existsSync(destPath)) {
    actions.push(`seed   ${destPath}  (уже есть — не трогаю)`);
    return;
  }
  mkdirSync(dirname(destPath), { recursive: true });
  cpSync(srcPath, destPath);
  actions.push(`seed   ${destPath}  (создан — заполни под свой продукт)`);
}

function applyMerge(srcPath, destPath, actions) {
  const fragment = JSON.parse(readFileSync(srcPath, "utf8"));
  const current = existsSync(destPath) ? JSON.parse(readFileSync(destPath, "utf8")) : {};
  const merged = mergeSettingsBlock(current, fragment);
  writeLf(destPath, `${JSON.stringify(merged, null, 2)}\n`);
  actions.push(`merge  ${destPath}  (${existsSync(destPath) ? "смерджен" : "создан"})`);
}

function main() {
  const { dry, target } = parseArgs(argv.slice(2));
  const omni = loadFrame();
  const contentRoot = join(HERE, omni.contentRoot);
  const actions = [];
  const planned = [];

  for (const f of omni.frame) {
    const srcPath = join(contentRoot, f.src);
    const destPath = join(target, f.dest);
    if (!existsSync(srcPath)) throw new Error(`frame.src не найден в бандле: ${f.src}`);
    if (dry) {
      planned.push(`${f.mode.padEnd(6)} ${f.src}  →  ${f.dest}`);
      continue;
    }
    if (f.mode === "exact") applyExact(srcPath, destPath, actions);
    else if (f.mode === "seed") applySeed(srcPath, destPath, actions);
    else if (f.mode === "merge") applyMerge(srcPath, destPath, actions);
    else throw new Error(`неизвестный mode "${f.mode}" для ${f.dest}`);
  }

  if (dry) {
    process.stdout.write(
      `agent-harness — сухой прогон (${omni.frame.length} записей) в ${target}:\n`,
    );
    process.stdout.write(`${planned.map((l) => `  ${l}`).join("\n")}\n`);
    return;
  }
  process.stdout.write(`agent-harness установлен в ${target} (${actions.length} записей):\n`);
  process.stdout.write(`${actions.map((l) => `  ${l}`).join("\n")}\n`);
  process.stdout.write(
    "\nДальше: заполни `.omnifield/harness.yaml` под свой продукт (product/zones/models/grabli),\n" +
      "затем `node .claude/hooks/harness-doctor.mjs` — проверка установки.\n",
  );
}

try {
  main();
} catch (e) {
  process.stderr.write(`✖ install провалился: ${e.message}\n`);
  process.exit(1);
}
