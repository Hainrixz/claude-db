# Data tiers — free-first, offline by default

`claude-db` works with three escalating tiers of evidence. Tier 0 needs nothing; Tiers 1–2 are
opt-in and only sharpen findings. A check that needs a higher tier than is available emits
`status: needs_api` — **never a silent pass**.

## Tier 0 — offline (default, no keys)

Read schema/migration/ORM files, or accept a plain-language description. Two input classes:

- **(a) Declarative / generated artifacts — reliable parse:** `schema.prisma`, `structure.sql`, raw
  SQL DDL, Drizzle `drizzle/meta/*_snapshot.json`, `firestore.indexes.json`, Alembic/Flyway/Liquibase
  generated SQL. Findings can be `established` or `directional`.
- **(b) Program source — best-effort:** Drizzle `schema.ts`, Mongoose `.js`, DynamoDB CDK `.ts`.
  Capped at `confidence: directional`, **never raises a severity-5 cap**, and emits a `needs_api`
  nudge toward a generated artifact or Tier-1.

Tier 0 detects structure: missing constraints, FK-without-index (static), float money, naming,
normalization, anti-patterns, RLS-not-declared, unsafe migration ops. Anything requiring runtime
truth (real index usage, row counts, plans, autovacuum state) is deferred to Tier 1/2.

## Tier 1 — live read-only introspection (opt-in)

A least-privilege **read-only** connection string **or** a database MCP server (preferred — cleaner
permission boundary). Reads catalogs only:

- Postgres: `information_schema`, `pg_catalog`, `pg_class`, `pg_index`, `pg_constraint`, `pg_policies`,
  `version()`. MySQL: `information_schema`. Mongo: `db.stats()`, `$indexStats`.
- Unlocks: real index inventory, FK-without-index join, table/row sizes, RLS state, extensions,
  engine version. Upgrades affected findings to `confidence: established`.

**Read-only contract (enforced):** `SET default_transaction_read_only = on`, a `statement_timeout`,
and only `SELECT`/`EXPLAIN`/catalog queries. The MCP path invokes only read-class tools
(`*query*`/`*read*`/`*list*`/`*describe*`); a generic write-capable `query` tool is routed through the
same validator, and a PreToolUse hook (`mcp__.*`) backs this up. See `references/scoring-model.md` and
the `introspect` skill.

## Tier 2 — live statistics (opt-in)

Sustained runtime stats:

- `pg_stat_statements` (slow queries), `pg_stat_user_indexes`/`pg_stat_user_tables` (unused indexes,
  dead tuples, last autovacuum), `EXPLAIN (ANALYZE, BUFFERS)`, `age(datfrozenxid)` (wraparound),
  `pg_stat_replication`. Mongo `$collStats`. Cassandra `nodetool tablehistograms`. DynamoDB CloudWatch.
- Unlocks established performance findings (real plans, genuinely unused indexes, hot partitions).
  Without sustained stats these remain `directional`; if they need stats to decide → `needs_api`.

## Credentials

Connection strings are read from the environment (`$DATABASE_URL`), never echoed. `verification.
reproduce` references `$DATABASE_URL`, never a literal credential. `lib/util.mjs` `redactSecrets()`
scrubs any credential before it reaches a finding, report, log, or backup.
