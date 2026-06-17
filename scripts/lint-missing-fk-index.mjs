#!/usr/bin/env node
// Find foreign-key columns that are NOT the leading column(s) of any index. An unindexed FK
// makes parent-side deletes/updates do a full child scan and turns ON DELETE actions into
// table locks. Feeds M11 (indexing, performance axis). Static (Tier-0); the verification.reproduce
// confirms it live against pg_constraint/pg_index. Never modifies the database.
//
// Usage: node lint-missing-fk-index.mjs --file <schema|migration|orm>
//   -> JSON array of findings conforming to schema/finding.schema.json (module M11)

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseArgs, emit, redactSecrets, quoteIdent } from './lib/util.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// Reuse parse-schema.mjs so every supported artifact type is handled identically.
function parseSchema(file) {
  const res = spawnSync(process.execPath, [join(HERE, 'parse-schema.mjs'), '--file', file], { encoding: 'utf8' });
  if (res.status !== 0) {
    let err = 'parse-schema failed';
    try { err = JSON.parse(res.stdout || '{}').error || err; } catch { /* keep default */ }
    emit({ error: err }, 1);
  }
  return JSON.parse(res.stdout);
}

// An index "covers" an FK when the FK's columns are a leading prefix of the index columns,
// in order. (A composite FK needs all its columns as the leading prefix.)
function isLeadingPrefix(fkCols, idxCols) {
  if (idxCols.length < fkCols.length) return false;
  for (let i = 0; i < fkCols.length; i++) {
    if (String(idxCols[i]).toLowerCase() !== String(fkCols[i]).toLowerCase()) return false;
  }
  return true;
}

function buildFinding(table, fk, capping) {
  const cols = fk.columns.join(', ');
  const idColExpr = fk.columns.map((c) => `'${c}'`).join(', ');
  return {
    id: `M11.${table.name}.${fk.columns.join('_')}_fk_unindexed`,
    module: 'M11',
    title: `Foreign key ${table.name}(${cols}) has no leading index`,
    status: capping ? 'warn' : 'needs_api',
    severity: 3,
    scope: 'table',
    location: { object: `${table.name}(${cols})` },
    evidence: {
      observed: redactSecrets(`FK ${table.name}(${cols}) -> ${fk.refTable}(${(fk.refColumns || []).join(', ')}); no index has (${cols}) as its leading column(s).`),
    },
    expected: `An index leading with (${cols}) so deletes/updates on ${fk.refTable} and joins on this FK do not scan all of ${table.name}.`,
    recommendation: `CREATE INDEX CONCURRENTLY ON ${quoteIdent(table.name)} (${fk.columns.map((c) => quoteIdent(c)).join(', ')});`,
    fixable: 'proposed',
    fix_preview: `CREATE INDEX CONCURRENTLY idx_${table.name}_${fk.columns.join('_')} ON ${quoteIdent(table.name)} (${fk.columns.map((c) => quoteIdent(c)).join(', ')});`,
    verification: {
      method: 'index_check',
      assertion: `No index on ${table.name} begins with (${cols}).`,
      reproduce:
        `psql "$DATABASE_URL" -c "SELECT c.conname, c.conrelid::regclass AS child, ` +
        `(SELECT array_agg(att.attname ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ` +
        `JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = k.attnum) AS fk_cols ` +
        `FROM pg_constraint c WHERE c.contype = 'f' AND c.conrelid = '${table.name}'::regclass ` +
        `AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid ` +
        `AND (i.indkey::smallint[])[0:array_length(c.conkey,1)-1] = c.conkey);"`,
    },
    expected_impact: {
      axis: 'performance',
      confidence: 'directional',
      magnitude: 'medium',
      rationale: 'Unindexed FK columns force full child-table scans on parent delete/update and on join filters; magnitude scales with child-table size, which static analysis cannot measure — confirm with the live query and EXPLAIN.',
    },
    db: { engine: 'postgres', object: table.name, object_type: 'constraint' },
  };
}

function main() {
  const args = parseArgs();
  if (args.help) { process.stdout.write('Usage: node lint-missing-fk-index.mjs --file <schema>\nFinds FK columns not led by any index. JSON findings (M11) to stdout.\n'); process.exit(0); }
  const file = args.file || args._[0];
  if (!file) emit({ error: 'pass --file <schema>' }, 1);

  const model = parseSchema(file);
  const directional = model.confidence === 'directional';
  const findings = [];

  for (const table of model.tables || []) {
    const indexes = [
      ...(table.indexes || []),
      // a single-column PK / unique column is itself a leading index
      ...(table.primaryKey && table.primaryKey.length ? [{ columns: table.primaryKey }] : []),
      ...(table.columns || []).filter((c) => c.unique).map((c) => ({ columns: [c.name] })),
    ];
    for (const fk of table.foreignKeys || []) {
      if (!fk.columns || !fk.columns.length) continue;
      const covered = indexes.some((idx) => isLeadingPrefix(fk.columns, idx.columns || []));
      if (!covered) {
        const f = buildFinding(table, fk, !directional);
        if (directional) {
          f.status = 'needs_api';
          f.expected_impact.confidence = 'speculative';
          f.expected_impact.rationale += ' Source model parsed heuristically (directional) — verify the FK and index set against the live catalog before acting.';
        }
        findings.push(f);
      }
    }
  }

  emit(findings);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
export { isLeadingPrefix };
