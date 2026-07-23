#!/usr/bin/env node
// validate.mjs — build/CI-гейт: материализует проверку plugin-бандла против контракта
// (kb:DEVOPSER-6) без тест-раннера. Печатает результат, exit 1 при любой ошибке.

import { validatePackage } from "./contract.lib.mjs";

const { errors, npmOmni } = validatePackage();
if (errors.length) {
  process.stderr.write(
    "✗ plugin-контракт НАРУШЕН:\n" + errors.map((e) => `  - ${e}`).join("\n") + "\n",
  );
  process.exit(1);
}
process.stdout.write(
  `✓ @brainer/agent-harness-plugin: omnifield-блок валиден (target=${npmOmni.target}, ` +
    `${npmOmni.frame.length} frame-записей, дуальная доставка консистентна)\n`,
);
