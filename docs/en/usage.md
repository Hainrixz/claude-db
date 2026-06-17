# Usage

A practical guide to running `claude-db` — installing it, running the ten commands, reading the
dual-score report, and applying migrations and fixes safely.

## Install

**As a Claude Code plugin (recommended):**

```
/plugin marketplace add Hainrixz/claude-db
/plugin install claude-db@claude-db
/reload-plugins
```

**Cross-agent (Cursor, Codex, Gemini CLI, Windsurf…) via Vercel Skills:**

```
npx skills add Hainrixz/claude-db
```

> Published at `github.com/Hainrixz/claude-db`. The plugin works fully offline (Tier 0) — no keys, no
> database connection required. Optional live read-only introspection lives in Tier 1+ (see
> [`mcp.md`](./mcp.md)).

## The ten commands

`claude-db` ships **ten command skills**. There is no root router and no subcommand parsing: each is
its own top-level command. Plugin skills are always namespaced, so the plugin name (`claude-db`) is the
namespace, and every command is invoked as `/claude-db:<command>`. The `target` is a repo path, a
schema/migration file, a `$DATABASE_URL`, or a plain-language description. There is **no** `engine` or
`recommend` command — M0 engine selection is delivered by `design` and `start`.

```
/claude-db:start
/claude-db:design    "<what you're building>" [--scale small|medium|large]
/claude-db:audit     [<path|file|url>] [--paradigm auto|relational|document|key-value|wide-column|vector|time-series|graph] [--tier 0|1|2]
/claude-db:explain   "<path|table|finding-id>" [--query "<SQL>"]
/claude-db:migrate   "<migration-file>"  |  "<from-schema>" "<to-schema>"
/claude-db:fix       "<path>" [--category keys|indexing|constraints|migration|…] [--dry-run]
/claude-db:next      [<findings.json>]
/claude-db:score     [<findings.json>] [--paradigm …]
/claude-db:seed      "<path>" [--rows N]
/claude-db:checklist "<path|$DATABASE_URL>"
```

| Command | What it does | Writes? |
|---|---|---|
| `start` | Guided design wizard for non-coders (plain-language Q&A → starter schema). | No |
| `design` | Recommend an engine (M0) + draft a schema and diagram from requirements; emits DDL/diffs only. | No |
| `audit` | Full read-only audit on both axes; merges findings; scores per paradigm. | No — never |
| `explain` | Plain-language explainer for a finding, table, or query (why-is-this-slow). | No |
| `migrate` | Lint a migration file, or diff two schemas into a reversible migration; previews first. | Only on confirm |
| `fix` | Apply safe, deterministic schema/migration fixes, per-change confirm. | Only on confirm |
| `next` | Coach: the single highest-leverage fix, ranked from findings. | No |
| `score` | Recompute/show the two scores from the most recent (or a saved) findings JSON. | No |
| `seed` | Generate FK-aware sample/seed data for a schema. | No |
| `checklist` | Production-readiness go/no-go grid. | No |

`start`, `design`, `audit`, `explain`, `next`, `score`, `seed`, and `checklist` are read-only and can
be triggered by description. `fix` is `disable-model-invocation: true` — only **you** can invoke it.

### `audit`

Read-only. Invokes `db-orchestrator`, which detects the stack(s), parses the schema, dispatches the
read-only auditor subagents in parallel, merges findings, and scores per the detected paradigm. It
never touches your files or your database.

```
# Audit the current repo (auto-detect the stack)
/claude-db:audit

# Audit a single schema file
/claude-db:audit prisma/schema.prisma

# Audit with live read-only introspection (Tier 1)
/claude-db:audit --tier 1
```

You get: both scores with bands and one-line interpretations, a per-category breakdown, the data tier
reached, the count of `needs_api` checks, the multi-store rollup (if several stores), and a prioritized
fix list sorted by impact ÷ effort. Each item carries status, severity, evidence, recommendation,
fixability, and `expected_impact`.

### `score`

Recomputes and displays the two scores from the most recent audit by re-running `scripts/score.mjs`
(reproducible). Pass a saved findings JSON to score that file instead.

```
/claude-db:score
/claude-db:score findings.json --paradigm document
```

### `design`

Runs the M0 engine-selection recommendation as its first step — a **recommendation, not a scored
audit** (version currency, pricing/lock-in honesty, FK-support per platform, never fabricated
benchmarks; see [`engine-selection.md`](./engine-selection.md)) — then proposes a concrete schema/model
and a diagram, emitting **DDL or diffs only**. It does not apply anything. Pair it with `migrate` to
plan the rollout.

```
/claude-db:design "multi-tenant SaaS, 100s of tenants, heavy reporting, on a small team" --scale medium
/claude-db:design "orders, line items, customers; needs soft-delete and an audit trail"
```

### `start`

The guided design wizard for non-coders — plain-language Q&A that builds a starter schema without
requiring you to write code. See [`design-wizard.md`](./design-wizard.md).

```
/claude-db:start
```

### `explain`

A plain-language explainer. Point it at a finding id, a table, or a query and it walks you through what
is happening and why — including "why is this slow?" Read-only.

```
/claude-db:explain orders
/claude-db:explain M11-fk-no-index --query "SELECT * FROM orders WHERE customer_id = $1"
```

### `next`

The coach. From the most recent (or a saved) findings JSON it returns the **single highest-leverage
fix** next, ranked by impact ÷ effort. Read-only.

```
/claude-db:next
/claude-db:next findings.json
```

### `seed`

Generates **FK-aware** sample/seed data for a schema — inserts respect foreign-key order so the data
loads cleanly. Read-only with respect to your database (it emits seed SQL).

```
/claude-db:seed prisma/schema.prisma --rows 100
```

### `checklist`

A production-readiness **go/no-go grid** over a schema or a live `$DATABASE_URL` — the must-haves before
shipping, each marked pass / needs-attention / blocked. Read-only.

```
/claude-db:checklist prisma/schema.prisma
```

> **Live introspection (Tier 1+).** Any read-only command can sharpen its findings against a live
> database when you pass a `$DATABASE_URL` or a DB MCP — real index inventory, RLS state, sizes, and
> engine version. The connection is read-only by contract (`SET default_transaction_read_only = on`,
> `statement_timeout`, only `SELECT`/`EXPLAIN`/catalog reads). See [`mcp.md`](./mcp.md).

### `migrate` and `fix`

Opt-in writers — covered below. `migrate` either **lints a migration file** or **diffs two schemas**
into a reversible migration.

```
/claude-db:migrate db/migrations/0007_add_status.sql
/claude-db:migrate schema.v1.sql schema.v2.sql
/claude-db:fix prisma/schema.prisma --category indexing
```

## Reading the dual-score report

Two **independent** 0–100 scores, never blended. A schema can be clean yet slow, or fast yet fragile.

| Score | Weighted toward |
|---|---|
| **Design & Integrity** | modeling, keys, referential integrity, types, constraints, security |
| **Performance & Scale** | indexing, query patterns, concurrency, pooling, scaling, storage, migration safety |

Each score has a letter band (A–F) and a one-line interpretation. Notes:

- **Severity gating** caps a score at F if something critical fails (e.g. no primary key, float money,
  plaintext secrets) — see [`scoring.md`](./scoring.md).
- **Per-paradigm re-normalization** means a document store is never penalized for lacking foreign keys.
- Each finding carries a `confidence` tier (`established` / `directional` / `speculative`); inferences
  without live data ship only as `speculative` and never cap.

### What `needs_api` means

Some checks can't be verified offline — they need a live database (Tier 1+). These are marked
`needs_api`, **excluded from the score math**, and counted separately as **score confidence**, so a
high score backed by many unverifiable checks is reported honestly rather than inflated. Opening a
read-only connection or DB MCP turns these into real findings.

## The opt-in writers (dry-run / confirm flow)

`migrate` and `fix` are the only commands that can change anything, and only `db-migration-writer` (the
sole subagent with Write/Edit) does the writing. `fix` is `disable-model-invocation: true` — the model
can **never** trigger it on its own.

**Dry-run (preview only) is the default.** The flow:

1. Take the change (a `migrate` file to lint or a from→to schema diff, or `fix`-able findings from the
   last audit). `--category` scopes which findings `fix` applies.
2. For each, build the migration SQL/DDL and a **reverse** (down) step, plus a unified diff. Any
   real-world inputs (backfill values, default choices) are **asked of you** — never invented.
3. **Dry-run**: print every migration/diff, classify its lock level and whether it rewrites the table,
   write nothing, and summarize what dropping `--dry-run` would change.
4. On explicit confirmation only: delegate to `db-migration-writer` to apply, then re-verify.

```
# Lint an existing migration file (preview only)
/claude-db:migrate db/migrations/0007_add_status.sql

# Diff two schemas into a reversible migration (preview, then confirm to apply)
/claude-db:migrate schema.v1.sql schema.v2.sql
```

### Migration safety guarantees (M22)

- **Reversibility** — every migration ships with a down step or an explicit expand/contract plan.
- **Lock awareness** — each step is classified by lock level and whether it rewrites the table; a
  destructive or full-rewrite step without an expand/contract path is flagged (sev-5).
- **Dry-run by default** — writing requires dropping `--dry-run` and confirming.
- **Git-aware** — refuses a dirty working tree unless `--force`; prefers a branch.
- **Never touches** `.git/`, `.env`/secrets, or files outside the project root (enforced by a PreToolUse
  hook); audits never write to the database at all.
- **No fabrication** — never writes invented data, statistics, or values.

## Optional helper scripts

The skills work as pure Markdown; the zero-dependency Node/Python helpers (Node ≥ 18, Python 3 for the
ORM parser) sharpen accuracy and make each `verification.reproduce` runnable:

```
node   scripts/detect-stack.mjs   --dir .
node   scripts/parse-schema.mjs   --file prisma/schema.prisma
python scripts/parse-orm-python.py --file models.py
node   scripts/score.mjs          --findings findings.json --paradigm relational
```
