---
name: db-engine-selection
description: Engine selection (M0) — at design/start time, recommends a database paradigm and engine for a described workload (access patterns, consistency needs, scale, team, platform), and names the runner-up with the trade-off you're accepting. M0 is a RECOMMENDATION, not a scored audit module — it emits no findings and never contributes to the Design or Performance score. Walks the decision tree in references/engine-selection-tree.md and is honest about lock-in and operability instead of fabricating benchmarks.
allowed-tools: Read, Grep, Glob, Bash, WebFetch
---

# db-engine-selection (M0) — recommend, don't score

M0 runs at **design / `/claude-db:start`** time, when there may be no schema yet — only a described
workload. It answers "which database should this be?" It is **not a scored module**: it emits **no
findings**, has no axis, no severity, and never enters `score.mjs` or either of the two scores. Its
output is a separate **recommendation contract** (below). It walks the decision tree in
`references/engine-selection-tree.md`.

## Inputs it gathers
From the user's description (or detected stack via `references/detection-signals.md`):
- **Access patterns** — point lookups by key, range scans, complex multi-entity joins, full-text /
  semantic search, time-ordered analytics, graph traversal, fan-out reads/writes.
- **Consistency & integrity needs** — strong/transactional vs eventual; multi-row invariants; need for
  DB-enforced referential integrity.
- **Scale & shape** — expected size, write rate, read/write ratio, cardinality, whether data is
  append-only/time-series, vector/embedding workloads.
- **Operability & team** — managed vs self-hosted, serverless/edge, existing expertise, platform
  constraints (cross-checks `db-platform-fit` M21).

## How it decides (tree summary; full tree in the reference)
1. Relational by default for transactional, multi-entity, integrity-heavy workloads (Postgres as the
   safe default; MySQL/MariaDB where the ecosystem dictates).
2. Document (Mongo/Firestore) when the data is aggregate-oriented, read by one access pattern, and
   embedding beats joining — and the team accepts app-enforced integrity.
3. Key-value (Redis/DynamoDB) for known-key point access, caching, sessions, high-throughput simple ops.
4. Wide-column (Cassandra/Scylla) for massive write-heavy, table-per-query, partition-first workloads.
5. Vector (pgvector/Qdrant/etc.) for semantic search / RAG — often *alongside* a primary store, not
   instead of one.
6. Time-series (Timescale/ClickHouse/Influx) for append-only metrics/events with time-range analytics.
7. Graph (Neo4j) when traversal depth/relationship queries are the core workload, not an afterthought.
Polyglot is a valid answer: name each store and its job. Prefer "Postgres + an extension" (pgvector,
JSONB, partitioning, FTS) before adding a second engine, when one engine credibly covers the workload.

## Recommendation contract (what M0 emits — NOT a finding)
A structured recommendation object, rendered by `/claude-db:start`, with fields:
- `recommended` — `{ paradigm, engine, platform? }`.
- `rationale` — which access patterns / consistency / scale facts drove it, tied to the tree branch.
- `runner_up` — `{ paradigm, engine }` and the **explicit trade-off** of choosing the recommendation
  over it (what you give up).
- `assumptions` — the workload facts assumed; if a fact is unknown, it is listed here, not invented.
- `confidence` — `established | directional | speculative` (a description-only input is at most
  `directional`); `speculative` when key facts are missing.
- `caveats` — lock-in, operability, and platform notes (defers exact prices/limits to M21 / vendor page).
This object is rendered as guidance; it does **not** conform to `schema/finding.schema.json` and is
absent from `audit-report.schema.json`.

## Verification / honesty
- **Never fabricate benchmarks, latency, throughput, prices, or row-count ceilings** to justify a pick.
  Compare on documented properties (consistency model, FK support, index types, operability, lock-in)
  and band any magnitude high|medium|low. Cite a vendor page via `WebFetch` only by quoting it.
- Always name the **runner-up and the trade-off** — a recommendation without an alternative is a red flag.
- If the workload is under-specified, say so and ask (or mark `confidence: speculative`); do not force a
  pick from thin air.
- M0 produces no score and **never caps** anything — it is advisory by construction. When an existing
  schema is present, defer correctness judgments to the scored modules (M1..M22) and the auditors.
