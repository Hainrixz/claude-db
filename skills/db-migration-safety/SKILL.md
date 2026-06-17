---
name: db-migration-safety
description: Migration-safety lint (M22) — the static contract the migration-safety auditor (MSA) and db-migration-writer enforce on a candidate migration BEFORE it runs. Checks reversibility (down migration present / expand-contract), lock level (does it take ACCESS EXCLUSIVE on a hot table), table rewrite (full-table rewrites on type/default changes), destructive ops (DROP COLUMN/TABLE, TRUNCATE), unsafe enum mutation, NOT NULL without default on a large table, and schema drift between the declarative artifact and migration history. Feeds the Performance & Scale score.
allowed-tools: Read, Grep, Glob, Bash
---

# db-migration-safety (M22) — the migration lint contract

M22 lints a candidate migration as a static artifact before execution. It is the contract the
**migration-safety auditor** and the **db-migration-writer** agent both honor. Feeds **Performance &
Scale** (Almacenamiento/operability category). A destructive irreversible migration is the sev-5 cap on
the performance axis.

## What it checks (the lint contract)
1. **Reversibility** — a usable `down`/rollback exists, or the change follows **expand-contract**
   (add-new → backfill → switch → drop-old in separate deploys). A one-shot destructive step with no
   down is the highest-severity finding here.
2. **Lock level** — does the statement take a blocking lock on a hot table? In Postgres: adding a column
   with a volatile default (pre-11), `ALTER COLUMN TYPE`, adding a `CHECK`/FK without `NOT VALID`,
   non-`CONCURRENTLY` index creation all take `ACCESS EXCLUSIVE` / block writes. Prefer
   `CREATE INDEX CONCURRENTLY`, `ADD CONSTRAINT ... NOT VALID` then `VALIDATE CONSTRAINT`.
3. **Table rewrite** — changes that force a full-table rewrite (certain `ALTER COLUMN TYPE`, adding a
   `NOT NULL` column with a volatile default on old engines) → slow + long lock on large tables.
4. **Destructive ops** — `DROP COLUMN`, `DROP TABLE`, `TRUNCATE`, `DROP NOT NULL` reversals, dropping a
   column still read by deployed code. Destructive + irreversible = sev 5 (caps performance).
5. **NOT NULL without default** added to a populated table → fails or locks; require a backfill plan.
6. **Enum mutation** — the durable concern: enum values **cannot be removed or reordered** (removal is
   unsupported; renaming/reordering breaks dependents), so a changing set should be a **lookup table**,
   not a native enum. `ALTER TYPE ... ADD VALUE` is append-only and runs in a transaction on PG12+
   (only older PG forbade it mid-txn). Flag enum changes; suggest lookup tables.
7. **Schema drift** — the declarative artifact (schema.prisma / structure.sql / snapshot) disagrees with
   the migration history (a column exists in one but not the other) → directional warn.

## Tier-0 static checks
Parse migration SQL / ORM migration files (`scripts/parse-schema.mjs`, `parse-orm-python.py`). Scan for:
`DROP TABLE|DROP COLUMN|TRUNCATE`; `ALTER COLUMN .* TYPE`; `ADD COLUMN .* NOT NULL` without `DEFAULT`;
`CREATE INDEX` lacking `CONCURRENTLY`; `ADD CONSTRAINT` (FK/CHECK) lacking `NOT VALID`;
`ALTER TYPE .* ADD VALUE` / enum value removal or reorder; absence of a `down`/rollback block; drift between the
authoritative artifact (`references/detection-signals.md` precedence) and the latest migration.

## Tier-1 verification query
- Affected-table size (does the lock matter?): `SELECT pg_size_pretty(pg_total_relation_size('<t>')),
  reltuples FROM pg_class WHERE relname='<t>';`
- Lock the statement would take: `EXPLAIN`/`pg_locks` inspection, or a `dry_run_migration` against a
  throwaway copy / shadow DB. Use `verification.method: dry_run_migration` when a shadow DB is available;
  otherwise `migration_lint` on the static SQL. When live size is needed to decide severity but no DB is
  reachable → `needs_api`, never a silent pass.

## Findings
Emit per `schema/finding.schema.json`. Example ids:
- `M22.20240115_drop_users_legacy.destructive_irreversible` — `DROP COLUMN` with no down and column
  still referenced (fail, severity 5, axis `performance`, fixable `proposed` → expand-contract plan).
- `M22.add_index.lock_blocking` — `CREATE INDEX` without `CONCURRENTLY` on a hot table (warn, severity 4,
  axis `performance`, fixable `auto` → add `CONCURRENTLY`).
- `M22.add_email_notnull.notnull_no_default` — `ADD COLUMN ... NOT NULL` no default on a populated table
  (fail, severity 4, axis `performance`, fixable `proposed`).
- `M22.status_enum.enum_value_removed` — enum value removed/reordered (unsupported; breaks dependents) —
  suggest a lookup table (warn, severity 3, axis `performance`).
- `M22.drift.column_in_artifact_not_migration` — schema drift (warn, severity 2, axis `performance`,
  confidence `directional`).
Each finding: `evidence.observed` quotes the offending migration statement verbatim (secrets redacted);
`verification.reproduce` is a runnable command above using `$DATABASE_URL`; `verification.method` is
`migration_lint` or `dry_run_migration`; `fix_preview` carries the safer rewrite (e.g. `CONCURRENTLY`,
`NOT VALID` + `VALIDATE`, an expand-contract sequence); `expected_impact` carries
`{axis, confidence, magnitude, rationale}` — banded, never a naked %.

## Honesty
- Severity of a lock depends on table size and write rate — without live evidence, a blocking op on an
  unknown-size table is `directional` (medium), not an established sev-5. Don't claim a downtime
  duration in seconds; magnitude banded only.
- Only `DROP`/`TRUNCATE`-class destructive **and** irreversible migrations cap performance at sev 5.
  Reversible or expand-contract changes are warns. Drift is directional and never caps.
- Read-only: M22 lints and proposes; it never executes a migration. Execution is the writer agent's job
  behind explicit user accept.
