---
name: db-storage-bloat
description: Audit storage operability — VACUUM / autovacuum health and table-and-index bloat, transaction-ID wraparound risk (sev-5), and tombstone accumulation on wide-column stores. Module M18. Feeds the Performance & Scale score.
allowed-tools: Read, Grep, Glob, Bash
---

# db-storage-bloat (M18)

Storage operability keeps a database fast and *alive* over time; it is a **Performance & Scale** (axis
`performance`) concern, feeding relational *Almacenamiento* w12 (shared with M22/M20/M21) and the
*Tombstones* category in the wide-column profile. The catastrophic case — **TXID wraparound** — can
force a Postgres shutdown, so it is a `severity:5` cap when imminent.

## What it checks

1. **VACUUM / autovacuum health** — autovacuum disabled or mis-tuned on a high-churn table, dead
   tuples accumulating, bloated tables/indexes inflating size and slowing scans.
2. **TXID wraparound** — `age(datfrozenxid)` (or per-table `relfrozenxid`) approaching
   `autovacuum_freeze_max_age` / the 2-billion ceiling. **Imminent** wraparound is `severity:5`, `fail`
   (perf) — but only with **live** age evidence; statically it is at most a `needs_api` nudge.
3. **Tombstones (wide-column)** — Cassandra/Scylla heavy deletes / TTL churn producing tombstones that
   degrade reads (`tombstone_warn_threshold` territory).

## Score / axis

Feeds **performance** only (relational *Almacenamiento* w12; *Tombstones* in the wide-column profile).

## Tier-0 (static)

Almost all of M18 is **runtime truth**. Statically, detect autovacuum-disabling DDL/config
(`autovacuum_enabled = false`, aggressive `fillfactor`), high-delete/TTL access patterns, and
wide-column delete-heavy modeling. Dead-tuple counts, real bloat, frozen-xid age, and tombstone counts
all require a live DB → `status: needs_api` at Tier-0 (never a silent pass).

## Tier-1/2 (verification query, Postgres)

```sql
-- TXID wraparound headroom (Tier-1):
SELECT datname, age(datfrozenxid) AS xid_age,
       current_setting('autovacuum_freeze_max_age')::int AS freeze_max
FROM pg_database ORDER BY age(datfrozenxid) DESC;
-- dead tuples + last autovacuum (Tier-2):
SELECT relname, n_dead_tup, n_live_tup, last_autovacuum
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 20;
```
Method `query_stat`. `xid_age` near `freeze_max` (or the 2e9 ceiling) confirms wraparound as
`established` and **capping**. High `n_dead_tup` with stale/`NULL` `last_autovacuum` confirms bloat as
`established`; without sustained stats, bloat stays `directional`.

## Findings

Emit findings per `schema/finding.schema.json`. Examples:
- `M18.db.txid_wraparound_imminent` — `xid_age` approaching the ceiling (`severity:5`, `fail`, axis
  `performance`, confidence `established` **Tier-1 only** / `needs_api` Tier-0, `fixable: advisory` —
  aggressive `VACUUM (FREEZE)`).
- `M18.events.autovacuum_disabled` — autovacuum turned off on a churny table (`severity:3`, `warn`,
  `established` from DDL, `fixable: proposed`).
- `M18.events.dead_tuple_bloat` — high dead-tuple ratio (`severity:3`, `warn`, `established` Tier-2 /
  `needs_api`, `fixable: advisory`).

Each finding: `evidence.observed` quotes the config/DDL line or the catalog/stats row **verbatim**;
`verification.reproduce` is the query above referencing `$DATABASE_URL`; `expected_impact` is banded +
confidence-tagged (no naked %).

## Honesty

- Wraparound sev-5 **requires live `age()` evidence** — never declare it imminent from files; absent a
  connection, emit `needs_api`, which never caps.
- Some "bloat" is normal steady-state headroom; flag it only against a churn pattern or measured dead
  ratio, and mark file-only verdicts `directional`.
- Never quote a dead-tuple percentage or a days-to-wraparound number you cannot observe; magnitude is
  banded only. Routine maintenance fixes (`VACUUM`, autovacuum tuning) are `proposed`/`advisory`.

## Remedy — keep updates HOT
On an update-heavy table, lowering `FILLFACTOR` (e.g. the default `100`/`90` → `70`) leaves free space in
each page so an `UPDATE` can place the new row version on the **same page** as a **HOT (Heap-Only Tuple)
update** — which skips writing new index entries, curbing index write-amplification and slowing bloat
growth. HOT only fires when no indexed column changed and the page has room, so a lower `FILLFACTOR` plus
not over-indexing the churned columns is the lever. This is the positive counterpart to the autovacuum/bloat
findings above; emit it as `fixable: proposed` (a `FILLFACTOR` change rewrites only on subsequent updates).
