# Distribution

How `claude-db` ships, how to install it, and how to publish updates. The project distributes through
**two channels** from the same repository: a native **Claude Code plugin** and a cross-agent **Vercel
Skills** package.

## Two channels, one repo

| Channel | Mechanism | What you get |
|---|---|---|
| **Claude Code plugin** | `.claude-plugin/marketplace.json` (`source: ./`) | Full suite: skills + agent orchestration + opt-in MCP/hook |
| **Cross-agent (Vercel Skills)** | `npx skills add` | Agent-agnostic `skills/<name>/SKILL.md` only |

The orchestration layer — the `agents/` subagents (read-only auditors + the single
`db-migration-writer`), the `hooks/` PreToolUse write guard, and the opt-in read-only Postgres MCP from
`.mcp.json.example` — is **Claude-Code-specific**. On other agents the project **degrades to
skills-only**: the Markdown skills still run, but the agent-level safety and tool-allowlist enforcement
that Claude Code provides is not present.

## Claude Code plugin

The in-repo `marketplace.json` declares a single plugin sourced from the repo root (`"source": "./"`),
so the marketplace **is** the repository — no separate publish step or registry upload.

```
/plugin marketplace add Hainrixz/claude-db
/plugin install claude-db@claude-db
/reload-plugins
```

Published at `github.com/Hainrixz/claude-db` — `plugin.json` and `marketplace.json` carry that
`homepage` / `repository`. If you fork this repo, update the owner in `plugin.json`, `marketplace.json`,
and the schema `$id`s to your own.

The plugin works fully offline at **Tier 0** (read schema/migration/ORM files, or accept a
plain-language description, plus the bundled zero-dependency scripts). Live read-only introspection
(Tier 1) and runtime statistics (Tier 2) are opt-in — see [`mcp.md`](./mcp.md) and the
[Data tiers](../../references/data-tiers.md) reference.

## Cross-agent via Vercel Skills

Because every skill is a plain `skills/<name>/SKILL.md` Markdown file, the suite installs into any
compatible agent (Cursor, Codex, Gemini CLI, Windsurf, …):

```
npx skills add Hainrixz/claude-db
```

What carries over and what does not:

| Capability | Claude Code plugin | Cross-agent (skills-only) |
|---|---|---|
| Audit / design / migrate / fix skills (`SKILL.md`) | Yes | Yes |
| Zero-dep scripts (Node ≥ 18, `parse-orm-python.py` via Python 3) | Yes | Yes (if the agent can run Node/Python) |
| `db-migration-writer` as the sole writer subagent | Yes | No (no subagent isolation) |
| PreToolUse write-guard hook (blocks DB writes / file mutation in audits) | Yes | No |
| Opt-in read-only DB MCP (`.mcp.json.example`) | Yes | Depends on host agent |
| `disable-model-invocation` on `fix` | Yes | Not enforced |

> Safety reminder: in Claude Code the fixer (`skills/fix`) is `disable-model-invocation: true` and only
> `db-migration-writer` holds Write/Edit. When running skills-only on another agent, those guarantees
> rely on the host agent's own model and permissions, so review every diff and migration before
> applying.

## Offline Tier-0 guarantee

A complete audit runs with **zero MCP servers, zero API keys, and no database connection**. Tier 0
reads declarative artifacts (`schema.prisma`, Drizzle snapshots, `structure.sql`, raw SQL DDL,
`schema.rb`) and program source (Drizzle `.ts`, Mongoose `.js`, DynamoDB CDK), or accepts a
plain-language description. Anything that needs runtime truth (real index usage, row counts, query
plans, autovacuum state) emits `needs_api` rather than guessing.

## Versioning

Versions live in two places and must stay aligned:

- `.claude-plugin/plugin.json` → `"version"`
- `.claude-plugin/marketplace.json` → the plugin entry's `"version"`

To ship an update, bump the `version` in `plugin.json` (and match it in `marketplace.json`), commit,
and push. Users pull the new build by re-running the marketplace/install flow or `/reload-plugins`.

| Bump | When |
|---|---|
| Patch (`0.1.0 → 0.1.1`) | Fixes, doc edits, no behavior change |
| Minor (`0.1.0 → 0.2.0`) | New modules, skills, or flags; backward-compatible |
| Major (`0.1.0 → 1.0.0`) | Breaking changes to commands, finding schema, or scoring |

Keep the bilingual docs (`docs/en` + `docs/es`) in sync when user-facing behavior changes.

## Pre-publish checklist

```
# syntax-check every script
for f in scripts/*.mjs scripts/lib/*.mjs; do node --check "$f"; done
# run the script self-test against the fixtures
node tests/run.mjs
# validate the plugin manifest (if you have the CLI)
claude plugin validate .
```

## Licensing & originality

`claude-db` is **MIT-licensed** (full text in [`LICENSE`](../../LICENSE)). It is original work: copying
**no** branding, text, or names from any other project. Contributions must uphold the same standard —
including **no fabricated statistics, latency, throughput, row counts, or prices** in findings or
design recommendations. When redistributing, keep the MIT `LICENSE` and copyright notice intact.
