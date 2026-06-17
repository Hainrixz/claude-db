---
name: db-index-hygiene
description: Audit index bloat — exact-duplicate indexes, redundant indexes whose key is a prefix of another, and unused indexes that only cost write amplification and storage. Module M12. Feeds the Performance & Scale score.
allowed-tools: Read, Grep, Glob, Bash
---

# db-index-hygiene (M12)

The inverse of M11: M11 adds missing indexes, M12 removes the ones that only cost. Every index slows
writes and consumes storage and cache; duplicates and never-read indexes are pure overhead. Feeds the
**Performance & Scale** score (axis `performance`, relational *Higiene de índices* w16).

## What it checks

1. **Exact duplicates** — two indexes with the identical key column list (and same type/predicate);
   one is redundant.
2. **Redundant prefix** — index on `(a)` is fully covered by an existing index on `(a, b)`; the
   shorter one can usually be dropped (B-tree leftmost-prefix rule).
3. **Unused** — an index with no scans over a representative window (Tier-2 `idx_scan = 0`). This is
   **runtime truth**: never declared unused from static analysis alone.

## Score / axis

Feeds **performance** only (relational *Higiene de índices* w16; folds into *Indexación* in NoSQL
profiles).

## Tier-0 (static)

Parse declared indexes and detect exact duplicates and leftmost-prefix redundancy from the DDL alone
(`established` for duplicates — purely structural). **Unused-index detection is runtime-only** and
emits `status: needs_api` at Tier-0 (never a silent pass) with a nudge to Tier-2.

## Tier-1/2 (verification query, Postgres)

Duplicate/redundant (Tier-1 catalog):
```sql
SELECT indrelid::regclass AS tbl, array_agg(indexrelid::regclass) AS dupes
FROM pg_index GROUP BY indrelid, indkey, indclass, indpred
HAVING count(*) > 1;
```
Unused (Tier-2, requires sustained stats):
```sql
SELECT relname AS tbl, indexrelname AS idx, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) AS sz
FROM pg_stat_user_indexes WHERE idx_scan = 0 ORDER BY pg_relation_size(indexrelid) DESC;
```
Method `index_check` / `query_stat`. The Tier-2 result confirms `M12.*.unused` as `established`;
without a representative window it stays `directional`, and if stats are needed to decide → `needs_api`.

## Findings

Emit findings per `schema/finding.schema.json`. Examples:
- `M12.users.duplicate_email_index` — two indexes on the same key (`severity:2`, `warn`, axis
  `performance`, confidence `established` from DDL, `fixable: proposed` — `DROP INDEX`).
- `M12.orders.redundant_prefix_index` — `(status)` covered by `(status, created_at)` (`severity:1`,
  `warn`, `established`/`directional`, `fixable: proposed`).
- `M12.events.unused_index` — zero scans over the window (`severity:2`, `warn`, `established` Tier-2 /
  `needs_api` at Tier-0, `fixable: proposed`).

Each finding: `evidence.observed` quotes the index DDL or the catalog/stats row **verbatim**;
`verification.reproduce` is the query above referencing `$DATABASE_URL`; `expected_impact` is banded +
confidence-tagged (no naked %).

## Honesty

- An unused index over a short window may be hit by month-end/quarterly jobs — always require a
  representative window and mark short-window verdicts `directional`, not `established`.
- A unique/constraint-backing index is **not** droppable even if "unused" for scans — it enforces
  integrity; never recommend dropping it.
- Drops are `proposed` (never `auto`): removal is not trivially reversible at scale and intent may be
  deliberate. Suggest `DROP INDEX CONCURRENTLY` in the fix preview.
