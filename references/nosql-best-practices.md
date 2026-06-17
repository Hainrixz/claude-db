# NoSQL best practices (access-pattern-driven, 2026)

The defining shift from relational: **you model the data around the queries, not the entities.** List the
access patterns first; the schema falls out of them. A NoSQL schema that was designed entity-first (a
"relational schema in JSON") is the root anti-pattern these modules detect.

## Document (MongoDB / Firestore) — M1, M4, M5, M11, M16

### Embed vs reference (the core decision)
- **Embed** when the child is read with the parent, owned by it, and bounded in size/growth: order line
  items, address on a user, a post's small tag list. One read, no join.
- **Reference** when the child is shared across parents, queried independently, unbounded, or updated on a
  different cadence than the parent: a user referenced by many orders, comments that grow without limit.
- **Unbounded embedded arrays are the signature document defect** — an array that grows per event (likes,
  comments, audit log) drives the document toward the **16 MB BSON limit** and rewrites the whole document
  on every push. Detect statically: an array field with no cap fed by user actions. Fix: reference + a
  separate collection, or the **bucket/outlier pattern** (cap N per bucket document).

### Schema discipline without a DBA
- A schema-less store still needs a schema in your head. Use **JSON Schema validators** (`$jsonSchema`) on
  the collection — Validación-schema is a scored Design category. No validator + free-form writes = warn.
- **Money is `Decimal128`, never `double`** — float money is severity-5 in document stores too.
- Store dates as native `Date` (UTC), not strings. Don't bury queried/filtered fields inside deep nested
  objects that no index covers.

### Indexing & shard key (M11, shard-key, doc-growth)
- Index every field you filter/sort on; compound indexes follow an ESR-style order. Unindexed query =
  collection scan (confirm with `$indexStats`/`explain` at Tier 1).
- **Shard key is close to irreversible** — choose for even write distribution AND query routing. A
  monotonically increasing shard key (timestamp, ObjectId) creates a **hot shard**. Low-cardinality keys
  create jumbo chunks. This is the highest-leverage document scaling decision.

## Key-value (Redis, DynamoDB) — M2, M10, M14, M15, M16

### Key design is the schema
- The **key naming scheme is your data model**: `tenant:{id}:user:{id}:cart`. Consistent, prefix-based,
  collision-free. Document it.
- **TTL** on anything ephemeral (sessions, caches, rate-limit counters) — a KV store with no eviction
  policy and no TTLs leaks memory. TTL is a scored Design category for KV.
- Redis as the **primary durable store** is risky unless AOF/persistence + replication are configured and
  understood — severity escalates only with live evidence; otherwise directional.

### DynamoDB single-table design
- The advanced default: **one table, generic `PK`/`SK`, overloaded attributes**, item types distinguished
  by key prefixes; access patterns served by the base table + **GSIs** (one GSI per new query shape).
- Choose the **partition key for even distribution** under load; a low-cardinality or monotonic PK creates
  a hot partition (throttling). Adaptive capacity softens but does not cure this.
- Model the access patterns *before* the keys — list every query, then design PK/SK/GSI to serve each in
  one request. Multi-table relational thinking on DynamoDB is the anti-pattern.

### Idempotency (M14 — scored for KV/doc/wide-column)
- Writes get retried (at-least-once delivery, client retries). Make them **idempotent**: a dedup/idempotency
  key, conditional writes (`attribute_not_exists`), or upserts. Missing idempotency on a money/order path is
  a real defect — a scored category for these paradigms, not an afterthought.

## Wide-column (Cassandra / ScyllaDB) — M9 (tables-per-query), partition sizing

- **One table per query.** Denormalize aggressively; duplicate data across tables, each modeled for one
  read. There are no joins.
- The **partition key** controls distribution; clustering columns control on-disk order within a partition.
  Design so partitions stay bounded (rule of thumb: not millions of rows / not hundreds of MB per
  partition) — **unbounded wide rows on an event table are severity-5** (perf).
- **Tombstones**: deletes and TTL expirations leave tombstones that slow reads until compaction; a
  delete-heavy or queue-like access pattern on Cassandra is an anti-pattern. Idempotent writes matter here too.

## Cross-cutting honesty
- Never quote a throughput/latency/row-count number you didn't measure. Hot-partition, item-size, and
  durability claims are **directional** statically and **established** only with live stats (`$collStats`,
  CloudWatch, `nodetool tablehistograms`) — otherwise `needs_api`.
- Findings emit per `schema/finding.schema.json`; `evidence.observed` quotes the real schema/key code and
  `verification.reproduce` is runnable against the live store.
