// hooks.test.mjs — config-driven хуки (роль-модель = ДАННЫЕ): резолв зон из конфига (ноль
// хардкода), git-доступ по роли, identity-баннер по роли (subprocess), проверка регистрации
// хуков доктором (цена класса placed-once, tasker:BRAIN2-41 §4). node:test, ноль зависимостей.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  blockReason,
  currentAccess,
  gitInvocations,
  stripHeredocBodies,
} from "../harness/hooks/git-gate.mjs";
import {
  checkpointsTarget,
  DEFAULT_CONFIG,
  editDistance,
  gitAccess,
  grabliTarget,
  knownScopes,
  loadConfig,
  nearestScopes,
  needsOnboarding,
  normalizeConfig,
  overlappingZones,
  PLACEHOLDER_PRODUCT,
  parseYaml,
  pilotWorkspace,
  resolveScope,
  roleOf,
  serviceBase,
  validateConfig,
  zonePaths,
  zoneReality,
} from "../harness/hooks/harness-config.mjs";
import {
  declaredRegistrations,
  findRegistrationBlock,
  gitDirOf,
  hooksPathOf,
  isRegistered,
  missingRegistrations,
  precommitReport,
  precommitStatus,
  registrationFix,
  registrationReport,
  report,
  SOURCE_ID,
} from "../harness/hooks/harness-doctor.mjs";
import {
  anomalyBanner,
  checkpointNotice,
  foreignConfigWarning,
  launchBlock,
  needsOnboarding as needsOnboardingViaIdentity,
  noScopeBanner,
  overlapNotice,
  pilotsNotice,
} from "../harness/hooks/scope-identity.mjs";
import block from "../harness/settings.hooks.json" with { type: "json" };

const HERE = dirname(fileURLToPath(import.meta.url));
const PRODUCT_FIXTURE = join(HERE, "fixtures", "product");
const FOREIGN_FIXTURE = join(HERE, "fixtures", "foreign");
const PLACEHOLDER_FIXTURE = join(HERE, "fixtures", "placeholder");
const OVERLAP_FIXTURE = join(HERE, "fixtures", "overlap");
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

// --- pilots-слот (BRAIN2-59): раздел пилотов --------------------------------

test("pilotWorkspace: ws по имени сервиса; нет/пусто → null (правило молчит)", () => {
  const c = normalizeConfig({ pilots: { tasker: " PILOT ", knowledger: "  " } });
  assert.equal(pilotWorkspace(c, "tasker"), "PILOT"); // пробелы обрезаны
  assert.equal(pilotWorkspace(c, "knowledger"), null); // пустой
  assert.equal(pilotWorkspace(normalizeConfig({}), "tasker"), null); // слот не объявлен
  assert.equal(pilotWorkspace(cfg, "knowledger"), "PILOT"); // из фикстуры
});

test("доктор говорит про раздел пилотов в обоих состояниях", () => {
  assert.match(report(PRODUCT_FIXTURE, DOCTOR_URL), /раздел пилотов: knowledger=PILOT/);
  assert.match(report(OVERLAP_FIXTURE, DOCTOR_URL), /раздел пилотов не задан/);
});

// --- checkpoints-слот (BRAIN2-58): адрес чекпойнта роли ----------------------

test("checkpointsTarget: адрес из слота; без root → null (правило молчит)", () => {
  const c = normalizeConfig({ checkpoints: { workspace: "BRAIN2", root: " BRAIN2-55 " } });
  assert.deepEqual(checkpointsTarget(c), { workspace: "BRAIN2", root: "BRAIN2-55" });
  assert.equal(checkpointsTarget(normalizeConfig({})), null); // слот не объявлен
  assert.equal(checkpointsTarget(normalizeConfig({ checkpoints: { workspace: "W" } })), null);
  // workspace справочный: без него адрес всё ещё годен, называть есть что
  assert.deepEqual(checkpointsTarget(normalizeConfig({ checkpoints: { root: "X-1" } })), {
    workspace: null,
    root: "X-1",
  });
  assert.deepEqual(checkpointsTarget(cfg), { workspace: "ACME", root: "ACME-1" }); // фикстура
});

test("баннер называет адрес чекпойнта — и архитектору, и владельцу зоны", () => {
  for (const scope of ["main", "alpha"]) {
    const out = bannerOf(runIdentity(scope));
    assert.match(out, /Чекпойнт роли/, `${scope}: адрес чекпойнта не назван`);
    assert.match(out, /ACME-1/, `${scope}: корень из слота не попал в баннер`);
    assert.match(out, /закрытии этапа/); // момент записи назван там же
  }
  // Роль названа поимённо — узел на роль, а не на сессию.
  assert.match(bannerOf(runIdentity("alpha")), /owner-alpha/);
  // База сервиса есть → готовая команда, чем смотреть детей корня.
  assert.match(bannerOf(runIdentity("main")), /nodes\/ACME-1\/children/);
});

test("слот не объявлен → про чекпойнт МОЛЧИМ (адрес не выдумываем)", () => {
  const out = bannerOf(runIdentity("core", OVERLAP_FIXTURE));
  assert.doesNotMatch(out, /Чекпойнт роли/);
  assert.deepEqual(checkpointNotice(loadConfig(OVERLAP_FIXTURE), "owner-core"), []);
});

test("доктор говорит про слот чекпойнтов в обоих состояниях", () => {
  assert.match(report(PRODUCT_FIXTURE, DOCTOR_URL), /чекпойнты ролей: корень ACME-1/);
  assert.match(report(OVERLAP_FIXTURE, DOCTOR_URL), /чекпойнты не заданы/);
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

// --- validateConfig: relative / непустой -------------------------------------

test("validateConfig: валидная роль-модель → нет ошибок", () => {
  assert.deepEqual(validateConfig(cfg), []);
});

test("пересечение зон — НЕ ошибка валидатора (governance его не держит) — BRAIN2-46 §4", () => {
  const overlapping = normalizeConfig({
    zones: { a: { paths: ["packages/x"] }, b: { paths: ["packages/x/sub"] } },
  });
  assert.deepEqual(validateConfig(overlapping), []); // обещания защиты больше нет
  const pairs = overlappingZones(overlapping);
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].zones.sort(), ["a", "b"]);
});

test("overlappingZones: одинаковый путь, вложенный путь и своя же зона", () => {
  const same = overlappingZones(
    normalizeConfig({ zones: { a: { paths: ["pkg/x"] }, b: { paths: ["pkg/x"] } } }),
  );
  assert.equal(same.length, 1);
  // Несколько папок ОДНОЙ зоны, вложенных друг в друга, пересечением не считаются.
  const own = overlappingZones(
    normalizeConfig({ zones: { a: { paths: ["pkg/x", "pkg/x/sub"] } } }),
  );
  assert.deepEqual(own, []);
  assert.deepEqual(overlappingZones(cfg), []); // здоровая фикстура
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

// Пины сверяем с DEFAULT_CONFIG.models, а не с именами моделей: правило — «недостающее
// достраивается дефолтом», а КАКОЙ дефолт — продуктовая ручка, её крутят (BRAIN2-44 уже
// покрутил). Тест на имя краснел бы на штатной правке и спорил бы с правилом, а не защищал
// его. Саму форму пина держит тест «АЛИАСЫ, не снапшоты» ниже (tasker:BRAIN2-48).
test("normalizeConfig достраивает недостающие секции (+ дефолт-пины моделей)", () => {
  const n = normalizeConfig({ zones: { x: { path: "p" } } });
  assert.deepEqual(n.models, DEFAULT_CONFIG.models);
  assert.equal(n.git.architect, "full");
});

test("models: дефолт-пины применяются, продукт переопределяет частично", () => {
  const n = normalizeConfig({ models: { owner: "custom-own" } });
  assert.equal(n.models.architect, DEFAULT_CONFIG.models.architect); // не задан → дефолт
  assert.equal(n.models.owner, "custom-own"); // переопределён продуктом
  assert.equal(n.models.layer, DEFAULT_CONFIG.models.layer); // не задан → дефолт
  assert.notEqual(DEFAULT_CONFIG.models.owner, "custom-own"); // дефолт не мутировал
});

test("пины моделей — АЛИАСЫ, не снапшоты с датой (BRAIN2-44)", () => {
  const n = normalizeConfig({});
  for (const [role, pin] of Object.entries(n.models)) {
    assert.doesNotMatch(
      pin,
      /-\d{8}$/,
      `${role}: снапшот с датой замораживает сессии — нужен алиас`,
    );
  }
});

test("сид и дефолты рамки объявляют ОДНИ пины (дубль обязан быть громким)", () => {
  const seed = parseYaml(
    readFileSync(join(HERE, "..", "harness", "harness.config.example.yaml"), "utf8"),
  );
  const framework = normalizeConfig({}).models;
  assert.deepEqual(
    seed.models,
    framework,
    "сид обещает «эти же значения применяются, если секцию убрать» — обещание обязано быть правдой",
  );
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

// --- BRAIN2-49: гейт смотрит на исполняемую команду, а не на подстроку -------

const PY_PAYLOAD = [
  "python3 - <<'PY'",
  "body = '''Правило: ветку заводит architect — git checkout -b тебе режет гейт.",
  "Пуш и мерж тоже не твои: git push и git merge — за ним.'''",
  "print(body)",
  "PY",
].join("\n");

test("упоминание git-команды в ДАННЫХ не блокируется", () => {
  // Ровно тот случай, на котором грабля поймана: тело heredoc уезжает в stdin питона.
  assert.equal(blockReason(PY_PAYLOAD, "commit-only"), null);
  assert.equal(blockReason(PY_PAYLOAD, "none"), null);
  assert.equal(blockReason("echo 'git push'", "commit-only"), null);
  assert.equal(
    blockReason('curl -d "git push origin main" http://tasker:8030/x', "commit-only"),
    null,
  );
  assert.equal(blockReason("node -e 'console.log(\"git merge\")'", "commit-only"), null);
});

test("своё же сообщение коммита про git push не блокирует коммит", () => {
  assert.equal(
    blockReason('git commit -m "объясняю, почему git push не наш"', "commit-only"),
    null,
  );
  // а для layer коммит всё равно закрыт — по verb'у, а не по тексту сообщения
  assert.equal(blockReason('git commit -m "текст"', "none"), "git commit");
});

test("настоящая git-запись режется, как бы её ни завернули", () => {
  const cases = [
    ["git push", "git push"],
    ["git 'push'", "git push"], // кавычка вокруг verb'а — не щель
    ['git "push" origin main', "git push"],
    ["/usr/bin/git push", "git push"],
    ["FOO=bar git push", "git push"],
    ["cd packages/harness && git push", "git push"],
    ["git -C /repo --no-pager push", "git push"],
    ["bash -c 'git push'", "git push"], // интерпретатор — сеть грубее, дверь закрыта
    ["env -u OMNIFIELD_SCOPE git push", "git push"],
    ["sudo git push", "git push"],
    ['echo "$(git push)"', "git push"], // подстановка исполняется
    ["echo `git merge x`", "git merge"],
    ["bash <<'EOF'\ngit push\nEOF", "git push"], // heredoc ЧИТАЕТ интерпретатор → это программа
  ];
  for (const [cmd, label] of cases) {
    assert.equal(blockReason(cmd, "commit-only"), label, `не заблокировано: ${cmd}`);
  }
});

test("не разобрали строку → грубая сеть, а не пропуск (fail-safe в закрытую дверь)", () => {
  assert.equal(blockReason("echo 'git push", "commit-only"), "git push"); // кавычка не закрыта
});

test("gitInvocations: сегмент чужой команды игнорится целиком, git-вызов разбирается", () => {
  assert.deepEqual(gitInvocations("echo 'git push'"), []);
  const [call] = gitInvocations("git -C /repo checkout -b feat");
  assert.equal(call.tool, "git");
  assert.equal(call.verb, "checkout");
  assert.deepEqual(call.args, ["-b", "feat"]);
});

test("stripHeredocBodies: тело для питона вырезано, для интерпретатора сохранено", () => {
  assert.doesNotMatch(stripHeredocBodies(PY_PAYLOAD), /checkout/);
  assert.match(stripHeredocBodies("bash <<'EOF'\ngit push\nEOF"), /git push/);
});

test("граница «что считается git-записью» не сдвинулась", () => {
  // Полный набор запретов до и после переписывания распознавания — тот же.
  const commitOnly = [
    "git switch x",
    "git checkout -b x",
    "git push",
    "git merge x",
    "git rebase x",
    "git reset --hard",
    "git branch -D x",
    "git worktree add d",
    "gh pr create",
  ];
  for (const cmd of commitOnly)
    assert.ok(blockReason(cmd, "commit-only"), `должно резаться: ${cmd}`);
  const stillAllowed = [
    "git status",
    "git add .",
    "git commit -m x",
    "git diff",
    "git log",
    "git checkout -- file.txt",
    "git reset --soft HEAD~1",
    "git branch -a",
    "gh pr view",
  ];
  for (const cmd of stillAllowed)
    assert.equal(blockReason(cmd, "commit-only"), null, `не должно: ${cmd}`);
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

function runIdentity(scope, cwd = PRODUCT_FIXTURE) {
  const env = { ...process.env };
  if (scope === undefined) delete env.OMNIFIELD_SCOPE;
  else env.OMNIFIELD_SCOPE = scope;
  return execFileSync("node", [IDENTITY_HOOK], { cwd, env, encoding: "utf8" });
}

/** Текст баннера из ответа хука; хук не сказал ничего → null. */
function bannerOf(raw) {
  return JSON.parse(raw).hookSpecificOutput?.additionalContext ?? null;
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

// --- BRAIN2-60: адрес раздела пилотов — только архитектору --------------------

test("§60 architect-баннер называет адреса раздела пилотов и ссылается на канон", () => {
  const out = bannerOf(runIdentity("main"));
  assert.match(out, /Раздел пилотов/);
  assert.match(out, /kb:PILOT\b/); // ws знания из слота
  assert.match(out, /tasker:PILOT\b/); // ws работы из слота
  assert.match(out, /kb:PILOT-1/); // правила — ссылкой, не пересказом
  // Правила раздела не продублированы в баннер: ступени/критерии живут в shared-policy.
  assert.doesNotMatch(out, /обкатана минимум в ДВУХ|пилот → обкатка → канон/);
});

test("§60 owner-баннер про раздел пилотов молчит — и со слотом, и без", () => {
  assert.doesNotMatch(bannerOf(runIdentity("alpha")), /Раздел пилотов/); // фикстура со слотом
  assert.doesNotMatch(bannerOf(runIdentity("core", OVERLAP_FIXTURE)), /Раздел пилотов/);
});

test("§60 слот не объявлен → архитектор про раздел тоже молчит", () => {
  assert.doesNotMatch(bannerOf(runIdentity("main", OVERLAP_FIXTURE)), /Раздел пилотов/);
  assert.deepEqual(pilotsNotice(loadConfig(OVERLAP_FIXTURE)), []);
});

// --- BRAIN2-61: опечатка в scope — подсказка и готовая команда ----------------

test("§61/63 расстояние считается: вставка · удаление · замена · перестановка", () => {
  assert.equal(editDistance("harness", "harness"), 0);
  assert.equal(editDistance("harnes", "harness"), 1); // пропущенный символ
  assert.equal(editDistance("harnness", "harness"), 1); // лишний символ
  assert.equal(editDistance("hardess", "harness"), 1); // замена
  assert.equal(editDistance("", "abc"), 3);
  assert.equal(editDistance("kitten", "sitting"), 3); // хрестоматийный случай
  // BRAIN2-63: перестановка соседей стоит ОДНУ правку (Дамерау—Левенштейн, OSA), не две.
  assert.equal(editDistance("mian", "main"), 1);
  assert.equal(editDistance("hanress", "harness"), 1);
  // Перестановка НЕ соседей остаётся двумя правками — OSA этого класса и не обещает.
  assert.equal(editDistance("abcd", "dbca"), 2);
});

test("§61 nearestScopes: порог ≈ треть длины набранного, далёкое не подсказываем", () => {
  assert.deepEqual(nearestScopes("alph", cfg), ["alpha"]); // опечатка в один символ
  assert.deepEqual(nearestScopes("mai", cfg), ["main"]); // короткое имя, одна правка
  assert.deepEqual(nearestScopes("betta", cfg), ["beta"]); // лишний символ
  assert.deepEqual(nearestScopes("qwerty", cfg), []); // ничего похожего — не гадаем
  // BRAIN2-63, перевёрнутая граница BRAIN2-61: раньше перестановка в коротком имени стоила
  // ДВЕ правки и в порог не попадала — тест закреплял, что подсказки нет. Перешли на
  // Дамерау—Левенштейна (перестановка = 1 правка), и теперь она ЛОВИТСЯ. Порог не трогали.
  assert.deepEqual(nearestScopes("mian", cfg), ["main"]);
  assert.deepEqual(nearestScopes("aplha", cfg), ["alpha"]); // перестановка в длинном имени
  assert.deepEqual(nearestScopes("", cfg), []); // пусто — не ветка опечатки
  // Несколько имён в пороге — отдаём все, выбор не делаем за человека.
  const twins = normalizeConfig({ zones: { web: { paths: ["a"] }, wev: { paths: ["b"] } } });
  assert.deepEqual(nearestScopes("wex", twins), ["web", "wev"]);
  // Живые классы опечаток на именах длиннее (случай user'а и соседний): не сломались.
  const zones = normalizeConfig({ zones: { harness: { paths: ["a"] }, kernel: { paths: ["b"] } } });
  assert.deepEqual(nearestScopes("harnes", zones), ["harness"]); // пропущенный символ
  assert.deepEqual(nearestScopes("kernell", zones), ["kernel"]); // лишний символ
  assert.deepEqual(nearestScopes("zzzzzz", zones), []); // далёкое — без ложной подсказки
});

test("§63 перестановка даёт названного кандидата и готовую команду", () => {
  const out = bannerOf(runIdentity("mian"));
  assert.match(out, /возможно, ты имел в виду `main`/);
  assert.match(out, /OMNIFIELD_SCOPE=main\s+claude/);
});

test("§61 один близкий кандидат — назван прямо, с готовой командой", () => {
  const out = bannerOf(runIdentity("alph"));
  assert.match(out, /возможно, ты имел в виду `alpha`/);
  assert.match(out, /OMNIFIELD_SCOPE=alpha\s+claude/); // команда, а не только имя
  assert.match(out, /Action.*STOP/s); // финал на месте
});

test("§61 несколько кандидатов — перечислены, выбор за человеком", () => {
  const twins = normalizeConfig({ zones: { web: { paths: ["a"] }, wev: { paths: ["b"] } } });
  const out = anomalyBanner(twins, "wex");
  assert.match(out, /Близкие по написанию: `web`, `wev`/);
  assert.match(out, /за тебя не выбираем/);
  assert.doesNotMatch(out, /имел в виду/); // за человека не решили
  assert.match(out, /OMNIFIELD_SCOPE=web\s+claude/);
  assert.match(out, /OMNIFIELD_SCOPE=wev\s+claude/);
});

test("§61 далёкое имя — обычный список без ложной подсказки", () => {
  const out = anomalyBanner(cfg, "qwerty");
  assert.doesNotMatch(out, /имел в виду|Близкие по написанию/);
  assert.match(out, /OMNIFIELD_SCOPE=alpha\s+claude/); // но команды всё равно даны
  assert.match(out, /OMNIFIELD_SCOPE=main\s+claude/);
});

test("§61 совет «перезапустись» идёт РАНЬШЕ «впиши зону в конфиг»", () => {
  for (const out of [anomalyBanner(cfg, "alph"), anomalyBanner(cfg, "qwerty")]) {
    const restart = out.indexOf("OMNIFIELD_SCOPE=");
    const edit = out.indexOf("впиши её в");
    assert.ok(restart >= 0 && edit > restart, "правка конфига обязана идти вторым советом");
  }
});

test("§61 блок команд запуска — ОДИН формат на обе ветки (роли нет / опечатка)", () => {
  const block = launchBlock(knownScopes(cfg)).join("\n");
  assert.ok(noScopeBanner(cfg).includes(block), "ветка «роли нет» печатает не тот блок");
  assert.ok(anomalyBanner(cfg, "qwerty").includes(block), "ветка UNRESOLVED печатает не тот блок");
});

// --- онбординг: незаполненный сид (BRAIN2-8) ---------------------------------

test("needsOnboarding: my-product/пусто → true; заданный продукт → false", () => {
  assert.equal(needsOnboarding({ product: PLACEHOLDER_PRODUCT }), true); // placeholder шаблона
  assert.equal(needsOnboarding({ product: null }), true); // не задан
  assert.equal(needsOnboarding({ product: "baser" }), false); // заполнен под продукт
  assert.equal(needsOnboarding(cfg), false); // фикстура: product=acme
});

test("признак плейсхолдера — ОДИН на баннер и на доктора (не две копии)", () => {
  assert.equal(needsOnboardingViaIdentity, needsOnboarding);
});

// --- BRAIN2-46: харнесс говорит о своём состоянии ----------------------------

test("§1 доктор НЕ ставит зелёную галочку на плейсхолдер-конфиг", () => {
  const out = report(PLACEHOLDER_FIXTURE, DOCTOR_URL);
  assert.doesNotMatch(out, /✓ продукт: my-product/); // именно эта галочка и врала
  assert.match(out, /ПЛЕЙСХОЛДЕР/);
  assert.match(out, /ОНБОРДИНГ/);
  // …а на заполненном конфиге галочка на месте
  assert.match(report(PRODUCT_FIXTURE, DOCTOR_URL), /✓ продукт: acme/);
});

test("§2 zoneReality: чужой конфиг — зоны объявлены, на диске нет ни одной", () => {
  const foreign = zoneReality(loadConfig(FOREIGN_FIXTURE), FOREIGN_FIXTURE);
  assert.equal(foreign.declared, 2);
  assert.equal(foreign.present, 0);
  assert.equal(foreign.foreign, true);
  // Здоровый репозиторий: все объявленные папки на месте → не чужой.
  const own = zoneReality(cfg, PRODUCT_FIXTURE);
  assert.equal(own.present, own.declared);
  assert.equal(own.foreign, false);
  // Зон нет вовсе — это «зон нет», а не «конфиг чужой».
  assert.equal(zoneReality(normalizeConfig({}), PRODUCT_FIXTURE).foreign, false);
});

test("§2 баннер называет чужой конфиг чужим — ДО первого действия", () => {
  const out = bannerOf(runIdentity("main", FOREIGN_FIXTURE));
  assert.match(out, /НЕ ОТ ЭТОГО РЕПОЗИТОРИЯ/);
  assert.match(out, /STOP/);
  assert.match(out, /weber/); // чужой продукт назван
  // Здоровая фикстура предупреждения не получает.
  assert.doesNotMatch(bannerOf(runIdentity("main")), /НЕ ОТ ЭТОГО РЕПОЗИТОРИЯ/);
});

// --- BRAIN2-51: сигнал приходит туда, где его прочтут ------------------------

test("§1 сомнение о чужом конфиге стоит ПЕРЕД представлением роли, не после", () => {
  const out = bannerOf(runIdentity("main", FOREIGN_FIXTURE));
  const doubt = out.indexOf("НЕ ОТ ЭТОГО РЕПОЗИТОРИЯ");
  const role = out.indexOf("Ты в роли");
  assert.ok(doubt >= 0 && role >= 0, "в баннере должны быть и сомнение, и представление роли");
  assert.ok(doubt < role, "сначала личность, потом оговорка к ней — читающий запомнит первую");
  assert.match(out, /Читай как гипотезу, а не как свою личность/);
});

test("§1 порядок держится и для owner-сессии, не только для архитектора", () => {
  const out = bannerOf(runIdentity("web", FOREIGN_FIXTURE));
  assert.ok(out.indexOf("НЕ ОТ ЭТОГО РЕПОЗИТОРИЯ") < out.indexOf("Ты в роли"));
});

test("§2 владелец пересекающейся зоны узнаёт соседа из БАННЕРА", () => {
  const out = bannerOf(runIdentity("core", OVERLAP_FIXTURE));
  assert.match(out, /делишь папку/);
  assert.match(out, /owner-core-ui/); // сосед назван поимённо
  assert.match(out, /packages\/core.*packages\/core\/ui/); // и по каким путям
  assert.match(out, /границы между вами НЕТ|границы между вами нет/i);
  // Симметрично: сосед узнаёт про нас.
  assert.match(bannerOf(runIdentity("core-ui", OVERLAP_FIXTURE)), /owner-core\b/);
});

test("§2 владелец непересекающейся зоны лишнего блока не получает", () => {
  assert.doesNotMatch(bannerOf(runIdentity("alpha")), /делишь папку/);
  assert.deepEqual(overlapNotice(cfg, "alpha"), []);
});

test("§2 overlapNotice: сосед и стороны путей не перепутаны местами", () => {
  const config = loadConfig(OVERLAP_FIXTURE);
  const mine = overlapNotice(config, "core").join("\n");
  assert.match(mine, /твой `packages\/core` ↔ его `packages\/core\/ui`/);
  const theirs = overlapNotice(config, "core-ui").join("\n");
  assert.match(theirs, /твой `packages\/core\/ui` ↔ его `packages\/core`/);
});

test("§2 предупреждение приезжает и owner-сессии, не только архитектору", () => {
  assert.deepEqual(foreignConfigWarning(cfg, PRODUCT_FIXTURE), []);
  const lines = foreignConfigWarning(loadConfig(FOREIGN_FIXTURE), FOREIGN_FIXTURE);
  assert.ok(lines.length > 0);
  assert.match(lines.join("\n"), /ни одна их папка здесь не/);
});

test("§2 доктор складывает отметки «папки нет» в один вывод", () => {
  const out = report(FOREIGN_FIXTURE, DOCTOR_URL);
  assert.match(out, /КОНФИГ, ПОХОЖЕ, НЕ ОТ ЭТОГО РЕПОЗИТОРИЯ/);
  assert.match(out, /существует: 0/);
});

test("§3 без OMNIFIELD_SCOPE баннер ГОВОРИТ, а не молчит — с командой запуска", () => {
  const out = bannerOf(runIdentity(undefined));
  assert.ok(out, "хук промолчал — человек узнает о проблеме на первой правке");
  assert.match(out, /РОЛИ НЕТ/);
  assert.match(out, /OMNIFIELD_SCOPE=main\s+claude/); // готовая команда
  assert.match(out, /OMNIFIELD_SCOPE=alpha\s+claude/); // и по зоне из ДАННЫХ конфига
  assert.match(out, /STOP/);
});

test("§3 noScopeBanner перечисляет зоны конфига, а без зон — только main", () => {
  assert.match(noScopeBanner(cfg), /Доступные scope: main, alpha, beta/);
  const bare = noScopeBanner(normalizeConfig({}));
  assert.match(bare, /OMNIFIELD_SCOPE=main\s+claude/);
  assert.match(bare, /Зон в .* нет/);
});

test("§4 доктор описывает пересечение зон честно: не ошибка, а отсутствие границы", () => {
  const out = report(OVERLAP_FIXTURE, DOCTOR_URL);
  assert.doesNotMatch(out, /валидатор роль-модели: \d+ ошибок/); // больше не ошибка
  assert.match(out, /машинной границы между ними НЕТ/);
  assert.match(out, /законная раскладка/);
  assert.match(out, /core.*core-ui|core-ui.*core/);
});

// --- BRAIN2-64: рамка требует pre-commit, доктор говорит, есть ли он ---------

const FMT = { ok: (s) => `ok: ${s}`, bad: (s) => `bad: ${s}`, warn: (s) => `warn: ${s}` };

/** Временный «репозиторий» под сценарий: собираем нужные файлы, после теста сносим. */
function withRepo(build, check) {
  const dir = mkdtempSync(join(tmpdir(), "harness-precommit-"));
  try {
    build(dir);
    check(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function put(dir, rel, content = "#!/bin/sh\nexit 0\n") {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

test("§64 хук в `.git/hooks` — машина есть, доктор говорит откуда", () => {
  withRepo(
    (dir) => put(dir, ".git/hooks/pre-commit"),
    (dir) => {
      const s = precommitStatus(dir);
      assert.equal(s.live, true);
      assert.match(s.via, /\.git[/\\]hooks/);
      assert.match(precommitReport(dir, FMT).join("\n"), /^ok: машинный pre-commit подключён/);
    },
  );
});

test("§64 `core.hooksPath` (husky и подобные) читается из `.git/config`", () => {
  withRepo(
    (dir) => {
      put(dir, ".git/config", "[core]\n\tbare = false\n\thooksPath = .husky/_\n[remote]\n");
      put(dir, ".husky/_/pre-commit");
    },
    (dir) => {
      assert.equal(hooksPathOf(join(dir, ".git")), ".husky/_");
      const s = precommitStatus(dir);
      assert.equal(s.live, true);
      assert.match(s.via, /core\.hooksPath = \.husky\/_/);
    },
  );
});

test("§64 хук лежит файлом, но git его не видит — это НЕ зелёный, а громкий отказ", () => {
  withRepo(
    (dir) => {
      put(dir, ".git/config", "[core]\n\tbare = false\n");
      put(dir, ".husky/pre-commit"); // `prepare` не выполнялся → core.hooksPath не настроен
    },
    (dir) => {
      const s = precommitStatus(dir);
      assert.equal(s.live, false);
      assert.equal(s.dormant, ".husky/pre-commit");
      const out = precommitReport(dir, FMT).join("\n");
      assert.match(out, /^bad: .*git его не видит/m);
      assert.match(out, /core\.hooksPath/);
    },
  );
});

test("§64 машины нет вовсе — доктор говорит громко и называет границу «не везём»", () => {
  withRepo(
    (dir) => put(dir, ".git/config", "[core]\n\tbare = false\n"),
    (dir) => {
      const s = precommitStatus(dir);
      assert.deepEqual([s.repo, s.live, s.dormant], [true, false, null]);
      const out = precommitReport(dir, FMT).join("\n");
      assert.match(out, /^bad: машинного pre-commit НЕТ/m);
      assert.match(out, /ТРЕБОВАНИЕ К ПРОДУКТУ/);
      assert.match(out, /обвес их не везёт/);
      assert.match(out, /husky init|lefthook install|pre-commit install/);
      assert.match(out, /руками перед каждым коммитом/);
    },
  );
});

test("§64 не репозиторий — говорим об этом, а не выдаём отсутствие хука за отказ", () => {
  withRepo(
    () => {},
    (dir) => {
      assert.equal(precommitStatus(dir).repo, false);
      assert.match(precommitReport(dir, FMT).join("\n"), /^warn: git-репозиторий не найден/);
    },
  );
});

test("§64 `.git` файлом (worktree/submodule) резолвится, а не считается отсутствием репо", () => {
  withRepo(
    (dir) => {
      put(dir, ".git", "gitdir: ./real-git\n");
      put(dir, "real-git/hooks/pre-commit");
    },
    (dir) => {
      assert.equal(gitDirOf(dir), join(dir, "real-git"));
      assert.equal(precommitStatus(dir).live, true);
    },
  );
});

test("§64 рамка не выдаёт машинный pre-commit за данность", () => {
  // Защищаем ПРАВИЛО (обещание = ложь у того, кто машину не ставил), а не формулировку:
  // прежняя строка обещала «pre-commit test+lint+build зелёные» как факт поставки.
  const policy = readFileSync(new URL("../harness/shared-policy.md", import.meta.url), "utf8");
  assert.doesNotMatch(policy, /^\s*pre-commit test\+lint\+build зелёные\.$/m);
  assert.match(policy, /ТРЕБОВАНИЕ К ПРОДУКТУ/);
  assert.match(policy, /не везёт/); // граница названа и в рамке, не только в коде
  assert.match(policy, /каденс держится на ТЕБЕ|держится на ТЕБЕ/);
});

// --- доктор: регистрация хуков (цена класса placed-once, BRAIN2-41 §4) -------

const DOCTOR_URL = new URL("../harness/hooks/harness-doctor.mjs", import.meta.url).href;

test("эталон объявляет регистрацию всех четырёх гейт-хуков", () => {
  const regs = declaredRegistrations(block);
  const cmds = regs.map((r) => r.command).join(" ");
  for (const hook of ["git-gate", "governance", "main-session-marker", "scope-identity"])
    assert.match(cmds, new RegExp(`${hook}\\.mjs`), `эталон не регистрирует ${hook}`);
  assert.ok(
    regs.some((r) => r.event === "PreToolUse" && r.matcher?.includes("Edit")),
    "governance должен висеть на файло-мутирующих тулах",
  );
  assert.ok(regs.some((r) => r.event === "SessionStart" && r.matcher === null));
});

test("зарегистрированным считается совпадение тройки событие·matcher·команда", () => {
  const reg = declaredRegistrations(block)[0];
  assert.equal(isRegistered({ hooks: { [reg.event]: [reg2group(reg)] } }, reg), true);
  // тот же хук, но повешен на другое событие — НЕ считается зарегистрированным
  assert.equal(isRegistered({ hooks: { Other: [reg2group(reg)] } }, reg), false);
  // тот же хук на своём событии, но с чужим matcher'ом — тоже нет
  assert.equal(
    isRegistered(
      { hooks: { [reg.event]: [{ matcher: "Nope", hooks: reg2group(reg).hooks }] } },
      reg,
    ),
    false,
  );
});

function reg2group(reg) {
  const group = reg.matcher === null ? {} : { matcher: reg.matcher };
  group.hooks = [{ type: "command", command: reg.command }];
  return group;
}

test("пустой settings.json → не зарегистрировано НИЧЕГО (все записи названы поимённо)", () => {
  const missing = missingRegistrations({}, block);
  assert.equal(missing.length, declaredRegistrations(block).length);
});

test("чужие хуки и настройки пользователя расхождением не считаются", () => {
  const settings = JSON.parse(JSON.stringify(block));
  settings.permissions = { allow: ["Read"] };
  settings.hooks.SessionStart.unshift({
    hooks: [{ type: "command", command: "node user-hook.mjs" }],
  });
  assert.deepEqual(missingRegistrations(settings, block), []);
});

test("наш хук рядом с чужим в одной группе — зарегистрирован (группу не сравниваем целиком)", () => {
  const settings = JSON.parse(JSON.stringify(block));
  settings.hooks.SessionStart[0].hooks.push({ type: "command", command: "node user-hook.mjs" });
  assert.deepEqual(missingRegistrations(settings, block), []);
});

test("расхождение печатается ГОТОВОЙ строкой для `.claude/settings.json`", () => {
  const fix = registrationFix(missingRegistrations({}, block));
  assert.ok(fix.length >= 1);
  const json = JSON.parse(`{${fix.join(",")}}`); // строка обязана быть валидным куском JSON
  assert.ok(Array.isArray(json.PreToolUse) && Array.isArray(json.SessionStart));
  assert.match(JSON.stringify(json), /git-gate\.mjs/);
  assert.equal(json.PreToolUse[0].hooks[0].type, "command");
});

test("эталон находится рядом с доктором (раскладка пакета/бандла)", () => {
  const ref = findRegistrationBlock(join(HERE, "fixtures", "product"), DOCTOR_URL);
  assert.ok(ref, "эталонный блок не найден рядом с доктором");
  assert.match(ref.path, /settings\.hooks\.json$/);
});

test("эталона нет → проверка НЕ выполнена и это сказано вслух (не молчаливый зелёный)", () => {
  const nowhere = new URL("fixtures/product/.omnifield/nope.mjs", import.meta.url).href;
  assert.equal(findRegistrationBlock(join(HERE, "fixtures", "product"), nowhere), null);
  const lines = registrationReport(join(HERE, "fixtures", "product"), nowhere, {
    ok: (s) => s,
    bad: (s) => s,
    warn: (s) => s,
  });
  assert.match(lines.join("\n"), /НЕ выполнена/);
});

test("нет `.claude/settings.json` у потребителя → громкий отчёт, а не тишина", () => {
  const lines = registrationReport(join(HERE, "fixtures", "product"), DOCTOR_URL, {
    ok: (s) => s,
    bad: (s) => s,
    warn: (s) => s,
  });
  assert.match(lines.join("\n"), /не найден|НЕ зарегистрированы/);
});

test("личность обвеса в докторе совпадает с манифестом (дубль обязан быть громким)", () => {
  const pkg = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));
  assert.equal(SOURCE_ID, pkg.baser.source.id);
});

// --- доставка хуков объявлена в раскладке ------------------------------------

test("все config-driven хуки объявлены в раскладке (regenerated) и существуют", () => {
  const pkg = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));
  const hookEntries = pkg.baser.layout.filter((f) => f.dest.startsWith(".claude/hooks/"));
  for (const name of [
    "harness-config",
    "scope-resolve",
    "scope-identity",
    "git-gate",
    "governance",
    "main-session-marker",
    "harness-doctor",
  ]) {
    const entry = hookEntries.find((f) => f.dest === `.claude/hooks/${name}.mjs`);
    assert.ok(entry, `раскладка не кладёт ${name}.mjs`);
    assert.equal(entry.class, "regenerated");
    assert.equal(entry.render, false);
    assert.ok(existsSync(join(HERE, "..", "harness", entry.src)), `нет src ${entry.src}`);
  }
});
