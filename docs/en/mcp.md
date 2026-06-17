# MCP & Data Tiers

`claude-db` is designed to work with **zero MCP servers and zero API keys**. A full audit runs offline
at Tier 0 from your schema, migrations, ORM source, or a plain-language description. Everything beyond
that is opt-in and only **sharpens** findings. When a higher tier is unavailable, a check degrades to
`status: needs_api` honestly — the tool never fabricates a measured value or returns a false `pass`.

## The three data tiers

| Tier | Requires | Unlocks | If unavailable |
|---|---|---|---|
| **0 — offline (default)** | Nothing — read files or a description, plus the bundled scripts | Structure: constraints, FK-without-index (static), float money, naming, normalization, anti-patterns, RLS-not-declared, unsafe migration ops | This is the floor — always available |
| **1 — live read-only introspection** | A least-privilege read-only `$DATABASE_URL` **or** a DB MCP server (preferred) | Real index inventory, FK-without-index join, table/row sizes, RLS state, extensions, engine version → upgrades findings to `established` | Runtime-dependent findings → `needs_api` |
| **2 — live statistics** | Sustained runtime stats (`pg_stat_statements`, `pg_stat_user_*`, `EXPLAIN (ANALYZE)`, `age(datfrozenxid)`) | Real plans, genuinely unused indexes, dead tuples, hot partitions, TXID wraparound age | Stat-dependent findings → `needs_api` |

The `introspect` skill records the `tier` actually reached; downstream modules annotate any finding
`needs_api` when it requires a higher tier than was reached. Tier 0 program-source parses (Drizzle
`.ts`, Mongoose `.js`, CDK) are capped at `confidence: directional` and **never raise a severity-5
cap** — they nudge toward a generated artifact or Tier-1.

## Tier 0 — what works with no setup

- Parse `schema.prisma`, Drizzle `*_snapshot.json`, `structure.sql`, raw SQL DDL, `schema.rb`, and
  generated Alembic/Flyway/Liquibase SQL (reliable → `established`).
- Best-effort parse of Drizzle `schema.ts`, Mongoose models, DynamoDB CDK (→ `directional`).
- Detect missing constraints, FK-without-index (static), float/`double` money, naming drift,
  normalization issues, the unified anti-pattern catalog, RLS-not-declared, and unsafe migration ops.
- Accept a **plain-language description** when no schema files exist (the `/claude-db:start` wizard).

Anything that needs runtime truth (real index usage, row counts, plans, autovacuum/bloat state) is
deferred to Tier 1/2 and reported as `needs_api` — never a silent pass.

## Tier 1 — opt into a read-only DB MCP (recommended) or `$DATABASE_URL`

Tier 1 is opt-in and we **never auto-start it**. Enabling the plugin never forces a download, a
credential prompt, or a connection. To enable live read-only introspection, the cleanest path is a
read-only database MCP server. Copy the entry from [`.mcp.json.example`](../../.mcp.json.example) into
your project `.mcp.json` (or `mcpServers` in `~/.claude.json`) and approve it:

```jsonc
{
  "mcpServers": {
    "postgres-readonly": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "${DATABASE_URL_READONLY}"]
    }
  }
}
```

`DATABASE_URL_READONLY` should point at a **least-privilege read-only role**. The MCP path is preferred
over a raw connection string because it draws a cleaner permission boundary: the `introspect` skill
invokes only read-class tools (`*query*`/`*read*`/`*list*`/`*describe*`), and a generic write-capable
`query` tool is routed through the same read-only validator. A PreToolUse hook (`mcp__.*`) backs this
up by blocking anything that is not a `SELECT`/`EXPLAIN`/catalog read.

If you prefer a raw connection string instead of an MCP, export a read-only `$DATABASE_URL`; the
introspection enforces `SET default_transaction_read_only = on`, a `statement_timeout`, and only
`SELECT`/`EXPLAIN`/catalog queries. Connection strings are read from the environment, never echoed;
`redactSecrets()` scrubs any credential before it reaches a finding, report, or log, and every
`verification.reproduce` references `$DATABASE_URL`, never a literal credential.

## Tier 2 — live statistics

Tier 2 reuses the same read-only connection or MCP but reads sustained runtime statistics
(`pg_stat_statements`, `pg_stat_user_indexes`/`pg_stat_user_tables`, `EXPLAIN (ANALYZE, BUFFERS)`,
`age(datfrozenxid)`, `pg_stat_replication`; Mongo `$collStats`; Cassandra `nodetool tablehistograms`;
DynamoDB CloudWatch). Without sustained stats these findings remain `directional`; if a decision truly
needs stats, the finding is `needs_api`.

## Graceful degradation, summarized

- **Tier 0 is always enough to run an audit.** No MCP, no key, no connection required.
- Missing live connection → structural findings only; runtime checks reported as `needs_api`.
- Program-source-only parse → capped at `directional`, never a sev-5 cap, with a nudge toward a
  generated artifact or Tier-1.
- When the required tier is unavailable, the status is **`needs_api`** — never a fabricated metric and
  never a false `pass`.
