#!/usr/bin/env node
// Zero-dependency test harness for claude-db. Run: node tests/run.mjs
// Covers the scoring contract (the foundation everything conforms to) plus repo invariants.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { PROFILES } from '../scripts/score.mjs';
import { band, parentModule, redactSecrets } from '../scripts/lib/util.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCORE = join(ROOT, 'scripts', 'score.mjs');
const FIXTURES = join(ROOT, 'tests', 'fixtures');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const section = (name) => console.error('• ' + name);

function score(findings, paradigm = 'relational') {
  const out = execFileSync('node', [SCORE, '--paradigm', paradigm], { input: JSON.stringify(findings), encoding: 'utf8' });
  return JSON.parse(out);
}

// ---- 1. band boundaries ----
section('band boundaries');
ok(band(90) === 'A' && band(89.9) === 'B' && band(80) === 'B' && band(70) === 'C' && band(60) === 'D' && band(59.9) === 'F', 'band thresholds A/B/C/D/F');

// ---- 2. every profile: weights sum to 100 per axis, modules unique within an axis ----
section('per-paradigm profiles balanced & module-unique');
for (const [name, profile] of Object.entries(PROFILES)) {
  for (const axis of ['design', 'performance']) {
    const cats = profile[axis];
    const sum = cats.reduce((s, c) => s + c.weight, 0);
    ok(sum === 100, `${name}.${axis} weights sum to 100 (got ${sum})`);
    const seen = new Set();
    let dup = null;
    for (const c of cats) for (const m of c.modules) { if (seen.has(m)) dup = m; seen.add(m); }
    ok(dup === null, `${name}.${axis} module ${dup} appears in two categories`);
  }
}

// ---- 3. fixtures conform to required finding fields ----
section('sample findings conform to schema (required fields)');
const REQUIRED = ['id', 'module', 'title', 'status', 'severity', 'scope', 'evidence', 'expected', 'recommendation', 'fixable', 'verification', 'expected_impact'];
const sample = JSON.parse(readFileSync(join(FIXTURES, 'sample-findings.json'), 'utf8'));
for (const f of sample) {
  const missing = REQUIRED.filter((k) => !(k in f));
  ok(missing.length === 0, `finding ${f.id} missing ${missing.join(',')}`);
  ok(/^M([0-9]|1[0-9]|2[0-2])[a-z]?$/.test(f.module), `finding ${f.id} module id invalid`);
  ok(['design', 'performance', 'both'].includes(f.expected_impact.axis), `finding ${f.id} bad axis`);
}

// ---- 4. scorer on the sample (relational): two scores, in range, not capped ----
section('relational sample scoring');
const s = score(sample);
ok(s.design_integrity && s.performance_scale, 'both scores present');
ok(s.design_integrity.value >= 0 && s.design_integrity.value <= 100, 'design value in range');
ok(s.performance_scale.value >= 0 && s.performance_scale.value <= 100, 'performance value in range');
ok(s.design_integrity.capped === false && s.performance_scale.capped === false, 'sample not capped (no sev-5 fail)');
ok(typeof s.design_integrity.computed === 'number', 'computed reported alongside value');

// ---- 5. severity-5 fail caps the matching axis at <=59, keeps computed ----
section('severity gating');
const sev5 = [
  { id: 'M2.t.no_pk', module: 'M2', title: 'table has no primary key', status: 'fail', severity: 5, scope: 'table',
    evidence: { observed: 'CREATE TABLE t (a int, b int);' }, expected: 'Every table needs a PK.', recommendation: 'Add a PK.', fixable: 'proposed',
    verification: { method: 'ddl_parse', assertion: 'PK exists', reproduce: 'n/a' },
    expected_impact: { axis: 'design', confidence: 'established', magnitude: 'high', rationale: 'No PK breaks identity/replication.' } },
  { id: 'M7.t.ok', module: 'M7', title: 'naming ok', status: 'pass', severity: 1, scope: 'table',
    evidence: { observed: 'snake_case used' }, expected: 'consistent', recommendation: 'none', fixable: 'advisory',
    verification: { method: 'ddl_parse', assertion: 'ok', reproduce: 'n/a' },
    expected_impact: { axis: 'design', confidence: 'established', magnitude: 'low', rationale: 'ok' } },
];
const g = score(sev5);
ok(g.design_integrity.capped === true, 'design capped by sev-5 fail');
ok(g.design_integrity.value <= 59 && g.design_integrity.band === 'F', 'capped value <=59 and band F');
ok(g.design_integrity.computed >= g.design_integrity.value, 'uncapped computed retained');

// ---- 6. speculative sev-5 fail does NOT cap ----
section('speculative never caps');
const spec = JSON.parse(JSON.stringify(sev5));
spec[0].expected_impact.confidence = 'speculative';
ok(score(spec).design_integrity.capped === false, 'speculative sev-5 does not cap');

// ---- 7. all-needs_api category: no crash, category inactive ----
section('division-by-zero guard');
const na = [
  { id: 'M11.t.x', module: 'M11', title: 'index check needs live db', status: 'needs_api', severity: 3, scope: 'table',
    evidence: { observed: 'no live connection' }, expected: 'index present', recommendation: 'connect', fixable: 'advisory',
    verification: { method: 'index_check', assertion: 'idx', reproduce: 'Tier-1' },
    expected_impact: { axis: 'performance', confidence: 'directional', magnitude: 'medium', rationale: 'needs live' } },
];
const z = score(na);
ok(Number.isFinite(z.performance_scale.value), 'no NaN/Infinity from all-needs_api');
ok(z.performance_scale.categories.every((c) => c.active === false), 'all categories inactive');
ok(z.performance_scale.needs_api_count === 1, 'needs_api counted');

// ---- 8. document paradigm is never penalised for foreign keys ----
section('document never penalised for FKs');
const docFindings = [
  { id: 'M3.t.fk_missing', module: 'M3', title: 'no FK (relational-only)', status: 'fail', severity: 5, scope: 'table',
    evidence: { observed: 'no references' }, expected: 'FK', recommendation: 'add FK', fixable: 'proposed',
    verification: { method: 'ddl_parse', assertion: 'fk', reproduce: 'n/a' },
    expected_impact: { axis: 'design', confidence: 'established', magnitude: 'high', rationale: 'orphans' } },
  { id: 'M19.users.embedding_ok', module: 'M19', title: 'embed-vs-reference choice is sound', status: 'pass', severity: 3, scope: 'collection',
    evidence: { observed: 'orders embedded under customer with bounded size' }, expected: 'good access-pattern fit', recommendation: 'none', fixable: 'advisory',
    verification: { method: 'manual_review', assertion: 'bounded', reproduce: 'n/a' },
    expected_impact: { axis: 'design', confidence: 'directional', magnitude: 'medium', rationale: 'fits read pattern' } },
];
const doc = score(docFindings, 'document');
ok(doc.design_integrity.capped === false, 'document design not capped by an FK finding');
ok(doc.design_integrity.value >= 60, 'document design reflects only document categories');

// ---- 9. redactSecrets scrubs credentials ----
section('secret redaction');
ok(!redactSecrets('postgres://u:hunter2@host:5432/db').includes('hunter2'), 'password in connection string redacted');
ok(!redactSecrets('PGPASSWORD=hunter2').includes('hunter2'), 'password= redacted');

// ---- 9b. detection & parsing on fixtures ----
section('stack detection & schema parsing');
const runJson = (script, ...a) => JSON.parse(execFileSync('node', [join(ROOT, 'scripts', script), ...a], { encoding: 'utf8' }));
const det = runJson('detect-stack.mjs', '--dir', FIXTURES);
ok(det.stacks.length >= 3, `detect-stack found ${det.stacks.length} stacks (>=3)`);
ok(det.stacks.some((x) => x.orm === 'prisma' && x.engine === 'postgres' && x.confidence === 'established'), 'detected Prisma+Postgres (established)');
ok(det.stacks.some((x) => x.orm === 'mongoose' && x.paradigm === 'document' && x.confidence === 'directional'), 'detected Mongoose+document (directional)');
const psql = runJson('parse-schema.mjs', '--file', join(FIXTURES, 'postgres-ddl.sql'));
ok(psql.confidence === 'established' && psql.table_count === 2, 'SQL DDL → 2 tables, established');
ok(psql.tables.find((t) => t.name === 'orders').foreignKeys.some((f) => f.refTable === 'customers'), 'SQL DDL → orders FK to customers parsed');
const pprisma = runJson('parse-schema.mjs', '--file', join(FIXTURES, 'schema.prisma'));
ok(pprisma.confidence === 'established' && pprisma.table_count === 2, 'Prisma → 2 tables, established');
const psnap = runJson('parse-schema.mjs', '--file', join(FIXTURES, 'drizzle-snapshot.json'));
ok(psnap.confidence === 'established' && psnap.tables.find((t) => t.name === 'orders').foreignKeys.length === 1, 'Drizzle snapshot → orders FK parsed');
const prb = runJson('parse-schema.mjs', '--file', join(FIXTURES, 'rails-schema.rb'));
ok(prb.confidence === 'established' && prb.table_count === 2, 'Rails schema.rb → 2 tables, established');
const pjs = runJson('parse-schema.mjs', '--file', join(FIXTURES, 'mongoose-model.js'));
ok(pjs.confidence === 'directional', 'Mongoose .js source → confidence directional (never caps)');

// ---- 10. references <= 200 lines each ----
section('references under 200 lines');
const refDir = join(ROOT, 'references');
if (existsSync(refDir)) {
  for (const f of readdirSync(refDir).filter((x) => x.endsWith('.md'))) {
    const n = readFileSync(join(refDir, f), 'utf8').split('\n').length;
    ok(n <= 200, `references/${f} is ${n} lines (>200)`);
  }
}

// ---- 11. no module SKILL.md uses the misspelled key "user-invokable" ----
section('no misspelled user-invokable key');
const skillsDir = join(ROOT, 'skills');
if (existsSync(skillsDir)) {
  for (const d of readdirSync(skillsDir)) {
    const p = join(skillsDir, d, 'SKILL.md');
    if (existsSync(p)) ok(!readFileSync(p, 'utf8').includes('user-invokable'), `skills/${d}/SKILL.md uses misspelled user-invokable`);
  }
}

// ---- 12. agent names are globally unique and match their filename ----
section('agent names unique');
const agentsDir = join(ROOT, 'agents');
if (existsSync(agentsDir)) {
  const names = new Map();
  for (const f of readdirSync(agentsDir).filter((x) => x.endsWith('.md'))) {
    const m = readFileSync(join(agentsDir, f), 'utf8').match(/^name:\s*(.+)$/m);
    const name = m ? m[1].trim() : null;
    ok(name !== null, `agents/${f} has no name in frontmatter`);
    if (name) { ok(!names.has(name), `agent name "${name}" duplicated`); names.set(name, f); }
  }
}

// ---- 13. JSON manifests & schemas parse ----
section('JSON manifests & schemas valid');
for (const p of ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'schema/finding.schema.json', 'schema/audit-report.schema.json']) {
  const full = join(ROOT, p);
  if (existsSync(full)) { try { JSON.parse(readFileSync(full, 'utf8')); ok(true, p); } catch (e) { ok(false, `${p} invalid JSON: ${e.message}`); } }
}

// ---- 14. security guards (defense in depth) ----
section('guard-sql / guard-write');
const guard = (script, payload) => {
  try { execFileSync('node', [join(ROOT, 'scripts', script)], { input: JSON.stringify(payload), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); return 0; }
  catch (e) { return e.status; }
};
if (existsSync(join(ROOT, 'scripts', 'guard-sql.mjs'))) {
  ok(guard('guard-sql.mjs', { tool_input: { command: 'psql -c "DROP TABLE users;"' } }) === 2, 'guard-sql blocks DROP TABLE');
  ok(guard('guard-sql.mjs', { tool_input: { command: 'psql -c "DELETE FROM users;"' } }) === 2, 'guard-sql blocks DELETE without WHERE');
  ok(guard('guard-sql.mjs', { tool_input: { sql: 'DROP DATABASE prod' } }) === 2, 'guard-sql blocks DROP via mcp sql field');
  ok(guard('guard-sql.mjs', { tool_input: { command: 'redis-cli FLUSHALL' } }) === 2, 'guard-sql blocks FLUSHALL');
  ok(guard('guard-sql.mjs', { tool_input: { command: 'psql -c "SELECT * FROM users WHERE id=1;"' } }) === 0, 'guard-sql allows SELECT');
  ok(guard('guard-sql.mjs', { tool_input: { command: 'psql -c "UPDATE orders SET s=1 WHERE id=2;"' } }) === 0, 'guard-sql allows scoped UPDATE');
}
if (existsSync(join(ROOT, 'scripts', 'guard-write.mjs'))) {
  ok(guard('guard-write.mjs', { tool_input: { file_path: '.git/config' } }) === 2, 'guard-write blocks .git write');
  ok(guard('guard-write.mjs', { tool_input: { file_path: 'src/app.ts' } }) === 0, 'guard-write allows normal write');
}

// ---- 15. lint scripts produce findings on the unsafe/rails fixtures ----
section('lint-migration / lint-missing-fk-index');
if (existsSync(join(ROOT, 'scripts', 'lint-migration.mjs'))) {
  const lm = runJson('lint-migration.mjs', '--file', join(FIXTURES, 'unsafe-migration.sql'));
  const arr = Array.isArray(lm) ? lm : (lm.statements || lm.findings || lm.results || []);
  ok(arr.some((x) => x.destructive === true), 'lint-migration flags a destructive op in the unsafe fixture');
}
if (existsSync(join(ROOT, 'scripts', 'lint-missing-fk-index.mjs'))) {
  const fk = runJson('lint-missing-fk-index.mjs', '--file', join(FIXTURES, 'rails-schema.rb'));
  const arr = Array.isArray(fk) ? fk : (fk.findings || []);
  ok(arr.some((x) => String(x.module) === 'M11'), 'lint-missing-fk-index flags the unindexed FK (M11)');
}

// ---- 16. final-audit regression fixes ----
section('audit-fix regressions');
const mk = (module, axis, conf, sev = 5) => [{ id: `${module}.t.x`, module, title: 'x', status: 'fail', severity: sev, scope: 'table', evidence: { observed: 'x' }, expected: 'x', recommendation: 'x', fixable: 'advisory', verification: { method: 'ddl_parse', assertion: 'x', reproduce: 'x' }, expected_impact: { axis, confidence: conf, magnitude: 'high', rationale: 'x' } }];
// P0-1: directional sev-5 must NOT cap
ok(score(mk('M3', 'design', 'directional')).design_integrity.capped === false, 'directional sev-5 does not cap');
ok(score(mk('M3', 'design', 'established')).design_integrity.capped === true, 'established sev-5 caps');
// P0-2: M22 (migration) caps on a document store (it is in every paradigm profile); M3 (FK) does not
ok(score(mk('M22', 'performance', 'established'), 'document').performance_scale.capped === true, 'M22 sev-5 caps document performance');
ok(score(mk('M3', 'design', 'established'), 'document').design_integrity.capped === false, 'leaked FK finding never caps a document store');
// P0-3/P1-1: guard-sql new rules
if (existsSync(join(ROOT, 'scripts', 'guard-sql.mjs'))) {
  ok(guard('guard-sql.mjs', { tool_input: { command: "psql -c \"COPY t TO PROGRAM 'sh'\"" } }) === 2, 'guard-sql blocks COPY ... PROGRAM (RCE)');
  ok(guard('guard-sql.mjs', { tool_input: { command: 'psql -c "DROP ROLE admin"' } }) === 2, 'guard-sql blocks DROP ROLE');
  ok(guard('guard-sql.mjs', { tool_input: { command: 'psql -c "ALTER SYSTEM SET x=1"' } }) === 2, 'guard-sql blocks ALTER SYSTEM');
  ok(guard('guard-sql.mjs', { tool_input: { command: 'redis-cli SHUTDOWN' } }) === 2, 'guard-sql blocks SHUTDOWN');
}
// P0-4: redactSecrets prefixed tokens / bearer / aws
ok(!redactSecrets('GITHUB_TOKEN=ghp_abc123').includes('ghp_abc123'), 'redacts prefixed *_TOKEN');
ok(!redactSecrets('STRIPE_SECRET_KEY=sk_live_x').includes('sk_live_x'), 'redacts *_SECRET_KEY');
ok(!redactSecrets('Authorization: Bearer eyJhbG.AbC.dEf').includes('eyJhbG'), 'redacts full Bearer token');
ok(!redactSecrets('AKIAIOSFODNN7EXAMPLE').includes('AKIAIOSFODNN7EXAMPLE'), 'redacts AWS access key id');
// P0-5: quoted FK columns stripped (regression covered by parse + the schema id regex)
// P1-9: detect-stack reads a .env connection string (isolated dir — fixtures/ already has a postgres stack)
{
  const envDir = join(ROOT, 'tests', 'fixtures', '_envonly');
  try {
    execFileSync('bash', ['-c', `mkdir -p ${envDir} && printf 'DATABASE_URL=postgres://u:s@h:5432/d\\n' > ${envDir}/.env`]);
    const d = runJson('detect-stack.mjs', '--dir', envDir);
    ok(d.stacks.some((x) => x.orm === 'connection-string' && x.engine === 'postgres'), 'detect-stack reads .env connection string');
  } catch (e) { ok(false, 'detect-stack .env test errored: ' + e.message); }
  finally { try { execFileSync('bash', ['-c', `rm -rf ${envDir}`]); } catch {} }
}

// ---- 17. new features: schema-diff & gen-seed ----
section('schema-diff / gen-seed');
if (existsSync(join(ROOT, 'scripts', 'schema-diff.mjs'))) {
  const a = join(FIXTURES, 'postgres-ddl.sql');
  const d1 = runJson('schema-diff.mjs', '--from', a, '--to', a);
  ok(d1.changes.length === 0 && d1.destructive === false, 'schema-diff of identical schemas is a no-op');
  const onlyCustomers = join(FIXTURES, '_from.sql');
  try {
    execFileSync('bash', ['-c', `printf 'CREATE TABLE customers (id bigint PRIMARY KEY, email text NOT NULL);\\n' > ${onlyCustomers}`]);
    const d2 = runJson('schema-diff.mjs', '--from', onlyCustomers, '--to', a);
    ok(d2.changes.some((c) => c.kind === 'add_table' && c.object === 'orders'), 'schema-diff detects an added table');
    const d3 = runJson('schema-diff.mjs', '--from', a, '--to', onlyCustomers);
    ok(d3.destructive === true && d3.changes.some((c) => c.kind === 'drop_table'), 'schema-diff flags a dropped table as destructive');
  } finally { try { execFileSync('bash', ['-c', `rm -f ${onlyCustomers}`]); } catch {} }
}
if (existsSync(join(ROOT, 'scripts', 'gen-seed.mjs'))) {
  const s = runJson('gen-seed.mjs', '--file', join(FIXTURES, 'postgres-ddl.sql'), '--rows', '2', '--format', 'json');
  ok(s.tables.indexOf('customers') < s.tables.indexOf('orders'), 'gen-seed orders parents (customers) before children (orders)');
  ok(s.statement_count === 4, 'gen-seed emits rows×tables INSERTs');
}

// ---- 18. round-2 fixes: runnable-output correctness ----
section('round-2: runnable output & emit layer');
const tmpw = (name, body) => { const p = join(FIXTURES, name); execFileSync('bash', ['-c', `printf '%s' ${JSON.stringify(body)} > ${p}`]); return p; };
const rmw = (p) => { try { execFileSync('bash', ['-c', `rm -f ${p}`]); } catch {} };
if (existsSync(join(ROOT, 'scripts', 'gen-seed.mjs'))) {
  // P0-1: never insert into an identity/auto-increment PK
  const seed = runJson('gen-seed.mjs', '--file', join(FIXTURES, 'postgres-ddl.sql'), '--rows', '2', '--format', 'json');
  ok(!seed.statements.some((s) => /INSERT INTO\s+"?customers"?\s*\([^)]*\bid\b/.test(s)), 'gen-seed never supplies a value for an identity PK');
  // P1-2: honor CHECK IN allowed values
  const chk = tmpw('_chk.sql', "CREATE TABLE t (id bigserial PRIMARY KEY, status text NOT NULL CHECK (status IN ('pending','paid')));\n");
  const cs = runJson('gen-seed.mjs', '--file', chk, '--format', 'json');
  ok(cs.statements.every((s) => !s.includes("'status_")), 'gen-seed honors CHECK IN (no invented enum literal)');
  rmw(chk);
  // P1-1: quote reserved-word identifiers
  const res = tmpw('_res.sql', 'CREATE TABLE "order" (id bigserial PRIMARY KEY, qty int NOT NULL);\n');
  ok(runJson('gen-seed.mjs', '--file', res, '--format', 'json').statements.some((s) => s.includes('"order"')), 'gen-seed quotes the reserved word "order"');
  rmw(res);
}
if (existsSync(join(ROOT, 'scripts', 'schema-diff.mjs'))) {
  const a = tmpw('_a.sql', 'CREATE TABLE oi (id bigint PRIMARY KEY);\n');
  const b = tmpw('_b.sql', 'CREATE TABLE oi (id bigint PRIMARY KEY, qty int NOT NULL DEFAULT 1);\n');
  ok(runJson('schema-diff.mjs', '--from', a, '--to', b).up[0].includes('DEFAULT 1'), 'schema-diff preserves a column DEFAULT');
  const pd = runJson('schema-diff.mjs', '--from', a, '--to', join(FIXTURES, 'schema.prisma'));
  ok(pd.confidence === 'directional' && pd.up.join(' ').includes('numeric') && !pd.up.join(' ').includes(' decimal'), 'schema-diff translates Prisma types and marks directional');
  rmw(a); rmw(b);
}
// P0-3: guard-sql blocks server-side file read / RCE
if (existsSync(join(ROOT, 'scripts', 'guard-sql.mjs'))) {
  ok(guard('guard-sql.mjs', { tool_input: { command: "SELECT pg_read_file('/etc/passwd')" } }) === 2, 'guard-sql blocks pg_read_file');
  ok(guard('guard-sql.mjs', { tool_input: { command: 'CREATE EXTENSION plpython3u' } }) === 2, 'guard-sql blocks CREATE EXTENSION');
}
// P1-3 + P2: lint-migration directory + CONCURRENTLY classification
if (existsSync(join(ROOT, 'scripts', 'lint-migration.mjs'))) {
  const md = join(FIXTURES, '_migs');
  execFileSync('bash', ['-c', `mkdir -p ${md} && printf 'CREATE UNIQUE INDEX CONCURRENTLY i ON t(x);\\n' > ${md}/001.sql && printf 'DROP TABLE old;\\n' > ${md}/002.sql`]);
  const dl = runJson('lint-migration.mjs', '--file', md);
  ok(Array.isArray(dl) && dl.length === 2 && dl.some((x) => x.op === 'drop_table'), 'lint-migration lints every *.sql in a directory');
  ok(dl.some((x) => x.op === 'create_index'), 'lint-migration classifies CREATE INDEX CONCURRENTLY as create_index');
  execFileSync('bash', ['-c', `rm -rf ${md}`]);
}

// ---- 19. finding-schema conformance (real validation, not just field presence) ----
section('finding-schema conformance');
{
  const schema = JSON.parse(readFileSync(join(ROOT, 'schema', 'finding.schema.json'), 'utf8'));
  const props = schema.properties;
  const topKeys = new Set(Object.keys(props));
  const validate = (f) => {
    const e = [];
    for (const r of schema.required) if (!(r in f)) e.push(`missing ${r}`);
    for (const k of Object.keys(f)) if (!topKeys.has(k)) e.push(`unknown key ${k}`);
    if (f.status && !props.status.enum.includes(f.status)) e.push(`bad status ${f.status}`);
    if (f.scope && !props.scope.enum.includes(f.scope)) e.push(`bad scope ${f.scope}`);
    if (f.fixable && !props.fixable.enum.includes(f.fixable)) e.push(`bad fixable ${f.fixable}`);
    if (typeof f.severity !== 'number' || f.severity < 0 || f.severity > 5) e.push(`bad severity ${f.severity}`);
    const ei = f.expected_impact || {}, eip = props.expected_impact.properties;
    if (ei.axis && !eip.axis.enum.includes(ei.axis)) e.push(`bad axis ${ei.axis}`);
    if (ei.confidence && !eip.confidence.enum.includes(ei.confidence)) e.push(`bad confidence ${ei.confidence}`);
    if (ei.magnitude && !eip.magnitude.enum.includes(ei.magnitude)) e.push(`bad magnitude ${ei.magnitude}`);
    if ((f.verification || {}).method && !props.verification.properties.method.enum.includes(f.verification.method)) e.push(`bad method ${f.verification.method}`);
    if (f.module && !new RegExp(props.module.pattern).test(f.module)) e.push(`bad module ${f.module}`);
    if (f.id && !new RegExp(props.id.pattern).test(f.id)) e.push(`bad id ${f.id}`);
    return e;
  };
  for (const f of sample) { const e = validate(f); ok(e.length === 0, `sample ${f.id} conforms to finding.schema.json: ${e.join('; ')}`); }
}

// ---- 20. round-3 fixes ----
section('round-3 fixes');
if (existsSync(join(ROOT, 'scripts', 'schema-diff.mjs'))) {
  const sd = runJson('schema-diff.mjs', '--from', join(FIXTURES, 'postgres-ddl.sql'), '--to', join(FIXTURES, 'schema.prisma'));
  const up = sd.up.join(' ');
  ok(!up.includes('autoincrement(') && !/DEFAULT\s+"/.test(up), 'schema-diff emits runnable ORM defaults (no truncated/double-quoted DEFAULT)');
  ok(up.includes('DEFAULT now()'), 'schema-diff passes now() through');
  const x = tmpw('_x3.sql', 'CREATE TABLE t (id bigint PRIMARY KEY, name text);\n');
  const y = tmpw('_y3.sql', "CREATE TABLE t (id bigint PRIMARY KEY, name text NOT NULL DEFAULT 'x');\n");
  ok(runJson('schema-diff.mjs', '--from', x, '--to', y).changes.some((c) => c.kind === 'set_not_null'), 'schema-diff detects a new NOT NULL on an existing column');
  rmw(x); rmw(y);
}
if (existsSync(join(ROOT, 'scripts', 'guard-sql.mjs'))) {
  ok(guard('guard-sql.mjs', { tool_input: { command: 'ALTER ROLE app SUPERUSER' } }) === 2, 'guard-sql blocks role privilege escalation');
  ok(guard('guard-sql.mjs', { tool_input: { command: 'SELECT * INTO OUTFILE "/tmp/x" FROM t' } }) === 2, 'guard-sql blocks INTO OUTFILE');
}
ok(!redactSecrets('-----BEGIN RSA PRIVATE KEY-----\nABCDEF\n-----END RSA PRIVATE KEY-----').includes('ABCDEF'), 'redactSecrets strips PEM private keys');

console.error(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
