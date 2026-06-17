# Architecture

`claude-db` is a Claude Code plugin — a senior multi-paradigm database expert that **designs**,
**audits**, and **migrates** schemas across relational, document, key-value, wide-column, vector,
time-series, and graph stores. It reports **two independent scores** — Design & Integrity and
Performance & Scale — that are never blended. This document describes the **current** design.

## Entry points: ten command skills

There is no root skill and no subcommand router. The plugin exposes **ten command skills** directly
under `skills/`, each invoked as a namespaced slash command (the plugin name `claude-db` is the
namespace). There is **no** `engine` or `recommend` command — M0 engine selection is delivered by
`design` and `start`:

| Command | Skill | Purpose | Writes? |
|---|---|---|---|
| `/claude-db:start` | `start` | Guided design wizard for non-coders — plain-language Q&A → a starter schema (M0) | No |
| `/claude-db:design` | `design` | Recommend an engine (M0) + draft a schema and diagram from requirements; emits DDL/diffs, never applied directly | No |
| `/claude-db:audit` | `audit` | Full read-only audit → both scores + prioritized findings report | No |
| `/claude-db:explain` | `explain` | Plain-language explainer for a finding, table, or query (why-is-this-slow) | No |
| `/claude-db:migrate` | `migrate` | Lint a migration file, or diff two schemas into a reversible migration; previews before applying | Yes (gated) |
| `/claude-db:fix` | `fix` | Apply safe, deterministic schema/migration fixes after per-change confirmation | Yes (gated) |
| `/claude-db:next` | `next` | Coach: the single highest-leverage fix, ranked from findings | No |
| `/claude-db:score` | `score` | Recompute/redisplay the two scores from the latest (or a saved) findings JSON | No |
| `/claude-db:seed` | `seed` | Generate FK-aware sample/seed data for a schema | No |
| `/claude-db:checklist` | `checklist` | Production-readiness go/no-go grid | No |

`fix` carries **`disable-model-invocation: true`** — the model can **never** auto-trigger it; it runs
only when the user types `/claude-db:fix`. The read-only commands may be model-invoked.

## Three-layer model

```
Layer 1  DIRECTIVE      start · design · audit · explain · migrate · fix · next · score · seed · checklist
                                   |
                                   v
Layer 2  ORCHESTRATION   db-orchestrator
            detect stack(s) -> dispatch read-only auditors (parallel)
            -> merge findings -> score.mjs (per paradigm) -> render the two-score report
                                   |
                                   v
Layer 3  EXECUTION       M0 + M1..M22 audit modules (skills/db-*)
            + zero-dependency scripts (detect-stack.mjs, parse-schema.mjs, score.mjs,
              schema-diff.mjs, gen-seed.mjs, parse-orm-python.py)
```

**Layer 1 — Directive.** Command skills are thin. `start`/`design` run the M0 recommendation and
produce DDL (`design` also draws a diagram); `audit` hands the target and flags to `db-orchestrator`;
`explain` and `next` narrate findings; `score` re-runs `score.mjs` over existing findings; `seed` and
`checklist` produce seed data and a go/no-go grid; `migrate`/`fix` run the gated writer workflow. Each
renders results in the user's language (EN/ES).

**Layer 2 — Orchestration.** `db-orchestrator` runs the audit in three phases — **detect → dispatch →
synthesize**:
1. Resolve the target (a repo path, a schema/migration file, a `$DATABASE_URL`, or a plain-language
   description), run `detect-stack.mjs` to classify one or more `{paradigm, engine, orm, platform,
   source_of_truth, confidence}` stacks (see `references/detection-signals.md`).
2. Dispatch the read-only auditor subagents **in parallel** — multiple `Task` calls in one message —
   so verbose intermediate output stays isolated. Each gets the parsed schema, the detected stack, and
   its assigned modules.
3. Merge findings, dedupe by `id` (keep most severe status), run `score.mjs` with the detected
   paradigm's profile, and render the two-score report per the render contract.

**Layer 3 — Execution.** One module skill per concern: **M0** (engine-selection, a recommendation, not
scored) and **M1..M22** (scored). Each evaluates one concern and emits findings conforming to
`schema/finding.schema.json`. Modules shell out to **zero-dependency** scripts (`detect-stack.mjs`,
`parse-schema.mjs`, `parse-orm-python.py`, `score.mjs`) for reproducible, CI-checkable results. The
audit still works offline (Tier 0) without a live database.

## Module map

`M0` engine-selection (recommendation) · `M1` normalization · `M2` keys · `M3` referential integrity ·
`M4` types/precision · `M5` constraints · `M6` defaults/generated · `M7` naming · `M8`
temporal/history · `M9` multitenancy · `M10` security/access · `M11` indexing · `M12` index hygiene ·
`M13` query patterns · `M14` concurrency · `M15` connection pooling · `M16` partitioning/sharding ·
`M17` replicas/views · `M18` storage/bloat · `M19` anti-patterns (unified catalog) · `M20` specialized
fit (vector/time-series/graph/search) · `M21` platform fit · `M22` migration safety.

Each scored module declares an axis: **Design & Integrity** (`design`), **Performance & Scale**
(`performance`), or **both**. A `both` finding feeds the category that owns its module **in each axis
independently**.

## Subagents

Subagents live in `agents/`. The auditors are strictly **read-only** (tools `Read, Grep, Glob, Bash,
WebFetch` — no `Write`/`Edit`), so an audit can never mutate files or a database. Only
`db-migration-writer` can write, and only via the `migrate`/`fix` skills after confirmation.

| Subagent | Tools | Role |
|---|---|---|
| Read-only auditors | Read, Grep, Glob, Bash, WebFetch | Run assigned M0–M22 modules, emit findings JSON |
| `db-migration-writer` | Read, Edit, Write, Bash | **The only writer** — applies migrations/fixes after confirmation |

## Stack detection & paradigm routing

`detect-stack.mjs` classifies a project into one or more stacks and never guesses an engine: when
nothing matches it returns an empty list and routes the user to `/claude-db:start` or description mode.
The detected **paradigm** selects a category profile in `score.mjs` (`PROFILES`). Relational-only
categories (referential integrity, FK-index coverage) simply don't exist in the document/KV/etc.
profiles, so a document store is **never penalised for lacking foreign keys**.

## Two scores, never blended

`score.mjs` produces **two independent 0–100 scores** with letter bands (A–F):

- **Design & Integrity** (`design`) — modeling, keys, referential integrity, types/precision,
  constraints, naming, security/access, temporal/lifecycle.
- **Performance & Scale** (`performance`) — indexing, query patterns, concurrency, pooling, scaling
  topology, storage/operability, migration safety.

A schema can be clean yet slow, or fast yet fragile — surfacing both is the product thesis. The full
formula, per-paradigm weight tables, severity gating, and the multi-store worst-of rollup live in
`references/scoring-model.md` and are mirrored for end users in [`scoring.md`](./scoring.md).

## Finding contract

Every module emits findings conforming to `schema/finding.schema.json`. The schema is
falsifiability-first: each finding is independently observable and re-checkable. Required fields
include `id` (module-prefixed), `module`, `title`, `status` (`pass`/`warn`/`fail`/`not_applicable`/
`needs_api`), `severity` (0–5), `scope`, `evidence.observed` (verbatim DDL/migration/query, secrets
redacted), `expected`, `recommendation`, `fixable`, `verification` (`method` + `assertion` + a runnable
`reproduce` using `$DATABASE_URL`), and `expected_impact` (`axis` + `confidence` + `magnitude` +
`rationale`).

## Honesty guardrails

- **No fabrication** — never invent statistics, latency, throughput, row counts, or prices, in
  findings *or* design recommendations. Magnitude is banded `high`/`medium`/`low`, never a naked
  percentage.
- **`needs_api`, never a silent pass** — a check that needs a live database emits `needs_api` and is
  counted as score confidence, not as a pass.
- **Confidence tiers** — `established` (durable fact or Tier-1/2-backed, can cap) · `directional`
  (strong static signal) · `speculative` (inference without live data, never caps).
- **Read-only by default** — auditors hold no write tools; the writer is gated behind explicit
  confirmation and `disable-model-invocation` on `fix`.
