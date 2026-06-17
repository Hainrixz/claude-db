# Migration safety — zero-downtime, lock-aware, reversible

Powers M22 (migration-safety). A migration that takes a long lock, rewrites a big table, or destroys data
without a path back is the difference between a deploy and an outage. Default posture: **expand-contract,
additive-first, reversible, lock-aware.** A destructive/irreversible migration with no back-out is severity-5.

## Expand-contract (the backbone of zero-downtime)
Never change a column in place while old and new code both run. Split every breaking change into phases that
each keep old and new app versions working:

1. **Expand** — add the new shape additively (new nullable column, new table, new index built concurrently).
   Backfill in batches. Dual-write from the app if needed.
2. **Migrate** — switch reads to the new shape once backfilled and verified.
3. **Contract** — only after all old code is gone, drop the old column/table/constraint.

Renames and type changes are *expand-contract in disguise*: add-new → backfill → switch → drop-old. A bare
`RENAME COLUMN` or in-place `ALTER TYPE` on a live table is the classic break.

## Lock-aware operations (Postgres)
- **`CREATE INDEX CONCURRENTLY`** (no table lock) — never a plain `CREATE INDEX` on a live large table.
- **Add `NOT NULL`**: add as a `CHECK (col IS NOT NULL) NOT VALID`, `VALIDATE CONSTRAINT` (no full lock),
  then optionally promote — not a bare `SET NOT NULL` that scans under `ACCESS EXCLUSIVE`.
- **Add a column with a non-volatile default**: fast in modern PG (metadata-only); a *volatile* default still
  rewrites — flag it.
- **Add FK** as `NOT VALID` then `VALIDATE CONSTRAINT` (takes a weaker lock).
- **`ALTER TYPE` that changes storage** (e.g. `int`→`bigint`, `varchar`→`text` can be safe;
  `text`→`int` is not) rewrites the table under `ACCESS EXCLUSIVE` — use expand-contract.
- Keep migration transactions short; a long lock queues *behind it* every query needing that lock.

### Lock-safety envelope (production DDL)
Wrap every production DDL session with a bounded `lock_timeout` (and a sane `statement_timeout`) plus
retry, so a blocked DDL **fails fast** instead of queueing behind a long-running transaction and stalling
all traffic on that object:
```sql
SET lock_timeout = '2s';      -- give up on the lock fast; don't head-of-line-block the table
SET statement_timeout = '30s'; -- cap the operation itself
-- run the DDL; on lock_timeout error, back off and retry rather than waiting indefinitely
```
Without `lock_timeout`, a DDL that can't immediately grab `ACCESS EXCLUSIVE` waits — and every query that
arrives behind it also waits, turning one slow transaction into a full-table outage.

**Failed `CREATE INDEX CONCURRENTLY` leaves an INVALID index.** Because it commits in phases and takes no
table lock, an interrupted/failed run leaves a leftover index marked `INVALID` (visible in
`pg_index.indisvalid = false`). It is not used by the planner but still costs write overhead, and a retry
of the same name fails. You must `DROP INDEX CONCURRENTLY <name>;` the invalid index before retrying.

## Lock-aware per engine
- **MySQL/PlanetScale**: prefer online DDL (`ALGORITHM=INPLACE`/`INSTANT`) or the platform's online-schema-
  change / deploy-request flow; some `ALTER`s still copy the table. PlanetScale's branch+deploy-request gives
  this safely. Watch FK-constraint support under Vitess (see `platforms-2026.md`).
- **MongoDB**: schema is per-document — "migration" = backfill writes + validator changes; build indexes in
  the background; beware rewriting huge documents.
- **Cassandra**: schema changes propagate cluster-wide; avoid changing the primary/partition key (effectively
  a new table + data copy). Adding columns is cheap.

## Reversible vs irreversible
- **Reversible** (write a `down`): add column/table/index, add constraint, backfill into a new column.
- **Irreversible / destructive** (require explicit confirmation, a backup, and ideally a soft-delete window):
  `DROP TABLE/COLUMN`, `TRUNCATE`, dropping a constraint/index you can't perfectly recreate, narrowing a type
  (data loss), deleting rows. **No reversibility/expand-contract on a destructive op = severity-5.**
- **Destructive-confirmation token (concrete):** never accept a generic `yes`/`y`. Require the operator to
  **type the affected object name back verbatim** (the GitHub "type the repository name to confirm" pattern):
  e.g. to drop `users` they must type `users`. This is echo-resistant — it can't be satisfied by a reflexive
  keystroke or a copied prompt, and it forces the operator to read *which* object is being destroyed. Referenced
  by `/migrate` and `/fix`.
- **Enum mutation**: removing/renaming an enum value is destructive and lock-prone in PG (can't drop a value);
  prefer a lookup table when the set changes. Adding a value is append-only and safe.

## Zero-downtime backfill
- Backfill in **bounded batches** (by PK range), throttled, idempotent (re-runnable), outside the schema-
  change transaction. Never `UPDATE` an entire large table in one statement (long lock + bloat + replication
  lag). Track progress so a failed run resumes.

## Schema drift (M22 + detection)
When a declarative artifact (`schema.prisma`, snapshot) and a generated migration/DB disagree, that's drift —
emit a directional warn and point at the authoritative source (`references/detection-signals.md`
precedence). The live DB beats any file; a generated artifact beats ORM program source.

## Detection (Tier 0) & honesty
Statically: parse each migration's statements and classify lock level / rewrite / destructiveness /
reversibility / enum mutation. Lock *duration* and table-size impact are **directional** without live row
counts; confirm with a dry run / `EXPLAIN` / catalog sizes at Tier 1 — never fabricate a lock-time number.
Findings emit per `schema/finding.schema.json`; `fixable:auto` only for additive, verifiable rewrites (e.g.
plain→concurrent index), `proposed` for restructures, `advisory` for destructive ops.
