# Brief — 🕳 fix: vite port 5173 → 3500 (порт-контракт)

| | |
|---|---|
| **Scope** | `frontend` (`packages/frontend/`) |
| **Owner** | owner-frontend (запускает user) |
| **Класс** | дыро-фикс (foundation-first) — идёт до любой фичевой работы |
| **Происхождение** | заметка architect'а в PR#2; расхождение существовало до скелета |

## Факты

- `vite.config.ts:9` — `server: { port: 5173 }` (vite-дефолт).
- Контракт: **3500** — закреплён в `DEPLOY.md` §Порты и в devopser `registry/ports.md`
  (source of truth). Изменение порта = контракт, менять код под контракт, не наоборот.

## Fix

`server: { port: 3500, strictPort: true }` + `preview: { port: 3500, strictPort: true }`.

`strictPort` обязателен: без него занятый порт заставит vite **молча** прыгнуть на соседний —
порт-контракт нарушится тихо. С ним — громкий отказ, причина чинится, не маскируется (канон).

## Verify (DoD)

- `pnpm dev` → дашборд отвечает на `http://localhost:3500`, флоу `DEPLOY.md` сходится.
- `pnpm test` / `pnpm build` зелёные.
- `VITE_API_BASE` и код api-клиента НЕ трогать — дыра только про порт dev-сервера.

## Заметки

- Git: commit-only, `fix(frontend): ...`; push/merge — architect после ревью.
