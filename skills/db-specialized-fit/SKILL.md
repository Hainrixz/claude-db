---
name: db-specialized-fit
description: Specialized-engine fitness (M20) — checks whether a vector, time-series/OLAP, graph, or search store is configured correctly for its job. M20a vector (dimensions match the embedding model, distance metric matches how the model was trained, HNSW/IVFFlat params present), M20b time-series/OLAP (hypertable/partition fit, continuous aggregates, compression), M20c graph (edge modeling, supernode risk, index-backed lookups), M20d search (analyzer/mapping, FTS config). Feeds the Design & Integrity AND Performance & Scale scores per sub-module.
allowed-tools: Read, Grep, Glob, Bash
---

# db-specialized-fit (M20) — vector · time-series · graph · search

M20 covers purpose-built engines whose correctness depends on parameters a generic relational audit
ignores. Sub-modules carry a letter (`M20a`..`M20d`); the scorer maps them to the parent M20 in the
paradigm profile (Vector / Time-series / Graph categories in `references/scoring-model.md`).

## M20a — Vector (pgvector, Qdrant, Pinecone, Weaviate)
*Feeds:* design (Métrica & dimensión, Modelo-version, Metadata/filtro) + performance (Índice & params,
Búsqueda filtrada, Recall-vs-latencia).
- **Dimension match** — column/collection dim equals the embedding model's output dim
  (e.g. `vector(1536)` for text-embedding-3-small). A mismatch is a hard bug (design, sev 5).
- **Distance metric match** — the index metric (cosine / L2 / inner-product) matches how the model was
  trained; a mismatch silently wrecks recall. **Sev-5 only when the model is declared in-repo**; else
  `directional` and do not cap (per scoring-model honesty rule).
- **Index present & tuned** — HNSW (`m`, `ef_construction`, `ef_search`) or IVFFlat (`lists`/`probes`)
  declared, not a brute-force seq scan on a large table (performance).
- **Model version captured** — embeddings are tied to a model version so a re-embed is possible (design).
- **Filtered search** — metadata used for pre/post-filtering is itself indexed (performance).

## M20b — Time-series / OLAP (TimescaleDB, InfluxDB, ClickHouse)
*Feeds:* design (Hypertable-fit, Retención, Precisión-ts & tz) + performance (Chunk/retención,
Continuous-agg, Compresión, Query).
- **Hypertable / partition fit** — large append-only time data is a hypertable / partitioned by time,
  with a sane chunk interval (not one giant chunk, not millions of tiny ones).
- **Continuous aggregates / rollups** declared for dashboard queries instead of scanning raw rows.
- **Compression / TTL retention** policy present for cold chunks; raw retention bounded.
- **Timestamp precision & timezone** — `timestamptz`/UTC, not naive local time (shares the M4 rule).

## M20c — Graph (Neo4j)
*Feeds:* design (Modelado-aristas, Nodos/traversal) + performance (Índice-lookup, Traversal, Supernodo).
- **Edge modeling** — relationships carry the right direction/type; relationship properties exist where
  traversals need them; no relationship modeled as a node-pair table that defeats the graph engine.
- **Index-backed lookups** — entry-point node properties used to start traversals have indexes/constraints
  (`CREATE CONSTRAINT ... IS UNIQUE`), so traversals don't begin with a full label scan.
- **Supernode risk** — a node with a very high relationship degree that will dominate traversal cost
  (performance). **Sev escalation requires live degree evidence**; else `directional`.

## M20d — Search (Elasticsearch, OpenSearch)
*Feeds:* design (mapping/analyzer correctness) + performance (query/shard layout).
- **Mapping & analyzer** — fields have explicit mappings (not relying on dynamic mapping for analyzed
  text); analyzer matches language; keyword vs text chosen deliberately.
- **No mapping explosion / unbounded dynamic fields**; shard count sane for index size.

## Tier-0 static checks
Parse declared schema/config: pgvector `vector(N)` columns + `CREATE INDEX ... USING hnsw/ivfflat`;
Qdrant/Pinecone collection config (`size`, `distance`); Timescale `create_hypertable`/`add_*_policy`;
ClickHouse `ENGINE = MergeTree ... ORDER BY`; Neo4j constraint/index DDL; ES `mappings`/`settings` JSON.
Cross-check declared embedding-model dim/metric against any model id referenced in repo code.

## Tier-1 verification query
- pgvector: `SELECT indexdef FROM pg_indexes WHERE indexdef ILIKE '%hnsw%' OR indexdef ILIKE '%ivfflat%';`
  and `\d <table>` for the `vector(N)` dim.
- Timescale: `SELECT * FROM timescaledb_information.hypertables;` and `...continuous_aggregates;`.
- Neo4j: `SHOW INDEXES;` `SHOW CONSTRAINTS;` and per-node degree for supernode (`MATCH (n) RETURN ...`).
- ES: `GET /<index>/_mapping`, `GET /<index>/_settings`. When the engine isn't reachable → `needs_api`.

## Findings
Emit per `schema/finding.schema.json`. Example ids:
- `M20a.embeddings.dim_mismatch` — `vector(768)` but model emits 1536 (fail, severity 5, axis `design`,
  confidence `established` when the model id is in-repo).
- `M20a.embeddings.metric_mismatch` — index uses L2 but model trained for cosine (fail, severity 5 only
  if model declared, else warn/directional, axis `both`).
- `M20a.embeddings.no_ann_index` — seq scan vector search (warn, severity 4, axis `performance`).
- `M20b.metrics.no_hypertable` — large time table not a hypertable (warn, severity 4, axis `both`).
- `M20c.users.unindexed_traversal_root` — traversal start property unindexed (warn, severity 3, perf).
Each finding: `evidence.observed` quotes the real DDL/collection config verbatim (secrets redacted);
`verification.reproduce` is a runnable command above using `$DATABASE_URL`; `verification.method` is
`schema_introspect`, `index_check`, `ddl_parse`, or `explain_plan`; `expected_impact` carries
`{axis, confidence, magnitude, rationale}` — banded, never a naked %.

## Honesty
- Never assert a recall number or latency for an index configuration — magnitude is banded only.
- Metric/dimension mismatch caps only when the embedding model is declared in-repo (durable fact).
  Inferred mismatches are `directional` and never cap. Supernode/hot-partition sev-5 needs live degree
  evidence; otherwise `directional` or `needs_api`, never a silent pass.
