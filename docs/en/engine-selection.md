# Engine selection — delivered by `/claude-db:design` (and `/claude-db:start`) — M0

Engine selection answers one question: **which database paradigm and engine fit what you're
building?** It is module **M0** — a *recommendation, not a scored audit*. There is no separate
`recommend`/`engine` command: the M0 logic is delivered by **`/claude-db:design`** (and, for
non-coders, by the **`/claude-db:start`** wizard). It produces no Design or Performance score; it
produces a reasoned choice with honest trade-offs. The default is Postgres unless your requirements
point elsewhere.

## How the recommendation is made

The recommendation walks from **access patterns → paradigm → engine → platform**, in that order. It
never starts from a brand.

1. **Capture the workload.** What you store, how you read it (point lookups, ranges, joins, full-text,
   vector similarity, graph traversal, time-ordered events), write rate, consistency needs, and team
   size/operational appetite. When a number matters it is **asked**, never invented.
2. **Pick the paradigm.** Map the dominant access pattern to a paradigm:
   - Relational — rich relationships, transactions, ad-hoc queries, referential integrity.
   - Document — aggregate-oriented, denormalized read models, flexible per-document shape.
   - Key-value — high-throughput point lookups by a known key, caching, sessions.
   - Wide-column — table-per-query, huge write volume, partition-keyed access.
   - Vector — embedding similarity search (with metadata filtering).
   - Time-series — append-only time-ordered events, retention, downsampling.
   - Graph — traversal-heavy relationships, variable-depth queries.
3. **Pick the engine within the paradigm**, weighing maturity, ecosystem/ORM support, operational
   burden, and fit to the access patterns. **Default to Postgres** for relational and for many
   "specialized" needs it covers well (JSONB for document-ish data, `pgvector` for vectors, TimescaleDB
   for time-series) before reaching for a separate system.
4. **Pick the platform/host** — self-managed vs managed (Supabase, Neon, PlanetScale, RDS, Turso, D1,
   Atlas, …) — weighing version currency, pricing/lock-in honesty, and feature support per platform.

## Honesty rules (no fabricated comparisons)

- **No fabricated stats** — never invent latency, throughput, QPS, row counts, or benchmark numbers to
  justify a choice. Comparisons are qualitative trade-offs, not made-up figures.
- **No fabricated EOL or version claims** — version currency is reported only from verifiable facts;
  the tool does not invent end-of-life dates.
- **Pricing & lock-in honesty** — cost and lock-in trade-offs are described directionally (e.g. "egress
  and per-branch pricing can surprise you at scale; verify current pricing"), never as fabricated dollar
  figures.
- **FK-support per platform** — flags real platform limitations (e.g. engines/hosts with limited or
  non-enforced foreign keys) so a relational choice isn't undermined by the host.
- **A recommendation is a starting point**, not a guarantee; it names the assumptions it made and the
  questions it could not answer without your input.

## "Don't add a new database yet"

A frequent, deliberate output is **"Postgres already does this"** — JSONB instead of a separate document
store, `pgvector` instead of a standalone vector DB, TimescaleDB instead of a separate time-series
system — because premature polyglot persistence multiplies operational cost. The recommendation says so
plainly when it applies, and flags **premature sharding** the same way.

## How it connects to the rest of the suite

- For a brand-new project with no schema, `/claude-db:start` (the [design wizard](./design-wizard.md))
  uses this same M0 logic to pick where to put the starter schema.
- When you already know your requirements, `/claude-db:design` runs the M0 recommendation as its first
  step, then drafts the schema and a diagram around the chosen engine.
- Once an engine is chosen and a schema exists, `/claude-db:audit` scores it on both axes; platform-fit
  concerns (version currency, lock-in, FK support) continue to surface there as **M21**.

```
/claude-db:design "event analytics, 50k events/sec ingest, dashboards over last 90 days"
# → likely time-series (TimescaleDB on Postgres, or ClickHouse) with the trade-offs spelled out
```
