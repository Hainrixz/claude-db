---
name: db-partitioning-sharding
description: Audit horizontal scaling topology — declarative partitioning fit for large/time-series tables, hot-partition / skewed partition-key risk, and premature sharding that adds complexity before it is justified. Module M16. Feeds the Performance & Scale score.
allowed-tools: Read, Grep, Glob, Bash
---

# db-partitioning-sharding (M16)

Scaling topology is **Performance & Scale** (axis `performance`); feeds relational *Escala* w12
(shared with M17/M2/M9) and the *Shard-key* / *Partición&hot* categories in NoSQL profiles. The two
failure directions are symmetric: scaling **too late** (a monster table that should be partitioned) and
scaling **too early** (sharding a 5 GB database that a single node handles trivially).

## What it checks

1. **Partitioning fit** — large append-only / time-series tables (events, logs, metrics) that would
   benefit from Postgres declarative range/list partitioning (cheap pruning, fast retention drops) but
   are a single heap.
2. **Hot partition / skewed key** — a partition or shard key with low cardinality or temporal skew
   (e.g. partitioning by `tenant_id` where one tenant is 90% of traffic, or all writes hitting
   "today's" partition). On wide-column stores an unbounded/hot partition on an event table is
   `severity:5` (perf) *with live write-rate evidence* — otherwise `directional`.
3. **Premature sharding** — application-level sharding / multiple shards introduced with no size or
   throughput justification, adding cross-shard-query and rebalancing cost for no benefit.

## Score / axis

Feeds **performance** only (relational *Escala* w12; *Shard-key* document / *Partición&hot* KV+WC /
*Escala* vector+graph).

## Tier-0 (static)

Detect partitioning DDL (`PARTITION BY`, partition children), the chosen partition/shard key and its
apparent cardinality, large-table candidates from naming/columns (timestamp + high insert intent), and
shard-fanout code. Table **size**, **row counts**, and **per-partition write rate** are runtime →
`needs_api` at Tier-0 (never a silent pass).

## Tier-1/2 (verification query, Postgres)

```sql
-- partition inventory + sizes (Tier-1):
SELECT inhparent::regclass AS parent, inhrelid::regclass AS partition,
       pg_size_pretty(pg_total_relation_size(inhrelid)) AS sz
FROM pg_inherits ORDER BY pg_total_relation_size(inhrelid) DESC;
-- candidate (unpartitioned) large tables:
SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) AS sz, reltuples::bigint AS est_rows
FROM pg_class WHERE relkind='r' ORDER BY pg_total_relation_size(oid) DESC LIMIT 20;
```
Method `schema_introspect` / `query_stat`. A large unpartitioned table confirms a partitioning-fit
finding as `established`; per-partition skew needs Tier-2 write stats — without them, hot-partition is
`directional` and never caps.

## Findings

Emit findings per `schema/finding.schema.json`. Examples:
- `M16.events.unpartitioned_large_table` — large append-only table as a single heap (`severity:3`,
  `warn`, axis `performance`, confidence `established` Tier-1 / `needs_api` Tier-0, `fixable: advisory`).
- `M16.metrics.hot_partition_today` — all writes to the current partition / skewed key (`severity:3`,
  `warn`, `directional` static / `established` Tier-2; `severity:5` only with live write-rate on a WC
  event table, `fixable: advisory`).
- `M16.app.premature_sharding` — sharding with no size/throughput justification (`severity:2`, `warn`,
  `directional`, `fixable: advisory`).

Each finding: `evidence.observed` quotes the DDL / shard code / catalog row **verbatim**;
`verification.reproduce` is the query above referencing `$DATABASE_URL`; `expected_impact` is banded +
confidence-tagged (no naked %).

## Honesty

- Partitioning has real overhead (planning time, cross-partition constraints) — recommend it only for
  tables genuinely large or with retention/pruning needs, never as a default.
- Never fabricate a row count or table size to justify (or refute) partitioning — size claims need
  Tier-1; absent it, emit `needs_api`.
- Hot-partition sev-5 requires **live write-rate evidence**; a static key-cardinality guess stays
  `directional` and cannot cap.
- These are architectural changes → `advisory` (or `proposed` for a concrete declarative-partition
  migration), never `auto`.
