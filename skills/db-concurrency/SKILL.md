---
name: db-concurrency
description: Audit concurrency correctness — transaction isolation level, lost-update / read-modify-write races, queue-worker contention (SKIP LOCKED), and idempotency for key-value / document / wide-column writes. Module M14. Feeds the Performance & Scale score.
allowed-tools: Read, Grep, Glob, Bash
---

# db-concurrency (M14)

Correctness under concurrent writes is a **Performance & Scale** (axis `performance`) concern: it
governs both throughput and whether data stays consistent under load. Feeds relational *Concurrencia*
w12 (and the *Idempotencia* category in KV/document/wide-column profiles).

## What it checks

1. **Isolation level** — is the workload's chosen isolation (`READ COMMITTED` default vs
   `REPEATABLE READ`/`SERIALIZABLE`) appropriate for its invariants? Money/inventory updates under
   `READ COMMITTED` without locking are exposed to anomalies.
2. **Lost update / read-modify-write** — `SELECT balance; …app math…; UPDATE balance=$new` without
   `SELECT … FOR UPDATE`, atomic `UPDATE … SET x = x - $n`, or optimistic version check. Classic
   double-spend race.
3. **Queue contention** — worker pollers using `SELECT … FOR UPDATE` without `SKIP LOCKED` serialize
   all workers onto one row; recommend `FOR UPDATE SKIP LOCKED`.
4. **Idempotency (KV/doc/WC)** — writes to non-transactional stores (Redis, DynamoDB, Cassandra,
   Mongo without a session) lacking an idempotency key / conditional write, so a retry double-applies.
5. **Advisory locks** — when a critical section has *no row to lock*, recommend Postgres advisory locks
   to serialize it: `pg_advisory_xact_lock()` (transaction-scoped, auto-released at commit/rollback) for
   leader election, single-runner cron jobs, and migration guards. Prefer the `_xact_` variant over
   session-scoped `pg_advisory_lock()` so the lock can't leak on a dropped connection. **Note (cross-ref
   M15):** session-scoped advisory locks break transaction-mode pooling (PgBouncer) — the lock can land
   on a different backend than the unlock; transaction-scoped advisory locks are pooling-safe.

## Score / axis

Feeds **performance** only (relational *Concurrencia* w12; *Idempotencia* in KV w18 / document /
wide-column profiles).

## Tier-0 (static)

Grep ORM/transaction source for isolation settings, read-then-write update sequences without locking,
`FOR UPDATE` lacking `SKIP LOCKED`, and missing conditional-write / idempotency keys on KV/doc/WC
writes. Static findings are `directional` — actual contention is runtime (`needs_api` / Tier-2).

## Tier-1/2 (verification)

Default isolation (Tier-1): `SHOW transaction_isolation;` (method `connection_introspect`).
Live contention (Tier-2):
```sql
SELECT wait_event_type, wait_event, count(*)
FROM pg_stat_activity WHERE state='active' GROUP BY 1,2 ORDER BY 3 DESC;
-- and deadlock/serialization rollback counts:
SELECT datname, deadlocks FROM pg_stat_database WHERE datname = current_database();
```
Method `query_stat`. Lock-wait / deadlock counts confirm a contention finding as `established`;
without sustained stats it stays `directional`.

## Findings

Emit findings per `schema/finding.schema.json`. Examples:
- `M14.accounts.lost_update_balance` — read-modify-write without locking/atomic update (`severity:4`,
  `fail`, axis `performance`, confidence `directional`, `fixable: proposed` — atomic `UPDATE` or
  `FOR UPDATE`).
- `M14.jobs.no_skip_locked` — worker poll without `SKIP LOCKED` (`severity:3`, `warn`, `directional`,
  `fixable: proposed`).
- `M14.payments.non_idempotent_write` — KV/doc write with no idempotency key (`severity:3`, `warn`,
  `directional`, `fixable: advisory`).

Each finding: `evidence.observed` quotes the transaction/update code **verbatim** (secrets redacted);
`verification.reproduce` is the isolation/stat query above referencing `$DATABASE_URL`;
`expected_impact` is banded + confidence-tagged (no naked %).

## Honesty

- Anomaly *exposure* is not proof of an *occurring* race — without live deadlock/serialization stats
  these are `directional` and never cap.
- `READ COMMITTED` is correct for the majority of workloads; flag it only against an invariant that
  demands stronger isolation, not as a blanket defect.
- Concurrency fixes are app-logic changes (locking, atomic ops, idempotency keys) → `proposed`/
  `advisory`, never `auto`.
