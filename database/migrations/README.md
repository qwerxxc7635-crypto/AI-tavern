# Database migrations

Versioned SQLite migrations live in this directory and are applied in numeric order by the persistence migration runner. A migration version is recorded only after its SQL commits successfully; an already recorded version is skipped on later startups.

- `0001_initial.sql`: v0.1 core schema defined by `docs/data-model.md`.
