# CLAUDE.md — working on `claude-db`

Project instructions for Claude Code when developing this repository. `claude-db` is a Claude Code
plugin that turns Claude into a senior, multi-paradigm database expert: **design** a new schema,
**audit** an existing one on two independent axes, and plan **safe migrations**.

## Architecture (skill-first, three layers)

Claude is the runtime; the Node/Python scripts are optional accelerators, never required.

1. **Directive skills** — `skills/<name>/SKILL.md` becomes `/claude-db:<name>`. The 10 commands:
   `start`, `design`, `audit`, `explain`, `migrate`, `fix`, `next`, `score`, `seed`, `checklist`.
   There is **no** `engine` or `recommend` command — M0 engine selection is delivered by `design`
   and `start`.
2. **Orchestration** — `skills/db-orchestrator` detects the stack/paradigm (`scripts/detect-stack.mjs`),
   builds the shared schema snapshot (`scripts/parse-schema.mjs`, `scripts/parse-orm-python.py`),
   dispatches the read-only auditor subagents **in parallel** (multiple `Task` calls in one message),
   merges findings, runs `scripts/score.mjs`, and renders the report.
3. **Module skills** — `skills/db-*/SKILL.md`, modules **M0–M22**. M0 (`db-engine-selection`) is an
   advisory recommendation and is **not scored**; M1–M22 are scored. Each module declares which axis
   it feeds: `design`, `performance`, or `both`.

### Agents (`agents/<name>.md`)
- **Read-only auditors**: tools `Read, Grep, Glob, Bash, WebFetch`, model `sonnet`. They emit a JSON
  array of findings conforming to `schema/finding.schema.json`. Read-only by tool allowlist.
- **Writer** (`db-migration-writer`): tools `Read, Edit, Write, Bash`. Only reachable via `/claude-db:fix`.

### The two-score model (never blend)
Two independent 0–100 scores with A–F bands: **Design & Integrity** (`design`) and
**Performance & Scale** (`performance`). A finding's `expected_impact.axis` routes it into the category
that owns its module **in each axis independently**. Severity gating caps a score at F on a `severity:5`
`fail` for that axis; `needs_api` and `speculative` findings never cap. The detected **paradigm** swaps
the category profile (`scripts/score.mjs` → `PROFILES`) so each axis still sums to 100. The full model
lives in `references/scoring-model.md` — conform to it, do not silently change weights.

## Dev rules (non-negotiable)

- **SKILL.md** bodies: command/orchestration skills `< 500` lines; module skills `≤ 120` lines.
  References `≤ 200` lines.
- **Frontmatter** matches the gold standard exactly:
  - Command/directive: `name` (== dir), `description`, `argument-hint`, `allowed-tools` (include `Task`
    only when the skill dispatches subagents). Only `skills/fix` sets `disable-model-invocation: true`.
  - Module: `name` (== dir) + `description` (+ `allowed-tools` if needed). **No** invocability key, and
    **never** the misspelled `user-invokable`.
- **kebab-case** for skill/agent/file names; module dirs are `db-<topic>`; module ids are `M0..M22`.
- **Scripts are zero-dependency**: Node `.mjs` (≥ 18) importing from `./lib/util.mjs`; Python `≥ 3.10`
  stdlib only. Every `.mjs` ends with
  `if (import.meta.url === \`file://${process.argv[1]}\`) main();`, supports `--help` (print usage,
  exit 0), and prints JSON to stdout. Scripts **degrade gracefully** (`needs_api` or a clear error,
  never crash the audit).
- **Read-only by default**: never connect with a write-capable role; Tier-1 introspection runs under
  `default_transaction_read_only=on` + `statement_timeout`, only `SELECT`/`EXPLAIN`/catalog reads,
  backed by the `PreToolUse` hook. Only the writer agent, only via `/claude-db:fix`, may write — and
  only after the user confirms each diff.
- **Honesty**: never fabricate latency/throughput/row-counts/table-sizes/EOL-dates/prices, in findings
  **or** design recommendations. Magnitude is banded `high|medium|low`. When a live DB is required emit
  `needs_api` — never a silent pass. Every finding carries a `confidence` tier; `speculative` never caps.
- **Bilingual docs**: `docs/en` and `docs/es` mirror each other; keep them in sync when user-facing
  behavior changes.
- **Don't touch the foundation**: `schema/*.json`, `references/scoring-model.md`, `scripts/score.mjs`,
  `detect-stack.mjs`, `parse-schema.mjs`, `parse-orm-python.py`, `lib/util.mjs` are tested — conform.

## Quality gates (run before every PR)

```bash
node tests/run.mjs                              # self-test over tests/fixtures
pytest                                          # Python ORM parser tests
for f in scripts/*.mjs scripts/lib/*.mjs; do node --check "$f"; done   # syntax-check every script
# validate every finding/report fixture against the JSON Schemas in schema/
node scripts/score.mjs --findings tests/fixtures/findings.json
```

Also describe what changed, why, and how you verified it. Keep the module map in `README.md` and the
weight tables in `references/scoring-model.md` consistent with any new or moved module.
