#!/usr/bin/env node

// harness-doctor.mjs — самопроверка установки харнесса. НЕ хук: запускается руками из корня репо.
//   node .claude/hooks/harness-doctor.mjs                 # общий отчёт
//   OMNIFIELD_SCOPE=<scope> node .claude/hooks/harness-doctor.mjs   # + кто ты при этом scope
//
// Печатает реальность (продукт · зоны+существование папок · твоя роль · регистрация хуков ·
// marker), чтобы не приходилось «понимать по описанию»: запустил — увидел. Zero-deps
// (node:* + harness-config).
//
// ЗАЧЕМ здесь проверка регистрации хуков. `.claude/settings.json` — общий файл клиента
// (permissions, env, свои хуки), и обвес кладёт его классом `placed-once`: один раз и дальше
// не трогает. Цена класса — новые хуки следующих версий обвеса приезжают в `.claude/hooks/`,
// а РЕГИСТРАЦИЯ их не приезжает, потому что живёт в том самом файле. Форма baser выразить это
// не может (режимов материализации в записи нет, `merge` отменён), поэтому деградацию делаем
// ГРОМКОЙ: доктор сверяет эталонный блок регистрации с настоящим settings.json и печатает
// строку, которую нужно дописать. Это не обход формы — механизм не подменяется, называется то,
// что механизм назвать не может (tasker:BRAIN2-41 §4).

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import {
  gitAccess,
  grabliTarget,
  knownScopes,
  loadConfig,
  parseYaml,
  rejectedZoneNames,
  resolveScope,
  roleOf,
  serviceBase,
  validateConfig,
  zonePaths,
} from "./harness-config.mjs";

/** Личность обвеса (`package.json.baser.source.id`). Дубль объявления — но ГРОМКИЙ:
 *  расхождение с манифестом ловит contract.test.mjs. Личность стабильна по построению,
 *  имя пакета — нет (форма §1: имя это доставка, id это личность). */
export const SOURCE_ID = "brainer/harness";
/** Имя эталонного блока регистрации внутри contentRoot обвеса. */
export const REGISTRATION_BLOCK = "settings.hooks.json";
const CONSUMER_SETTINGS = join(".claude", "settings.json");

// --- регистрация хуков: эталон, факт, расхождение ----------------------------

/** Плоский список объявленных регистраций: {event, matcher, command}. */
export function declaredRegistrations(block) {
  const out = [];
  for (const [event, groups] of Object.entries(block?.hooks ?? {})) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const matcher = group?.matcher ?? null;
      for (const hook of group?.hooks ?? []) {
        if (typeof hook?.command === "string") out.push({ event, matcher, command: hook.command });
      }
    }
  }
  return out;
}

/** Зарегистрирована ли ровно эта тройка (событие · matcher · команда) в settings.json. */
export function isRegistered(settings, { event, matcher, command }) {
  const groups = settings?.hooks?.[event];
  if (!Array.isArray(groups)) return false;
  return groups.some(
    (g) => (g?.matcher ?? null) === matcher && (g?.hooks ?? []).some((h) => h?.command === command),
  );
}

/** Что объявлено эталоном, но не зарегистрировано у потребителя. */
export function missingRegistrations(settings, block) {
  return declaredRegistrations(block).filter((r) => !isRegistered(settings, r));
}

/** Готовая строка, которую человеку нужно дописать в `.claude/settings.json`. */
export function registrationFix(missing) {
  const byEvent = new Map();
  for (const r of missing) {
    if (!byEvent.has(r.event)) byEvent.set(r.event, []);
    byEvent.get(r.event).push(r);
  }
  const lines = [];
  for (const [event, regs] of byEvent) {
    const groups = [];
    const byMatcher = new Map();
    for (const r of regs) {
      if (!byMatcher.has(r.matcher)) byMatcher.set(r.matcher, []);
      byMatcher.get(r.matcher).push(r.command);
    }
    for (const [matcher, commands] of byMatcher) {
      const group = matcher === null ? {} : { matcher };
      group.hooks = commands.map((command) => ({ type: "command", command }));
      groups.push(group);
    }
    lines.push(`"${event}": ${JSON.stringify(groups)}`);
  }
  return lines;
}

/**
 * Где лежит эталонный блок регистрации. Объявление у него ОДНО (`settings.hooks.json` в
 * contentRoot обвеса) — ищем его там, где в этой раскладке живёт содержимое обвеса:
 *   1) рядом с самим доктором (`harness/hooks/` → `harness/`) — исходник и ручной бандл;
 *   2) у потребителя доктор лежит в `.claude/hooks/`, а содержимое — в пакете: находим пакет
 *      по ЛИЧНОСТИ среди объявленных в `baser.json` (имя пакета — доставка, оно переезжает).
 * Не нашли — говорим вслух: проверка НЕ выполнена (молчаливый зелёный хуже отсутствующего).
 */
export function findRegistrationBlock(cwd, moduleUrl) {
  const sibling = fileURLToPath(new URL(`../${REGISTRATION_BLOCK}`, moduleUrl));
  if (existsSync(sibling)) return { path: sibling, via: "рядом с доктором (contentRoot обвеса)" };

  const consumerManifest = join(cwd, "package.json");
  if (!existsSync(consumerManifest)) return null;
  let sources = [];
  try {
    sources = JSON.parse(readFileSync(join(cwd, "baser.json"), "utf8"))?.sources ?? [];
  } catch {
    return null;
  }
  const require = createRequire(consumerManifest);
  for (const entry of sources) {
    const use = entry?.use;
    if (typeof use !== "string") continue;
    try {
      const manifestPath = require.resolve(`${use}/package.json`);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest?.baser?.source?.id !== SOURCE_ID) continue;
      const path = join(
        dirname(manifestPath),
        manifest.baser.source.contentRoot,
        REGISTRATION_BLOCK,
      );
      if (existsSync(path)) return { path, via: `пакет ${use}` };
    } catch {
      // пакет не резолвится / манифест не читается — идём к следующему источнику
    }
  }
  return null;
}

/** Отчёт по регистрации хуков: строки для печати. */
export function registrationReport(cwd, moduleUrl, { ok, bad, warn }) {
  const lines = [];
  const ref = findRegistrationBlock(cwd, moduleUrl);
  if (!ref) {
    lines.push(warn("эталонный блок регистрации не найден — проверка хуков НЕ выполнена"));
    lines.push(
      `    → он живёт в пакете обвеса (${REGISTRATION_BLOCK}); поставь пакет либо запусти доктора из бандла.`,
    );
    return lines;
  }
  let block;
  try {
    block = JSON.parse(readFileSync(ref.path, "utf8"));
  } catch {
    lines.push(bad(`эталонный блок регистрации не читается: ${ref.path}`));
    return lines;
  }

  const settingsPath = join(cwd, CONSUMER_SETTINGS);
  let settings = null;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    settings = null;
  }
  if (settings === null) {
    lines.push(bad(`${CONSUMER_SETTINGS} не найден/не читается — ни один хук не подключён`));
    lines.push("    → положи файл заново (обвес кладёт его один раз, класс placed-once).");
    return lines;
  }

  const declared = declaredRegistrations(block);
  const missing = missingRegistrations(settings, block);
  if (!missing.length) {
    lines.push(
      ok(
        `хуки зарегистрированы в ${CONSUMER_SETTINGS}: ${declared.length}/${declared.length} (эталон — ${ref.via})`,
      ),
    );
  } else {
    lines.push(bad(`хуки НЕ зарегистрированы: ${missing.length} из ${declared.length}`));
    for (const r of missing)
      lines.push(`    - ${r.event}${r.matcher ? ` [${r.matcher}]` : ""} → ${r.command}`);
    lines.push(`    ПРИЧИНА: ${CONSUMER_SETTINGS} кладётся один раз (placed-once) — регистрация`);
    lines.push("    новых хуков сама не приезжает. Допиши в `hooks` вручную:");
    for (const line of registrationFix(missing)) lines.push(`      ${line}`);
  }

  // Обратная сторона: зарегистрированная команда указывает на несуществующий файл.
  const stale = declaredRegistrations(settings)
    .filter((r) => /\.claude[/\\]hooks[/\\]/.test(r.command))
    .filter((r) => {
      const file = /(\.claude[/\\]hooks[/\\][\w.-]+)/.exec(r.command)?.[1];
      return file && !existsSync(resolve(cwd, file));
    });
  for (const r of stale) lines.push(warn(`зарегистрирован отсутствующий хук: ${r.command}`));

  return lines;
}

// --- отчёт -------------------------------------------------------------------

export function report(cwd, moduleUrl) {
  const out = [];
  const p = (s = "") => out.push(s);
  const ok = (s) => `  ✓ ${s}`;
  const bad = (s) => `  ✗ ${s}`;
  const warn = (s) => `  ⚠ ${s}`;

  p("harness doctor — проверка установки");
  p(`repo (cwd): ${cwd}`);
  p("");

  // --- конфиг ----------------------------------------------------------------
  const yamlPath = join(cwd, ".omnifield", "harness.yaml");
  let raw = null;
  try {
    raw = parseYaml(readFileSync(yamlPath, "utf8"));
  } catch {
    raw = null;
  }
  const config = loadConfig(cwd);

  if (!raw) {
    p(bad(".omnifield/harness.yaml не найден/не читается"));
    p("    → main-сессия заведётся на дефолте; owner-сессии НЕ смогут стартовать (нет зон).");
  } else {
    p(ok(".omnifield/harness.yaml прочитан"));
    const av = raw.apiVersion ?? "(нет)";
    const kind = raw.kind ?? "(нет)";
    p(`    apiVersion: ${av} · kind: ${kind}  (справочно — станком не валидируются)`);
  }
  p("");

  // --- продукт ---------------------------------------------------------------
  if (config.product) p(ok(`продукт: ${config.product}`));
  else p(warn("продукт не задан (`product:` пуст) — баннер попросит вписать"));
  p(`архитекторов сконфигурено: ${config.architects}`);
  const grabli = grabliTarget(config);
  if (grabli) p(ok(`grabli-ws: ${grabli} (затыки/грабли пишем сюда)`));
  else p(warn("grabli-ws не задан (`grabli.workspace`) — канал записи граблей не сконфигурен"));
  const tsk = serviceBase(config, "tasker");
  const kb = serviceBase(config, "knowledger");
  if (tsk || kb) {
    p(ok(`services (доступ curl'ом, НЕ MCP): tasker=${tsk ?? "—"} · knowledger=${kb ?? "—"}`));
    p(
      `    проверь связь: curl -s ${tsk ?? "<tasker>"}/healthz  (нет ответа → сэндбокс off / смени адрес)`,
    );
  } else {
    p(warn("services не заданы (`services.tasker/.knowledger`) — базы сервисов не сконфигурены"));
  }
  p("");

  // --- зоны ------------------------------------------------------------------
  const rejected = rejectedZoneNames(raw?.zones);
  if (rejected.length) {
    p(bad(`зоны с зарезервированными именами ОТВЕРГНУТЫ: ${rejected.join(", ")}`));
    p("    → переименуй (main/layer — служебные слова роль-модели).");
  }
  const zones = Object.entries(config.zones);
  if (!zones.length) {
    p(warn("зон нет — owner-сессии стартовать не смогут (только architect/main)"));
  } else {
    p(`зоны (${zones.length}):`);
    for (const [name, z] of zones) {
      const paths = zonePaths(z);
      if (!paths.length) {
        p(bad(`${name} → нет путей (пустой paths[])`));
        continue;
      }
      p(`  ${name}:`);
      for (const path of paths) {
        const exists = existsSync(join(cwd, path));
        p(`    ${exists ? "✓" : "✗"} ${path}${exists ? "" : "   ПАПКИ НЕТ (boundary на пустоту)"}`);
      }
    }
  }
  // Валидатор роль-модели (disjoint / relative / непустой) — kb:BRAIN2-1.
  const cfgErrors = validateConfig(config);
  if (cfgErrors.length) {
    p("");
    p(bad(`валидатор роль-модели: ${cfgErrors.length} ошибок`));
    for (const e of cfgErrors) p(`    - ${e}`);
  } else if (zones.length) {
    p(ok("валидатор роль-модели: пути relative, непустые, не пересекаются"));
  }
  p("");

  // --- регистрация хуков (цена класса placed-once, см. шапку) ----------------
  for (const line of registrationReport(cwd, moduleUrl, { ok, bad, warn })) p(line);
  p("");

  // --- текущий scope ---------------------------------------------------------
  const scope = process.env.OMNIFIELD_SCOPE;
  if (!scope) {
    p("OMNIFIELD_SCOPE не задан — запусти `OMNIFIELD_SCOPE=main|<zone> ...` чтобы увидеть роль.");
    p(`доступные scope: ${knownScopes(config).join(", ")}`);
  } else {
    const resolved = resolveScope(scope, config);
    if (scope === "main") {
      p(ok(`OMNIFIELD_SCOPE=main → architect (git: ${gitAccess("main", config)})`));
    } else if (resolved?.kind === "zone") {
      p(
        ok(
          `OMNIFIELD_SCOPE=${scope} → owner-${scope} (git: ${gitAccess(scope, config)}), папки: ${resolved.paths.map((x) => `${x}/`).join(", ")}`,
        ),
      );
    } else {
      p(bad(`OMNIFIELD_SCOPE=${scope} НЕ резолвится в зону (роль: ${roleOf(scope)})`));
      p(`    доступные: ${knownScopes(config).join(", ")}`);
    }
  }
  p("");

  // --- marker ----------------------------------------------------------------
  const marker = join(cwd, ".claude", ".main-session-id");
  try {
    const ids = readFileSync(marker, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    p(ok(`marker .claude/.main-session-id есть (${ids.length} активн. main-сессий)`));
  } catch {
    p(`  · marker .claude/.main-session-id нет (появится на SessionStart architect-сессии)`);
  }

  return out.join("\n");
}

// main() ТОЛЬКО как скрипт — при import (тесты) не запускается.
if (fileURLToPath(import.meta.url) === argv[1]) {
  process.stdout.write(`${report(process.cwd(), import.meta.url)}\n`);
}
