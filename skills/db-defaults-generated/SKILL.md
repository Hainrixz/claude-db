---
name: db-defaults-generated
description: Audit column defaults and generated columns — application-side timestamps that should be DB defaults, non-deterministic or wrong defaults, derived values that should be GENERATED ALWAYS / computed columns instead of drift-prone duplicated data, and identity/sequence defaults. Module M6. Feeds the Design & Integrity score (Tipos category, shared with M4).
allowed-tools: Read, Grep, Glob, Bash
---

# db-defaults-generated (M6)

Defaults and generated columns are correctness placed at the source: a `created_at DEFAULT now()` is true for every writer, and a `GENERATED ALWAYS AS` column can never drift from its inputs. Pushing this logic into the app means each writer can get it wrong differently. This module is **design**-axis (Tipos category). It applies to engines supporting defaults/generated columns.

## What it checks
- **Timestamp defaults**: `created_at`/`updated_at` set only by application code (no `DEFAULT now()`/`CURRENT_TIMESTAMP`, no `ON UPDATE`/trigger) — inconsistent across writers, missing on raw SQL inserts.
- **Derived value should be generated**: a stored column computed from siblings (`full_name`, `total = qty*price`, `search_vector`) kept in sync by app code rather than `GENERATED ALWAYS AS ... STORED` — drift-prone (ties to M1 denormalization discipline).
- **Non-deterministic / wrong default**: defaults that bake in a value that should be dynamic, or a default that masks a missing NOT NULL (e.g. `status DEFAULT 'active'` hiding required intent), or a `DEFAULT ''` standing in for NULL.
- **Identity/sequence hygiene**: `serial` vs `GENERATED ... AS IDENTITY`; shared/incorrect sequence ownership.
- **Boolean/flag defaults** missing, forcing three-valued logic where two was intended.

## Axis & severity
- Axis: **design**; magnitude banded, never invented drift rates.
- Derived stored column maintained by app (drift risk): severity 3, `warn`, `fixable: proposed`.
- Missing `created_at`/`updated_at` DB default: severity 2–3, `warn`, `fixable: auto` (additive default).
- `DEFAULT ''`/sentinel masking NULL semantics: severity 2, `warn`.
- M6 holds no sev-5 cap; it shapes the Tipos category value.

## Tier-0 static check
Parse DDL/snapshot via `scripts/parse-schema.mjs`: flag `*_at` timestamp columns with no `DEFAULT`; detect stored columns whose name implies derivation (`full_name`, `total`, `*_count`, `search_vector`) that are plain columns rather than `GENERATED`; list defaults that are empty-string/sentinel; note `serial` where identity is preferred. Program-source parses stay `directional`.

## Tier-1 verification query
Inspect column defaults and generated status:
```sql
-- $DATABASE_URL, read-only
SELECT table_name, column_name, column_default, is_generated, generation_expression
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog','information_schema')
  AND (column_name ~* '(_at$|total|full_name|count|vector)');
```
Confirm a "derived" column has drifted from its inputs:
```sql
SELECT count(*) AS drifted FROM order_items WHERE total <> qty * unit_price;
```

## Findings
Emit per `schema/finding.schema.json`. Examples:
- `M6.invoices.total_app_maintained` — `total` is a plain column synced by app code, not `GENERATED ALWAYS AS ... STORED` (severity 3, `warn`, axis `design`, `fixable: proposed`).
- `M6.users.created_at_no_default` — `created_at` has no `DEFAULT now()` (severity 2, `warn`, `fixable: auto`, axis `design`).
- `M6.users.name_default_empty_string` — `DEFAULT ''` masks NULL semantics (severity 2, `warn`).
Each finding: `evidence.observed` quotes the column DDL or default verbatim; `verification.reproduce` is a runnable query above (`method: ddl_parse` / `schema_introspect` / `query_stat`); `expected_impact` banded + confidence-tagged.

## Honesty
- A DB default does not absolve the app of intent — flag only where DB-side enforcement is clearly safer (timestamps, derived values), not as a blanket "move all defaults to the DB".
- Generated columns have engine/version support limits (Postgres STORED only, MySQL VIRTUAL/STORED); scope the recommendation to the detected engine.
- Never claim a derived column has drifted without a Tier-1 mismatch count; static, it is `directional`.
