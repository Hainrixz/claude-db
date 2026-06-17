---
name: migrate
description: Lint a database migration for safety before it runs — classify lock level, table rewrite, and reversibility; flag destructive/blocking operations; and propose an expand-contract rollout. Read-only analysis by default; any data-loss step requires an explicit token handshake before the writer is involved. Use when the user asks to review, lint, check, or de-risk a migration, an ALTER/DROP, an enum change, a backfill, or a schema change before deploying.
argument-hint: "<migration-file|migration-dir> | <from-schema> <to-schema> [--engine postgres|mysql|...] [--apply]"
allowed-tools: Read, Grep, Glob, Bash, Task
---

# /claude-db:migrate

Migration-safety lint, owned by module **db-migration-safety (M22, axis `performance`)** via the **db-migration-safety / MSA** checks. Default mode is **read-only**: it analyzes and explains, it does not run the migration.

`$ARGUMENTS` has two forms:
- **single-file lint** — `<migration-file|migration-dir> [flags]`: parse and classify an existing migration (below).
- **diff mode** — `<from-schema> <to-schema> [flags]`: two schema paths. Run `node scripts/schema-diff.mjs --from <from-schema> --to <to-schema>` to generate the up/down migration, then classify the generated migration exactly as in single-file mode.

If no argument is given, ask for one (or point at the project's migration directory).

## Diff mode (`<from-schema> <to-schema>`)
1. Run `node scripts/schema-diff.mjs --from <A> --to <B>` to produce the **up** and **down** migration; `schema-diff.mjs` flags destructive steps.
2. **Present** the generated up/down migration to the user, with the plain-language summary of each step.
3. Route every step `schema-diff.mjs` flagged **destructive** (DROP TABLE/COLUMN, type narrowing) through the data-loss handshake below before anything is written.
4. Then classify the generated migration through the same lock/rewrite/reversibility analysis as single-file mode.

## What to do (single-file lint)
1. Parse the migration (raw SQL or generated ORM migration). Detect the engine; load engine-specific lock/rewrite rules.
2. For each statement, **classify**:
   - **Lock level** — e.g. Postgres `ACCESS EXCLUSIVE` (blocks reads+writes) vs `SHARE UPDATE EXCLUSIVE`; whether it blocks the table for the duration.
   - **Table rewrite** — does the change rewrite every row (e.g. adding a `NOT NULL` column with a volatile default on an old engine, changing a column type)? Rewrites scale with table size.
   - **Reversibility** — is there a clean down-migration, or is it one-way (data already dropped/coerced)?
   - **Destructive / data-loss** — `DROP COLUMN/TABLE`, `TRUNCATE`, narrowing types, enum-value removal, irreversible coercions.
3. Emit findings per `schema/finding.schema.json` (status/severity/`evidence.observed` quoting the offending statement with secrets redacted/`verification.reproduce`/`expected_impact.axis=performance`+confidence+magnitude). A destructive migration without reversibility/expand-contract is severity-5 (caps Performance). Never fabricate a row-count or lock-duration — magnitude is banded high|medium|low and scales with table size described, not invented.
4. Propose an **expand-contract** rollout for risky changes: *expand* (add the new nullable column / new table / dual-write), *migrate* (backfill in batches, online), *contract* (flip constraints, drop the old shape) — each as a separate, individually-reversible step with the lock level per step.

## Safety / handshake
- This command never applies a migration on its own. `--apply` only *requests* application.
- Any step classified **data-loss / destructive** requires an explicit **token handshake**: present the exact statement(s) and the irreversible consequence, then require the user to **type back the affected object's name verbatim** — not a yes/no. Example: to confirm `DROP TABLE orders`, the user must type `orders`; to drop a column `email`, they type `email`. A reply that does not exactly match the object name aborts the step. See `references/migration-safety.md` for the handshake rules.
- Actual writes are delegated only to the **db-migration-writer** subagent (the one agent with Write/Edit), and only after the handshake. Read-only by default.
