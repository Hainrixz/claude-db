# Engine selection tree — the decision framework (M0)

Powers `/claude-db:design` and `/claude-db:start`. Turns a non-expert's plain answers (from
`design-wizard.md`) into a **recommended engine + the boring default + when to deviate**. M0 is a
*recommendation*, never scored. **No fabricated benchmarks** — recommendations are qualitative, with the
trade-off named honestly.

## The prime directive
**The boring default is managed Postgres.** It handles relational, JSON (`jsonb`), vector (pgvector),
time-series (TimescaleDB), full-text (FTS + GIN), and geo (PostGIS) — one store, low lock-in, huge talent
pool. Recommend deviating only when an answer below names a real reason. "We might need scale later" is not
a reason; design for the load you can see and keep the door open.

## Inputs (from the wizard → `{paradigm, scale, mode}`)
The wizard yields a paradigm hint, a scale band, and a mode (`design` new vs `audit` existing). The tree
consumes those plus the shape of the data and the dominant access pattern.

## Decision flow

1. **Is the data mostly relationships/transactions with shared entities you'll query many ways?**
   → **Relational / Postgres.** This is most apps. Stop here unless a later branch fires.

2. **Is the dominant operation deep, variable-depth traversal** (friend-of-friend, shortest path, fraud
   rings, recommendations *as graph walks*)? → consider a **graph DB (Neo4j)**. If the "graph" is really 1–2
   fixed joins, stay relational with indexed FKs.

3. **Is it high-rate timestamped measurements** (metrics, IoT, events) with time-window queries and
   retention? → **TimescaleDB on Postgres** first; **ClickHouse** for very large analytical/OLAP scale;
   **InfluxDB** for pure metrics (watch tag cardinality).

4. **Is it similarity search over embeddings** (semantic search, RAG, recommendations by vector)?
   → **pgvector on Postgres** first (vectors next to your data, transactional); a **dedicated vector store
   (Qdrant)** only at large scale or heavy metadata filtering.

5. **Is it rich full-text relevance / faceted search at scale** (typo tolerance, analyzers, ranking)?
   → Postgres FTS first; **Elasticsearch/OpenSearch** when relevance/scale demands it — as a *derived*
   index, not the source of truth.

6. **Is the access pattern a known, fixed set of key lookups at very high scale, AWS-native**, and you'll
   design keys/GSIs up front? → **DynamoDB**. Unknown/ad-hoc access patterns → not DynamoDB.

7. **Is it ephemeral, ultra-low-latency state** (sessions, caches, rate limits, queues, leaderboards)?
   → **Redis** — as a *cache/ephemeral layer*, not the durable system of record (unless persistence is
   configured and accepted).

8. **Is it flexible, deeply-nested documents owned-and-read-together, with realtime/mobile-offline needs?**
   → **MongoDB**, or **Firestore** when you want managed realtime + offline for a mobile/web app (accept the
   lock-in). But first ask whether `jsonb` in Postgres covers it — it usually does.

9. **Do you genuinely need multi-region writes with strong consistency / horizontal SQL scale?**
   → **CockroachDB** (or Vitess/PlanetScale for MySQL-at-scale). Not for single-region apps.

## Platform overlay (where to run the chosen engine)
Once the engine is chosen, route hosting via `platforms-2026.md`: Supabase/Neon for Postgres, PlanetScale
for MySQL-at-scale, Turso/D1 for edge-SQLite, managed DynamoDB/Firestore for those. Surface lock-in honestly.

## "Not sure" / mixed answers
- Conflicting or vague answers → recommend **Postgres** and explain it keeps every door open (JSON, vector,
  TS, FTS all in-engine), so a later specialization is additive, not a rewrite.
- Polyglot is allowed but has a cost: each extra store is sync + ops + consistency surface. Recommend the
  fewest stores that serve the patterns; default to Postgres + (optionally) Redis cache.

## Output of M0
A short recommendation: **primary engine + why + the honest trade-off + the deviation trigger** (what would
change the call). Never a benchmark number. Feeds the design report's plain-language layer
(`render-contract.md`).
