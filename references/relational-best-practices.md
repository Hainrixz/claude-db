# Relational best practices (Postgres-first, 2026)

The boring default. Most apps that say "we need NoSQL" are better served by Postgres with the
discipline below. These rules feed the Design & Integrity and Performance & Scale modules; each item
maps to the module that detects it statically (Tier 0) and the live query that confirms it (Tier 1).

## Modeling & normalization (M1, M19)
- Normalize to **3NF first**, denormalize only against a measured read pattern — and record *why* in a
  comment or migration note. Premature denormalization is the more common defect than the reverse.
- One fact, one place. Repeating groups, comma-joined lists in a column, and EAV "key/value attribute"
  tables are anti-patterns (see `antipattern-catalog.md`).
- A junction table for every many-to-many. No array-of-FK shortcuts in relational engines.

## Keys (M2)
- **Every table has a primary key.** No-PK is severity-5: it breaks replication identity, dedup, and
  `ON CONFLICT`.
- Surrogate PK default: **`bigint` GENERATED ALWAYS AS IDENTITY** (not `serial`) for internal ordering;
  **UUIDv7 or ULID** when the id is exposed externally or generated client-side (time-ordered, so it
  keeps B-tree locality unlike UUIDv4). Plain `uuid` v4 fragments index pages — call it out.
- **PostgreSQL 18+ (GA Sept 2025): native `uuidv7()`** is the recommended time-ordered UUID default
  (RFC 9562); the embedded timestamp is extractable via `uuid_extract_timestamp()`. On PG ≥18 a
  `gen_random_uuid()`/v4 default is a *downgrade* — prefer `uuidv7()`. Pre-18 (or non-Postgres engines)
  keep generating UUIDv7 app-side; `gen_random_uuid()` stays acceptable there.
- `int4`/`serial` PK on a high-write table is a time bomb: ~2.1B ceiling. Flag exhaustion risk; confirm
  with current max id vs ceiling at Tier 1.
- Natural keys are fine as a `UNIQUE` constraint; avoid them as the PK that FKs point at if they mutate.

## Referential integrity (M3)
- Declare **foreign keys**. Orphaned financial/auth rows from a missing FK is severity-5.
- Choose `ON DELETE` deliberately: `RESTRICT`/`NO ACTION` (default safe), `CASCADE` (only when children
  are truly owned), `SET NULL` (only on a nullable FK). Silent `CASCADE` on audit/financial data is a bug.
- FK cycles (A→B→A) block inserts/deletes without deferrable constraints — severity-4.
- Composite FKs must reference a matching composite UNIQUE/PK, columns in order.

## Types & precision (M4, M6)
- **Money = `numeric(p,s)`**, never `float`/`double` (binary float can't represent 0.10). Float money is
  severity-5.
- **Timestamps = `timestamptz`, stored UTC.** `timestamp` (no tz) silently drops offset — a latent bug.
- Prefer native types over stringly-typed columns: `inet`, `uuid`, `date`, `interval`, `jsonb`.
- `jsonb` is for genuinely schema-less or sparse data, **not** to dodge designing columns you query and
  constrain. JSONB-as-schema-evasion is a design warn.
- Enumerated values: a **lookup table** (FK) scales better than a PG `enum` when the set changes (altering
  an enum locks); reserve native enums for truly fixed, rarely-changing sets.
- Text: default to `text`; use `varchar(n)` only when `n` is a real domain rule. Set `utf8mb4` +
  case/accent-aware collation on MySQL.
- Generated columns (`GENERATED ALWAYS AS … STORED`) beat trigger-maintained denormalized columns.

## Constraints (M5)
- Push invariants into the database: `NOT NULL`, `CHECK`, `UNIQUE`, FK, exclusion constraints. App-level
  validation alone drifts and races.
- **Over-nullable UNIQUE trap:** in SQL, multiple NULLs are distinct, so `UNIQUE(email)` does not stop two
  NULL emails — use a partial unique index or `NULLS NOT DISTINCT` (PG 15+) when that's the intent.
- `CHECK` for enums-by-domain, ranges, and cross-column rules. Name your constraints (stable, greppable).

## Naming (M7)
- One convention, applied everywhere: `snake_case`, plural-or-singular-but-consistent table names,
  `table_id` FK columns, `idx_`/`uq_`/`fk_`/`ck_` prefixes for objects. Reserved words avoided.

## Security & access (M9, M10)
- **No plaintext secrets in schema/migrations/seeds** — severity-5; redact before any finding.
- **TLS required:** `sslmode=disable` is severity-4. Encryption at rest on managed platforms.
- Multi-tenant on Postgres: **enable Row-Level Security** on tenant tables; RLS off on a relied-on tenant
  table is severity-5. Lead composite indexes with `tenant_id`.
- Tag PII columns; have a deletion/retention story (see `migration-safety.md`, GDPR erasure in M8).
- Parameterize everything. Raw string-concatenated SQL is severity-5 (injection).

## Indexing & queries (M11, M12, M13)
- Index for the workload, not reflexively. **ESR rule** for composite indexes: Equality columns first,
  then Sort, then Range. **Every FK that is joined or filtered needs an index** (PG does not auto-index
  the referencing side).
- Covering (`INCLUDE`) and partial (`WHERE`) indexes for hot, selective queries; GIN for `jsonb`/array/FTS,
  GiST for ranges/geo, BRIN for naturally-ordered big tables.
- Remove duplicate/redundant (left-prefix) and genuinely unused indexes — each one taxes every write.
  "Unused" requires Tier-2 `pg_stat_user_indexes`; statically you can only flag exact duplicates.
- Avoid `SELECT *` in app code, OFFSET pagination on deep pages (use keyset), and non-SARGable predicates
  (`WHERE fn(col) = …`) that defeat indexes. Structural N+1 is a directional signal, not a guarantee.

## Operability (M14, M15, M18, M22)
- Pool connections (PgBouncer / platform pooler); a serverless function holding a direct PG connection per
  invocation exhausts `max_connections` — flag it.
- Pick isolation deliberately; use `SELECT … FOR UPDATE SKIP LOCKED` for queue tables; design idempotency
  keys for retried writes.
- Let autovacuum keep up; watch dead tuples and **TXID wraparound** (`age(datfrozenxid)`) — wraparound
  imminent is severity-5 (Tier-1 only).
- Migrations: expand-contract, `CREATE INDEX CONCURRENTLY`, avoid full-table rewrites and long
  `ACCESS EXCLUSIVE` locks. Destructive/irreversible migration without a back-out is severity-5. See
  `migration-safety.md`.

All findings emit per `schema/finding.schema.json` with `evidence.observed` quoting the real DDL and
`verification.reproduce` runnable against `$DATABASE_URL`.
