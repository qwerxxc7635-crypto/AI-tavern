# Database migrations

Versioned SQLite migrations live in this directory and are applied in numeric order by the persistence migration runner. A migration version is recorded only after its SQL commits successfully; an already recorded version is skipped on later startups.

- `0001_initial.sql`: v0.1 core schema defined by `docs/data-model.md`.
- `0011_rules_engine.sql`: versioned character rule state plus immutable, idempotent rules audit events.
- `0012_knowledge_boundary.sql`: separate World Truth, Claim, actor-scoped Knowledge, provenance, and subjective Memory records.
