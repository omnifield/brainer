# Omnifield Brainer

Продукт **оркестрации агентов** экосистемы Omnifield. Пульт: запускать, мониторить и
вести agent-сессии (Claude Code owner/architect-сессии — сейчас; наши self-hosted агенты —
позже) через интерфейс, а не жонглируя терминалами. Мы — юзер №0 (brainer'ом ведём
разработку всех продуктов, включая сам brainer).

> Статус: **skeleton done** — pnpm workspace + nx (affected/cache) + uv workspace + biome/ruff
> + CI + husky (`briefs/repo-skeleton.md`); тулчейн запинен (машина = cattle, канон
> commons toolchain-pins). Рабочее имя (sweep: `brainer` в AI/софте плотно занят — вернёмся
> к публичному имени перед релизом). Реализация — по брифам (`briefs/`).

## Ключевая идея — agent-as-provider

Мод «внешний Claude Code агент» = один провайдер за общим швом; наши LLM-агенты
(`backend/llm` + agent-loop) = другой провайдер; ресурсно-тарифно (ADR 078 §4). Тот же
kernel-паттерн, что у Omnifield Writer → строим шов один раз. См. [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Раскладка (`packages/<name>/`, extract-ready)

`packages/kernel` (шов) · `packages/orchestrator` (сессии+провайдеры+телеметрия) ·
`packages/backend` (API) · `packages/frontend` (дашборд) · `content` (doc-эталоны, догфуд).
`kernel`+`orchestrator` → позже в общий `engines`-репо.

## MVP — начинаем с интерфейса

Мод `claude-code`: список/статус сессий · запуск · бриф · трек · стоп. Contract-first
(фронт против мок-контракта → backend наполняет). См. `briefs/interface-mvp.md`.
