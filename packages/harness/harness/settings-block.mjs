// settings-block.mjs — идемпотентный splice-merge managed-блока хуков (settings.hooks.json)
// в пользовательский `.claude/settings.json`. НЕ перезапись: user-настройки и его собственные
// hook-группы сохраняются; наши группы добавляются РОВНО ОДИН раз (повторный merge = no-op).
//
// Идемпотентность — по СОДЕРЖИМОМУ (deep-equal группы), без не-схемных marker-ключей:
// повторный прогон находит идентичную группу и не дублирует.
//
// Это harness-side reference-материализация managed-блока (source of truth — settings.hooks.json).
// Движковый mode:block пока line-splice для gitignore; JSON-aware wiring — за devopser (эскалация).

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

/**
 * Вмерживает block.hooks в settings.hooks идемпотентно.
 * @param {object} settings — текущий .claude/settings.json (или {}).
 * @param {object} block — managed-блок (settings.hooks.json), $comment игнорится.
 * @returns {object} новый settings с зарегистрированными хуками (input не мутируется).
 */
export function mergeSettingsBlock(settings, block) {
  const result = settings && typeof settings === "object" ? clone(settings) : {};
  const blockHooks = block?.hooks ?? {};
  if (!result.hooks || typeof result.hooks !== "object") result.hooks = {};

  for (const [event, groups] of Object.entries(blockHooks)) {
    if (!Array.isArray(result.hooks[event])) result.hooks[event] = [];
    for (const group of groups) {
      const exists = result.hooks[event].some((g) => deepEqual(g, group));
      if (!exists) result.hooks[event].push(clone(group));
    }
  }
  return result;
}
