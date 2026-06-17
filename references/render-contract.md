# Render contract — audit / design / fix output

The exact human-facing rendering for the three flows. The principle: a **novice plain-language layer on
top, an expandable technical layer underneath** — a non-expert understands the headline; an expert can open
every finding to the verbatim evidence and the runnable verification. Honesty rules from the foundation
apply to *rendering* too: banded magnitudes, no fabricated numbers, `needs_api` shown explicitly, capped
scores never dressed up.

## Shared header (all flows)
- **Two scores, side by side, never blended:** `Design & Integrity NN (band)` and
  `Performance & Scale NN (band)`. One plain sentence interpreting the pair, e.g. "Solid design, but it will
  get slow under load." Bands A≥90 B≥80 C≥70 D≥60 F<60.
- If a score is **capped**, show `NN (F, capped)` with the one sev-5 reason in plain words, and render the
  uncapped `computed` next to it ("would be 82 without the blocker"). A capped score is never raised by good
  findings elsewhere.
- **Confidence line:** detected paradigm(s)/engine, the source of truth used (live > generated > ORM
  source), and how many findings are `needs_api` (so the reader knows what's unverified). Multi-store: name
  the flooring store ("Design 58 — floored by `redis-cache`") with per-store breakdown beneath.

## `/audit` rendering
1. **Plain headline** — the two scores + the one-sentence interpretation + the single most important thing
   to fix first.
2. **Top issues (novice layer)** — a short ranked list, each one line: what's wrong, why it matters in plain
   terms, banded impact (high/medium/low), and which score it hurts. Severity-5 fails sort first.
3. **Score breakdown** — per-axis category table: category, weight, value, and whether it's `active` (an
   inactive category is shown as such, not as 0). This is the `categories[]` from `score.mjs`.
4. **Findings (expandable technical layer)** — grouped by module. Each finding renders its
   `schema/finding.schema.json` fields: `status`/`severity`, `evidence.observed` (verbatim DDL/query, secrets
   redacted), `expected`, `recommendation`, `verification.reproduce` (runnable against `$DATABASE_URL`), and
   `expected_impact` (axis + confidence + magnitude + rationale). `needs_api` findings say exactly what live
   access would confirm them — never shown as a pass.
5. **What I did not check** — Tier gaps: "Real index usage / row counts / autovacuum need a live connection
   (Tier 1/2)." Offer `/introspect`.

## `/design` rendering (greenfield / wizard)
1. **Plain recommendation** — the recommended engine in one sentence + *why*, plus the boring-default note
   ("Postgres also covers this if you'd rather keep one store") and the **deviation trigger** (what would
   change the call). From `engine-selection-tree.md` (M0, unscored).
2. **Starter design (novice layer)** — the proposed tables/collections/keys described in plain language:
   what each holds and how the main actions map to it (tying back to the wizard's Q2 access patterns).
3. **The schema (technical layer, expandable)** — concrete DDL / collection + validator / key design,
   already following `relational-best-practices.md` / `nosql-best-practices.md` (proper PK, types,
   constraints, the indexes the access patterns need).
4. **Honest trade-offs** — lock-in, consistency, and scale notes, qualitative only (no benchmarks). Things to
   decide later, flagged, not guessed.

## `/fix` rendering
`/fix` is the only skill with `disable-model-invocation: true` — it runs only on explicit request and writes
nothing without per-item confirmation.
1. **Plan first** — list each proposed change grouped by `fixable`: `auto` (deterministic, additive,
   verifiable — e.g. `CREATE INDEX CONCURRENTLY`), `proposed` (a draft migration needing review), `advisory`
   (never written — destructive/irreversible, shown for the human to do). Destructive ops never auto-apply.
2. **Per change** — the source finding id, a plain one-liner of what it does and why, and the `fix_preview`
   (unified diff / new-file content / migration SQL). Expand-contract and lock-aware per `migration-safety.md`.
3. **Confirm → apply → verify** — apply only confirmed items, then run each finding's
   `verification.reproduce` and report pass/fail. Re-run scoring and show the score delta (old → new).
   Anything that needs a live DB to verify is reported as `needs_api`, not assumed fixed.

## Cross-cutting rendering rules
- Banded magnitude only (high/medium/low); a published stat may appear **only** inside a rationale with its
  citation, never as the headline impact.
- Speculative-confidence findings are labeled and never affect a cap.
- Plain-language layer must be understandable without DB expertise; technical layer must be complete enough
  for an expert to independently reproduce every finding.
- Bilingual: the same structure renders from `docs/en` and `docs/es`.
