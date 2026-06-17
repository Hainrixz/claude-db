---
name: db-keys
description: Audit primary-key strategy — missing PK (severity 5), surrogate vs natural keys, UUIDv4 index fragmentation vs time-ordered UUIDv7/ULID/bigint, and int4/serial exhaustion on high-volume tables. Module M2. Feeds both the Design & Integrity (Llaves) and Performance & Scale (Escala) scores.
allowed-tools: Read, Grep, Glob, Bash
---

# db-keys (M2)

The primary key is the identity contract of a row: it dictates how the row is referenced, how it clusters on disk, and how it scales. A missing or exhausting PK is one of the few defects that can cap a score. This module is **both**-axis: identity/modeling on design, index locality and exhaustion on performance.

## What it checks
- **No primary key** (or no unique row identifier on a collection): the cap case. A table without a PK cannot be safely updated, replicated, or de-duplicated.
- **PK type strategy**: random `UUIDv4` as a clustered/leading B-tree key fragments inserts and bloats indexes; prefer time-ordered `UUIDv7`/`ULID` or `bigint` identity. Flag `uuid_generate_v4()` defaults on hot insert tables.
- **Postgres ≥18 (GA Sept 2025)**: native `uuidv7()` (RFC 9562) is the recommended time-ordered UUID PK default (timestamp recoverable via `uuid_extract_timestamp()`). When the detected engine is PG ≥18, treat a `gen_random_uuid()`/v4 default as a *downgrade* and recommend `uuidv7()`. Pre-18 or non-Postgres engines: `gen_random_uuid()` and app-side UUIDv7 remain fine.
- **Natural vs surrogate**: a mutable natural key (email, slug) used as PK propagates churn through every FK; recommend a stable surrogate.
- **Integer width exhaustion**: `int4`/`serial`/`SERIAL` PK on a table whose volume can exceed ~2.1B rows — `int4` exhaustion is a production-halting event. `bigint`/`bigserial` is the safe default.
- **Composite PK ordering**: when composite, the leading column should match the dominant access/partition pattern (ties to M9 tenant_id, M11 ESR).

## Axis & severity
- **No PK** on a relational/wide-column table: severity 5, `fail`, axis `both`, confidence `established` (caps both scores).
- `int4`/serial PK near exhaustion: severity 5 **only with Tier-1 row-count evidence**; otherwise severity 4 `warn`, confidence `directional` (never caps without live data).
- `UUIDv4` clustered PK on a hot-insert table: severity 3, `warn`, axis `performance`, confidence `directional`.
- Mutable natural-key PK: severity 3, `warn`, axis `design`.

## Tier-0 static check
Parse DDL/snapshot via `scripts/parse-schema.mjs`: assert every table declares a `PRIMARY KEY` (or document-store `_id`/shard identity); inspect PK column type for `uuid` + `gen_random_uuid()/uuid_generate_v4()` default, and for `int4`/`serial`. Directional program-source parses never raise the sev-5 no-PK cap.

## Tier-1 verification query
Find tables with no primary key:
```sql
-- $DATABASE_URL, read-only
SELECT t.table_schema, t.table_name
FROM information_schema.tables t
LEFT JOIN information_schema.table_constraints c
  ON c.table_name = t.table_name AND c.table_schema = t.table_schema
  AND c.constraint_type = 'PRIMARY KEY'
WHERE t.table_type = 'BASE TABLE' AND t.table_schema NOT IN ('pg_catalog','information_schema')
  AND c.constraint_name IS NULL;
```
Check int4 PK headroom (confirms exhaustion sev-5):
```sql
SELECT max(id) AS cur, 2147483647 AS int4_max, round(100.0*max(id)/2147483647,1) AS pct_used FROM <table>;
```

## Findings
Emit per `schema/finding.schema.json`. Examples:
- `M2.events.no_primary_key` — base table has no PK (severity 5, `fail`, axis `both`, confidence `established`).
- `M2.audit_log.int4_pk_exhaustion` — `id integer` PK at high pct of int4 max (severity 5 Tier-1 / 4 static, axis `both`).
- `M2.orders.uuidv4_clustered_pk` — random `uuid` PK with `gen_random_uuid()` default fragments inserts (severity 3, `warn`, axis `performance`, confidence `directional`).
Each finding: `evidence.observed` quotes the PK DDL or the catalog result verbatim; `verification.reproduce` is the runnable query above (`method: ddl_parse` / `schema_introspect` / `query_stat`); `expected_impact` banded + confidence-tagged.

## Honesty
- Do not claim int4 exhaustion is imminent without a Tier-1 `max(id)` and growth signal — static, it is `directional` and never caps.
- `UUIDv4` is not "wrong"; the cost is index locality on hot inserts. Band the impact, never fabricate an insert-throughput percentage.
- A surrogate vs natural choice is contextual; present the trade, do not assert one as universally correct.
