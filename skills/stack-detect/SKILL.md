---
name: stack-detect
description: Detects the database stack(s) of a project — paradigm, engine, ORM, platform, and the authoritative source_of_truth — by wrapping scripts/detect-stack.mjs. Emits the stacks array plus routing (which paradigm profile and module set each stack drives) and the source_of_truth precedence. Never guesses an engine; an empty result routes to /claude-db:start. Invoked by db-orchestrator (Phase 1); not usually called directly.
allowed-tools: Read, Glob, Bash
---

# stack-detect (Phase 1 — detect)

Classifies the project into one or more `{ paradigm, engine, orm, platform, source_of_truth, confidence, files }` stacks. This is the deterministic front door of every audit: it picks the **paradigm profile** the scorer re-normalizes over (`scripts/score.mjs` → `PROFILES`) and the module set each auditor runs.

## What to do
1. Resolve the target directory (`$ARGUMENTS` path, else the project root / cwd).
2. Run the detector and read its JSON stdout:

   ```bash
   node scripts/detect-stack.mjs --dir "<dir>"
   ```

   It returns `{ stacks: [...], files_scanned }`. Never edit or re-implement it — it is tested foundation.
3. **Empty `stacks`** → there is nothing to audit offline. Do **not** guess an engine. Route the user to `/claude-db:start` (the guided wizard) or invite a plain-language description of the intended database. Surface the detector's `hint` verbatim.

## Source-of-truth precedence (see references/detection-signals.md)
When several sources describe one database, authority is, in order:
1. **Live Tier-1 introspection** (via the `introspect` skill) — beats any file.
2. **Declarative / generated artifact** — `schema.prisma`, Drizzle `*_snapshot.json`, `structure.sql`, `schema.rb`, generated migration SQL → `confidence: established`.
3. **Migration SQL** over **ORM program source**.
4. **ORM program source** (`schema.ts`, `models.py`, Mongoose/CDK) → `confidence: directional`.

`directional` stacks parsed from program source **never raise a severity-5 cap** — they nudge toward a generated artifact or Tier-1. When a declarative artifact and ORM source disagree, that is schema drift, owned by `db-migration-safety` (M22).

## Routing emitted per stack
For each detected stack, emit the routing the orchestrator needs:
- **paradigm** → selects the `score.mjs` profile and `--paradigm` flag (`relational | document | key-value | wide-column | vector | time-series | graph`).
- **module set** → M0 engine-selection (recommendation, unscored) + M1..M22 filtered to the paradigm's profile modules. Categories whose modules emit no scored finding go inactive — e.g. a document store is never penalised for missing foreign keys.
- **source_of_truth** + **confidence** → the parse reliability ceiling carried into every finding (Tier 0(a) reliable vs 0(b) best-effort).

## Multi-store
Return **all** stacks (e.g. Postgres primary + Redis cache). The orchestrator audits each, scores each with its own `--paradigm`, and rolls up worst-of-across-stores per axis (see references/scoring-model.md → Multi-store rollup), naming the flooring store.

## Output
Emit the raw `stacks` array, the per-stack routing (paradigm profile + module set), and the source_of_truth precedence note. Keep narration tight. Respond in the user's language (EN/ES).
