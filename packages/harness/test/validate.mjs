#!/usr/bin/env node
// validate.mjs — build/CI-гейт: объявление обвеса (`package.json.baser`) валидно против формы
// baser и полно против раскладки этого обвеса. Без тест-раннера. Печатает результат, exit 1
// при любой ошибке. Авторитетная проверка формы — `npx baser check packages/harness`.

import { validatePackage } from "./contract.lib.mjs";

const { errors, pkg, baser } = validatePackage();
if (errors.length) {
  process.stderr.write(
    `✗ объявление обвеса НЕПРИГОДНО:\n${errors.map((e) => `  - ${e}`).join("\n")}\n`,
  );
  process.exit(1);
}
const placedOnce = baser.layout.filter((f) => f.class === "placed-once").length;
process.stdout.write(
  `✓ ${pkg.name}@${pkg.version}: объявление валидно (обвес ${baser.source.id}, форма ` +
    `${baser.formVersion}, ${baser.layout.length} записей раскладки — ${placedOnce} placed-once)\n`,
);
