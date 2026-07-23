// harness-config.mjs — единый источник роль-модели как ДАННЫХ (kb:BRAIN-3): читает
// `.omnifield/harness.yaml` (пресет-сид, доставленный плагином mode:seed) и отдаёт хукам
// зоны/пути, пины моделей, число архитекторов, git-доступ по роли. Ноль хардкода зон.
//
// Зависимостей нет (хуки Claude Code стартуют голым node). YAML парсится подмножеством
// (scalar + вложенные map'ы, без списков/flow — ровно то, что нужно harness.yaml).
// Файла нет → DEFAULT_CONFIG (degraded, но безопасный: только 'main'/architect известен,
// зоны пусты → неизвестный scope = аномалия; git по роли — инвариант рамки).

import { readFileSync } from "node:fs";
import { join } from "node:path";

// Инвариант рамки (shared-policy) — НЕ продуктовые данные: git-доступ по роли не выключить.
// Значения оверрайдятся конфигом, но роль-семантика (что именно режется) — в git-gate.
const GIT_INVARIANT = { architect: "full", owner: "commit-only", layer: "none" };

export const DEFAULT_CONFIG = {
  architects: 1,
  models: {},
  zones: {},
  git: { ...GIT_INVARIANT },
};

/** Коэрция скалярного YAML-значения: quotes strip, int, bool, иначе строка. */
function coerce(raw) {
  const v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (/^-?\d+$/.test(v)) return Number(v);
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

/**
 * Мини-парсер YAML-подмножества: отступ = 2 пробела/уровень; `key:` → вложенный map;
 * `key: value` → скаляр. Комментарии (`# …`), пустые строки и `---` игнорятся.
 * Списки и flow-синтаксис НЕ поддерживаются (в harness.yaml их нет).
 */
export function parseYaml(text) {
  const root = {};
  const stack = [{ indent: -1, obj: root }];
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed === "---") continue;
    const ci = trimmed.indexOf(":");
    if (ci === -1) continue; // не key:value (списков не ждём) — пропуск
    const indent = rawLine.length - rawLine.trimStart().length;
    const key = trimmed.slice(0, ci).trim();
    const val = trimmed.slice(ci + 1).trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    if (val === "") {
      const child = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else {
      parent[key] = coerce(val);
    }
  }
  return root;
}

/** Достраивает распарсенный конфиг дефолтами по отсутствующим секциям. */
export function normalizeConfig(parsed) {
  const c = parsed && typeof parsed === "object" ? parsed : {};
  return {
    architects: typeof c.architects === "number" ? c.architects : DEFAULT_CONFIG.architects,
    models: c.models && typeof c.models === "object" ? c.models : {},
    zones: c.zones && typeof c.zones === "object" ? c.zones : {},
    git: { ...GIT_INVARIANT, ...(c.git && typeof c.git === "object" ? c.git : {}) },
  };
}

/** Читает `.omnifield/harness.yaml` из cwd; нет файла/парс упал → DEFAULT_CONFIG. */
export function loadConfig(cwd = process.cwd()) {
  try {
    const text = readFileSync(join(cwd, ".omnifield", "harness.yaml"), "utf8");
    return normalizeConfig(parseYaml(text));
  } catch {
    return { ...DEFAULT_CONFIG, git: { ...GIT_INVARIANT } };
  }
}

/** Роль по scope: main→architect; 'layer'→layer; иначе (зона) → owner. */
export function roleOf(scope) {
  if (scope === "main") return "architect";
  if (scope === "layer") return "layer";
  return "owner";
}

/** Git-доступ (full|commit-only|none) для scope — из config.git[role], иначе инвариант. */
export function gitAccess(scope, config) {
  const role = roleOf(scope);
  return config?.git?.[role] ?? GIT_INVARIANT[role] ?? "none";
}

/** Резолв scope → зона (из ДАННЫХ конфига). main → architect; unknown → null (аномалия). */
export function resolveScope(scope, config) {
  if (scope === "main") return { kind: "main", scope: "main", role: "architect" };
  const zone = config?.zones?.[scope];
  if (!zone) return null;
  const description = typeof zone === "object" ? zone.description : undefined;
  const relativePath = typeof zone === "object" ? zone.path : String(zone);
  return {
    kind: "zone",
    scope,
    role: "owner",
    relativePath,
    name: description ? `${scope} — ${description}` : scope,
  };
}

/** Список известных scope'ов (для аномалий/CLI). */
export function knownScopes(config) {
  return ["main", ...Object.keys(config?.zones ?? {})];
}
