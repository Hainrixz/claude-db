---
name: db-indexing
description: Audit index coverage for the query workload — composite index column order (ESR), covering and partial indexes, specialized types (GIN/GiST/BRIN, FTS, geo, JSONB-GIN), and foreign keys with no covering index. Module M11. Feeds the Performance & Scale score.
allowed-tools: Read, Grep, Glob, Bash
---

# db-indexing (M11)

Indexing is the single heaviest **Performance & Scale** (axis `performance`) lever (relational weight
20, *Indexación*). This module checks whether the indexes that exist match how the data is queried —
missing, mis-ordered, or wrong-type indexes turn a sub-millisecond lookup into a sequential scan.

## What it checks

1. **Composite order (ESR)** — multi-column indexes should order columns **Equality → Sort → Range**.
   A leading range/low-selectivity column wastes the index.
2. **Covering / partial** — frequent `SELECT a,b WHERE c` benefits from an `INCLUDE` covering index;
   queries always filtered on a predicate (`WHERE deleted_at IS NULL`) benefit from a partial index.
3. **Specialized types** — `GIN` for `jsonb`/array/FTS containment, `GiST`/`SP-GiST` for geometry/range,
   `BRIN` for naturally-ordered append-only columns (timestamps). Flag full-text/geo/JSONB filters
   served by a plain B-tree (or no index).
4. **FK-no-index** — every foreign key column should have a covering index; an unindexed FK forces a
   sequential scan on the *referenced* side during `ON DELETE`/`ON UPDATE` and on joins. This is the
   highest-yield, lowest-risk index finding.

## Score / axis

Feeds **performance** only (relational *Indexación* w20; *Indexación* category in every NoSQL profile).

## Tier-0 (static)

Parse DDL/migrations for declared indexes and FKs; cross-reference visible query patterns (ORM
`where`/`orderBy`, raw SQL) against index columns. Detect FK columns with no matching index prefix,
composite indexes with a non-equality leading column, and JSONB/array/FTS/geo predicates with no
specialized index. Whether an index is *actually used* is runtime truth → `needs_api` at Tier-0.

## Tier-1 (verification query) — FK-no-index (Postgres)

```sql
SELECT conrelid::regclass AS tbl, conname,
       pg_get_constraintdef(c.oid) AS fk
FROM pg_constraint c
WHERE c.contype = 'f'
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = c.conrelid
      AND (c.conkey[1]) = i.indkey[0]   -- leading index column == first FK column
  );
```
Method `index_check`. Each returned row is a confirmed unindexed FK (`established`). For ESR/covering,
`EXPLAIN (ANALYZE, BUFFERS)` on the real query (method `explain_plan`, Tier-2) confirms the scan type.

## Findings

Emit findings per `schema/finding.schema.json`. Examples:
- `M11.orders.customer_id_fk_unindexed` — FK column with no covering index (`severity:3`, `warn`,
  axis `performance`, confidence `directional` static / `established` Tier-1, `fixable: auto` —
  `CREATE INDEX CONCURRENTLY`).
- `M11.events.composite_order_esr` — leading range column in a composite index (`severity:2`, `warn`,
  `directional`, `fixable: proposed`).
- `M11.posts.jsonb_no_gin` — `jsonb` containment filter with no GIN index (`severity:3`, `warn`,
  `directional`, `fixable: proposed`).

Each finding: `evidence.observed` quotes the FK/index DDL or query **verbatim**; `verification.reproduce`
is the catalog query above (FK-no-index) or an `EXPLAIN` referencing `$DATABASE_URL`; `expected_impact`
is banded + confidence-tagged (no naked %).

## Honesty

- A missing index is not always a defect — a tiny lookup table or a write-heavy table can be slower
  *with* an index. Scope severity to table size/access frequency; default `directional` without stats.
- Never quote a latency/row-count improvement number; magnitude is `high|medium|low` only.
- `CREATE INDEX CONCURRENTLY` is `auto`-fixable for FK gaps (additive, non-blocking, verifiable);
  composite reorders and partial indexes are `proposed` because intent may differ.
