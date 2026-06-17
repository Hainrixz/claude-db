---
name: db-temporal-history
description: Audit temporal and lifecycle modeling — soft-delete consistency and its uniqueness/query traps, presence and integrity of an audit/history trail, and retention / GDPR right-to-erasure handling (hard delete vs anonymization, retention windows). Module M8. Feeds the Design & Integrity score (Temporal category).
allowed-tools: Read, Grep, Glob, Bash
---

# db-temporal-history (M8)

Data has a lifecycle: it is created, changed, retired, and — legally — sometimes must be erased. Modeling that lifecycle explicitly avoids resurrected "deleted" rows, missing audit trails when something goes wrong, and GDPR/CCPA exposure from data that should have been purged. This module is **design**-axis (Temporal category). It applies across paradigms.

## What it checks
- **Soft-delete consistency**: a `deleted_at`/`is_deleted` column present on some tables but not others, or present without the matching guards — queries/uniques/FKs that ignore it (resurrecting deleted rows in joins, UNIQUE collisions). Ties to the M5 over-nullable UNIQUE trap.
- **Audit / history trail**: sensitive tables (financial, auth, permissions, config) with no change history (no `*_history`/`*_audit` table, no temporal columns, no trigger/CDC) — when something is wrong, there is no record of who changed what when.
- **Retention & erasure (GDPR/CCPA)**: PII held with no retention window, no documented purge/anonymization path, or "soft delete" used where the law requires actual erasure or anonymization. Cross-reference PII detection in M10.
- **Temporal validity**: bitemporal/effective-dated data using a single timestamp where `valid_from`/`valid_to` is needed; missing `end_date >= start_date` CHECK.

## Axis & severity
- Axis: **design**; magnitude banded, never a fabricated record count or fine amount.
- PII with no retention/erasure path (compliance exposure): severity 4, `warn`, confidence `directional` (legal applicability needs human review — never auto-caps).
- Inconsistent soft-delete with no query/unique guards: severity 3, `warn`.
- No audit trail on financial/auth tables: severity 3, `warn`.
- M8 holds no sev-5 cap; it shapes the Temporal category value.

## Tier-0 static check
Parse DDL/snapshot via `scripts/parse-schema.mjs`: detect soft-delete columns and check whether they appear consistently and in UNIQUE/partial-index definitions; look for companion `*_history`/`*_audit` tables or temporal columns on sensitive tables; flag PII-bearing tables (email, name, phone, address, dob) with no retention/erasure marker. Static → `directional`.

## Tier-1 verification query
Find tables with soft-delete but no audit companion, and confirm soft-deleted rows still satisfy a "unique" key:
```sql
-- $DATABASE_URL, read-only
SELECT table_name FROM information_schema.columns
WHERE column_name IN ('deleted_at','is_deleted')
  AND table_schema NOT IN ('pg_catalog','information_schema');
-- resurrection check: deleted rows colliding on a natural key
SELECT email, count(*) FROM users GROUP BY email HAVING count(*) > 1;  -- if soft-deleted dupes appear
```

## Findings
Emit per `schema/finding.schema.json`. Examples:
- `M8.users.pii_no_retention_or_erasure` — PII columns with no retention window or erasure/anonymization path (severity 4, `warn`, axis `design`, confidence `directional`).
- `M8.orders.soft_delete_inconsistent` — `deleted_at` present but joins/uniques ignore it, resurrecting deleted rows (severity 3, `warn`, axis `design`).
- `M8.permissions.no_audit_trail` — auth-critical table has no change history (severity 3, `warn`).
Each finding: `evidence.observed` quotes the relevant DDL/column verbatim (PII values never echoed); `verification.reproduce` is a runnable query above (`method: ddl_parse` / `schema_introspect` / `query_stat`); `expected_impact` banded + confidence-tagged.

## Honesty
- GDPR/CCPA applicability is a legal determination, not a schema fact — flag the *exposure* (no erasure path) as `directional` and defer the legal call to a human; never assert a fine or a violation as established.
- Soft delete is a valid pattern; flag only inconsistency (some tables/queries honour it, others don't), not its use.
- Never invent retention periods or record counts; band the impact and cite the missing mechanism, not a number.
