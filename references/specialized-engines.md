# Specialized engines (vector, time-series, graph, search) — 2026

These power module M20 (specialized-fit). The recurring principle: a specialized workload bolted onto the
wrong engine is slow *and* fragile, but reaching for a specialized engine prematurely adds an operational
store you don't need. Postgres extensions (pgvector, TimescaleDB) often defer that cost — recommend them as
the boring default before a dedicated store.

## Vector / similarity search (M20a)

### The non-negotiables
- **Distance metric must match how the embeddings were trained.** Cosine for normalized text embeddings
  (most OpenAI/Cohere/open models), inner-product or L2 only when the model expects it. A metric mismatch
  silently returns wrong neighbors — severity-5 **only when the embedding model is declared in-repo** so the
  expected metric is knowable; otherwise directional + `needs_api`.
- **Dimensions must equal the model's output** (e.g. a 1536-dim column for a 1536-dim model). A mismatch is
  a hard, statically detectable defect.
- **Version the model.** Embeddings from different models/versions are not comparable; store a
  `model_version` so you can re-embed on upgrade. Missing version tracking is a Design warn (Modelo-version).

### Index choice — pgvector and dedicated stores
- **HNSW**: high recall, fast queries, higher build time/memory, supports incremental inserts — the default
  for most read-heavy workloads. Tune `m` and `ef_construction` (build), `ef_search` (query recall↔latency).
- **IVFFlat**: lower memory and faster build, but recall depends on `lists`/`probes` and it must be built
  *after* representative data exists (building on an empty/tiny table gives poor recall). Better for very
  large, write-once corpora where memory is tight.
- **Filtered search**: combining a metadata `WHERE` with vector search needs care — pre-filter vs post-filter
  changes recall. In pgvector, pair a normal index on the filter column; in Qdrant, use payload indexes.
  Filtered-search correctness is a scored Performance category.
- **Qdrant / dedicated stores** earn their keep at large scale, heavy metadata filtering, or when you want
  managed sharding/quantization. Below that, **pgvector keeps vectors next to your relational data** (no
  sync, transactional consistency) — prefer it unless scale or features force the move.
- Recall vs latency is a real trade-off — state it as a band, never a fabricated recall percentage.

## Time-series & OLAP (M20b)

- **TimescaleDB** (Postgres extension): turn the table into a **hypertable** partitioned by time (chunks).
  Add **continuous aggregates** (incrementally-maintained rollups) instead of recomputing, **compression**
  on older chunks, and **retention policies** to drop aged data. Modeling a high-ingest time-series as a
  plain Postgres table with no partitioning is the anti-pattern Hypertable-fit detects.
- **ClickHouse**: columnar, append-mostly analytical/OLAP at very high scale; pick the right `ORDER BY`
  (sort key) and partitioning, and accept eventual/merge semantics and weak single-row update/delete. Wrong
  for transactional OLTP.
- **InfluxDB**: purpose-built TS/metrics; tag cardinality is the dominant cost — high-cardinality tags
  (e.g. user-id as a tag) blow up the index. Flag unbounded tag cardinality.
- Tags/keys, precision and timezone of the timestamp (UTC, correct resolution) feed Design; chunk/retention,
  continuous-agg, and compression feed Performance.

## Graph (M20c)

- **Neo4j / property graph**: use when the *queries are traversals* — variable-depth relationships,
  shortest-path, recommendation, fraud rings. If your "graph" queries are really 1–2 fixed joins, a
  relational schema with indexed FKs is simpler and faster — don't adopt a graph DB for that.
- Model relationships as first-class **edges with types and properties**; index the node properties you look
  up to *start* a traversal (Índice-lookup). 
- **Supernodes** (a node with millions of edges — a celebrity, a "everyone follows" account) make traversals
  explode; detect and mitigate (edge partitioning, relationship-type fan-out). Supernode handling is a scored
  Performance category.

## Search (M20d)

- **Elasticsearch / OpenSearch**: full-text relevance, faceting, analyzers, fuzzy/typo tolerance at scale.
  For modest needs, **Postgres FTS** (`tsvector` + GIN) or a managed search add-on avoids running a second
  cluster — recommend it first.
- A search index is a **derived projection**, not the source of truth: design the sync (CDC / dual-write
  with reconciliation) and accept eventual consistency. Treating the search cluster as primary is the
  anti-pattern.
- Get the **analyzer/mapping** right up front (language analyzer, keyword vs text, n-grams for autocomplete);
  mappings are painful to change after indexing — usually a reindex.

## Honesty
Never invent recall, ingest-rate, latency, or cardinality numbers. Metric/dimension mismatch is the one
statically-establishable hard defect; performance and scale claims are directional or `needs_api` until
measured. Findings conform to `schema/finding.schema.json`.
