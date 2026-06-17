---
name: design
description: Greenfield database design — pick the right engine for a new project, compare it against the boring default, and hand back a starter data model with a diagram. Recommendation mode (module M0); never scored, never destructive. Use when the user is starting fresh and asks what database to use, how to model a new app, which engine fits, or for a schema/data-model from scratch.
argument-hint: "<one-line description of what you're building> [--paradigm-hint relational|document|...] [--scale small|medium|large] [--emit prisma|drizzle|sql]"
allowed-tools: Read, Grep, Glob, Bash, Task
---

# /claude-db:design

Greenfield engine choice + starter model. This is **module M0 (engine-selection): a recommendation, not a score** — `/claude-db:design` never produces the two audit scores and never writes to a database.

`$ARGUMENTS` = a plain-language description of the project (the data, the access patterns, the scale, any constraints). If it's too thin to choose well, ask 2–3 sharp questions first — or hand off to `/claude-db:start` for the full guided wizard.

## What to do
1. **Walk the M0 decision tree** (`references/engine-selection-tree.md`; see also `references/detection-signals.md` and `data-tiers.md` for the paradigm signals): from the access patterns and shape of the data, narrow to a paradigm (relational / document / key-value / wide-column / vector / time-series / graph), then to a concrete engine.
2. **Recommend an engine** — and always **compare it against the boring default** (Postgres for most app workloads). State plainly when the boring default wins (it usually does) and what specific, concrete need would justify reaching for something else. Be honest about lock-in and operational cost; **never fabricate prices, latency, throughput, or benchmark numbers** — describe trade-offs qualitatively or mark `needs_api` if a real figure is required.
3. **Hand back a starter data model** for the recommended engine — core entities, keys (UUIDv7/ULID/bigint as appropriate, never floats for money, timestamptz/UTC), the obvious relationships/embeddings, and the constraints/indexes a sane first migration would include.
4. **Draw a paradigm-aware diagram** with `node scripts/gen-diagram.mjs --file <schema> [--paradigm relational|document|key-value|wide-column|graph]` (paradigm-aware: ERD for relational, access-pattern map for document, key+GSI sketch for DynamoDB/KV, node/edge for graph).

## Format — novice-first, with an expandable technical layer
- Lead with a **plain, novice-friendly explanation**: which database, in one sentence, and why — no jargon up front.
- Then an **expandable technical layer**: the DDL/collection spec, index choices, key strategy, and the design-rule rationale (which audit modules each choice satisfies, e.g. M2 keys, M4 types, M11 indexing) for the reader who wants depth.
- Close by offering: "When you have a first schema, run `/claude-db:audit` to score it on Design & Integrity and Performance & Scale."

## `--emit <prisma|drizzle|sql>` — scaffold a first migration
After recommending the model (the steps above still run first; `--emit` never replaces the recommendation), scaffold a **reversible first migration** for the chosen target:
- Generate the schema in the requested format — a Prisma schema, a Drizzle schema, or raw SQL DDL — for the recommended starter model.
- Hand the scaffold to the **db-migration-writer** agent (via Task) to write it as a reversible migration (forward + down). The writer reuses `fix`'s guards: refuse on a dirty git tree (treat **no git repo** as writable, backups still go to the plugin data dir), **dry-run preview by default**, and **no-secrets** (never write `.env`/credentials/invented connection strings).
- For **`--emit sql`** specifically, also offer `/claude-db:seed` to generate FK-aware seed data for the new schema.

Respond in the user's language (EN/ES).
