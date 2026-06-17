---
name: fix
description: Opt-in writer (the /claude-db:fix command). Applies the safe, reversible schema/migration changes from an audit — adding indexes, NOT NULL/CHECK/UNIQUE constraints, missing FKs, type corrections, default/generated columns — as expand-contract migrations. Dry-run preview by default; writes only after explicit per-change confirmation, and only via the migration-writer subagent. Runs only when the user invokes it — never auto-triggered.
disable-model-invocation: true
argument-hint: "<path|findings.json> [--category keys|integrity|types|constraints|indexing|index-hygiene|migration] [--dry-run]"
allowed-tools: Read, Grep, Glob, Bash, Task
---

# fix (opt-in writer)

`disable-model-invocation: true` means the model can **never** trigger this on its own — only the user running `/claude-db:fix`. Writes happen only through the **db-migration-writer** subagent (the one agent with Write/Edit) and only after explicit confirmation. Default is **dry-run**.

## Fixability classes (from each finding's `fixable` field — see `schema/finding.schema.json`)
- **AUTO** — deterministic, additive, reversible, machine-verifiable, low-semantic-risk. May be written (with diff + confirmation), expressed as an expand-contract migration where the change is online-safe:
  add a missing non-unique index / FK-supporting index; add a `NOT NULL`/`CHECK`/`UNIQUE` constraint via `NOT VALID` then `VALIDATE`; add a missing FK as `NOT VALID` then validate; add a default or generated column additively; widen an undersized integer key. Each ships with a clean down-migration.
- **PROPOSED** — changes data, semantics, or shape; generate a draft migration and require per-item accept: type changes that coerce/rewrite data (e.g. `float`→`numeric` money), backfills, denormalization/normalization moves, renames, enum mutations, soft-delete/temporal columns.
- **ADVISORY** — never written by the tool: engine choice (M0), sharding/partitioning topology, RLS/security policy design, capacity/scaling decisions, anything requiring real production data or a judgment call about intent.

## Workflow
1. Take the findings (from the last audit or a fresh one / a findings JSON). Filter to `fixable: auto` (+ `proposed` if the user opts in). Honor `--category` to scope.
2. For each, build the exact migration (expand-contract steps where rewrite/lock risk exists), with a **plain-language line before each diff** explaining what it does and why — then the unified diff / migration file content. Resolve any required real inputs (backfill values, enum target set, FK target) by **asking the user** — never invent them.
3. **Dry-run (default)**: print every plain-language line + diff grouped by file/step. Write nothing. Summarize what `fix` (without `--dry-run`) would change, including lock level and reversibility per step.
4. On explicit confirmation (and only then): delegate to **db-migration-writer** to apply. Per-change or batch confirmation is the user's choice.

## Safety (hard rules)
- **Dry-run is the default**; writing requires dropping `--dry-run` and confirming.
- Any **data-loss / destructive** step (DROP, TRUNCATE, narrowing, enum-value removal) requires the `/claude-db:migrate` **token handshake** before it is written — `fix` routes such steps through migration-safety, it does not shortcut them. The handshake is **concrete, not yes/no**: the user must type the **affected object's name verbatim** (e.g. type `orders` to confirm dropping the `orders` table) — a non-matching reply aborts the step.
- **Git-aware**: refuse to write to a dirty working tree unless `--force`; prefer a branch. Detect via `git status --porcelain`. **No-git-repo branch**: `git status --porcelain` exits **128** outside a repo — treat "no repo" as **writable** (there is nothing to dirty), and backups still go to the plugin data dir; say so in one line to the user before writing.
- **Idempotent**: detect existing constraints/indexes; never duplicate (re-running produces no new diffs once applied).
- **Re-verify**: after writing, re-run each finding's `verification.reproduce` / assertion and report pass/fail per change.
- **Never touch** `.git/`, `.env`/secrets, lockfiles, or files outside the project root; **never write to a live database** — `fix` emits migration files, application is the migration tool's job under the handshake.
- **No fabrication**: never write invented defaults, backfill values, statistics, prices, or credentials.
