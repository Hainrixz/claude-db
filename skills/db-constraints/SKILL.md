---
name: db-constraints
description: Audit data-integrity constraints — missing NOT NULL on required columns, absent CHECK constraints for domain rules, missing UNIQUE on natural keys, and the over-nullable UNIQUE trap where NULLs silently permit duplicates. Module M5. Feeds the Design & Integrity score (Constraints category).
allowed-tools: Read, Grep, Glob, Bash
---

# db-constraints (M5)

Constraints are invariants the database guarantees no matter which app, script, or migration writes the row. Without them, "this is always true" is a hope, not a fact. This module is **design**-axis (Constraints category). It applies to engines that enforce declarative constraints; document stores route to the Validación-schema category instead.

## What it checks
- **Missing NOT NULL**: columns that are semantically required (FKs to mandatory parents, `email`, `status`, timestamps) left nullable, allowing partial/garbage rows.
- **Missing CHECK**: domain rules not enforced — `quantity >= 0`, `price >= 0`, `status IN (...)`, `start_date <= end_date`, `email ~ '@'`. The app "validates" it; the DB does not.
- **Missing UNIQUE**: natural keys (email, username, slug, external_id) with no UNIQUE constraint, permitting duplicates that corrupt joins and auth.
- **Case-insensitive uniqueness (emails)**: a plain `UNIQUE` on a case-varying column (e.g. `email`) still admits `Foo@x.com` *and* `foo@x.com` as distinct rows — duplicate identities. Name the remedy: a `citext` column type, or a `UNIQUE` expression index on `lower(col)` (e.g. `CREATE UNIQUE INDEX ON users (lower(email))`), so case-folded values collide.
- **Over-nullable UNIQUE trap**: a UNIQUE constraint over nullable columns where the engine treats each NULL as distinct, so duplicates slip through (e.g. `UNIQUE(user_id, deleted_at)` for soft-delete uniqueness fails when `deleted_at` is NULL). Recommend a partial/filtered unique index or `NULLS NOT DISTINCT`.
- **Constraint declared NOT VALID / NOCHECK** and never validated.

## Axis & severity
- Axis: **design**; magnitude banded, never a fabricated violation count.
- Missing UNIQUE on an auth/natural key allowing duplicate identities: severity 4, `fail`/`warn`, confidence `directional`.
- Over-nullable UNIQUE that silently permits dupes: severity 4, `warn` (subtle, high-impact).
- Missing NOT NULL on a required FK/column: severity 3, `warn`.
- Missing CHECK for a stated domain rule: severity 2–3, `warn`, `fixable: proposed`.
- M5 does not hold a sev-5 cap; it shapes the Constraints category value.

## Tier-0 static check
Parse DDL/snapshot via `scripts/parse-schema.mjs`: list columns lacking `NOT NULL`; detect natural-key column names without a `UNIQUE`/unique index; find UNIQUE constraints whose member columns are nullable (the over-nullable trap); scan for absent `CHECK` on quantity/price/date-range columns. Program-source parses stay `directional`.

## Tier-1 verification query
Inventory constraints and nullability:
```sql
-- $DATABASE_URL, read-only
SELECT c.table_name, c.column_name, c.is_nullable,
       tc.constraint_type
FROM information_schema.columns c
LEFT JOIN information_schema.constraint_column_usage ccu
  ON ccu.table_name = c.table_name AND ccu.column_name = c.column_name
LEFT JOIN information_schema.table_constraints tc
  ON tc.constraint_name = ccu.constraint_name AND tc.constraint_type IN ('UNIQUE','CHECK')
WHERE c.table_schema NOT IN ('pg_catalog','information_schema');
```
Confirm the over-nullable UNIQUE actually has duplicates:
```sql
SELECT user_id, count(*) FROM memberships WHERE deleted_at IS NULL
GROUP BY user_id HAVING count(*) > 1;
```

## Findings
Emit per `schema/finding.schema.json`. Examples:
- `M5.users.email_no_unique` — `email` has no UNIQUE constraint; duplicate identities possible (severity 4, `warn`, axis `design`, `fixable: proposed`).
- `M5.memberships.over_nullable_unique` — `UNIQUE(user_id, deleted_at)` lets NULL `deleted_at` duplicate (severity 4, `warn`, axis `design`).
- `M5.order_items.quantity_no_check` — no `CHECK (quantity >= 0)` (severity 3, `warn`).
- `M5.events.user_id_nullable` — required FK column is nullable (severity 3, `warn`).
Each finding: `evidence.observed` quotes the column/constraint DDL verbatim; `verification.reproduce` is a runnable query above (`method: ddl_parse` / `constraint_check` / `query_stat`); `expected_impact` banded + confidence-tagged.

## Honesty
- App-layer validation reduces but does not replace a DB constraint — multiple writers (jobs, admin scripts, replicas) bypass the app. State this plainly; do not call app validation equivalent.
- The over-nullable UNIQUE trap is engine-specific (Postgres pre-15 treats NULLs distinct; `NULLS NOT DISTINCT` since 15). Scope advice to the detected engine/version, do not generalise.
- Never claim duplicates/violations exist without a Tier-1 count; static, it is `directional`.
