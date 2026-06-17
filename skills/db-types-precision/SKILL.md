---
name: db-types-precision
description: Audit column types and precision — money stored as float/double (severity 5), naive timestamp vs timestamptz/UTC, jsonb used to evade schema, enum-vs-lookup-table choice, and charset/collation (utf8mb4, case-insensitive collation). Module M4. Feeds the Design & Integrity score (Tipos category).
allowed-tools: Read, Grep, Glob, Bash
---

# db-types-precision (M4)

The type is the first and cheapest constraint: it decides what values are even representable and how they sort, compare, and round. The classic data-loss bug — money in a float — lives here. This module is **design**-axis (Tipos category, shared with M6). It applies across paradigms with paradigm-appropriate type vocabularies (Postgres `numeric`, Mongo `Decimal128`).

## What it checks
- **Money as float**: `float`/`real`/`double precision` (or Mongo `Double`) for currency/amounts — binary floating point cannot represent decimal cents exactly. Use `numeric`/`decimal`/`Decimal128`/integer-minor-units. This is the **severity-5 cap**.
- **Timestamps & timezone**: naive `timestamp`/`datetime` (without time zone) for instants that cross zones; prefer `timestamptz` stored in UTC. Flag `timestamp` columns named `*_at` lacking tz.
- **jsonb as schema evasion**: a `jsonb`/`json` column carrying what should be first-class typed/constrained columns (stable, queried, FK-related keys buried in JSON). Embedding flexible blobs is fine; hiding the schema is not.
- **enum vs lookup**: native `ENUM` (esp. MySQL `ENUM`, hard to alter) where a referenced lookup table would be safer to evolve; or free-text status where a constrained domain is needed.
- **Charset/collation**: MySQL `utf8` (3-byte, no emoji/astral) instead of `utf8mb4`; an unintended case-sensitive or accent-sensitive collation on identifiers/emails.

## Axis & severity
- Money in float/double: severity 5, `fail`, axis `design`, confidence `established` (caps the Design score).
- Naive timestamp for cross-zone instant: severity 3–4, `warn`, axis `design`.
- jsonb hiding a stable queried schema: severity 3, `warn`, `fixable: proposed`.
- MySQL `utf8` (not utf8mb4): severity 3, `warn`.
- enum-as-lock-in / wrong collation: severity 2–3, `warn`.

## Tier-0 static check
Parse DDL/snapshot via `scripts/parse-schema.mjs`: match money-like column names (`price, amount, total, balance, cost, *_cents`) against `float|real|double|Double` types; flag `timestamp`/`datetime` without tz on `*_at` columns; detect `json`/`jsonb` columns and `ENUM(...)`; read declared charset/collation. Directional program-source parses never raise the money-float sev-5 cap.

## Tier-1 verification query
Confirm float money columns from the catalog:
```sql
-- $DATABASE_URL, read-only
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE data_type IN ('real','double precision')
  AND column_name ~* '(price|amount|total|balance|cost|fee|tax)';
```
MySQL charset check:
```sql
SELECT table_name, column_name, character_set_name, collation_name
FROM information_schema.columns WHERE character_set_name = 'utf8';
```

## Findings
Emit per `schema/finding.schema.json`. Examples:
- `M4.orders.total_float_money` — `total double precision` loses cents (severity 5, `fail`, axis `design`, confidence `established`).
- `M4.events.created_at_naive_timestamp` — `created_at timestamp` lacks time zone (severity 4, `warn`, axis `design`, `fixable: proposed`).
- `M4.products.attributes_jsonb_schema_evasion` — stable queried keys buried in `jsonb` (severity 3, `warn`).
- `M4.users.email_utf8_not_utf8mb4` — MySQL `utf8` truncates astral chars (severity 3, `warn`).
Each finding: `evidence.observed` quotes the column DDL verbatim; `verification.reproduce` is a runnable query above (`method: ddl_parse` / `schema_introspect`); `expected_impact` banded + confidence-tagged.

## Honesty
- Float money caps regardless of paradigm (relational and Mongo `Double`); never soften it.
- `jsonb` is the right tool for genuinely flexible/sparse data — only flag it when it conceals a stable, queried, relational schema.
- Do not assert collation breakage without showing the declared collation; band the impact, never invent a sort-error rate.
