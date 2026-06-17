---
name: db-replicas-views
description: Audit read-scaling correctness — read-your-writes consistency when reads are routed to replicas, and materialized-view staleness / refresh strategy. Module M17. Feeds the Performance & Scale score.
allowed-tools: Read, Grep, Glob, Bash
---

# db-replicas-views (M17)

Read replicas and materialized views scale reads, but both introduce **staleness** that silently breaks
correctness if the application assumes fresh data. This is a **Performance & Scale** (axis
`performance`) concern; feeds relational *Escala* w12 (shared with M16/M2/M9).

## What it checks

1. **Read-your-writes** — a write immediately followed by a read of the same data, where the read may
   be routed to an async replica that has not yet caught up. User writes a comment, the next page load
   reads the replica and the comment is "gone." Recommend routing the immediate read to the primary,
   or using sync/quorum reads where required.
2. **Materialized-view refresh** — an `MATERIALIZED VIEW` queried as if live but refreshed manually /
   on a slow cron / never, so it serves stale data. Flag `REFRESH MATERIALIZED VIEW` without
   `CONCURRENTLY` (locks readers), and views with no visible refresh schedule.

## Score / axis

Feeds **performance** only (relational *Escala* w12; replica/view concerns map to the *Query*/*Escala*
categories in NoSQL profiles where applicable).

## Tier-0 (static)

Detect replica routing config (read/write split in the ORM/driver, multiple connection URLs), write→
read sequences against the same entity, `CREATE MATERIALIZED VIEW` DDL, and any `REFRESH` calls (and
whether `CONCURRENTLY`). Actual **replication lag** and **refresh recency** are runtime →
`needs_api` at Tier-0 (never a silent pass).

## Tier-1/2 (verification query, Postgres)

```sql
-- replication lag (Tier-1, on primary):
SELECT client_addr, state,
       pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS replay_lag_bytes
FROM pg_stat_replication;
-- matview presence + populated state:
SELECT matviewname, ispopulated FROM pg_matviews;
```
Method `query_stat` / `schema_introspect`. Measurable `replay_lag_bytes` confirms the read-your-writes
exposure as `established`; matview refresh recency needs the app's schedule or Tier-2 observation —
absent it, staleness is `directional`.

## Findings

Emit findings per `schema/finding.schema.json`. Examples:
- `M17.comments.read_your_writes_on_replica` — immediate read after write routed to a replica
  (`severity:3`, `warn`, axis `performance`, confidence `directional` static / `established` Tier-1,
  `fixable: proposed` — route the read to primary).
- `M17.dashboard.matview_no_refresh` — materialized view with no visible refresh schedule
  (`severity:2`, `warn`, `directional` / `needs_api`, `fixable: advisory`).
- `M17.dashboard.refresh_blocks_readers` — `REFRESH MATERIALIZED VIEW` without `CONCURRENTLY`
  (`severity:2`, `warn`, `established` from DDL, `fixable: proposed`).

Each finding: `evidence.observed` quotes the routing config / view DDL / catalog row **verbatim**;
`verification.reproduce` is the query above referencing `$DATABASE_URL`; `expected_impact` is banded +
confidence-tagged (no naked %).

## Honesty

- Replica staleness is correct *by design* for most analytics/reporting reads — flag it only where the
  read path needs its own just-written data, not as a blanket "replicas are dangerous."
- Never quote a lag number or a stale-read probability you cannot measure; lag claims need Tier-1 to be
  `established`, otherwise `directional`.
- `REFRESH … CONCURRENTLY` requires a unique index on the matview — note that prerequisite in the fix
  preview. Routing/refresh changes are `proposed`/`advisory`, never `auto`.
