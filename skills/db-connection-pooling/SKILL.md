---
name: db-connection-pooling
description: Audit connection management — serverless functions opening direct Postgres connections, transaction-mode pooler misuse (PgBouncer / Supabase / prepared statements), and pool sizing against backend max_connections. Module M15. Feeds the Performance & Scale score.
allowed-tools: Read, Grep, Glob, Bash
---

# db-connection-pooling (M15)

Connection exhaustion is a top cause of production outages and a pure **Performance & Scale** (axis
`performance`) concern. Feeds relational *Pooling* w10 (and the *Conexión* category in every NoSQL
profile). The dominant modern failure is serverless functions opening one direct connection each and
saturating the backend.

## What it checks

1. **Serverless + direct Postgres** — a function/edge runtime (Vercel/Lambda/Cloudflare/Netlify)
   connecting directly to Postgres with no pooler. Each cold start opens a connection; concurrency
   spikes blow past `max_connections`. Recommend a transaction-mode pooler or a serverless driver
   (Neon/`@neondatabase/serverless`, Supabase pooler, PlanetScale HTTP).
2. **Transaction-mode pooler misuse** — using a transaction-pooling endpoint (PgBouncer `transaction`
   mode, Supabase port 6543) while relying on session features it breaks: server-side prepared
   statements, `SET`/session GUCs, `LISTEN/NOTIFY`, advisory-session locks.
3. **Pool sizing** — application pool `max` × instance count exceeding backend `max_connections`, or a
   pool so small it serializes requests.

## Sizing block

- The **server-connection ceiling** is roughly a small multiple of vCPU, not your peak concurrency.
  Frame `(cores*2) + effective_spindles` as the *server-side* ceiling on usefully-busy backend
  connections — **not** a per-app-pool target.
- Size the **client pool to that ceiling**, not to peak request concurrency. More backend connections
  than the server can usefully run just adds context-switch and lock contention; queue at the pool, not
  the database.
- Reserve **headroom below `max_connections`** — leave `superuser_reserved_connections` (and room for
  other apps/replication) free so an admin can still connect when the pool saturates.
- **PgBouncer transaction mode** multiplexes many client connections onto a few backend connections, so
  the client pool can far exceed the backend ceiling — but session-level features break under it
  (server-side prepared statements, `SET`/session GUCs, `LISTEN/NOTIFY`, session-scoped advisory locks).

## Score / axis

Feeds **performance** only (relational *Pooling* w10; *Conexión*/*Pooling* in NoSQL profiles).

## Tier-0 (static)

Detect the runtime (serverless markers per `references/detection-signals.md`) and the client/driver
(`pg`, `postgres`, `@neondatabase/serverless`, `@prisma/client`, connection URL host/port). Flag direct
connections from serverless, port-6543/`pgbouncer=true` URLs combined with prepared-statement usage,
and pool config. Backend `max_connections` and *live* connection counts are runtime → `needs_api` at
Tier-0.

## Tier-1 (verification query, Postgres)

```sql
SELECT current_setting('max_connections') AS max_conn,
       count(*) AS open_conns,
       count(*) FILTER (WHERE state = 'idle') AS idle
FROM pg_stat_activity;
```
Method `connection_introspect`. `open_conns` approaching `max_conn` confirms an exhaustion finding as
`established`. The serverless-direct and pooler-mode findings are confirmable from config alone
(`directional`); their *impact* under load is `needs_api` without Tier-2.

## Findings

Emit findings per `schema/finding.schema.json`. Examples:
- `M15.app.serverless_direct_pg` — serverless function with a direct Postgres connection, no pooler
  (`severity:4`, `warn`, axis `performance`, confidence `directional`, `fixable: proposed` — switch to
  pooler/serverless driver).
- `M15.app.prepared_stmt_on_txn_pooler` — server-side prepared statements over a transaction-mode
  pooler (`severity:3`, `warn`, `directional`, `fixable: proposed`).
- `M15.app.pool_exceeds_max_connections` — pool × instances > backend max (`severity:3`, `warn`,
  `established` Tier-1 / `directional`, `fixable: proposed`).

Each finding: `evidence.observed` quotes the connection config / driver import **verbatim with the
credential redacted**; `verification.reproduce` is the catalog query above referencing `$DATABASE_URL`;
`expected_impact` is banded + confidence-tagged (no naked %).

## Honesty

- A long-lived server (a single Node/Rails process) with a sane pool is **fine** with a direct
  connection — the serverless-direct finding applies only to per-invocation runtimes.
- Never quote a connection count or an outage probability you cannot observe; impact is banded only,
  and exhaustion claims need Tier-1/2 to become `established`.
- All fixes here are config/architecture → `proposed`/`advisory`, never `auto`.
