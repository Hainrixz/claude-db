#!/usr/bin/env node
// Generate FK-aware sample/seed data for a schema (any format parse-schema.mjs understands).
// Deterministic (values derived from row index, no RNG) so output is stable and reviewable.
// Powers `/claude-db:seed`. Emits INSERT statements in FK-dependency order (parents first).
//
// Usage: node gen-seed.mjs --file <schema> [--rows N] [--format sql|json]

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseArgs, emit, quoteIdent } from './lib/util.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function parse(file) {
  let out;
  try {
    out = execFileSync('node', [join(HERE, 'parse-schema.mjs'), '--file', file], { encoding: 'utf8' });
  } catch (e) {
    // re-surface parse-schema's structured {error,hint} instead of "Command failed: ..."
    try { const p = JSON.parse(e.stdout || ''); throw new Error(p.error + (p.hint ? ` (${p.hint})` : '')); }
    catch { throw new Error(String((e && e.message) || e)); }
  }
  const m = JSON.parse(out);
  if (m.error) throw new Error(m.error);
  return m;
}

// Topologically sort tables so a table's FK parents are inserted first. Records FK cycles.
function topoSort(tables) {
  const byName = Object.fromEntries(tables.map((t) => [t.name, t]));
  const seen = new Set(), order = [], cycles = [];
  const visit = (t, stack) => {
    if (seen.has(t.name)) return;
    if (stack.has(t.name)) { cycles.push(t.name); return; }
    stack.add(t.name);
    for (const fk of t.foreignKeys || []) if (byName[fk.refTable] && fk.refTable !== t.name) visit(byName[fk.refTable], stack);
    stack.delete(t.name);
    seen.add(t.name); order.push(t);
  };
  for (const t of tables) visit(t, new Set());
  order.cycles = cycles;
  return order;
}

function valueFor(col, i, fkParentId) {
  if (fkParentId != null) return fkParentId;
  const t = String(col.type || '').toLowerCase();
  const name = col.name.toLowerCase();
  if (col.array) return "'{}'"; // empty array literal (Postgres) for scalar-list columns
  // honor CHECK IN / enum members so the row passes the constraint
  if (col.allowed && col.allowed.length) return `'${String(col.allowed[i % col.allowed.length]).replace(/'/g, "''")}'`;
  if (/uuid/.test(t)) return `'00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}'`;
  if (col.pk || /\b(serial|bigint|integer|int|number|smallint)\b/.test(t)) return i + 1;
  if (/bool/.test(t)) return i % 2 === 0 ? 'true' : 'false';
  if (/(timestamp|datetime|date)/.test(t)) return "'2026-01-0" + ((i % 9) + 1) + "T12:00:00Z'";
  if (/(numeric|decimal|float|double|real|money)/.test(t)) return (10 + i) + '.00';
  if (/email/.test(name)) return `'user${i + 1}@example.com'`;
  if (/(json|jsonb)/.test(t)) return `'{}'`;
  return `'${col.name}_${i + 1}'`;
}

function main() {
  const args = parseArgs();
  if (args.help) { process.stdout.write('Usage: node gen-seed.mjs --file <schema> [--rows N] [--format sql|json]\nGenerates FK-aware, deterministic seed rows in dependency order.\n'); process.exit(0); }
  const file = args.file || args._[0];
  if (!file) emit({ error: 'pass --file <schema>' }, 1);
  const rows = Math.max(1, Math.min(1000, parseInt(args.rows, 10) || 5));
  let model;
  try { model = parse(file); } catch (e) { emit({ error: String((e && e.message) || e) }, 1); }

  const dialect = args.engine || 'postgres';
  const ordered = topoSort(model.tables);
  const statements = [];
  if (ordered.cycles && ordered.cycles.length) {
    statements.push(`-- WARNING: foreign-key cycle through ${ordered.cycles.join(', ')}; wrap these INSERTs in a transaction with DEFERRABLE constraints, or insert parents with NULL FKs first.`);
  }
  for (const t of ordered) {
    const fkByCol = Object.fromEntries((t.foreignKeys || []).flatMap((fk) => (fk.columns || []).map((c) => [c, fk])));
    // Skip database-generated columns: identity/auto-increment PKs and anything with a DEFAULT
    // (let the engine fill them — explicit values into GENERATED ALWAYS identity columns are rejected).
    const cols = t.columns.filter((c) => !c.identity && c.default === undefined);
    const qt = quoteIdent(t.name, dialect);
    for (let i = 0; i < rows; i++) {
      if (cols.length === 0) { statements.push(`INSERT INTO ${qt} DEFAULT VALUES;`); continue; }
      const vals = cols.map((c) => {
        const fk = fkByCol[c.name];
        const parentId = fk ? ((i % rows) + 1) : null; // reference an existing parent row id
        return valueFor(c, i, parentId);
      });
      statements.push(`INSERT INTO ${qt} (${cols.map((c) => quoteIdent(c.name, dialect)).join(', ')}) VALUES (${vals.join(', ')});`);
    }
  }

  if (args.format === 'json') emit({ source: file, rows, dialect, tables: ordered.map((t) => t.name), statement_count: statements.length, statements });
  emit({ source: file, rows, dialect, order: ordered.map((t) => t.name), confidence: model.confidence, sql: statements.join('\n') });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
export { topoSort };
