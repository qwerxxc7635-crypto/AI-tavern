# Database migrations

Versioned SQLite migrations live in this directory and are applied in numeric order by the persistence migration runner. A migration version is recorded only after its SQL commits successfully; an already recorded version is skipped on later startups.

- `0001_initial.sql`: v0.1 core schema defined by `docs/data-model.md`.
- `0011_rules_engine.sql`: versioned character rule state plus immutable, idempotent rules audit events.
- `0012_knowledge_boundary.sql`: separate World Truth, Claim, actor-scoped Knowledge, provenance, and subjective Memory records.
- `0013_universal_character.sql`: versioned universal character profiles and Constitution-bound world extension definitions with V0.2 row compatibility.
- `0014_character_creation_sessions.sql`: durable Quick/Advanced drafts, field locks, cancellation/resume, and confirmation audit state.
- `0025_dynamic_quest_sources.sql`: one-shot Quest Pool creation intents plus append-only, source-validated Dynamic Quest provenance.
