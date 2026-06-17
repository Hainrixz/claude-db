#!/usr/bin/env node
// Parse a schema/migration/ORM file into a normalized model:
//   { source, confidence, dialect, tables: [{ name, columns, primaryKey, indexes, foreignKeys }] }
// Reliable (confidence: established) for declarative/generated artifacts: SQL DDL, Prisma,
// Drizzle meta snapshot JSON, Rails schema.rb. Best-effort (confidence: directional) for program
// source (Drizzle .ts, Mongoose .js, CDK .ts) — a wrongly-parsed model must never cap a score, so
// downstream modules treat directional models accordingly.
//
// Usage: node parse-schema.mjs --file <path>

import { readFileSync } from 'node:fs';
import { extname, basename } from 'node:path';
import { parseArgs, emit, GENERIC_SCALARS } from './lib/util.mjs';

function splitTopLevel(body) {
  // Split on commas that are not inside parentheses (so numeric(12,2) stays intact).
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseSql(text) {
  const tables = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([\w.]+)["`]?\s*\(([\s\S]*?)\)\s*;/gi;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1].replace(/.*\./, '');
    const cols = [], pk = [], indexes = [], fks = [];
    for (const line of splitTopLevel(m[2])) {
      const up = line.toUpperCase();
      if (/^(CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY/i.test(line)) {
        const cm = line.match(/\(([^)]+)\)/);
        if (cm) cm[1].split(',').forEach((c) => pk.push(c.trim().replace(/["`]/g, '')));
        continue;
      }
      if (/^(CONSTRAINT\s+\S+\s+)?UNIQUE/i.test(line)) {
        const cm = line.match(/\(([^)]+)\)/);
        if (cm) indexes.push({ columns: cm[1].split(',').map((c) => c.trim().replace(/["`]/g, '')), unique: true });
        continue;
      }
      if (/^(CONSTRAINT\s+\S+\s+)?FOREIGN\s+KEY/i.test(line)) {
        const fm = line.match(/FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+["`]?([\w.]+)["`]?\s*\(([^)]+)\)/i);
        if (fm) fks.push({ columns: fm[1].split(',').map((c) => c.trim().replace(/["`]/g, '')), refTable: fm[2].replace(/.*\./, ''), refColumns: fm[3].split(',').map((c) => c.trim().replace(/["`]/g, '')) });
        continue;
      }
      const cm = line.match(/^["`]?(\w+)["`]?\s+([A-Za-z0-9_]+(?:\s*\([^)]*\))?(?:\s+with\s+time\s+zone)?)/i);
      if (!cm) continue;
      const col = { name: cm[1], type: cm[2].trim().toLowerCase(), notNull: /\bNOT\s+NULL\b/i.test(line), pk: /\bPRIMARY\s+KEY\b/i.test(line), unique: /\bUNIQUE\b/i.test(line) };
      const dm = line.match(/\bDEFAULT\s+([^,]+?)(?:\s+(?:NOT\s+NULL|UNIQUE|PRIMARY|REFERENCES|CHECK)|$)/i);
      if (dm) col.default = dm[1].trim();
      // database-generated identity / auto-increment — seed/diff must NOT supply explicit values
      if (/\bGENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\b/i.test(line) || /\bAUTO_INCREMENT\b/i.test(line) || /\b(?:big|small)?serial\b/i.test(line)) col.identity = true;
      // allowed values from an inline CHECK (... IN (...)) — for constraint-valid seed data
      const ckm = line.match(/\bCHECK\s*\([^)]*?\bIN\s*\(([^)]+)\)/i);
      if (ckm) col.allowed = ckm[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
      const rm = line.match(/REFERENCES\s+["`]?([\w.]+)["`]?\s*(?:\(([^)]+)\))?/i);
      if (rm) fks.push({ columns: [col.name], refTable: rm[1].replace(/.*\./, ''), refColumns: rm[2] ? rm[2].split(',').map((c) => c.trim().replace(/["`]/g, '')) : ['id'] });
      if (col.pk) pk.push(col.name);
      cols.push(col);
    }
    tables.push({ name, columns: cols, primaryKey: pk, indexes, foreignKeys: fks });
  }
  return { confidence: 'established', tables };
}

function parsePrisma(text) {
  const tables = [];
  // enum blocks → allowed values, keyed by lowercase enum name (Prisma field types are the enum name)
  const enums = {};
  for (const em of text.matchAll(/enum\s+(\w+)\s*\{([^}]*)\}/g)) {
    enums[em[1].toLowerCase()] = em[2].split('\n').map((l) => {
      const t = l.trim();
      if (!t || t.startsWith('//') || t.startsWith('@@')) return null;
      const mapped = t.match(/@map\(\s*"([^"]*)"\s*\)/); // the DB stores the @map'd value, not the member name
      return mapped ? mapped[1] : t.split(/\s+/)[0];
    }).filter(Boolean);
  }
  const re = /model\s+(\w+)\s*\{([\s\S]*?)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const cols = [], pk = [], indexes = [], fks = [];
    for (const raw of m[2].split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) {
        const u = line.match(/@@unique\(\[([^\]]+)\]/);
        if (u) indexes.push({ columns: u[1].split(',').map((c) => c.trim()), unique: true });
        const idx = line.match(/@@index\(\[([^\]]+)\]/);
        if (idx) indexes.push({ columns: idx[1].split(',').map((c) => c.trim()), unique: false });
        continue;
      }
      const fm = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?/);
      if (!fm) continue;
      // Skip pure relation fields (Type is another model with @relation) but capture the FK scalar.
      const isRelation = /@relation\(/.test(line);
      if (isRelation) {
        const rel = line.match(/fields:\s*\[([^\]]+)\]/);
        const refModel = fm[2];
        if (rel) fks.push({ columns: rel[1].split(',').map((c) => c.trim()), refTable: refModel, refColumns: (line.match(/references:\s*\[([^\]]+)\]/) || [, 'id'])[1].split(',').map((c) => c.trim()) });
        continue;
      }
      const elemType = fm[2].toLowerCase();
      // A list field `Order[]` of another MODEL is a relation, not a column; a scalar/enum list
      // (`String[]`, `Status[]`) IS a column we keep (as an array).
      if (fm[3] && !GENERIC_SCALARS.has(elemType) && !enums[elemType]) continue;
      const col = { name: fm[1], type: elemType, notNull: !fm[4], pk: /@id\b/.test(line), unique: /@unique\b/.test(line) };
      if (fm[3]) col.array = true;
      // balanced @default(...) capture — handles one level of nesting (now(), autoincrement(), dbgenerated("...")).
      const dm = line.match(/@default\(((?:[^()]|\([^()]*\))*)\)/);
      if (dm) col.default = dm[1].trim();
      if (/^autoincrement\(\)$/i.test(col.default || '')) { col.identity = true; delete col.default; } // DB-generated → no SQL DEFAULT
      if (enums[col.type]) col.allowed = enums[col.type];
      if (col.pk) pk.push(col.name);
      cols.push(col);
    }
    tables.push({ name: m[1], columns: cols, primaryKey: pk, indexes, foreignKeys: fks });
  }
  return { confidence: 'established', dialect: (text.match(/provider\s*=\s*"(\w+)"/) || [])[1], tables };
}

function parseDrizzleSnapshot(json) {
  const tables = Object.values(json.tables || {}).map((t) => ({
    name: t.name,
    columns: Object.values(t.columns || {}).map((c) => ({ name: c.name, type: String(c.type).toLowerCase(), notNull: !!c.notNull, pk: !!c.primaryKey, unique: false, identity: /serial/.test(String(c.type).toLowerCase()) || !!c.identity || !!c.autoincrement, default: c.default })),
    primaryKey: Object.values(t.columns || {}).filter((c) => c.primaryKey).map((c) => c.name),
    indexes: Object.values(t.indexes || {}).map((i) => ({ name: i.name, columns: i.columns, unique: !!i.isUnique })),
    foreignKeys: Object.values(t.foreignKeys || {}).map((f) => ({ columns: f.columnsFrom, refTable: f.tableTo, refColumns: f.columnsTo })),
  }));
  return { confidence: 'established', dialect: json.dialect, tables };
}

function parseRubySchema(text) {
  const tables = [];
  const re = /create_table\s+"(\w+)"[^]*?do\s*\|t\|([\s\S]*?)\n\s*end/g;
  let m;
  while ((m = re.exec(text))) {
    const cols = [], indexes = [];
    for (const raw of m[2].split('\n')) {
      const line = raw.trim();
      const cm = line.match(/^t\.(\w+)\s+"(\w+)"/);
      if (cm && cm[1] !== 'index') cols.push({ name: cm[2], type: cm[1], notNull: /null:\s*false/.test(line), pk: false, unique: false, default: (line.match(/default:\s*("[^"]*"|\S+?)(?:,|$)/) || [])[1] });
      const im = line.match(/t\.index\s+\[([^\]]+)\][^]*?(unique:\s*true)?/);
      if (im) indexes.push({ columns: im[1].split(',').map((c) => c.trim().replace(/"/g, '')), unique: /unique:\s*true/.test(line) });
    }
    tables.push({ name: m[1], columns: cols, primaryKey: ['id'], indexes, foreignKeys: [] });
  }
  // add_foreign_key "orders", "customers"
  for (const fm of text.matchAll(/add_foreign_key\s+"(\w+)",\s*"(\w+)"/g)) {
    const t = tables.find((x) => x.name === fm[1]);
    if (t) t.foreignKeys.push({ columns: [fm[2].replace(/s$/, '') + '_id'], refTable: fm[2], refColumns: ['id'] });
  }
  return { confidence: 'established', tables };
}

function parseSourceBestEffort(text, kind) {
  // Program source (Drizzle .ts / Mongoose .js / CDK .ts) — heuristic only.
  const tables = [];
  for (const mm of text.matchAll(/new\s+mongoose\.Schema\(\{([\s\S]*?)\}\)/g)) {
    const cols = [];
    for (const fm of mm[1].matchAll(/(\w+)\s*:\s*\{[^}]*type\s*:\s*(\w+)/g)) cols.push({ name: fm[1], type: fm[2].toLowerCase(), notNull: /required\s*:\s*true/.test(mm[1]), pk: false, unique: /unique\s*:\s*true/.test(mm[1]) });
    if (cols.length) tables.push({ name: 'schema', columns: cols, primaryKey: [], indexes: [], foreignKeys: [] });
  }
  return { confidence: 'directional', note: `Parsed ${kind} program source heuristically; prefer a generated artifact (migration SQL / snapshot) or Tier-1 introspection for an authoritative model.`, tables };
}

function main() {
  const args = parseArgs();
  const file = args.file || args._[0];
  if (!file) emit({ error: 'pass --file <path>' }, 1);
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { emit({ error: 'cannot read file: ' + String((e && e.message) || e) }, 1); }
  const ext = extname(file).toLowerCase();
  const name = basename(file).toLowerCase();

  let model;
  if (ext === '.json' || /snapshot/.test(name)) {
    try { model = parseDrizzleSnapshot(JSON.parse(text)); } catch (e) { emit({ error: 'invalid JSON snapshot: ' + String((e && e.message) || e) }, 1); }
  } else if (ext === '.prisma') model = parsePrisma(text);
  else if (ext === '.sql') model = parseSql(text);
  else if (ext === '.rb') model = parseRubySchema(text);
  else if (ext === '.ts' || ext === '.js') model = parseSourceBestEffort(text, ext);
  else if (/create\s+table/i.test(text)) model = parseSql(text);
  else if (/^model\s+\w+/m.test(text)) model = parsePrisma(text);
  else emit({ error: `unsupported file type: ${ext || name}`, hint: 'supported: .sql .prisma .json(snapshot) .rb .ts/.js(best-effort)' }, 1);

  emit({ source: file, ...model, table_count: model.tables.length });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
export { parseSql, parsePrisma, parseDrizzleSnapshot, parseRubySchema };
