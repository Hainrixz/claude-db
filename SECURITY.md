# Security Policy

`claude-db` reads database schemas, migration files, ORM models, and — when you opt in — a live
database. Security is part of the product contract, not an afterthought.

## Supported versions

This project is pre-1.0. Security fixes land on the latest `0.x` release.

| Version | Supported |
|---|---|
| 0.1.x | ✅ |

## Reporting a vulnerability

Please report security issues **privately**, not in a public issue:

- Open a [GitHub Security Advisory](https://github.com/Hainrixz/claude-db/security/advisories/new) on
  the repository, **or**
- Email **enriqueers98@gmail.com** with `[claude-db security]` in the subject.

Include the affected version, a reproduction, and the impact. Expect an acknowledgement within a few
business days. Please give a reasonable window to ship a fix before public disclosure. There is no
bug-bounty program; credit is given in the changelog for valid reports unless you prefer to remain
anonymous.

## Security model & guarantees

- **Read-only by default.** Auditor subagents are read-only by tool allowlist. Tier-1 live
  introspection runs under a read-only contract (`default_transaction_read_only=on`, a
  `statement_timeout`, and only `SELECT`/`EXPLAIN`/catalog reads). A `PreToolUse` hook backs this up
  and routes any write-capable MCP `query` tool through the same read-only validator.
- **Writes are opt-in and gated.** Only the `db-migration-writer` agent can write, only via
  `/claude-db:fix`, and only after you confirm each diff. The fixer refuses a dirty git tree and never
  writes to `.git`, secrets, or lockfiles. Destructive operations are surfaced as advisory and never
  applied automatically.
- **Credentials are never echoed.** Connection strings are read from the environment
  (`$DATABASE_URL`) and never written into findings, reports, logs, or backups. `verification.reproduce`
  references `$DATABASE_URL`, never a literal credential. `scripts/lib/util.mjs` `redactSecrets()`
  scrubs any credential before it reaches output.
- **Least privilege.** For live introspection, use a dedicated read-only role scoped to catalog and
  statistics views. Never point the tool at a superuser or write-capable connection.

## Your responsibilities

- Run live introspection against a least-privilege, read-only connection.
- Keep `$DATABASE_URL` and other secrets in environment variables, never committed to the repo.
- Review every fixer diff before accepting it, and run the generated migration in a staging
  environment first.
