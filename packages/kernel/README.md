# kernel — agent-as-provider шов

Capability / provider / router / entitlement для агентных сессий (ARCHITECTURE.md, ADR 078-паттерн).
Самодостаточный пакет: **не импортит `backend`/`frontend`**. Общий с writer-kernel по идее —
переедет в `engines`-репо. MVP: контракты определены, реальный провайдер только `claude-code`,
entitlement = no-op. Реализация — по брифу.
