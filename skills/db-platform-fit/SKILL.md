---
name: db-platform-fit
description: Managed-platform fitness (M21) — checks the project against the realities of its hosting platform (Supabase, Neon, PlanetScale, Turso, Cloudflare D1, CockroachDB, Yugabyte, DynamoDB, RDS/Aurora). Engine version currency (without fabricating EOL dates), honest pricing / vendor lock-in trade-offs, and per-platform feature support — most importantly foreign-key support (PlanetScale Vitess historically restricts FKs; D1/SQLite, serverless drivers, connection limits). Feeds the Design & Integrity AND Performance & Scale scores.
allowed-tools: Read, Grep, Glob, Bash, WebFetch
---

# db-platform-fit (M21) — version · pricing/lock-in · per-platform feature support

M21 audits the project against constraints imposed by the **managed platform**, not the raw engine.
The same Postgres schema behaves differently on Neon (serverless, scale-to-zero, branching) vs RDS vs
Supabase (RLS-centric, PostgREST). Findings feed both axes: feature gaps (FK support, RLS) are design;
connection/cold-start/version issues are performance.

## What it checks
1. **Version currency** — the declared/introspected engine version vs the platform's current supported
   range. Flag clearly-old majors. **Never fabricate an EOL date or a "supported until" date.** If the
   exact EOL is not known from a citable source, say "older major, confirm support window with the
   platform" and mark `confidence: directional`. With `WebFetch` you MAY cite the vendor's published
   version page; quote it, don't paraphrase a number you can't source.
2. **Pricing / lock-in honesty** — name the lock-in trade-off (proprietary features: Supabase Auth/RLS
   coupling, PlanetScale Vitess sharding, D1's SQLite dialect, DynamoDB single-table design, Aurora
   storage format). **Never invent a price, a per-GB cost, or a row/request quota.** State the
   *category* of cost (egress, branching compute, read/write units) and that exact figures must be
   confirmed on the vendor's current pricing page. Magnitude banded only.
3. **Per-platform feature support — FK support is the headline check:**
   - **PlanetScale / Vitess** — historically does not enforce foreign keys (and sharded FKs are
     restricted); a schema relying on DB-enforced FKs needs app-level integrity or `FOREIGN_KEY_CHECKS`
     awareness. → design + performance, sev 4 when FKs are declared but unenforceable.
   - **Cloudflare D1 / SQLite** — FKs exist but `PRAGMA foreign_keys` must be ON; limited concurrency,
     DB size ceilings.
   - **DynamoDB / Firestore** — no FKs/joins at all; integrity is an application concern (M3 re-homes).
   - **Serverless drivers (Neon/PlanetScale HTTP, D1)** — direct long-lived PG connections from
     serverless/edge are an anti-pattern → cross-checks `db-connection-pooling` (M15).
   - **Supabase** — RLS must be ON for any table exposed via the auto REST/Realtime API → cross-checks
     `db-security-access` (M10); RLS-off on an exposed table is sev 5 (design).
   - **CockroachDB / Yugabyte** — PG wire-compatible but distributed: serial/sequence hotspots, no
     certain PG extensions, different isolation defaults.

## Tier-0 static checks
Detect the platform from `references/detection-signals.md` signals (`supabase/` dir,
`@planetscale/database`, `@neondatabase/serverless`, `wrangler.toml [[d1_databases]]`,
`@libsql/client`, `cockroach`/`yugabyte` in connection string/deps). Parse declared engine version from
config/migrations. Cross-reference declared FK constraints against the platform's FK-support reality.
Detect direct-PG drivers (`pg`, `Pool`) used in a serverless/edge entrypoint.

## Tier-1 verification query
- Postgres family: `SELECT version();` and `SHOW server_version;`.
- MySQL/PlanetScale: `SELECT VERSION();` and `SELECT @@foreign_key_checks;`; inspect whether declared
  FKs actually exist: `SELECT * FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY';`
- Supabase RLS: `SELECT relname, relrowsecurity FROM pg_class WHERE relkind='r';` and `pg_policies`.
- D1/SQLite: `PRAGMA foreign_keys;`. When the engine/platform isn't reachable → `needs_api`, never a
  false `pass`.

## Findings
Emit per `schema/finding.schema.json`. Example ids:
- `M21.platform.fk_unenforced_on_vitess` — FK constraints declared but PlanetScale/Vitess won't enforce
  them (fail, severity 4, axis `both`, confidence `directional` static / `established` with Tier-1).
- `M21.platform.rls_off_supabase` — table exposed via Supabase API with RLS disabled (fail, severity 5,
  axis `design`, confidence `established` with Tier-1).
- `M21.platform.engine_version_old` — clearly-old engine major (warn, severity 3, axis `both`,
  confidence `directional`; no fabricated EOL date — cite vendor page or defer).
- `M21.platform.serverless_direct_pg` — direct long-lived PG connection from edge/serverless (warn,
  severity 4, axis `performance`; cross-ref M15).
Each finding: `evidence.observed` quotes the real config/DDL/version string verbatim (secrets redacted);
`verification.reproduce` is a runnable command above using `$DATABASE_URL`; `verification.method` is
`connection_introspect`, `schema_introspect`, or `manual_review`; `expected_impact` carries
`{axis, confidence, magnitude, rationale}` — banded, never a naked %.

## Honesty
- **No fabricated EOL dates, prices, or quotas — ever**, in findings or design recs. Cite the vendor's
  current page via `WebFetch` (quote it) or defer with `directional` and a "confirm on vendor page" note.
- Lock-in is a trade-off, not automatically a defect: name what you'd give up, don't moralize.
- Version "old" without a sourced EOL is `directional` and never caps. FK-unenforced caps only at sev 4
  (not 5) unless it directly enables orphan financial/auth rows. Unreachable platform → `needs_api`.
