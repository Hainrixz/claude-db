---
name: db-referential-integrity
description: Audit foreign-key integrity — missing FKs that allow orphan rows (financial/auth = severity 5), absent or unsafe ON DELETE/ON UPDATE actions, reference cycles, and composite-FK column/order mismatches. Module M3. Feeds both the Design & Integrity (Integridad referencial) and Performance & Scale (Query) scores.
allowed-tools: Read, Grep, Glob, Bash
---

# db-referential-integrity (M3)

Foreign keys are the database enforcing that a reference points at something real — the cheapest, most durable guarantee against orphan data. Missing them pushes integrity into application code, where it silently rots. This module is **both**-axis: integrity on design, and join/planning behaviour on performance. It applies to FK-supporting relational engines only; the document/KV profiles drop it entirely (no false penalty).

## What it checks
- **Missing FK**: a column named/typed as a reference (`*_id` matching another table's PK) with no `FOREIGN KEY` constraint. On financial or auth tables (orders, payments, sessions, memberships) an orphan-enabling missing FK is the **severity-5 cap** case.
- **ON DELETE / ON UPDATE action**: FK with no explicit referential action where the default (`NO ACTION`/`RESTRICT`) is wrong for the relationship, or a dangerous `CASCADE` that can mass-delete (e.g. deleting a user cascades to invoices). Each action must be intentional.
- **Reference cycles**: FK cycles (A→B→C→A) that block ordered insert/delete and complicate migrations — severity 4.
- **Composite FK mismatch**: multi-column FK whose column set/order does not match the referenced unique key, or partial composite references.
- **Untrusted/NOT VALID FK** left unvalidated after a backfill (Postgres `NOT VALID`).

## Axis & severity
- Missing FK enabling orphan financial/auth rows: severity 5, `fail`, axis `both`, confidence `established` (caps).
- FK cycle: severity 4, `warn`, axis `both`.
- Missing/over-broad `ON DELETE` (silent `RESTRICT` blocking, or unintended `CASCADE`): severity 3–4, `warn`, axis `design`.
- Composite-FK order mismatch: severity 3, `warn`.
- Note: FK columns lacking a supporting index are owned by **M11** (indexing), not here — cross-reference, do not double-count.

## Tier-0 static check
Parse DDL via `scripts/parse-schema.mjs`: for each `*_id`-style column, check whether a matching `FOREIGN KEY`/`REFERENCES` clause exists; enumerate declared FKs and flag those without an explicit `ON DELETE`/`ON UPDATE` action; build the FK graph and detect cycles. Directional ORM-source parses never raise the sev-5 orphan cap.

## Tier-1 verification query
List FK constraints and their actions (confirms missing/dangerous actions):
```sql
-- $DATABASE_URL, read-only
SELECT conrelid::regclass AS child, confrelid::regclass AS parent,
       confdeltype AS on_delete, confupdtype AS on_update, convalidated AS validated
FROM pg_constraint WHERE contype = 'f';
```
Confirm real orphans exist for a suspected missing FK:
```sql
SELECT count(*) AS orphans FROM child c
LEFT JOIN parent p ON c.parent_id = p.id WHERE p.id IS NULL AND c.parent_id IS NOT NULL;
```
No live DB → `needs_api` for the orphan count, never a silent pass.

## Findings
Emit per `schema/finding.schema.json`. Examples:
- `M3.payments.user_id_no_fk` — `user_id` references no table; orphan payments possible (severity 5, `fail`, axis `both`, confidence `established`).
- `M3.invoices.fk_cascade_deletes_financial` — `ON DELETE CASCADE` from users mass-deletes invoices (severity 4, `warn`, axis `design`, `fixable: proposed`).
- `M3.graph.fk_cycle_a_b_c` — reference cycle blocks ordered load (severity 4, `warn`, axis `both`).
Each finding: `evidence.observed` quotes the FK/column DDL or catalog row verbatim; `verification.reproduce` is a runnable query above (`method: ddl_parse` / `constraint_check` / `query_stat`); `expected_impact` banded + confidence-tagged.

## Honesty
- A missing FK only caps when the orphan risk is real (financial/auth integrity); a missing FK on a low-stakes lookup is at most a `warn`.
- App-level integrity (validation, soft FKs) is a mitigation, not a substitute — note it, but the DB-level guarantee is absent. Do not claim app code "fixes" it.
- Never assert orphan rows exist without a Tier-1 count; static, it is `directional`.
