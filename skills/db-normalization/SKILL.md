---
name: db-normalization
description: Audit relational schema normalization — 1NF through 3NF violations, repeating groups and CSV-in-a-column, partial and transitive functional dependencies, and the inverse trap of premature or undisciplined denormalization. Module M1. Feeds the Design & Integrity score (Modelado category).
allowed-tools: Read, Grep, Glob, Bash
---

# db-normalization (M1)

Normalization is the spine of relational design: it removes update/insert/delete anomalies by giving every fact one home. This module audits 1NF→3NF and the deliberate, documented exceptions (denormalization for read paths). It is **design**-axis only. For document/KV paradigms this module is replaced by Access-pattern&embedding in the profile — do not penalise a Mongo collection for "lacking 3NF".

## What it checks
- **1NF — atomicity**: columns holding lists (`tags VARCHAR` with comma-separated values, `phone_numbers TEXT`), repeating-group columns (`addr1, addr2, addr3`, `item_1, item_2`), or arrays used as a join-table substitute. Static signal: column name patterns + a `text/varchar` type carrying delimited data in sample DDL/comments.
- **2NF — partial dependency**: on a composite PK, a non-key column that depends on only part of the key (e.g. `order_items(order_id, product_id, product_name)` where `product_name` depends on `product_id` alone).
- **3NF — transitive dependency**: a non-key column functionally determined by another non-key (e.g. `employees(id, dept_id, dept_name)` — `dept_name` belongs in `departments`).
- **Denormalization discipline**: duplicated/derived columns (`total`, `full_name`, cached counts) with no generated-column definition, no trigger, and no documented refresh path — these drift silently. Cross-check with `db-defaults-generated` (M6).

## Axis & severity
- Axis: **design**. Magnitude banded high|medium|low, never a fabricated anomaly rate.
- Repeating groups / CSV-in-a-column on a high-write table: severity 3–4, `warn`/`fail`, confidence `directional` (static).
- Transitive dependency causing redundant updatable data: severity 3, `warn`.
- Undocumented denormalized duplicate that can drift: severity 3, `warn`, `fixable: proposed`.
- M1 never holds a severity-5 cap; it shapes the Modelado category value.

## Tier-0 static check
Parse DDL via `scripts/parse-schema.mjs` and inspect column inventories: flag delimited-list column names, repeating numbered columns, and non-key columns whose name matches another table's entity (`*_name`, `*_label` alongside a `*_id`). Program-source parses stay `directional` and never cap.

## Tier-1 verification query
Confirm a suspected CSV-in-column actually carries multiple values:
```sql
-- $DATABASE_URL, read-only; does the column hold delimited lists?
SELECT count(*) AS rows_with_delimiter
FROM <table>
WHERE position(',' IN <column>::text) > 0;   -- >0 confirms 1NF violation
```
For a transitive dependency, confirm functional determination holds across rows:
```sql
SELECT dept_id, count(DISTINCT dept_name) AS distinct_names
FROM employees GROUP BY dept_id HAVING count(DISTINCT dept_name) = 1;
```
When no live DB is available the finding stays `needs_api` for the count assertion — never a silent pass.

## Findings
Emit per `schema/finding.schema.json`. Examples:
- `M1.users.tags_csv_in_column` — `tags VARCHAR(255)` stores comma-separated values (severity 4, `fail`, `fixable: proposed`, axis `design`, confidence `directional`).
- `M1.order_items.partial_dependency_product_name` — non-key `product_name` depends on part of the composite PK (severity 3, `warn`, axis `design`).
- `M1.invoices.total_denormalized_undocumented` — derived `total` column with no generated-column/trigger refresh (severity 3, `warn`, `fixable: proposed`).
Each finding: `evidence.observed` quotes the real DDL line verbatim (secrets redacted); `verification.reproduce` is the runnable command above (`method: ddl_parse` for static, `query_stat`/`schema_introspect` for Tier-1); `expected_impact` is banded + confidence-tagged with rationale.

## Honesty
- Denormalization is a legitimate, sometimes correct choice — flag only *undisciplined* denormalization (no refresh path, no documentation), never denormalization per se.
- 1NF/2NF/3NF apply to relational models. Embedded documents in a document store are not a normalization defect; that judgment lives in the document profile.
- Never invent an anomaly frequency or row count without a Tier-1 query backing it.
