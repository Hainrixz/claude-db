---
name: audit
description: Audit a database schema, ORM model, or migrations for design and performance — produces two independent 0-100 scores (Design & Integrity + Performance & Scale) plus a prioritized, evidence-backed report. Read-only; never writes or migrates. Use when the user asks to audit, analyze, review, check, or score a database, schema, data model, migrations, indexes, keys, referential integrity, types, constraints, query patterns, partitioning, or connection pooling — for Postgres, MySQL, Mongo, DynamoDB, Cassandra, pgvector, ClickHouse, Neo4j, and friends.
argument-hint: "<path|connection-target> [--paradigm auto|relational|document|key-value|wide-column|vector|time-series|graph] [--tier 0|1|2]"
allowed-tools: Read, Grep, Glob, Bash, Task
---

# /claude-db:audit

A full, **read-only** database audit. Never writes files, never mutates the database — even at Tier 1/2 it runs only read-only verification queries.

`$ARGUMENTS` = `<path|connection-target> [flags]`. The target is a repo path (schema/ORM/migration files) and, optionally, a live database via `$DATABASE_URL` for Tier-1/2 verification. If no target is given **and no schema/ORM/migration artifacts are found in the working directory**, do not fabricate a pass: say so plainly and suggest `/claude-db:start` (guided wizard, zero artifacts) or `/claude-db:design` (greenfield).

## What to do
1. Invoke the **db-orchestrator** skill with the target and flags. It detects the stack (`scripts/detect-stack.mjs` — paradigm/engine/ORM/platform), parses the schema (`scripts/parse-schema.mjs` / `parse-orm-python.py`), records the data **tier** reached (0/1/2), dispatches the read-only auditor subagents in parallel, merges findings, and runs **db-score**.
2. Present:
   - The two scores — **Design & Integrity** and **Performance & Scale** — each with a band (A–F) and a one-line interpretation. Show the uncapped `computed` alongside any `capped:true` (a `fail`+`severity:5` on that axis caps it at F). Never blend the two.
   - A per-category breakdown for each score (value, weight, active?), the detected paradigm/engine, the tier reached, and the count of `needs_api` checks (score confidence — never a silent pass).
   - If multiple datastores were detected, the **worst-of-across-stores** roll-up per axis with the flooring store named, plus the per-store breakdown.
   - A **prioritized action list** sorted by impact: each item with status, severity, evidence (`evidence.observed` quoting real DDL/query with secrets redacted), recommendation, fixability (auto/proposed/advisory), and `expected_impact` (axis + confidence + magnitude, banded high|medium|low — never a fabricated %/latency/row-count).
3. End by offering: "Run `/claude-db:fix` to apply the safe, reversible changes (you confirm each one), `/claude-db:migrate` to lint a migration, or `/claude-db:next` to see what to tackle first."

Two scores, never blended. Every finding conforms to `schema/finding.schema.json` with reproducible evidence. Respond in the user's language (EN/ES).
