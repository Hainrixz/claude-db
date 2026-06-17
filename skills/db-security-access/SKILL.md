---
name: db-security-access
description: Audit access control and data protection — Row-Level Security state, PII handling, encryption at-rest and in-transit (TLS / sslmode), and SQL-injection exposure from raw concatenation. Module M10. Feeds the Design & Integrity score.
allowed-tools: Read, Grep, Glob, Bash
---

# db-security-access (M10)

Security is a **Design & Integrity** (axis `design`) concern: a schema can be perfectly normalized and
still leak every row. This module checks who *can* read/write data and whether the data itself is
protected at rest and in flight. RLS-off on a relied-on multi-tenant/Supabase table and plaintext
secrets/SQL-injection are severity-5 caps.

## What it checks

1. **Row-Level Security (RLS)** — on Postgres/Supabase, is RLS enabled on tables that hold per-tenant
   or per-user rows and are reached by a non-superuser/`anon`/`authenticated` role? RLS off on such a
   table is `severity:5`, `fail`. (Tenant *isolation* logic lives in M9; M10 owns the on/off state.)
2. **PII exposure** — columns whose names/types imply personal data (email, ssn, phone, dob, address,
   `card`/`pan`) stored without encryption/tokenization, or logged.
3. **Plaintext secrets in schema** — passwords, API keys, tokens stored as `text`/`varchar` with no
   hashing note, or literal credentials embedded in DDL/migrations/defaults. `severity:5`.
4. **Encryption in transit** — connection config forcing `sslmode=disable` (or no TLS on a remote
   host) is `severity:4`. Encryption at-rest absence is flagged where statically visible.
5. **SQL injection** — raw string concatenation / f-strings / template literals building SQL with
   user input (visible in ORM source or migration helpers). `severity:5`, `design`.

## Score / axis

Feeds **design** only (category *Seguridad*, relational weight 14 shared with M9/M20/M21; analogous
*Seguridad* category in every NoSQL profile).

## Tier-0 (static)

Parse DDL/migrations/ORM source and connection config: detect `text`-typed secret columns, literal
credentials (cross-checked against `redactSecrets()`), `sslmode=disable`, raw-concat SQL, and
PII-named columns. RLS *enablement* (`ALTER TABLE … ENABLE ROW LEVEL SECURITY`) is detectable in
declarative DDL; when RLS state cannot be confirmed from files it is `needs_api` (never a silent pass).

## Tier-1 (verification query, Postgres)

```sql
SELECT c.relname,
       c.relrowsecurity  AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policy_count
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';
```
Method `schema_introspect`/`constraint_check`. A table with `rls_enabled = false` that holds tenant/
user rows confirms `M10.rls.*` as `established` and capping. Runtime-only checks (actual at-rest
encryption, live TLS negotiation) are `needs_api` at Tier-0.

## Findings

Emit findings per `schema/finding.schema.json`. Examples:
- `M10.tenants.rls_disabled` — RLS off on a per-tenant table (`severity:5`, `fail`, axis `design`,
  confidence `established` at Tier-1 / `directional` from DDL, `fixable: proposed`).
- `M10.users.password_plaintext` — secret stored as `text` with no hash (`severity:5`, `fail`,
  `established`, `fixable: advisory`).
- `M10.conn.sslmode_disable` — `sslmode=disable` on a remote host (`severity:4`, `warn`,
  `fixable: proposed`).
- `M10.repo.sql_string_concat` — user input concatenated into SQL (`severity:5`, `fail`, `directional`
  from source, `fixable: advisory`).

Each finding: `evidence.observed` quotes the DDL/connection line/query **verbatim with secrets
redacted**; `verification.reproduce` is the catalog query above (referencing `$DATABASE_URL`) or a
`grep` for the offending pattern; `expected_impact` is banded + confidence-tagged (no naked %).

## Honesty

- "PII present" is not automatically a fail — flag *unprotected* PII; many columns are legitimately
  plaintext. Scope the recommendation to encryption/tokenization, not deletion.
- At-rest encryption is usually a **platform** setting (cloud KMS/volume) invisible in files: report
  `needs_api`, never assert it is missing.
- A `directional` source-only RLS/injection signal **never raises the severity-5 cap** — confirm via
  Tier-1 or generated DDL first.
