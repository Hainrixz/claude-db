---
name: seed
description: Generate FK-aware, deterministic sample/seed data from a database schema, ORM model, or migrations — INSERT statements emitted in dependency order (parents first), values derived from row index so output is stable and reviewable. Read-only; never writes to a database. For dev/test fixtures only. Use when the user asks to seed, generate sample/test/fixture/dummy/fake data, populate tables, or create starter rows for Postgres, MySQL, SQLite, and friends.
argument-hint: "<path-to-schema> [--rows N] [--format sql|json]"
allowed-tools: Read, Grep, Glob, Bash
---

# /claude-db:seed

Generates **FK-aware, deterministic** sample/seed `INSERT`s from a schema. **Read-only** — it never connects to or writes to a database. The output is **dev/test data only**: predictable values derived from the row index (no RNG), suitable for fixtures, local development, and CI — never for production.

`$ARGUMENTS` = `<path-to-schema> [flags]`. The target is a schema/DDL, ORM model, or migration file. If no path is given, detect one in the working directory (look for `*.sql`, `schema.prisma`, `models.py`, migration dirs). If nothing is found, say so plainly and suggest pointing at a file or running `/claude-db:design` to create one.

## What to do
1. Resolve the schema path (from `$ARGUMENTS` or detection above).
2. Run the generator:
   ```bash
   node scripts/gen-seed.mjs --file <schema> --rows N [--format sql|json]
   ```
   - `--rows N` defaults to 5 (clamped 1–1000). `--format` defaults to `sql`; `json` returns the statements as an array plus metadata.
   - The script topologically sorts tables so each table's FK parents are inserted **first**, fills FK columns with valid parent ids, and skips auto-increment/identity PKs.
3. Present the result:
   - The **insert order** (dependency order, parents → children) and per-table row counts.
   - The generated **`INSERT` statements**, grouped by table in that order.
   - The parser **confidence** and any tables skipped or cycles ignored.
4. Offer to **save to a file** (e.g. `seed.sql` or `fixtures.json`) — only write if the user confirms a path. Otherwise leave it inline.

## Notes
- Deterministic by design: re-running with the same `--rows` yields byte-identical output, so seeds are diff-friendly and reproducible.
- Values are illustrative placeholders (emails like `user1@example.com`, fixed timestamps, sequential ids) — **not** realistic or privacy-safe production data.
- Cyclic FKs are ignored for ordering; deferred-constraint or self-referential cases may need a manual pass after generation.

For **dev/test fixtures only**. Never run generated seeds against a production database. Respond in the user's language (EN/ES).
