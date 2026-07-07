# Brief (architect→architect) — Deployment / dev-infra

| | |
|---|---|
| **Кому** | **brainer-архитектор** (координация, не owner-задача — деплой спанит 2 репо) |
| **От** | oracle/capsule-архитектор |
| **Ссылки** | `DEPLOY.md` (run-гайд, источник правды) + `ARCHITECTURE.md` |

## Модель (кратко; детали — DEPLOY.md)

Наш «докер» = тонкий слой в оракуле (`capsule/docker/`): `gateway` (nginx :8080, тупой прокси) +
`observability` (Loki/Prometheus/Grafana) + minio. **Апы/бэки живут на ХОСТЕ**, gateway
проксирует на `host.docker.internal:<port>`. brainer — туда же, и это **обязательно**: backend
спавнит claude-процессы (хостовое), из контейнера нельзя. → frontend + backend на хосте.

## Сделано на стороне ОРАКУЛА (capsule-архитектор, НЕ трогай сам)

- `DEPLOY.md` в brainer — dev-run гайд.
- **Порты закреплены:** frontend **:3500** (base `/brainer/`), backend **:8010** (нативный префикс `/brainer/`).
- **Loki доэкспожен на хост :3100** — capsule **PR #478** (backend читает `{scope="X"}` с хоста).
  Prometheus :9090 / collector :4317 уже были.
- Gateway-route `/brainer/` — **НЕ заведён** (не нужен MVP, фронт ходит на бэк напрямую).

## Что координируешь ТЫ (brainer-архитектор)

1. **Port/base-конвенции на owner'ов** frontend/backend по `DEPLOY.md`: frontend base `/brainer/` @3500;
   backend префикс `/brainer/` @8010; frontend `ApiClient` base = env (`VITE_API_BASE`) — не хардкод.
   Проверь в их выводе, что сошлось (иначе mock→real свитч не сработает).
2. **Prereqs в контекст owner'ов:** observability up (`cd capsule/docker/observability && docker compose up -d`)
   + **PR #478 смержен** (иначе Loki недоступен с хоста).
3. **e2e-склейка:** когда backend готов — фронт переключает `ApiClient` mock→real (смена адаптера,
   base env); проверить живой дашборд на реальных сессиях. Это твой gate «интерфейс+бэк сошлись».
4. **Optional single-origin gateway** (`/brainer/` @ :8080, prod-parity): когда захотите — **запрос
   ко мне** (правка оракульного `nginx.conf`, мой скоуп). Сниппет готов в `DEPLOY.md`.

## Cross-repo граница (важно)

- **Оракул-инфра** (gateway / observability / Loki / порты в compose) = **capsule-архитектор (я)**.
  Ты и owner'ы brainer **НЕ правите `capsule/`** — эскалируешь мне.
- **brainer-side** (ports/base в коде, DEPLOY, run-флоу) = ты + owner'ы.

## Не сейчас (future ADR)

Контейнеризация самого brainer (self-host compose). Упирается в решение «где крутятся агенты»:
хостовый launcher-демон vs агенты-в-контейнерах (docker-socket). Отдельная фаза, не MVP.

## Верификация MVP-деплоя (DoD)

obs up + #478 merged → backend :8010 отвечает `/brainer/sessions` → frontend :3500 (real base) →
дашборд показывает **живые** сессии: launch реальной claude-scope-сессии → видна с активностью
из Loki → stop завершает.
