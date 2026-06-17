# Changelog

All notable changes to claude-db are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/); this project uses semantic versioning.

## [0.1.0] — Unreleased

Initial release — the complete v1 suite.

### Added
- **Plugin scaffold**: `.claude-plugin/plugin.json` + in-repo `marketplace.json`, MIT license.
- **8 command skills** routed under `/claude-db`: `engine`, `design`, `audit`, `introspect`,
  `migrate`, `score`, `explain`, `fix`.
- **Two-score model**: independent **Design & Integrity** and **Performance & Scale** 0–100 scores
  with letter bands (A–F), severity gating (a `severity:5` fail caps that axis at F), and dynamic
  per-paradigm re-normalization (`references/scoring-model.md`, `scripts/score.mjs` → `PROFILES`).
  The two scores are never averaged into one.
- **Multi-paradigm coverage**: relational, document, key-value, wide-column, vector, time-series, and
  graph — each with its own scoring profile so a non-relational store is never penalized for relational
  concepts it lacks. Multi-store audits floor each score at the worst-of across stores per axis.
- **Falsifiable finding contract**: `schema/finding.schema.json` + `schema/audit-report.schema.json`
  (observed `evidence`, a runnable `verification.reproduce` against `$DATABASE_URL`, banded
  `expected_impact` with `axis` + `confidence` + `magnitude`).
- **23 modules** (`db-*`): M0 engine-selection (advisory) + M1–M22 scored — normalization, keys,
  referential integrity, types/precision, constraints, defaults/generated, naming, temporal/history,
  multitenancy, security/access, indexing, index hygiene, query patterns, concurrency, connection
  pooling, partitioning/sharding, replicas/views, storage/bloat, anti-patterns, specialized fit,
  platform fit, and migration safety.
- **Orchestration**: `db-orchestrator` detects the stack/paradigm, builds a shared schema snapshot,
  dispatches read-only auditor subagents in parallel, merges findings, and runs the scorer.
- **Subagents**: read-only auditors (`Read, Grep, Glob, Bash, WebFetch`, model `sonnet`) + one writer
  (`db-migration-writer`) reachable only via `/claude-db:fix`.
- **Opt-in fixer** with hard safety: `disable-model-invocation`, dry-run default, reversible &
  lock-aware migration generation (concurrent index builds, `NOT VALID`/`VALIDATE` splits,
  expand/contract column changes), git-awareness, and a `PreToolUse` write/read-only guard.
- **Three data tiers**: Tier 0 offline (schema/migration/ORM files or a plain-language description),
  Tier 1 read-only live catalog introspection, Tier 2 runtime statistics — with `needs_api` instead
  of a silent pass whenever a higher tier is required.
- **Zero-dependency helpers** (`scripts/`): `detect-stack.mjs`, `parse-schema.mjs`,
  `parse-orm-python.py`, `score.mjs`, and `lib/util.mjs`.
- **Honesty guardrails**: no fabricated stats/latency/row-counts/prices/EOL dates, banded magnitudes,
  confidence labeling throughout, and read-only-by-default introspection.
- **Bilingual docs** (`docs/en`, `docs/es`) and test fixtures (`tests/fixtures`).
