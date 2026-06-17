# Managed database platforms — trade-offs (2026, qualitative only)

Powers M21 (platform-fit). **No fabricated prices, limits, latencies, or EOL dates** — only durable,
qualitative trade-offs and lock-in shape. When a specific number, current price, or version-currency claim
is needed, that is `needs_api` / a live check, never a guessed figure. The honest default recommendation for
most teams remains **managed Postgres**; deviate only for a reason below.

## How to read this
Each platform: what it *is*, the lock-in you take on, and **when to pick it**. "Lock-in" = how hard it is to
leave (proprietary API, non-portable SQL, data-egress, ops you can't replicate elsewhere).

## Relational / Postgres-compatible

- **Supabase** — managed Postgres + auth, storage, realtime, edge functions, auto REST/GraphQL. *Lock-in:*
  low at the data layer (it's real Postgres — `pg_dump` out), higher if you lean on the auth/RLS/realtime
  stack. *Pick when:* you want a Postgres app with batteries (auth + RLS-first multi-tenancy) fast.
- **Neon** — serverless Postgres, separation of storage/compute, scale-to-zero, **branching** (copy-on-write
  DB branches per PR). *Lock-in:* low (standard Postgres); branching/autoscale are the sticky bits. *Pick
  when:* spiky/serverless workloads, preview-branch-per-PR workflows, cost-sensitive idle.
- **CockroachDB** — distributed, Postgres-wire-compatible, multi-region with strong consistency and survival
  goals. *Lock-in:* medium (SQL is mostly PG-compatible but distributed-specific tuning and some
  incompatibilities). *Pick when:* you genuinely need multi-region writes / horizontal scale with serializable
  guarantees — not for a single-region app (operational overhead unjustified).
- **PlanetScale** — managed MySQL (Vitess), online schema changes via **branching + deploy requests**,
  horizontal sharding. *Lock-in:* medium; historically **discouraged/blocked FK constraints** under Vitess
  sharding — verify current support before relying on FKs (M21 FK-support-per-platform check). *Pick when:*
  MySQL at scale with safe online DDL and a branch-based migration workflow.

## SQLite-at-the-edge

- **Turso** (libSQL) — distributed SQLite, edge replicas, embedded replicas. *Lock-in:* low data
  (it's SQLite), the distribution/replication is the value. *Pick when:* read-heavy, low-latency-at-edge,
  per-tenant or embedded DBs. *Watch:* write concentration, SQLite type affinity and concurrency limits.
- **Cloudflare D1** — SQLite on Cloudflare's edge, tied to Workers. *Lock-in:* higher (platform-coupled to
  Workers/CF). *Pick when:* you're already all-in on Cloudflare Workers and the data is modest.

## NoSQL / managed

- **DynamoDB** — AWS managed key-value/document, single-digit-ms at scale, single-table design, on-demand or
  provisioned capacity. *Lock-in:* **high** (proprietary API, single-table model doesn't port). *Pick when:*
  AWS-native, known high-scale access patterns, willing to design keys/GSIs up front. Wrong for ad-hoc
  querying or unknown access patterns.
- **Firestore** — Google serverless document DB, realtime listeners, generous client-SDK/offline story.
  *Lock-in:* **high** (proprietary query model; composite-index + per-query design constraints). *Pick when:*
  mobile/web app needing realtime + offline with minimal backend; not for heavy relational/analytical queries.

## The recurring guidance (M21)
- **Default to managed Postgres** (Supabase/Neon/RDS/Cloud SQL). It covers relational, JSON, vector
  (pgvector), time-series (Timescale), FTS, and geo — one store, low lock-in, huge talent pool.
- Deviate for a *named* reason: true multi-region writes (Cockroach), MySQL-at-scale + online DDL
  (PlanetScale), edge-latency reads (Turso/D1), AWS-native extreme KV scale (DynamoDB), realtime mobile
  (Firestore).
- **Version currency** (is the engine version current / approaching EOL) and **pricing** are time-sensitive:
  check the platform's live status — never assert a fabricated EOL date or price. M21 emits `needs_api` rather
  than guess.
- Be honest about lock-in in design recommendations, not just audits. Findings conform to
  `schema/finding.schema.json`.
