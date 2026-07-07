# DEPLOY (dev) — как запускать Omnifield Brainer

## Принцип: brainer крутится НА ХОСТЕ, не в контейнере

Наш «докер» (оракул `capsule/docker/`) — это тонкий слой: `gateway` (nginx :8080, тупой
прокси) + `observability` (Loki/Prometheus/Grafana) + minio. **Апы и бэки живут на ХОСТЕ**,
gateway лишь проксирует на `host.docker.internal:<port>` (learn→:3100, studio→:3050, …).

brainer садится в тот же паттерн — и это **обязательно**, а не удобство: его backend
**спавнит claude-процессы** (claude CLI + репо + креды = хостовое). Из контейнера так нельзя,
на хосте — штатно. → frontend (vite) + backend (uvicorn) запускаем на хосте.

## Порты (закреплено, architect)

| Компонент | Порт | Прим. |
|---|---|---|
| brainer frontend (vite) | **3500** | base см. ниже |
| brainer backend (uvicorn) | **8010** | нативный префикс `/brainer/` |

Свободны относительно занятых (3000/3050/3100/3200/3333/3400/9090, 8001–8007).

## Контракт-база (frontend ↔ backend)

Backend отдаёт контракт под нативным префиксом `/brainer/` (как `svc_learn` под `/learn/`).
Frontend `ApiClient` base — env-конфиг (`VITE_API_BASE`):
- **dev-direct:** `http://localhost:8010/brainer` (фронт → бэк напрямую, gateway не нужен).
- **gateway (parity):** `/api/brainer` (см. опциональный шаг ниже).

Пути контракта (`/sessions`, `/tasks`, …) — относительно base. Owner'ы фронта/бэка держат base
конфигом, не хардкодят.

## Prerequisites

Observability-стек поднят (backend читает Loki/Prometheus):
```
cd <capsule>/docker/observability && docker compose up -d
```
- Loki **:3100** (доэкспожен на хост для brainer-backend), Prometheus **:9090**, collector **:4317**, Grafana **:3333**.
- Backend читает активность из Loki `{scope="X"}` и метрики из Prometheus `claude_code_*`.
- Backend при спавне сессии сам инжектит OTEL-env на `:4317` → любая запущенная сессия
  эмитит телеметрию (см. `briefs/backend-mvp.md`).

## Запуск (dev)

```
# 1. observability up (см. выше)
# 2. backend
cd packages/backend && uv run uvicorn <app> --host 0.0.0.0 --port 8010 --reload
# 3. frontend
cd packages/frontend && npm run dev   # vite на :3500, VITE_API_BASE=http://localhost:8010/brainer
```
Открываешь `http://localhost:3500` — дашборд на реальном backend'е.

## Опционально: single-origin через gateway (prod-parity, ADR 068)

Не нужно для MVP (фронт ходит на бэк напрямую). Когда захотим один origin :8080 —
в `capsule/docker/gateway/nginx.conf`:
```nginx
upstream app_brainer { server host.docker.internal:3500; keepalive 64; }
upstream svc_brainer { server host.docker.internal:8010; keepalive 16; }
# ...
location /brainer/      { proxy_pass http://app_brainer; }             # фронт (base '/brainer/')
location /api/brainer/  { proxy_pass http://svc_brainer/brainer/;      # бэк
                          proxy_buffering off; }                        # SSE /stream
```
Reload без пересборки: `docker exec capsule-gateway nginx -s reload`. Тогда всё под
`http://localhost:8080/brainer/`, а `VITE_API_BASE=/api/brainer`. Это правка ОРАКУЛА
(gateway там) — делает architect, когда решим parity.

## Контейнеризация brainer (потом, ADR 072)

Полный self-host (compose с frontend+backend контейнерами) — отдельная фаза. Упирается в
решение «где крутятся агенты»: хостовый launcher-демон vs агенты-в-контейнерах (docker-socket).
Не MVP.
