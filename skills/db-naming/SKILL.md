---
name: db-naming
description: Audit naming conventions — inconsistent table/column casing and pluralization, ambiguous or reserved-word identifiers, untyped/opaque columns, inconsistent FK and boolean naming, and identifiers that fight the engine's case-folding rules. Module M7. Feeds the Design & Integrity score (Naming category, low weight).
allowed-tools: Read, Grep, Glob, Bash
---

# db-naming (M7)

Naming is the schema's documentation: consistent, predictable identifiers make joins obvious and reduce the quoting/casing bugs that creep in across ORMs and engines. It is low-weight (Naming category, design axis) — real but never the headline. This module is **design**-axis and never caps.

## What it checks
- **Casing / pluralization consistency**: a mix of `snake_case` and `camelCase`, or singular and plural table names (`user`, `orders`, `OrderItem`) in one schema — pick one and hold it.
- **Reserved words & case-folding traps**: identifiers that are SQL reserved words (`user`, `order`, `group`, `select`) or that rely on case (`"User"` quoted) — Postgres folds unquoted to lowercase, MySQL is filesystem/case-config dependent; mixed quoting causes "relation does not exist" bugs.
- **FK naming**: FK columns not following a predictable `<referenced>_id` pattern, so joins aren't self-evident.
- **Boolean naming**: booleans not prefixed `is_`/`has_`/`can_`, or negative names (`not_active`) that invert logic.
- **Opaque / ambiguous names**: `data`, `info`, `value`, `flag`, `temp`, `col1`, abbreviations without a glossary, or timestamps not suffixed `_at`.

## Axis & severity
- Axis: **design**; magnitude almost always **low**, banded honestly.
- Reserved-word unquoted identifier that breaks across engines: severity 2–3, `warn`.
- Schema-wide casing/pluralization inconsistency: severity 2, `warn`, `fixable: proposed` (rename is high-blast-radius — never `auto`).
- Opaque column name / missing `_at` suffix: severity 1, `warn`.
- M7 never caps any score; it is the smallest-weight design category.

## Tier-0 static check
Parse DDL/snapshot via `scripts/parse-schema.mjs`: tally identifier casing styles and table pluralization; match identifiers against a reserved-word list per engine; check FK columns against the `<table>_id` pattern; flag boolean columns without `is_/has_/can_` and opaque names. This is fully static and `directional`.

## Tier-1 verification query
Confirm live identifier inventory and quoting:
```sql
-- $DATABASE_URL, read-only
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog','information_schema')
ORDER BY table_name;   -- inspect casing/plurality/reserved words across the real catalog
```

## Findings
Emit per `schema/finding.schema.json`. Examples:
- `M7.schema.mixed_casing` — schema mixes `snake_case` and `camelCase` identifiers (severity 2, `warn`, axis `design`, `fixable: proposed`).
- `M7.user.reserved_word_table` — table named `user` requires quoting and breaks unquoted refs (severity 2, `warn`, axis `design`).
- `M7.accounts.active_boolean_unprefixed` — boolean `active` not named `is_active` (severity 1, `warn`).
Each finding: `evidence.observed` quotes the identifier(s) verbatim; `verification.reproduce` is the runnable query above (`method: ddl_parse` / `schema_introspect`); `expected_impact` is banded (typically `low`) + confidence `directional` with rationale.

## Honesty
- Naming findings are advisory polish — never let them dominate the report or imply a functional defect.
- Renames are destructive and break app code/migrations; recommendations are `proposed`/`advisory`, never `auto`.
- Reserved-word and case-folding behaviour is engine-specific; scope each finding to the detected engine rather than asserting a universal rule.
