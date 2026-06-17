#!/usr/bin/env node
// Diff two schemas (any format parse-schema.mjs understands) and emit the migration that turns
// `from` into `to`, plus a reversing `down`. Powers `/claude-db:migrate <from> <to>`. Destructive
// steps (DROP TABLE/COLUMN, type narrowing) are flagged so the writer/fix path can gate them.
//
// Usage: node schema-diff.mjs --from <schemaA> --to <schemaB> [--engine postgres|mysql]
// Output: JSON { changes:[...], up:[sql...], down:[sql...], destructive:bool, requires_review:bool }

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseArgs, emit, quoteIdent, mapType, modelIsGeneric } from './lib/util.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function parse(file) {
  let out;
  try {
    out = execFileSync('node', [join(HERE, 'parse-schema.mjs'), '--file', file], { encoding: 'utf8' });
  } catch (e) {
    // re-surface parse-schema's structured {error,hint} rather than "Command failed: ..."
    try { const p = JSON.parse(e.stdout || ''); throw new Error(`${file}: ${p.error}${p.hint ? ` (${p.hint})` : ''}`); }
    catch { throw new Error(`${file}: ${String((e && e.message) || e)}`); }
  }
  const m = JSON.parse(out);
  if (m.error) throw new Error(`${file}: ${m.error}`);
  return m;
}

const byName = (arr, k = 'name') => Object.fromEntries((arr || []).map((x) => [x[k], x]));
// Normalize an ORM/Rails double-quoted string default ("x") to a SQL string literal ('x');
// function/keyword defaults (now(), uuid(), numbers, already-quoted) pass through.
const sqlDefault = (d) => {
  const s = String(d).trim();
  if (/^"(?:[^"\\]|\\.)*"$/.test(s)) return "'" + s.slice(1, -1).replace(/'/g, "''") + "'";
  return s;
};
// Identity/auto-increment columns must NOT carry a SQL DEFAULT.
const colDDL = (c, d) => `${quoteIdent(c.name, d)} ${mapType(c.type || 'text', d)}${c.notNull ? ' NOT NULL' : ''}${(c.default !== undefined && !c.identity) ? ' DEFAULT ' + sqlDefault(c.default) : ''}${c.pk ? ' PRIMARY KEY' : ''}`;

function diff(from, to, dialect = 'postgres') {
  const changes = [], up = [], down = [], notes = [];
  let destructive = false;
  const fromT = byName(from.tables), toT = byName(to.tables);
  const qi = (n) => quoteIdent(n, dialect);
  const create = (t) => `CREATE TABLE ${qi(t.name)} (\n  ${t.columns.map((c) => colDDL(c, dialect)).join(',\n  ')}\n);`;

  // Added tables
  for (const name of Object.keys(toT)) {
    if (fromT[name]) continue;
    changes.push({ kind: 'add_table', object: name });
    up.push(create(toT[name]));
    down.push(`DROP TABLE ${qi(name)};`);
  }
  // Removed tables (destructive)
  for (const name of Object.keys(fromT)) {
    if (toT[name]) continue;
    destructive = true;
    changes.push({ kind: 'drop_table', object: name, destructive: true });
    up.push(`-- DESTRUCTIVE: drops table ${name} and all its data\nDROP TABLE ${qi(name)};`);
    down.push(`-- cannot restore data; recreates structure only\n${create(fromT[name])}`);
  }
  // Changed tables
  for (const name of Object.keys(toT)) {
    if (!fromT[name]) continue;
    const fc = byName(fromT[name].columns), tc = byName(toT[name].columns);
    for (const cn of Object.keys(tc)) {
      if (!fc[cn]) {
        const c = tc[cn];
        changes.push({ kind: 'add_column', object: `${name}.${cn}` });
        if (c.notNull && c.default === undefined) notes.push(`${name}.${cn} is NOT NULL with no default — backfill before enforcing, or add a default.`);
        up.push(`ALTER TABLE ${qi(name)} ADD COLUMN ${colDDL(c, dialect)};`);
        down.push(`ALTER TABLE ${qi(name)} DROP COLUMN ${qi(cn)};`);
      } else if ((fc[cn].type || '') !== (tc[cn].type || '')) {
        changes.push({ kind: 'alter_type', object: `${name}.${cn}`, from: fc[cn].type, to: tc[cn].type });
        notes.push(`${name}.${cn} type ${fc[cn].type} → ${tc[cn].type}: may rewrite/lock the table; verify it is not narrowing.`);
        up.push(`ALTER TABLE ${qi(name)} ALTER COLUMN ${qi(cn)} TYPE ${mapType(tc[cn].type, dialect)};`);
        down.push(`ALTER TABLE ${qi(name)} ALTER COLUMN ${qi(cn)} TYPE ${mapType(fc[cn].type, dialect)};`);
      } else {
        if (!fc[cn].notNull && tc[cn].notNull) {
          changes.push({ kind: 'set_not_null', object: `${name}.${cn}` });
          notes.push(`${name}.${cn} adds NOT NULL — backfill existing NULLs first; on PG12+ use ADD CHECK (${cn} IS NOT NULL) NOT VALID → VALIDATE CONSTRAINT → SET NOT NULL to avoid a long ACCESS EXCLUSIVE lock.`);
          up.push(`ALTER TABLE ${qi(name)} ALTER COLUMN ${qi(cn)} SET NOT NULL;`);
          down.push(`ALTER TABLE ${qi(name)} ALTER COLUMN ${qi(cn)} DROP NOT NULL;`);
        }
        if ((fc[cn].default ?? '') !== (tc[cn].default ?? '')) {
          changes.push({ kind: 'set_default', object: `${name}.${cn}` });
          up.push(tc[cn].default !== undefined ? `ALTER TABLE ${qi(name)} ALTER COLUMN ${qi(cn)} SET DEFAULT ${sqlDefault(tc[cn].default)};` : `ALTER TABLE ${qi(name)} ALTER COLUMN ${qi(cn)} DROP DEFAULT;`);
          down.push(fc[cn].default !== undefined ? `ALTER TABLE ${qi(name)} ALTER COLUMN ${qi(cn)} SET DEFAULT ${sqlDefault(fc[cn].default)};` : `ALTER TABLE ${qi(name)} ALTER COLUMN ${qi(cn)} DROP DEFAULT;`);
        }
      }
    }
    for (const cn of Object.keys(fc)) {
      if (tc[cn]) continue;
      destructive = true;
      changes.push({ kind: 'drop_column', object: `${name}.${cn}`, destructive: true });
      up.push(`-- DESTRUCTIVE: drops column ${name}.${cn} and its data\nALTER TABLE ${qi(name)} DROP COLUMN ${qi(cn)};`);
      down.push(`ALTER TABLE ${qi(name)} ADD COLUMN ${colDDL(fc[cn], dialect)};`);
    }
  }

  return { changes, up, down, destructive, requires_review: destructive || notes.length > 0, notes };
}

function main() {
  const args = parseArgs();
  if (args.help) { process.stdout.write('Usage: node schema-diff.mjs --from <schemaA> --to <schemaB> [--engine postgres|mysql|sqlite]\nDiffs two schemas and emits the up/down migration. Destructive steps are flagged.\n'); process.exit(0); }
  if (!args.from || !args.to) emit({ error: 'pass --from <schemaA> --to <schemaB>' }, 1);
  const dialect = args.engine || 'postgres';
  let from, to;
  try { from = parse(args.from); to = parse(args.to); } catch (e) { emit({ error: String((e && e.message) || e) }, 1); }
  const d = diff(from, to, dialect);
  // If either side used generic/ORM scalar types, the emitted DDL is a translation → directional.
  const translated = modelIsGeneric(from) || modelIsGeneric(to);
  const confidence = (from.confidence === 'directional' || to.confidence === 'directional' || translated) ? 'directional' : 'established';
  emit({ from: args.from, to: args.to, engine: dialect, confidence, note: translated ? 'Types were translated to engine SQL; review the generated DDL before applying.' : undefined, ...d });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
export { diff };
