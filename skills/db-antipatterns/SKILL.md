---
name: db-antipatterns
description: Unified cross-paradigm anti-pattern catalog (M19) — relational and NoSQL smells that no single structural module owns cleanly: EAV / generic key-value tables, the "god table" with hundreds of columns, comma-separated lists in a column, polymorphic associations without FK, boolean-flag soup, Mongo unbounded array growth, deeply nested documents, the document fan-out / "join in app code" trap, Redis as a relied-on durable primary store. Each finding is re-homed to inherit the natural module's category. Feeds the Design & Integrity AND Performance & Scale scores depending on the smell.
allowed-tools: Read, Grep, Glob, Bash
---

# db-antipatterns (M19) — unified anti-pattern catalog

M19 is the catch-all for recognized anti-patterns that span paradigms and don't sit cleanly inside one
structural module. It does **not** own a weight of its own. **Findings inherit the category of the most
natural module**: an EAV smell is a modeling/normalization problem → it scores under M1 (Modelado,
design); a Mongo unbounded-array smell scores under document Crecimiento-doc (performance); polymorphic
associations without an FK score under M3 (Integridad referencial, both). The finding's `module` stays
`M19` for provenance, but `expected_impact.axis` and the rule id's intent route it to the owning
category at scoring time. This avoids double-counting — a single smell contributes to exactly one
category per axis. See `references/scoring-model.md` for the category map per paradigm.

## What it checks (catalog)
**Relational / SQL:**
- **EAV (entity-attribute-value)** generic `(entity, attribute, value)` tables replacing real columns →
  re-homes to M1 (design). Defeats types, constraints, indexing.
- **God table** — one table with dozens-to-hundreds of columns, many nullable → M1 (design).
- **CSV-in-a-column** — `tags VARCHAR` holding `"a,b,c"` instead of a child table/array/jsonb → M1/M4.
- **Polymorphic association** without FK (`commentable_type` + `commentable_id`, no constraint) → M3 (both).
- **Boolean-flag soup** — many `is_*` booleans that should be a state enum/lookup → M4 (design).
- **Magic catch-all `jsonb`/`text` blob** used as schema evasion → re-homes to M4 (design).
**NoSQL:**
- **Mongo unbounded array growth** — arrays that grow without bound toward the 16 MB doc cap → document
  Crecimiento-doc (performance).
- **Deep nesting / massive embedded docs** that should be referenced collections → document
  Access-pattern & embedding (design).
- **App-side join / fan-out** — N reads to stitch documents that a different model would co-locate →
  document Query (performance, directional/structural).
- **Redis as durable primary store** — relied-on data with no AOF/RDB durability path → key-value
  Durabilidad (perf). **Sev-5 only with live evidence** of durability config; else directional.

## Tier-0 static checks
Parse the schema/ORM (`scripts/parse-schema.mjs`, `parse-orm-python.py`). Flag: a table whose columns
are literally `(entity_id, attribute, value)`; column count above a high threshold with mostly-nullable
columns; string columns named `tags`/`roles`/`csv`; `*_type` + `*_id` pairs with no matching FK; ≥N
`is_*`/`has_*` booleans on one table; Mongoose schemas with array-of-subdocument fields and no cap.

## Tier-1 verification query
- Postgres god table: `SELECT relname, count(*) AS cols FROM information_schema.columns
  JOIN pg_class ON relname=table_name GROUP BY relname ORDER BY cols DESC;`
- Mongo array growth (Tier-1/2): `db.coll.aggregate([{$project:{n:{$size:"$items"}}},{$group:{_id:null,max:{$max:"$n"},avg:{$avg:"$n"}}}])`
  and `db.coll.stats()` for avg doc size trending toward 16 MB.
- Redis durability: `CONFIG GET save` and `CONFIG GET appendonly` (needs live; else `needs_api`).

## Findings
Emit per `schema/finding.schema.json`. Example ids:
- `M19.events.eav_table` — generic EAV table (warn, severity 3, axis `design`, confidence `directional`,
  re-homes to Modelado/M1).
- `M19.comments.polymorphic_no_fk` — `commentable_type`/`commentable_id` with no FK (fail, severity 4,
  axis `both`, re-homes to M3).
- `M19.feed.unbounded_array` — Mongo array trending toward 16 MB (warn, severity 4, axis `performance`,
  re-homes to document Crecimiento-doc; **sev-5 only with live size evidence**).
Each finding: `evidence.observed` quotes the real DDL/Mongoose schema/query verbatim with secrets
redacted; `verification.reproduce` is one of the runnable commands above (referencing `$DATABASE_URL`);
`verification.method` is `ddl_parse`, `schema_introspect`, or `manual_review`;
`expected_impact` is `{axis, confidence, magnitude (high|medium|low), rationale}` — banded, never a naked %.

## Honesty
- Never call a pattern an anti-pattern without naming the workload it harms; EAV, denormalized blobs,
  and embedded arrays are legitimate in the right context. State the assumption.
- A `directional` structural smell (e.g. app-side fan-out inferred from ORM source) **never caps** a
  score. Redis-undurable and unbounded-array sev-5 require live evidence; otherwise `directional` or
  `needs_api`, never a silent pass.
