---
name: db-orchestrator
description: Orchestrates a full database audit — detects the stack(s), dispatches read-only auditor subagents in parallel by paradigm, merges and dedupes their findings, computes the two never-blended scores (Design & Integrity + Performance & Scale) via score.mjs, and renders the report. Invoked by the audit command; not usually called directly.
allowed-tools: Read, Grep, Glob, Bash, Task
---

# db-orchestrator (Layer 2)

Coordinates the whole audit. Three phases: **detect → dispatch → synthesize**. Two scores, never blended.

## 1. Detect
1. Resolve the target (project dir, or a plain-language description).
2. Run **stack-detect** (wraps `scripts/detect-stack.mjs`). Get the `stacks` array, each with `paradigm`, `engine`, `orm`, `platform`, `source_of_truth`, `confidence`.
3. Empty result → route to `/claude-db:start` (wizard) or description mode. Never guess an engine.
4. If the user opted into Tier-1, run **introspect** (read-only) so runtime-dependent checks can reach `established`; otherwise those checks will return `needs_api`.

## 2. Dispatch (parallel, read-only)
For each stack, spawn the read-only auditor subagents **in parallel** — one message with **multiple Task calls** — so their verbose intermediate output stays isolated. (`context: fork` is NOT a Task parameter; parallelism is achieved by issuing several Task calls in a single message.) Pass each the `source_of_truth` location/contents, the paradigm, the engine/platform, and its assigned modules. Auditors of an inactive paradigm are **not** dispatched (their modules emit no findings and leave the denominator):
- **schema-integrity-auditor** → M1–M10 (modeling, keys, referential integrity, types, constraints, defaults, naming, temporal, multitenancy, security/RLS). Always (relational); for NoSQL it runs the paradigm-shaped subset.
- **performance-scale-auditor** → M11–M18 (indexing, hygiene, query patterns, concurrency, pooling, partitioning, replicas/views, storage/bloat). Always.
- **nosql-paradigm-auditor** → M19 (NoSQL anti-patterns) + access-pattern fit. Only for **document / key-value / wide-column**.
- **specialized-platform-auditor** → M20 (vector/time-series/graph/search), M21 (platform fit), M0 (engine-selection recommendation in design mode). For vector/TS/graph/search and all platform checks.
- **migration-safety-auditor** → M22 (migration lint). When migration files are in scope (`/claude-db:migrate`, or audit when a migration dir exists).

Each subagent returns a JSON array of findings conforming to `schema/finding.schema.json`. Auditors are read-only (tools `Read, Grep, Glob, Bash, WebFetch` only) — the audit can never mutate files. M19/M20 findings keep their `module` id for provenance but inherit the natural module's category at scoring time.

## 3. Synthesize
1. **Merge** all findings; **dedupe by `id`** (keep the most severe status: fail > warn > needs_api > pass > not_applicable).
2. **Score** per stack with the matching paradigm:
   ```bash
   node scripts/score.mjs --findings <merged.json> --paradigm <paradigm>
   ```
   Multi-store → score each stack, then roll up **worst-of-across-stores per axis** (`design = min over stores`, same for performance); name the flooring store (e.g. "Design 58 — floored by `redis-cache`").
3. **Render** the report (bands/interpretations from `references/scoring-model.md`):
   - **Header:** **Design & Integrity** band/score + **Performance & Scale** band/score, each with the one-line interpretation from `score.mjs`. If a score is `capped:true`, show both `value` and uncapped `computed` and name the sev-5 fail that capped it.
   - **Per-axis category table** (one per score): category, weight, value, active?. Inactive categories shown as such (re-normalized out of the denominator).
   - **Confidence line:** tier reached (0/1/2) + total `needs_api` count across both axes. Never present a `needs_api` check as a pass.
   - **Prioritized actions:** findings sorted by `severity × magnitude ÷ effort` (magnitude banded high|medium|low, never a fabricated %). Each: status, severity, evidence.observed (real DDL/query, secrets redacted), verification.reproduce, recommendation, fixability (auto/proposed/advisory), and expected_impact (axis + confidence + magnitude).
   - **Footer:** "Run `/claude-db:fix` to apply the safe, reversible migrations — you confirm each change."

## Plain-language layer (novice-friendly)
Alongside the technical report, give a short plain-language summary: what the two scores mean in one sentence each ("your design is solid but it won't hold load yet"), the top 3 things to fix first in non-jargon terms, and what `needs_api` means ("I'd need a read-only connection to confirm these"). Keep the expert detail; add the human translation — never replace one with the other.

## Notes
- Keep this skill's own output tight — the value is the merged report, not narration.
- Honesty: never fabricate stats/latency/throughput/row-counts/prices. `needs_api` when a live DB is required. Read-only by default; speculative findings never cap.
- Respond in the user's language (EN/ES).
