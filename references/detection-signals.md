# Stack detection signals

`stack-detect` (via `scripts/detect-stack.mjs`) classifies a project into one or more
`{paradigm, engine, orm, platform, source_of_truth, confidence}` stacks. It never guesses an engine:
when nothing matches it returns an empty list and routes to `/claude-db:start` or description mode.

## Signals by stack

| Stack | Files / markers | Parse from | Confidence |
|---|---|---|---|
| Prisma | `prisma/schema.prisma`, `provider = "…"` | `schema.prisma` (declarative) | established |
| Drizzle | `drizzle.config.*`, `drizzle/meta/*_snapshot.json` | the **snapshot JSON** (generated) | established; `.ts` source → directional |
| Rails | `db/schema.rb`, `db/structure.sql` | `schema.rb` / `structure.sql` (generated) | established |
| Django | `models.py` + `manage.py` / `migrations/NNNN_*.py` | `migrations/` (preferred) or `models.py` via `ast` | directional |
| SQLAlchemy / Alembic | `alembic.ini`, `alembic/versions/*.py` | migration SQL / `ast` | directional |
| Mongoose | `require('mongoose')` / `from 'mongoose'` | `new Schema({…})` (best-effort) | directional |
| Raw SQL | `*.sql`, migration dirs (Flyway/Liquibase/dbmate/knex) | `CREATE TABLE` DDL | established |
| DynamoDB | `@aws-sdk/client-dynamodb`, CDK `new dynamodb.Table(...)` | CDK source (best-effort) | directional |
| Supabase | `supabase/` dir, `@supabase/supabase-js` | underlying Postgres | established (host) |
| Cloudflare D1 | `wrangler.toml` with `[[d1_databases]]` | migration SQL | directional |
| Platform deps | `package.json`: `pg`, `mysql2`, `mongodb`, `ioredis`, `@planetscale/database`, `@neondatabase/serverless`, `@libsql/client`, `pgvector`, `cassandra-driver`, `neo4j-driver` | — | directional |

## Engine → paradigm

`postgres/mysql/mariadb/sqlite/cockroachdb/yugabyte/planetscale/supabase/neon/turso/d1` → **relational** ·
`mongodb/firestore` → **document** · `redis/dynamodb` → **key-value** · `cassandra/scylla` →
**wide-column** · `pgvector/qdrant/pinecone/weaviate` → **vector** · `timescaledb/influxdb/clickhouse`
→ **time-series** · `neo4j` → **graph**.

## `source_of_truth` precedence

When several sources describe the same database, authority is, in order:

1. **Live Tier-1 introspection** (the running database) — beats any file.
2. **Declarative / generated artifact** — `schema.prisma`, Drizzle `*_snapshot.json`, `structure.sql`,
   `schema.rb`, generated migration SQL. Reliable to parse → `established`.
3. **Migration SQL** over **ORM program source**.
4. **ORM program source** (`schema.ts`, `models.py`, Mongoose/CDK) — best-effort → `directional`.

`detect-stack.mjs` records which source was authoritative. When a declarative artifact and ORM source
coexist and disagree (schema drift), `db-migration-safety` (M22) emits a directional warn.

## Parse reliability

`parse-schema.mjs` parses SQL DDL, Prisma, Drizzle snapshot JSON, and Rails `schema.rb` reliably
(`established`). Program source (Drizzle `.ts`, Mongoose `.js`, CDK `.ts`) is heuristic
(`directional`): fields built by spreads, helpers, loops, or inheritance are invisible to a static
parse, so a `directional` model **never raises a severity-5 cap** — it nudges the user toward a
generated artifact or Tier-1. `parse-orm-python.py` uses stdlib `ast` for Django/SQLAlchemy.
