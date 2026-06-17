# Anti-pattern catalog — detect statically + fix

The unified catalog behind M19 (relational + NoSQL anti-patterns). Each finding **inherits the natural
module's category** for scoring (e.g. an EAV finding scores under Modelado/M1). Every entry: how to **detect
at Tier 0** (no live DB) and the **fix**. Static detection is directional unless it's a hard, unambiguous
structural fact; live confirmation upgrades to established.

## Relational anti-patterns

| Anti-pattern | Detect statically | Fix | Scores as |
|---|---|---|---|
| **No primary key** | table DDL with no PK/`PRIMARY KEY` | add surrogate `bigint`/UUIDv7 PK | M2 (sev5) |
| **EAV** (entity-attribute-value) | a table like `(entity_id, attribute, value)` modeling real columns | promote attributes to typed columns; `jsonb` only if truly sparse | M1 |
| **Comma-separated values in a column** | `varchar`/`text` column named `tags`, `ids`, `roles` holding lists | junction table (M:N) or native array with GIN | M1 |
| **Float money** | `float`/`double`/`real`/`money` (MySQL) for amounts | `numeric(p,s)` / `Decimal128` | M4 (sev5) |
| **Naive timestamp** | `timestamp` (no tz) on event/audit columns | `timestamptz`, store UTC | M4 |
| **Missing FK** on a `*_id` column | column ending `_id` with no matching FK constraint | add FK with explicit `ON DELETE` | M3 (sev5 if financial/auth) |
| **Unindexed FK** | FK constraint with no index on the referencing column | `CREATE INDEX` on the FK column | M11 |
| **JSONB as schema evasion** | `jsonb` column whose keys are queried/filtered as if columns | extract queried keys to typed columns + constraints | M4 |
| **Over-nullable UNIQUE** | `UNIQUE(col)` on a nullable column meant to be unique | partial unique index / `NULLS NOT DISTINCT` | M5 |
| **God table** | a table with very many columns mixing unrelated concerns | split by concern / 1:1 extension tables | M1 |
| **Implicit/no `ON DELETE`** | FK without an explicit action where children outlive parents | choose `RESTRICT`/`SET NULL`/`CASCADE` deliberately | M3 |
| **Polymorphic association** (`*_type` + `*_id`) | columns like `commentable_type`/`commentable_id`, no FK possible | separate FK columns or supertype table | M3 |
| **`SELECT *` in app/views** | `SELECT *` in migrations/views/ORM raw | name columns; enables covering indexes | M13 |
| **Deep OFFSET pagination** | `OFFSET <large>` / `LIMIT … OFFSET` in queries | keyset/seek pagination | M13 |
| **Non-SARGable predicate** | `WHERE fn(col)=` / leading-wildcard `LIKE '%x'` | expression index or rewrite | M13 |
| **RLS off on tenant table** | tenant table, no `ENABLE ROW LEVEL SECURITY` | enable RLS + policies | M10 (sev5, PG) |
| **Plaintext secret in schema** | literal password/key/token in DDL/seed/migration | move to env/secrets manager; redact | M10 (sev5) |
| **Raw concatenated SQL** | string-built SQL with interpolated input | parameterize | M10 (sev5) |

## NoSQL anti-patterns

| Anti-pattern | Detect statically | Fix | Scores as |
|---|---|---|---|
| **Relational schema in JSON** | document model = entities + manual "foreign key" fields, designed without access patterns | re-model around the queries; embed/reference per pattern | M1 |
| **Unbounded embedded array** | array field fed by user events (comments/likes/log) with no cap | reference a child collection, or bucket pattern | M1 (doc-growth) |
| **No schema validator** | Mongoose/collection with free-form writes, no `$jsonSchema` | add a JSON Schema validator | M5 |
| **Float money in document** | `double`/`Number` for amounts in Mongoose/docs | `Decimal128` | M4 (sev5) |
| **Hot/monotonic shard or partition key** | shard/partition key = timestamp / ObjectId / autoincrement | high-cardinality, well-distributed key | M16 (perf) |
| **Low-cardinality partition key** | partition key with few distinct values | composite/synthetic key for spread | M16 |
| **Missing TTL on ephemeral KV** | session/cache/rate-limit keys with no expiry | set TTL / eviction policy | M8/M18 (KV) |
| **Non-idempotent retried write** | money/order write path with no dedup/conditional write | idempotency key / conditional put / upsert | M14 |
| **Unbounded wide row** | Cassandra partition that grows per event without bound | bucket the partition key by time/size | M16 (sev5, perf) |
| **Delete-heavy Cassandra / queue on C\*** | frequent deletes/TTL on a Cassandra table read often | re-model; tombstones kill reads | M18 |
| **Search/replica as source of truth** | app writes primarily to ES/MV and treats it as canonical | designate the OLTP store canonical; sync derived | M17 |

## Usage
M19 is the unified entry point; it routes each match to its natural module so scoring isn't double-counted.
Static matches are **directional**; a `directional` parse (ORM program source) **never raises a sev-5 cap**.
Findings emit per `schema/finding.schema.json` with verbatim `evidence.observed` and a runnable
`verification.reproduce`.
