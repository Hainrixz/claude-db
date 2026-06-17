#!/usr/bin/env node
// Detect classic schema anti-patterns from a parsed model. Feeds the unified M19 catalog; each
// finding carries the axis of the natural module it belongs to (money-as-float -> design/M4-ish,
// missing-PK -> both/M2-ish). Static (Tier-0) with a Tier-1 verification.reproduce. Read-only.
//
// Detects: float/double for money, EAV (entity-attribute-value), comma-separated values in a
// column, missing primary key, polymorphic FK (typed *_type + *_id with no real FK).
//
// Usage: node lint-antipatterns.mjs --file <schema|migration|orm>
//   -> JSON array of findings conforming to schema/finding.schema.json

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseArgs, emit, redactSecrets } from './lib/util.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseSchema(file) {
  const res = spawnSync(process.execPath, [join(HERE, 'parse-schema.mjs'), '--file', file], { encoding: 'utf8' });
  if (res.status !== 0) {
    let err = 'parse-schema failed';
    try { err = JSON.parse(res.stdout || '{}').error || err; } catch { /* keep */ }
    emit({ error: err }, 1);
  }
  return JSON.parse(res.stdout);
}

const MONEY_HINT = /(price|amount|cost|total|balance|fee|salary|revenue|payment|wage|tax|discount|subtotal|charge|refund|money|currency)/i;
const FLOAT_TYPE = /\b(float|double|real|float4|float8|double\s+precision)\b/i;
const CSV_HINT = /(tags|ids|categories|roles|emails|skus|list|csv|values|items)/i;

function finding(over) {
  return {
    fixable: 'advisory',
    db: { engine: 'generic' },
    ...over,
  };
}

function main() {
  const args = parseArgs();
  if (args.help) { process.stdout.write('Usage: node lint-antipatterns.mjs --file <schema>\nDetects money-as-float, EAV, CSV-in-column, missing PK, polymorphic FK. JSON findings to stdout.\n'); process.exit(0); }
  const file = args.file || args._[0];
  if (!file) emit({ error: 'pass --file <schema>' }, 1);

  const model = parseSchema(file);
  const directional = model.confidence === 'directional';
  const cap = directional ? 'speculative' : 'directional';
  const out = [];

  for (const t of model.tables || []) {
    const cols = t.columns || [];
    const colNames = cols.map((c) => String(c.name).toLowerCase());

    // 1) money stored as float/double
    for (const c of cols) {
      if (MONEY_HINT.test(c.name) && FLOAT_TYPE.test(c.type)) {
        out.push(finding({
          id: `M19.${t.name}.${c.name}_money_as_float`,
          module: 'M19',
          title: `Monetary column ${t.name}.${c.name} uses a binary float type`,
          status: directional ? 'needs_api' : 'fail',
          severity: 5,
          scope: 'column',
          location: { object: `${t.name}.${c.name}` },
          evidence: { observed: redactSecrets(`${t.name}.${c.name} ${c.type} — a money-shaped column stored as binary floating point.`) },
          expected: 'Exact decimal storage (PostgreSQL numeric/MySQL DECIMAL/Mongo Decimal128) for any value representing money.',
          recommendation: `ALTER ${t.name}.${c.name} to numeric(precision, scale); migrate values with rounding to the currency's minor unit.`,
          verification: {
            method: 'ddl_parse',
            assertion: `${t.name}.${c.name} is a float/double/real type while its name denotes money.`,
            reproduce: `psql "$DATABASE_URL" -c "SELECT data_type FROM information_schema.columns WHERE table_name='${t.name}' AND column_name='${c.name}';"`,
          },
          expected_impact: { axis: 'design', confidence: cap, magnitude: 'high', rationale: 'Binary floating point cannot represent decimal currency exactly (0.1 + 0.2 != 0.3), producing rounding drift in sums and reconciliation. Durable correctness defect.' },
          db: { engine: 'generic', object: t.name, object_type: 'column' },
        }));
      }
      // 3) comma-separated values stuffed into a text column
      if (CSV_HINT.test(c.name) && /\b(text|varchar|char|string)\b/i.test(c.type)) {
        out.push(finding({
          id: `M19.${t.name}.${c.name}_csv_in_column`,
          module: 'M19',
          title: `Column ${t.name}.${c.name} likely stores comma-separated values`,
          status: 'needs_api',
          severity: 3,
          scope: 'column',
          location: { object: `${t.name}.${c.name}` },
          evidence: { observed: redactSecrets(`${t.name}.${c.name} ${c.type} — plural, list-shaped name in a scalar text column suggests delimited multi-values.`) },
          expected: 'A child table (one row per value) or a native array/jsonb column — never delimited values in text, which breaks joins, indexing and FK integrity.',
          recommendation: `Normalise into ${t.name}_${c.name} (${t.name.replace(/s$/, '')}_id, value) or use a typed array column with a GIN index.`,
          verification: {
            method: 'query_stat',
            assertion: `${t.name}.${c.name} values contain delimiters.`,
            reproduce: `psql "$DATABASE_URL" -c "SELECT count(*) FROM ${t.name} WHERE ${c.name} LIKE '%,%';"`,
          },
          expected_impact: { axis: 'design', confidence: 'speculative', magnitude: 'medium', rationale: 'Heuristic from column name; delimited values defeat referential integrity and indexing. Inspect actual values to confirm before acting.' },
          db: { engine: 'generic', object: t.name, object_type: 'column' },
        }));
      }
    }

    // 2) EAV: a table with key/attribute + value columns and little else
    const hasAttr = colNames.some((n) => /^(attribute|attr|key|name|prop|property|field|meta_key)$/.test(n));
    const hasVal = colNames.some((n) => /^(value|val|meta_value|data)$/.test(n));
    if (hasAttr && hasVal && cols.length <= 6) {
      out.push(finding({
        id: `M19.${t.name}.eav`,
        module: 'M19',
        title: `Table ${t.name} looks like an Entity-Attribute-Value (EAV) store`,
        status: 'needs_api',
        severity: 3,
        scope: 'table',
        location: { object: t.name },
        evidence: { observed: redactSecrets(`${t.name} has generic attribute/value columns (${colNames.join(', ')}) — the EAV shape.`) },
        expected: 'Typed columns per real attribute, or a jsonb document column with a documented shape — not untyped key/value rows that lose types, constraints and query planning.',
        recommendation: 'Model the known attributes as real, typed, constrained columns; reserve jsonb for genuinely sparse/unknown extension data.',
        verification: { method: 'manual_review', assertion: `${t.name} stores arbitrary attributes as rows.`, reproduce: `psql "$DATABASE_URL" -c "SELECT * FROM ${t.name} LIMIT 20;"` },
        expected_impact: { axis: 'both', confidence: 'speculative', magnitude: 'medium', rationale: 'EAV trades all type safety, constraints and index efficiency for flexibility; confirm the table truly holds heterogeneous attributes before recommending a rewrite.' },
        db: { engine: 'generic', object: t.name, object_type: 'table' },
      }));
    }

    // 4) missing primary key
    if (!(t.primaryKey && t.primaryKey.length) && !cols.some((c) => c.pk)) {
      out.push(finding({
        id: `M19.${t.name}.no_primary_key`,
        module: 'M19',
        title: `Table ${t.name} has no primary key`,
        status: directional ? 'needs_api' : 'fail',
        severity: 5,
        scope: 'table',
        location: { object: t.name },
        evidence: { observed: redactSecrets(`CREATE TABLE ${t.name} (...) declares no PRIMARY KEY and no column is marked primary.`) },
        expected: 'Every table has a primary key (surrogate UUIDv7/ULID/bigint or a justified natural key) so rows are addressable and replication/upserts work.',
        recommendation: `Add a primary key to ${t.name} (e.g. id bigint GENERATED ALWAYS AS IDENTITY, or a UUIDv7).`,
        verification: { method: 'constraint_check', assertion: `${t.name} has no PRIMARY KEY constraint.`, reproduce: `psql "$DATABASE_URL" -c "SELECT 1 FROM pg_constraint WHERE contype='p' AND conrelid='${t.name}'::regclass;"` },
        expected_impact: { axis: 'both', confidence: cap, magnitude: 'high', rationale: 'No PK means rows cannot be uniquely identified — breaks updates/deletes by row, logical replication, and upserts. Foundational defect.' },
        db: { engine: 'generic', object: t.name, object_type: 'table' },
      }));
    }

    // 5) polymorphic FK: *_type text/varchar paired with *_id, no real FK on that column
    for (const c of cols) {
      const m = String(c.name).match(/^(.*)_type$/i);
      if (!m) continue;
      const base = m[1];
      const idCol = cols.find((x) => String(x.name).toLowerCase() === `${base}_id`.toLowerCase());
      const isTextish = /\b(text|varchar|char|string|enum)\b/i.test(c.type);
      const hasRealFk = (t.foreignKeys || []).some((fk) => (fk.columns || []).some((fc) => String(fc).toLowerCase() === `${base}_id`.toLowerCase()));
      if (idCol && isTextish && !hasRealFk) {
        out.push(finding({
          id: `M19.${t.name}.${base}_polymorphic_fk`,
          module: 'M19',
          title: `Polymorphic association ${t.name}.${base}_type/${base}_id has no enforceable FK`,
          status: directional ? 'needs_api' : 'warn',
          severity: 3,
          scope: 'table',
          location: { object: `${t.name}.${base}_id` },
          evidence: { observed: redactSecrets(`${t.name} has ${base}_type ${c.type} + ${base}_id ${idCol.type} with no FOREIGN KEY — a polymorphic reference the database cannot enforce.`) },
          expected: 'Per-target foreign keys (one nullable FK column per referenced table) or an exclusive-arc with CHECK, so referential integrity is actually enforced.',
          recommendation: `Replace the (${base}_type, ${base}_id) pair with explicit nullable FKs per target table plus a CHECK that exactly one is set.`,
          verification: { method: 'constraint_check', assertion: `${t.name}.${base}_id has no FK constraint.`, reproduce: `psql "$DATABASE_URL" -c "SELECT conname FROM pg_constraint WHERE contype='f' AND conrelid='${t.name}'::regclass;"` },
          expected_impact: { axis: 'both', confidence: cap, magnitude: 'medium', rationale: 'Polymorphic FKs cannot be enforced by the database, so orphaned/dangling references accumulate silently and cascades cannot protect data.' },
          db: { engine: 'generic', object: t.name, object_type: 'table' },
        }));
      }
    }
  }

  emit(out);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
