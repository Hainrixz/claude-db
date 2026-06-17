---
name: db-multitenancy
description: Audit multi-tenant data isolation — tenant model fit (shared rows vs schema vs database), missing or unenforced tenant scoping, the tenant_id-leading composite index/key requirement, and cross-tenant leak risk where queries or constraints omit the tenant boundary. Module M9. Feeds both the Design & Integrity (Seguridad) and Performance & Scale (Escala) scores.
allowed-tools: Read, Grep, Glob, Bash
---

# db-multitenancy (M9)

In a multi-tenant system the tenant boundary is the most important constraint in the schema: a single query that forgets it leaks one customer's data to another. It is also a performance axis — `tenant_id` must lead the keys and indexes so every access is tenant-pruned. This module is **both**-axis: isolation on design (Seguridad), index/partition locality on performance (Escala). Skip entirely (`not_applicable`) when the system is single-tenant.

## What it checks
- **Tenant model fit**: shared-table (`tenant_id` column) vs schema-per-tenant vs database-per-tenant — flag a model mismatched to the isolation requirement (e.g. shared rows for a strict-isolation/regulated workload with no RLS).
- **Missing tenant scoping**: tenant-owned tables lacking a `tenant_id`/`org_id`/`account_id` column, or a tenant column that is nullable (allowing un-scoped rows).
- **Unenforced isolation**: tenant scoping relied on app code only, with no RLS policy (Postgres) and no constraint — one missing `WHERE tenant_id = ?` leaks data. Ties to M10 (RLS off = sev5 on a relied-on tenant table).
- **tenant_id-leading index/key**: indexes and the PK/clustering key that do **not** lead with `tenant_id`, so the engine cannot prune to one tenant — full-table scans crossing tenants (perf) and worse isolation. Ties to M11 ESR ordering and M16 partitioning.
- **Cross-tenant FK / UNIQUE**: uniqueness or FKs defined without the tenant column, allowing collisions/joins across tenants.

## Axis & severity
- RLS off / no enforced isolation on a relied-on shared-tenant table: severity 5, `fail`, axis `both`, confidence `established` (caps; the cap itself is owned/asserted with M10's RLS rule — coordinate, do not double-count).
- Tenant-owned table missing `tenant_id`: severity 4, `warn`/`fail`, axis `both`.
- Index/PK not leading with `tenant_id`: severity 3, `warn`, axis `performance`.
- UNIQUE/FK omitting tenant column: severity 3–4, `warn`, axis `both`.

## Tier-0 static check
Parse DDL/snapshot via `scripts/parse-schema.mjs`: identify tenant-owned tables (heuristic: business tables in a system flagged multi-tenant), check each for a non-null tenant column, verify PKs/UNIQUEs/indexes lead with it, and detect declared RLS policies. Program-source parses stay `directional` and never raise the sev-5 cap.

## Tier-1 verification query
Check RLS state and tenant-leading indexes:
```sql
-- $DATABASE_URL, read-only
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace;
-- is tenant_id the leading index column?
SELECT i.indexrelid::regclass AS index, a.attname AS first_col
FROM pg_index i
JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
WHERE i.indrelid = '<table>'::regclass;
```
No live DB → RLS/enforcement findings stay `needs_api`, never a silent pass.

## Findings
Emit per `schema/finding.schema.json`. Examples:
- `M9.documents.rls_off_shared_tenant` — shared-tenant table relied on for isolation with RLS disabled (severity 5, `fail`, axis `both`, confidence `established`).
- `M9.invoices.no_tenant_id` — tenant-owned table has no `tenant_id` column (severity 4, `warn`, axis `both`).
- `M9.events.index_not_tenant_leading` — index leads with `created_at`, not `tenant_id`; no per-tenant pruning (severity 3, `warn`, axis `performance`).
Each finding: `evidence.observed` quotes the DDL/index/policy verbatim; `verification.reproduce` is a runnable query above (`method: ddl_parse` / `schema_introspect` / `index_check`); `expected_impact` banded + confidence-tagged.

## Honesty
- The sev-5 isolation cap requires that the table is *actually relied on* for tenant isolation; without live/declared RLS evidence it is `needs_api` or `directional`, never a silent cap.
- App-level `WHERE tenant_id = ?` is real mitigation but is not a database guarantee — one forgotten clause leaks. Say so; do not treat it as equivalent to RLS.
- Single-tenant systems get `not_applicable` (severity 0, excluded from scoring) — never invent a tenancy requirement.
