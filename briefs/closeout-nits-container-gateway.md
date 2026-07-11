# Brief — Закрытие висяков: ниты пересадки + финал gateway-DoD

| | |
|---|---|
| **Адресат** | brainer-архитектор (+ п.4 — user, браузер) |
| **От** | оракул-архитектор, 2026-07-11 |
| **Основание** | финал-ревью пересадки (devopser `feedback-container-sessions-brainer.md`) + ревью gateway (devopser `gateway-hub-single-origin.md`) — ниты повторены дважды, закрываем разом |
| **Класс** | мелочи, один заход; блокеров нет |

## Задачи

| # | Висяк | Что сделать | Где |
|---|---|---|---|
| 1 | `briefs/img.png` в дереве (untracked) | Решить судьбу: если это скрин для фидбека — фидбек давно ушёл текстом, файл удалить. Бинарь-скрины в `briefs/` не живут (прецедент devopser `74dfe8f` — «убрать случайно закоммиченный скриншот»). Если содержимое ценно — перенести инфо текстом в соответствующий бриф, файл удалить | рабочее дерево |
| 2 | Лаунчер без PAT-пробы: на свежем volume `pnpm install` «висит без намёка» (класс Д3) | Порт fail-fast пробы из postCreate шаблона — в `docker exec` перед install: `sudo chown -R vscode:vscode … && (timeout 20 npm whoami --registry=https://npm.pkg.github.com >/dev/null 2>&1 \|\| { echo "✖ нет валидного PAT в \$NPM_CONFIG_USERCONFIG (volume omnifield-secrets) — занос кредов: devopser devbox/README §Пост-шаги"; exit 1; }) && pnpm install` | `scripts/devbox-session.sh:36` |
| 3 | `WORKSPACE` прибит (`$HOME/omnifield/brainer`) — скрипт ломается при другом месте клона | Выводить из пути скрипта: `WORKSPACE="$(cd "$(dirname "$0")/.." && pwd)"` (строка 18). ⚠️ Грабля репо: правка через `\\wsl.localhost` сбрасывает exec-бит — править из WSL/контейнера либо вернуть бит (`372fc4d`) | `scripts/devbox-session.sh:18` |
| 4 | Последний пункт gateway-DoD: **HMR глазами** (websocket curl'ом не проверяется) | user, при живом фронте: открыть `http://localhost:8080/brainer/`, тронуть любой view → страница обновляется БЕЗ F5; в DevTools→Network — ни одного запроса на `:3500`/`:8000`. Результат — строкой в devopser `gateway-hub-single-origin.md` (секция ревью оракула) | браузер user |

## Не входит (не висяки этого брифа)

- platform D4 issue-form — трек devopser, несёт на согласование оракулу своим темпом.
- DoD-прогон workstation на чистой тачке — user, после (перед weber-пересадкой).
- llm-engine compose — ждёт порт оракула (`packages/llm-engine`, по отмашке user).

## DoD

Дерево brainer чистое (`git status` пуст); лаунчер: fail-fast проба + WORKSPACE от
пути скрипта, exec-бит на месте; HMR-строка вписана в gateway-бриф devopser. Ответ —
секцией сюда.
