#!/usr/bin/env node
// Classify each statement in a migration file by operational risk. Backs M22 (migration safety):
// reversibility, lock level, table rewrite, destructive ops. Static (Tier-0) — the lock/rewrite
// labels follow modern Postgres semantics and are flagged best-effort; confirm with a dry-run
// (BEGIN; <stmt>; ROLLBACK;) on a copy when the stakes are high. Never executes anything.
//
// Usage: node lint-migration.mjs --file <migration.sql>
//   -> JSON array of { statement, op, reversible, lock_level, rewrite, destructive, note }

import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, emit } from './lib/util.mjs';

// Split into statements on top-level semicolons, ignoring comments and string literals.
function splitStatements(text) {
  const stmts = [];
  let cur = '', i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === '--') { const nl = text.indexOf('\n', i); i = nl === -1 ? text.length : nl; continue; }
    if (two === '/*') { const end = text.indexOf('*/', i); i = end === -1 ? text.length : end + 2; continue; }
    const ch = text[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch; cur += ch; i++;
      while (i < text.length) { cur += text[i]; if (text[i] === q && text[i - 1] !== '\\') { i++; break; } i++; }
      continue;
    }
    if (ch === ';') { if (cur.trim()) stmts.push(cur.trim()); cur = ''; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts;
}

function classify(stmt) {
  const u = stmt.replace(/\s+/g, ' ').trim();
  const r = {
    statement: u.length > 240 ? u.slice(0, 237) + '...' : u,
    op: 'other', reversible: true, lock_level: 'none', rewrite: false, destructive: false, note: '',
  };

  if (/^DROP\s+(TABLE|COLUMN)\b/i.test(u) || /\bDROP\s+COLUMN\b/i.test(u)) {
    r.op = /DROP\s+TABLE/i.test(u) ? 'drop_table' : 'drop_column';
    r.destructive = true; r.reversible = false; r.lock_level = 'ACCESS EXCLUSIVE';
    r.note = 'Data loss; not reversible by a down migration. Stage as deprecate -> stop-writing -> drop.';
    return r;
  }
  if (/^DROP\s+(INDEX|VIEW|SEQUENCE|TYPE|SCHEMA|DATABASE)\b/i.test(u)) {
    r.op = 'drop_object'; r.destructive = true; r.reversible = false;
    r.lock_level = /DROP\s+INDEX/i.test(u) && !/CONCURRENTLY/i.test(u) ? 'ACCESS EXCLUSIVE' : 'none';
    if (/DROP\s+INDEX/i.test(u) && !/CONCURRENTLY/i.test(u)) r.note = 'Use DROP INDEX CONCURRENTLY to avoid blocking.';
    return r;
  }
  if (/\bADD\s+COLUMN\b/i.test(u)) {
    r.op = 'add_column';
    const notNull = /\bNOT\s+NULL\b/i.test(u);
    const hasDefault = /\bDEFAULT\b/i.test(u);
    const volatileDefault = hasDefault && !/DEFAULT\s+(NULL|TRUE|FALSE|'[^']*'|-?\d+(\.\d+)?|CURRENT_DATE)\b/i.test(u) && /DEFAULT\s+\w+\s*\(/i.test(u);
    if (notNull && hasDefault) {
      r.rewrite = true; r.lock_level = 'ACCESS EXCLUSIVE';
      r.note = 'ADD COLUMN NOT NULL DEFAULT rewrites the table and holds ACCESS EXCLUSIVE on PostgreSQL < 11. On PG >= 11 a constant default is metadata-only; a volatile default still rewrites.';
    } else if (volatileDefault) {
      r.rewrite = true; r.lock_level = 'ACCESS EXCLUSIVE';
      r.note = 'Volatile DEFAULT forces a full table rewrite even on modern PostgreSQL.';
    } else {
      r.lock_level = 'ACCESS EXCLUSIVE (brief, metadata-only)';
    }
    return r;
  }
  if (/\bALTER\s+COLUMN\b[\s\S]*\b(TYPE|SET\s+DATA\s+TYPE)\b/i.test(u)) {
    r.op = 'alter_type'; r.rewrite = true; r.lock_level = 'ACCESS EXCLUSIVE';
    // NUMERIC(n,m) is NOT treated as narrowing — widening (e.g. numeric(20,4)) is common and we
    // can't know the prior precision from the DDL alone. Only obvious downsizes stay flagged.
    const narrowing = /\b(VARCHAR|CHAR)\s*\(\s*\d+\s*\)/i.test(u) || /\b(SMALLINT|INT(EGER)?)\b/i.test(u);
    if (narrowing) { r.reversible = false; r.note = 'Type change may be narrowing (truncation/overflow risk) and is hard to reverse. Rewrites + blocks the table.'; }
    else r.note = 'Type change rewrites the table under ACCESS EXCLUSIVE.';
    return r;
  }
  if (/\bCREATE\s+(UNIQUE\s+)?INDEX\b[\s\S]*\bCONCURRENTLY\b/i.test(u) || /\bCREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i.test(u)) {
    r.op = 'create_index'; r.lock_level = 'SHARE UPDATE EXCLUSIVE (non-blocking)';
    r.note = 'CONCURRENTLY builds without blocking writes (cannot run inside a transaction block). If it fails it leaves an INVALID index — DROP INDEX CONCURRENTLY before retrying.';
    return r;
  }
  if (/\bADD\s+(CONSTRAINT\s+\S+\s+)?UNIQUE\b/i.test(u) || /\bCREATE\s+UNIQUE\s+INDEX\b/i.test(u)) {
    r.op = 'add_unique';
    r.lock_level = /CONCURRENTLY/i.test(u) ? 'SHARE UPDATE EXCLUSIVE' : 'ACCESS EXCLUSIVE';
    r.note = 'Fails at apply time if duplicates exist — dedup first (verify with a GROUP BY ... HAVING COUNT(*) > 1). Prefer CREATE UNIQUE INDEX CONCURRENTLY then ADD CONSTRAINT ... USING INDEX.';
    return r;
  }
  if (/\bADD\s+(CONSTRAINT\s+\S+\s+)?FOREIGN\s+KEY\b/i.test(u) || /\bREFERENCES\b/i.test(u) && /\bADD\b/i.test(u)) {
    r.op = 'add_fk'; r.lock_level = 'SHARE ROW EXCLUSIVE';
    r.note = 'Validates existing rows under a lock. Use ADD ... NOT VALID then VALIDATE CONSTRAINT to avoid the long lock.';
    return r;
  }
  if (/\bSET\s+NOT\s+NULL\b/i.test(u)) {
    r.op = 'set_not_null'; r.lock_level = 'ACCESS EXCLUSIVE';
    r.note = 'Full table scan to validate. On PG >= 12 add a CHECK (col IS NOT NULL) NOT VALID, VALIDATE, then SET NOT NULL.';
    return r;
  }
  if (/^CREATE\s+INDEX\b/i.test(u)) {
    r.op = 'create_index';
    r.lock_level = /CONCURRENTLY/i.test(u) ? 'SHARE UPDATE EXCLUSIVE' : 'SHARE (blocks writes)';
    if (!/CONCURRENTLY/i.test(u)) r.note = 'Blocks writes for the whole build. Use CREATE INDEX CONCURRENTLY in production.';
    return r;
  }
  if (/^(UPDATE|DELETE\s+FROM)\b/i.test(u)) {
    r.op = /^UPDATE/i.test(u) ? 'update' : 'delete';
    if (!/\bWHERE\b/i.test(u)) {
      r.destructive = true; r.reversible = false;
      r.note = (r.op === 'delete' ? 'DELETE' : 'UPDATE') + ' without WHERE touches every row — almost certainly unintended and irreversible.';
    } else {
      r.note = 'Bulk DML — irreversible without a backup; batch large updates to avoid long locks / bloat.';
      r.reversible = false;
    }
    return r;
  }
  if (/\bALTER\s+TYPE\b[\s\S]*\bDROP\s+VALUE\b/i.test(u) || (/\bALTER\s+TYPE\b/i.test(u) && /\bDROP\b/i.test(u))) {
    r.op = 'enum_remove_value'; r.destructive = true; r.reversible = false; r.lock_level = 'ACCESS EXCLUSIVE';
    r.note = 'PostgreSQL cannot DROP an enum value; this requires recreating the type. Irreversible and breaks rows using the value.';
    return r;
  }
  if (/\bALTER\s+TYPE\b[\s\S]*\bADD\s+VALUE\b/i.test(u)) {
    r.op = 'enum_add_value'; r.reversible = false;
    r.note = 'ADD VALUE cannot run inside a transaction block on older PG and cannot be removed later — prefer a lookup table for evolving sets.';
    return r;
  }
  if (/^CREATE\s+TABLE\b/i.test(u)) { r.op = 'create_table'; r.lock_level = 'none'; return r; }
  if (/^ALTER\s+TABLE\b/i.test(u) && /\bRENAME\b/i.test(u)) {
    r.op = 'rename'; r.lock_level = 'ACCESS EXCLUSIVE (brief)';
    r.note = 'Rename breaks code referencing the old name — coordinate with a deploy.';
    return r;
  }
  return r;
}

function lintFile(file) {
  return splitStatements(readFileSync(file, 'utf8')).map((s) => ({ file, ...classify(s) }));
}

function main() {
  const args = parseArgs();
  if (args.help) { process.stdout.write('Usage: node lint-migration.mjs --file <migration.sql|migration-dir>\nClassifies each statement {op, reversible, lock_level, rewrite, destructive}. A directory lints every *.sql in sorted order. JSON to stdout.\n'); process.exit(0); }
  const file = args.file || args._[0];
  if (!file) emit({ error: 'pass --file <migration.sql|migration-dir>' }, 1);
  let stat;
  try { stat = statSync(file); } catch (e) { emit({ error: 'cannot read path: ' + String((e && e.message) || e) }, 1); }
  try {
    if (stat.isDirectory()) {
      // recurse so nested migration dirs (e.g. versions/2026/...) are covered, not just top level
      const collect = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const p = join(d, e.name);
        if (e.isDirectory()) return collect(p);
        return e.name.toLowerCase().endsWith('.sql') ? [p] : [];
      });
      const files = collect(file).sort();
      if (!files.length) emit({ note: `no .sql files under ${file}`, statements: [] });
      emit(files.flatMap((f) => lintFile(f)));
    } else {
      emit(splitStatements(readFileSync(file, 'utf8')).map(classify));
    }
  } catch (e) { emit({ error: 'cannot lint: ' + String((e && e.message) || e) }, 1); }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
export { splitStatements, classify };
