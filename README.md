<p align="center">
  <img src="https://raw.githubusercontent.com/Hainrixz/claude-db/main/assets/hero.png" alt="claude-db — multi-paradigm database design, audit, and migration toolkit for Claude Code, with the Claude pixel mascot (an orange blocky creature) inspecting a stack of tables" width="840">
</p>

<h1 align="center">claude-db</h1>

<p align="center">
  <strong>The multi-paradigm database expert for Claude Code.</strong><br>
  Design a new schema, audit an existing one on <strong>two independent axes</strong> — <strong>Design &amp; Integrity</strong> and <strong>Performance &amp; Scale</strong> — and optionally plan the safe migration for you.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-000000.svg" alt="MIT License">
  <img src="https://img.shields.io/badge/Claude%20Code-plugin-da7756.svg" alt="Claude Code plugin">
  <img src="https://img.shields.io/badge/cross--agent-Vercel%20Skills-000000.svg" alt="Vercel Skills">
  <img src="https://img.shields.io/badge/paradigms-SQL%20%C2%B7%20doc%20%C2%B7%20KV%20%C2%B7%20vector%20%C2%B7%20TS%20%C2%B7%20graph-7c5cff.svg" alt="Multi-paradigm">
  <img src="https://img.shields.io/badge/works-offline%20(Tier%200)-2ea44f.svg" alt="Works offline">
</p>

> **Two scores, never blended.** A schema can be impeccably modeled yet collapse under load, or scream fast yet silently corrupt your data. `claude-db` measures **Design &amp; Integrity** and **Performance &amp; Scale** separately and tells you exactly what to fix on each.

🇪🇸 *Resumen en español al final · README completo en [`README.es.md`](README.es.md) · guías en [`docs/es/`](docs/es/).*

---

## Why

Most database tooling does one thing: a linter checks style, an EXPLAIN tab shows one query, an ORM hides the schema entirely. None of them sit a senior DBA next to you who can read your `schema.prisma` or live catalog, reason across **modeling, integrity, indexing, concurrency, and migration safety at once**, and weigh the trade-offs for *your* paradigm — relational, document, key-value, wide-column, vector, time-series, or graph.

`claude-db` is that reviewer. It is honest by construction: every finding ships with observed evidence and a runnable verification command, magnitudes are **banded** (high/medium/low), and it **never fabricates** a latency number, a row count, or a price. When a check genuinely needs a live database, it says `needs_api` — never a silent pass.

Original work, MIT-licensed — *inspired by* the patterns of community database tooling but copying **no** branding, text, or names from any other project.

## Install

**As a Claude Code plugin (recommended):**

```text
/plugin marketplace add Hainrixz/claude-db
/plugin install claude-db@claude-db
/reload-plugins
```

**Cross-agent** (Cursor, Codex, Gemini CLI, Windsurf…) via [Vercel Skills](https://vercel.com/docs/agent-resources/skills):

```text
npx skills add Hainrixz/claude-db
```

The plugin works **fully offline** (Tier 0, no keys) against your schema/migration/ORM files or a plain-language description. See [Data tiers](#data-tiers) for opt-in live introspection.

## Usage

```text
/claude-db:start                                           # ← start here: a no-jargon wizard (no files needed)
/claude-db:design   "<what you're building>" [--scale small|medium|large]   # recommend an engine + draft a schema + diagram
/claude-db:audit    "<path|$DATABASE_URL>" [--paradigm auto|…] [--tier 0|1|2]  # two scores + prioritized findings (read-only)
/claude-db:explain  "<path|table|finding-id>" [--query "<SQL>"]             # plain-language explainer / why-is-this-slow
/claude-db:migrate  "<migration-file>"  |  "<from-schema>" "<to-schema>"     # lint a migration, or diff two schemas → migration
/claude-db:fix      "<path>" [--category keys|indexing|constraints|migration|…] [--dry-run]   # opt-in, per-change confirm
/claude-db:next     "[findings.json]"                      # coach: the single highest-leverage fix, ranked
/claude-db:score    "[findings.json]" [--paradigm …]       # recompute the two scores
/claude-db:seed     "<path>" [--rows N]                    # generate FK-aware sample/seed data for a schema
/claude-db:checklist "<path|$DATABASE_URL>"                # production-readiness go/no-go grid
```

`audit`, `explain`, `score`, `next`, and `checklist` are **read-only** and never touch your files or write to your database. `fix` previews diffs by default and writes only after you confirm each change; destructive migrations require typing the object name back. First time? Run **`/claude-db:start`** — it asks 7 plain questions and recommends what to build. Power users can call any module directly, e.g. `/claude-db:db-indexing`.

## Two scores, never blended

<p align="center">
  <img src="https://raw.githubusercontent.com/Hainrixz/claude-db/main/assets/dual-score.png" alt="Two pixel-art scoreboards — DESIGN & INTEGRITY and PERFORMANCE & SCALE — with the Claude mascot between them" width="720">
</p>

Every audit reports two **0–100** scores with letter bands (A–F) and a one-line interpretation ([details](references/scoring-model.md)):

- **Design &amp; Integrity** — modeling, keys, referential integrity, types/precision, constraints, naming, security/access, temporal/lifecycle.
- **Performance &amp; Scale** — indexing, index hygiene, query patterns, concurrency, pooling, partitioning/replicas, storage/operability, migration safety.

A finding declares its `axis` (`design` | `performance` | `both`) and feeds the category that owns its module **in each axis independently** — no double counting, no averaging. **Severity gating** caps a score at **F** if a `severity:5` failure lands on that axis (e.g. a table with no primary key, RLS off on PII, TXID-wraparound risk). The detected **paradigm** swaps the category weights, so a document store is never penalized for lacking foreign keys, and `needs_api` checks are excluded from the math and counted separately as score confidence.

## How it works

A skill-first, three-layer design (Claude is the runtime; the Node/Python helpers are optional):

1. **Directive** — one of the command skills (`start`/`design`/`audit`/`explain`/`migrate`/`fix`/`next`/`score`/`seed`/`checklist`).
2. **Orchestration** — `db-orchestrator` detects the stack and paradigm, builds a shared schema snapshot, and dispatches read-only specialist auditors **in parallel**, then merges findings and runs `score.mjs`.
3. **Execution** — focused `db-*` modules (M0–M22) each emit findings conforming to [`schema/finding.schema.json`](schema/finding.schema.json) — with observed evidence and a runnable `verification.reproduce`. See [`docs/en/architecture.md`](docs/en/architecture.md).

## What it audits

A complete suite of 23 modules (M0 advisory; M1–M22 scored), each feeding the **design**, **performance**, or **both** axis:

| Module | M | Axis | Checks |
|---|---|---|---|
| `db-engine-selection` | M0 | — | engine/paradigm recommendation for a new project (advisory, not scored) |
| `db-normalization` | M1 | design | 1NF–3NF, deliberate denormalization |
| `db-keys` | M2 | both | PK strategy (UUIDv7/ULID/bigint), no-PK (sev5), int4 exhaustion |
| `db-referential-integrity` | M3 | both | FKs, `ON DELETE`, cycles (sev4), composite FKs |
| `db-types-precision` | M4 | design | money=numeric/Decimal (float=sev5), timestamptz/UTC, jsonb-as-schema-evasion, enum vs lookup, utf8mb4 |
| `db-constraints` | M5 | design | `NOT NULL`, `CHECK`, `UNIQUE` (incl. over-nullable trap) |
| `db-defaults-generated` | M6 | design | defaults, generated/computed columns |
| `db-naming` | M7 | design | naming consistency & conventions |
| `db-temporal-history` | M8 | design | soft-delete, audit trail, retention / GDPR erasure |
| `db-multitenancy` | M9 | both | tenant isolation, `tenant_id`-leading index |
| `db-security-access` | M10 | design | RLS off (sev5), PII, encryption at-rest/TLS (`sslmode=disable` sev4), injection |
| `db-indexing` | M11 | perf | composite ESR, covering/partial, GIN/GiST/BRIN, FK-no-index, FTS/geo/JSONB |
| `db-index-hygiene` | M12 | perf | duplicate / redundant / unused indexes |
| `db-query-patterns` | M13 | perf | `SELECT *`, structural N+1, OFFSET vs keyset, non-SARGable |
| `db-concurrency` | M14 | perf | isolation, lost-update, `SKIP LOCKED`, idempotency |
| `db-connection-pooling` | M15 | perf | serverless + direct-PG, transaction-mode pooler |
| `db-partitioning-sharding` | M16 | perf | declarative partitioning, hot-partition, premature sharding |
| `db-replicas-views` | M17 | perf | read-your-writes, materialized-view refresh |
| `db-storage-bloat` | M18 | perf | VACUUM, TXID wraparound (sev5), tombstones |
| `db-antipatterns` | M19 | both | unified anti-pattern catalog (inherits the natural module's category) |
| `db-specialized-fit` | M20 | both | vector (dims/metric/HNSW), time-series/OLAP, graph, search |
| `db-platform-fit` | M21 | both | version currency (no fabricated EOL), pricing/lock-in honesty, per-platform FK support |
| `db-migration-safety` | M22 | perf | reversibility, lock level, table rewrite, destructive ops, enum mutation, schema drift |

## Paradigm coverage

`claude-db` detects the paradigm from your stack and swaps the scoring profile so each axis still sums to 100 with only the categories that apply ([weights](references/scoring-model.md)):

- **Relational** (Postgres, MySQL, SQLite, SQL Server) — the base profile.
- **Document** (MongoDB, Firestore) — access-pattern & embedding, doc-growth / 16MB, shard key.
- **Key-value** (Redis, DynamoDB) — access-pattern & key, idempotency, hot-partition, throughput.
- **Wide-column** (Cassandra, ScyllaDB) — table-per-query, partition sizing, tombstones.
- **Vector** (pgvector, Pinecone, Qdrant) — metric & dimension, index params, filtered search, recall-vs-latency.
- **Time-series** (TimescaleDB, ClickHouse) — hypertable fit, retention, continuous aggregates, compression.
- **Graph** (Neo4j) — edge modeling, traversal, supernode, index-lookup.

When more than one datastore is detected, each top-level score is the **worst-of across stores per axis**, with the per-store breakdown rendered beneath and the flooring store named.

## Data tiers

| Tier | Needs | Adds |
|---|---|---|
| **0** (default) | nothing | full offline audit of schema/migration/ORM files or a plain-language description |
| **1** | a read-only `$DATABASE_URL` or a database MCP | live catalog introspection — real index inventory, FK-without-index, RLS state, engine version |
| **2** | runtime stats (`pg_stat_statements`, `pg_stat_user_*`, `EXPLAIN ANALYZE`) | real plans, genuinely unused indexes, dead tuples, wraparound age, hot partitions |

Tier 0 produces `established`/`directional` findings from generated artifacts and best-effort findings (capped at `directional`) from program source. Higher tiers upgrade affected findings to `established`. The Tier-1 connection is **read-only by contract** (`default_transaction_read_only=on`, `statement_timeout`, only `SELECT`/`EXPLAIN`/catalog reads), backed by a `PreToolUse` hook. See [`references/data-tiers.md`](references/data-tiers.md).

## Honesty guardrails

This tool refuses to ship database folklore:

- **No fabricated numbers** — never invents latency, throughput, row counts, table sizes, EOL dates, or prices, in findings *or* design recommendations. Magnitude is banded **high / medium / low** only.
- **`needs_api`, never a silent pass** — a check that needs a live DB it doesn't have says so, and is excluded from the score and counted as confidence.
- **Confidence tiers** on every finding — `established` (durable fact or Tier-1/2-backed — can cap a score), `directional` (strong static signal), `speculative` (inference without live data — **never caps**, never a naked percentage).
- **Read-only by default** — auditors are read-only by tool allowlist; only the one writer subagent (`db-migration-writer`) can write, only via `/claude-db:fix`, and only after you confirm each diff.
- **Paradigm-fair** — relational-only categories are dropped from NoSQL profiles, so a document/KV/graph store is never penalized for a relational concept it doesn't have.

## The opt-in fixer

The fixer ([`skills/fix`](skills/fix/SKILL.md)) is `disable-model-invocation: true` — Claude can **never** trigger writes on its own. Only `/claude-db:fix` does, and only `db-migration-writer` has Write/Edit. It generates **reversible, lock-aware** migration files (concurrent index builds, `NOT VALID` + `VALIDATE` constraint splits, expand/contract column changes), previews a unified diff, refuses a dirty git tree, and never writes to `.git`, secrets, or lockfiles. Destructive operations (drops, type rewrites, enum mutations) are surfaced as advisory and never auto-applied.

## Project structure

```text
.claude-plugin/   plugin.json + marketplace.json
skills/           10 command skills (start, design, audit, explain, migrate, fix, next, score, seed, checklist) + 3 orchestration (db-orchestrator, stack-detect, introspect)
                  + audit modules M0–M22 (db-*)
agents/           read-only auditors + 1 writer (db-migration-writer)
hooks/            PreToolUse write/read-only guard
scripts/          zero-dep helpers: detect-stack, parse-schema (.mjs), parse-orm-python.py, score.mjs, lib/util.mjs
references/        scoring model, detection signals, data tiers
schema/           finding + audit-report JSON Schemas
docs/en, docs/es  bilingual guides
tests/fixtures    sample schemas for verification
```

## Optional scripts

The skills work as pure Markdown; the zero-dependency helpers in [`scripts/`](scripts/) sharpen accuracy and make `verification.reproduce` runnable (Node ≥ 18, Python 3.10+, no install step):

```bash
node scripts/detect-stack.mjs   --path .
node scripts/parse-schema.mjs   --file schema.sql
python scripts/parse-orm-python.py --file models.py
node scripts/score.mjs          --findings findings.json
node tests/run.mjs              # self-test over the fixtures
```

## About

Built by **Enrique Rocha** — I help teams ship data infrastructure and AI: consulting, automations, and agents. This is a community, MIT-licensed project: use it, fork it, open issues and PRs (see [`CONTRIBUTING.md`](CONTRIBUTING.md)).

- 🌐 **[tododeia.com](https://tododeia.com)**
- 📸 Instagram **[@soyenriquerocha](https://instagram.com/soyenriquerocha)**

## License

[MIT](LICENSE) · *Claude mascot artwork generated for this project in pixel-art style.*

---

## 🇪🇸 Resumen (Español)

`claude-db` es la herramienta open-source de **diseño, auditoría y migración de bases de datos** para Claude Code. Audita cualquier base en **dos puntajes independientes** — **Diseño e Integridad** y **Rendimiento y Escala** — con hallazgos reproducibles, y opcionalmente **planifica la migración segura** por ti (reversible, consciente del nivel de bloqueo), siempre con confirmación previa.

- **Instalar:** `/plugin marketplace add Hainrixz/claude-db` → `/plugin install claude-db@claude-db`. Cross-agente: `npx skills add Hainrixz/claude-db`.
- **Usar:** `/claude-db:start` · `:design` · `:audit` · `:explain` · `:migrate` · `:fix` · `:next` · `:score` · `:seed` · `:checklist` (vista previa por defecto; nunca escribe sin tu confirmación).
- **Multi-paradigma:** relacional, documento, clave-valor, columna-ancha, vectorial, series de tiempo y grafo — el perfil de puntaje se adapta para que un store de documentos nunca se penalice por no tener llaves foráneas.
- **Honestidad:** nunca inventa latencias, conteos de filas, fechas de fin de soporte ni precios; magnitud en bandas alta/media/baja; cuando hace falta una base en vivo dice `needs_api`, nunca un aprobado silencioso.
- **Sin claves funciona** (Tier 0, offline). La introspección en vivo de solo lectura es opcional (Tier 1+).

README completo en español: [`README.es.md`](README.es.md) · guías en [`docs/es/`](docs/es/) · hecho con cariño por [tododeia.com](https://tododeia.com).
