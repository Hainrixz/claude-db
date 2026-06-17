---
name: db-query-patterns
description: Audit query-shape anti-patterns — SELECT *, structural N+1 (directional), OFFSET pagination vs keyset, and non-SARGable predicates that defeat indexes. Module M13. Feeds the Performance & Scale score.
allowed-tools: Read, Grep, Glob, Bash
---

# db-query-patterns (M13)

How queries are *written* decides whether the indexes from M11 can even be used. This module inspects
query shape in ORM source and raw SQL. Feeds the **Performance & Scale** score (axis `performance`,
relational *Query* w18, shared with M3/M19).

## What it checks

1. **`SELECT *`** — fetching all columns defeats covering indexes, bloats network/cache, and couples
   code to column order. Flag in hot paths.
2. **Structural N+1** — a query inside a loop / per-row lazy relation load that should be a single
   join or batched `IN`. Static detection is **directional** (the loop's runtime cardinality is
   unknown) — it points at the structure, never claims a row count.
3. **OFFSET pagination** — `LIMIT n OFFSET m` degrades linearly with depth; deep pagination should use
   **keyset/seek** (`WHERE id > $last ORDER BY id LIMIT n`).
4. **Non-SARGable predicates** — wrapping the indexed column in a function (`WHERE lower(email)=…`,
   `WHERE date(created_at)=…`, leading-wildcard `LIKE '%x'`, implicit type cast) so the index can't be
   used. Recommend an expression index or rewriting the predicate. For the leading-wildcard /
   `LIKE '%x%'` case a B-tree can never help — name the remedy: a `pg_trgm` **GIN/GiST** index on the
   column (or a dedicated search engine for heavy full-text search).

## Score / axis

Feeds **performance** only (relational *Query* w18; *Query* category in document/time-series/graph
profiles).

## Tier-0 (static)

Grep ORM call sites and raw SQL for `SELECT *`, function-wrapped indexed columns, leading-wildcard
`LIKE`, and `OFFSET`; detect query calls inside loops/`.map`/per-item relation access for N+1. All
query-pattern findings are at most `directional` from source — confirming the actual plan/cost needs
runtime (`needs_api` / Tier-2).

## Tier-1/2 (verification query)

```sql
EXPLAIN (ANALYZE, BUFFERS) <the suspect query>;
```
Method `explain_plan`. A `Seq Scan` where an index exists confirms a non-SARGable predicate; the
`actual rows` × `loops` confirms an N+1 amplification. Tier-2 `pg_stat_statements` (ordered by
`total_exec_time`) surfaces the real hot queries — without it, hotness is `directional`.

## Findings

Emit findings per `schema/finding.schema.json`. Examples:
- `M13.orders.select_star_hot_path` — `SELECT *` in a frequent read (`severity:2`, `warn`, axis
  `performance`, confidence `directional`, `fixable: proposed`).
- `M13.users.n_plus_one_posts` — per-row relation load in a loop (`severity:3`, `warn`, `directional`,
  `fixable: advisory` — requires app-side eager load / batching).
- `M13.feed.offset_deep_pagination` — `OFFSET` deep paging (`severity:2`, `warn`, `directional`,
  `fixable: proposed` — keyset rewrite).
- `M13.users.non_sargable_lower_email` — function-wrapped indexed column (`severity:3`, `warn`,
  `directional`, `fixable: proposed` — expression index or predicate rewrite).

Each finding: `evidence.observed` quotes the query / call site **verbatim** (secrets redacted);
`verification.reproduce` is the `EXPLAIN` above referencing `$DATABASE_URL`, or a `grep` for the
pattern; `expected_impact` is banded + confidence-tagged (no naked %).

## Honesty

- N+1 is **directional by design**: a loop running twice is fine, the same loop over 10k rows is not —
  static analysis cannot tell which, so it never caps and never quotes a multiplier.
- `SELECT *` is harmless on a small lookup or a one-shot admin query — scope severity to hot paths.
- Rewrites that change result semantics (keyset, predicate restructure) are `proposed`/`advisory`,
  never `auto`; expression-index additions can be `proposed`.
