---
name: explain
description: Explain a database schema, model, or a single finding in plain language, with a paradigm-aware diagram — what the tables/collections/keyspaces are, how they relate, and where the data lives. Read-only; teaches, does not change anything. Use when the user asks to explain, describe, walk through, draw, or diagram a schema, a data model, a relationship, or what a specific audit finding means.
argument-hint: "<path|table|finding-id> | --query \"<SQL>\" | <paste an EXPLAIN plan> [--depth overview|detailed] [--lang en|es]"
allowed-tools: Read, Grep, Glob, Bash
---

# /claude-db:explain

Plain-language description of a schema (or one finding), plus a **paradigm-aware diagram**. Read-only — explains, never edits or migrates.

`$ARGUMENTS` = `<path|table|finding-id> [flags]`. The target can be a schema/ORM/migration path, a single table/collection name, or a finding `id` from a prior audit.

## What to do
1. Detect the paradigm/engine (`scripts/detect-stack.mjs`) and parse the model (`scripts/parse-schema.mjs` / `parse-orm-python.py`).
2. Give a **plain-language description first** — no jargon in the opening: what each entity holds, who owns what, and how the pieces connect, in the user's words ("a user has many orders; each order belongs to exactly one user").
3. Render a **paradigm-aware diagram** (Mermaid) with `node scripts/gen-diagram.mjs --file <schema> [--paradigm relational|document|key-value|wide-column|graph]` — paradigm-aware: ERD for relational, access-pattern map for document, key+GSI sketch for DynamoDB/KV, node/edge for graph:
   - **Relational** → `erDiagram` with tables, PKs/FKs, and cardinality.
   - **Document** → embedding/reference tree showing what is nested vs referenced.
   - **Key-value** → access-pattern / key-design sketch (partition + sort key).
   - **Wide-column** → table-per-query / partition-key layout.
   - **Vector** → collection + metric/dimension + metadata filter fields.
   - **Time-series** → hypertable / measurement + tags + retention.
   - **Graph** → node-and-edge sketch with relationship types.
4. Offer an **expandable technical layer** below the plain description: exact column types, index definitions, constraint names, on-delete behavior — for the reader who wants the precise DDL.
5. If the target is a **finding id**, explain what it checks, which score/axis it affects (design | performance | both), why it matters, and how to reproduce it (`verification.reproduce`).

## Query / EXPLAIN-plan mode
Two additional inputs, both reusing the **db-query-patterns (M13)** reasoning:
- **`--query "<SQL>"`** — given a raw SQL statement, explain in plain language *why it would be slow* and *what fixes it*: detect M13 shapes (SELECT *, structural N+1, OFFSET deep paging, non-SARGable predicates), then recommend the concrete index, keyset rewrite, or predicate change that lets an index be used. This is static reasoning over the query text — no live DB needed.
- **paste-an-EXPLAIN-plan** — given a pasted `EXPLAIN`/`EXPLAIN ANALYZE` plan, read the plan nodes (seq scans, sort/hash spills, row estimate vs actual, nested-loop blowups) and explain which step dominates and what index/rewrite removes it, again via the M13 reasoning.
- If the user wants a **live plan generated** for them (running `EXPLAIN` against their database) rather than pasting one, mark the request **`needs_api` / Tier-2** and do not fabricate plan numbers — explain statically from the query text instead, or ask them to paste the plan.

## Honesty
- Describe only what is actually in the model. Never invent columns, relationships, row counts, or latency. If a relationship is implied but not enforced (e.g. a logical FK with no constraint), say so explicitly.
- Respond in the user's language (EN/ES); `--lang` overrides.
