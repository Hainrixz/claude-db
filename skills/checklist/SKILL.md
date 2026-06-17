---
name: checklist
description: Render a production-readiness GO/NO-GO grid for a database — runs a read-only audit, then maps the findings onto a fixed launch checklist (PITR/backups, RLS on tenant tables, FK indexes, money-as-numeric, timestamptz/UTC, connection pooling sized, migration reversibility, secrets-not-in-schema, charset/utf8mb4). Each row is PASS/WARN/FAIL/NEEDS-LIVE with the finding id, topped by a plain-language verdict. Read-only. Use when the user asks if a database is production-ready, ready to launch/ship, a go/no-go, a pre-launch or readiness checklist, or what to fix before going live.
argument-hint: "<path|connection-target> [--tier 0|1|2]"
allowed-tools: Read, Grep, Glob, Bash, Task
---

# /claude-db:checklist

A **production-readiness GO/NO-GO** grid. **Read-only** — runs an audit and maps the findings onto a fixed launch checklist; never writes files or mutates the database.

`$ARGUMENTS` = `<path|connection-target> [flags]`. The target is a repo path (schema/ORM/migration files) and, optionally, a live database via `$DATABASE_URL` for Tier-1/2 verification. If no target is given and no artifacts are found, say so and suggest `/claude-db:start` or `/claude-db:design`.

## What to do
1. Invoke the **db-orchestrator** skill with the target and `--tier` flag to run the read-only audit (stack detection → schema parse → auditor subagents → merged findings → scores). Reuse an existing `findings.json` if the user passes one.
2. Map the merged findings onto the fixed checklist below. Each row gets a status — **PASS** (satisfied), **WARN** (non-blocking gap), **FAIL** (blocking gap), or **NEEDS-LIVE** (cannot be confirmed without a live connection / higher tier) — plus the **finding id(s)** that drive it.

   | Check | What it verifies |
   |---|---|
   | PITR / backups | Point-in-time recovery or backup policy is configured — **NEEDS-LIVE** by default [^pitr] |
   | RLS on tenant tables | Row-level security enforced on multi-tenant tables |
   | FK indexes | Every foreign key column is covered by an index |
   | Money as numeric | Monetary columns use `numeric`/`decimal`, never float |
   | timestamptz / UTC | Timestamps are timezone-aware and stored in UTC |
   | Connection pooling sized | Pool is configured and sized for the platform's limits |
   | Migration reversibility | Migrations have working down/rollback paths |
   | Secrets not in schema | No credentials/secrets embedded in schema or DDL |
   | charset / utf8mb4 | MySQL uses `utf8mb4` (full Unicode), correct collation |

   [^pitr]: No static module audits backups/DR/PITR, so this row is rendered **NEEDS-LIVE** by default — it can only be confirmed at Tier-1 (a live connection / provider config) and offline is reported as `needs_api`, never assumed present (never a silent PASS).

3. Render the grid as a table (Check · Status · Finding id · one-line note). Mark `NEEDS-LIVE` rows distinctly and state the tier needed to resolve them. Checks not applicable to the detected engine/paradigm (e.g. RLS or utf8mb4 on a non-relational store) are shown as N/A with a reason — never a silent pass.
4. Lead with a **plain-language verdict** at the top: **GO** (no FAILs), **GO WITH CAVEATS** (WARNs/NEEDS-LIVE only), or **NO-GO** (one or more FAILs) — one sentence on the headline blocker.

End by offering: "Run `/claude-db:fix` to apply the safe, reversible fixes, or `/claude-db:next` to see what to tackle first." Read-only throughout. Respond in the user's language (EN/ES).
