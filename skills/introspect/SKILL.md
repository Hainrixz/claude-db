---
name: introspect
description: Tier-1 live read-only introspection. Connects to the running database through a DB MCP server's read-class tools (preferred) or a least-privilege read-only connection string, reads catalogs only (no table data, no writes), and upgrades affected findings to confidence established. Enforces the read-only contract; when no live access is available it marks the dependent checks needs_api — never a silent pass. Invoked by db-orchestrator and the auditors when a check needs runtime truth.
allowed-tools: Read, Bash
---

# introspect (Tier-1 — live read-only)

Tier 0 reads files. Many checks need **runtime truth** a file cannot give: real index usage, FK-without-index joins, table/row sizes, RLS state, extensions, engine version, autovacuum/wraparound state. `introspect` is the only path to that, and it is **read-only by contract**. See references/data-tiers.md.

## Connection path (prefer MCP)
1. **DB MCP server (preferred)** — cleaner permission boundary. Use only **read-class tools** whose names match `*query*` / `*read*` / `*list*` / `*describe*` / `*schema*`. A generic write-capable `query` tool is routed through the same read-only validator below; a PreToolUse hook on `mcp__.*` backs this up. List available tools first; never call a tool that mutates.
2. **Else a least-privilege read-only connection string** read from `$DATABASE_URL` in the environment — never echoed, never written into a finding. `redactSecrets()` scrubs any credential that reaches a finding, report, or log.
3. **Neither available** → emit `status: needs_api` on every dependent check with the reason and the minimal grant needed. Never silently pass and never fabricate row counts, sizes, or plans.

## Read-only contract (enforced before any query)
- `SET default_transaction_read_only = on;`
- a bounded `statement_timeout` (e.g. `SET statement_timeout = '15s';`).
- only `SELECT` / `EXPLAIN` (no `ANALYZE` write side effects beyond plan) / catalog reads. Reject anything else.

## Catalogs read (no row data)
- **Postgres:** `version()`, `information_schema`, `pg_catalog`, `pg_class`, `pg_index`, `pg_indexes`, `pg_constraint`, `pg_policies`, `pg_extension`. Tier-2 adds `pg_stat_user_indexes` / `pg_stat_user_tables`, `pg_stat_statements`, `age(datfrozenxid)`.
- **MySQL/MariaDB:** `information_schema` (TABLES, STATISTICS, KEY_COLUMN_USAGE), `SHOW ENGINE INNODB STATUS` (read).
- **Mongo:** `db.stats()`, `$indexStats`, `$collStats` (Tier-2).
- **Cassandra:** `system_schema`, `nodetool tablehistograms` (Tier-2).

## Effect on findings
A check answered with live evidence is upgraded to `confidence: established` and may therefore cap a score (e.g. confirmed `int4`/serial PK near exhaustion, TXID wraparound imminent, RLS off on a relied-on table). Without live access those same checks stay `directional` or become `needs_api` — they **never** cap on static signal alone. Every finding still conforms to `schema/finding.schema.json`; `verification.reproduce` references `$DATABASE_URL`, never a literal credential.

## Output
Return the catalog facts the calling auditor needs (index inventory, RLS state, version, sizes) plus a clear note of which checks remain `needs_api` and why. Respond in the user's language (EN/ES).
