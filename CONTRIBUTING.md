# Contributing to claude-db

Thanks for helping build the community multi-paradigm database toolkit. This is an open, MIT-licensed
project — all original work; please don't paste branding, copy, or names from other projects.

## Ground rules (non-negotiable)

1. **Falsifiability.** Every finding a skill emits must conform to
   [`schema/finding.schema.json`](schema/finding.schema.json): observed `evidence.observed` (quoting
   real DDL/migration/query text with secrets redacted), a runnable `verification.reproduce` (against
   `$DATABASE_URL`, never a literal credential), and a banded `expected_impact` with an `axis`, a
   `confidence` tier, and a `magnitude`. No naked percentages — cite published numbers only inside
   `rationale`.
2. **No fabrication.** Never invent latency, throughput, row counts, table sizes, EOL dates, or
   prices — in findings **or** design recommendations. Magnitude is banded `high|medium|low`. When a
   value needs a live database, emit `status: needs_api` — never a silent pass.
3. **Two scores, never blended.** Design & Integrity and Performance & Scale are computed and reported
   separately. A finding routes into the category that owns its module per axis; respect the weights in
   [`references/scoring-model.md`](references/scoring-model.md). `speculative` findings never cap.
4. **Read-only by default.** Auditor agents are read-only by tool allowlist; Tier-1 introspection runs
   under a read-only contract. Only `db-migration-writer`, only via `/claude-db:fix`, may write — and
   only after the user confirms each diff. Destructive operations are advisory, never auto-applied.

## Adding or editing a skill

- Skills live in `skills/<name>/SKILL.md`.
  - **Module skills** (`db-*`) mirror the structure/tone of the existing modules: frontmatter is
    `name` (== dir) + `description` (+ `allowed-tools` if needed) — **no** invocability key, and never
    the misspelled `user-invokable`. Body `≤ 120` lines: what it checks, which score/axis it feeds
    (`design`|`performance`|`both`), the Tier-0 static checks **and** the Tier-1 verification query,
    and that it emits findings conforming to the schema.
  - **Command/orchestration skills** add `argument-hint` and `allowed-tools` (include `Task` only when
    the skill dispatches subagents). Only `skills/fix` sets `disable-model-invocation: true`. Body
    `< 500` lines.
- Keep deep reference material in `references/` (`≤ 200` lines each), mirrored bilingually in
  `docs/en` + `docs/es`.
- Use module-prefixed finding ids (e.g. `M11.orders.fk_no_index`). The scorer maps a finding to a
  category by its module and the detected paradigm — see `references/scoring-model.md`.

## Adding a verification script

- Scripts in `scripts/` are **zero-dependency**: Node ESM (`.mjs`, Node ≥ 18) reusing
  `scripts/lib/util.mjs`, or Python `≥ 3.10` stdlib only. They run with no install step.
- A script must **degrade gracefully** (emit `needs_api` or a clear error, never crash the audit) and
  accept `--file`/`--path` (and `--url`/`$DATABASE_URL` for live checks).
- Every `.mjs` supports `--help` (print usage, exit 0), prints JSON to stdout, and ends with
  `if (import.meta.url === \`file://${process.argv[1]}\`) main();`.
- Wire it as the `verification.reproduce` command in the relevant skill's findings.

## Before you open a PR

```bash
# self-test over the fixtures
node tests/run.mjs
# Python ORM parser tests
pytest
# syntax-check every script
for f in scripts/*.mjs scripts/lib/*.mjs; do node --check "$f"; done
# scorer smoke test
node scripts/score.mjs --findings tests/fixtures/findings.json
# validate the plugin manifest (if you have the CLI)
claude plugin validate .
```

Please describe what you changed, why, and how you verified it. Bilingual docs (`docs/en` + `docs/es`)
should stay in sync when you change user-facing behavior, and keep the module map in `README.md` /
`README.es.md` consistent with the weight tables in `references/scoring-model.md`.
