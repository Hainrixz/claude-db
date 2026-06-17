#!/usr/bin/env node
// Detect the database stack(s) of a project from files + dependencies. Returns an ARRAY of
// { paradigm, engine, orm, platform, source_of_truth, confidence, files } — one per detected stack.
// When nothing matches, returns [] with a hint to use description / wizard mode (never guesses an
// engine). source_of_truth precedence: declarative/generated artifact > migration SQL > ORM source;
// a live connection (Tier-1) beats any file.
//
// Usage: node detect-stack.mjs --dir <path>   (default: cwd)

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { parseArgs, emit } from './lib/util.mjs';

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor', 'target', '__pycache__', '.venv', 'venv']);

function walk(dir, depth, acc) {
  if (depth < 0) return acc;
  let entries = [];
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const e of entries) {
    if (IGNORE.has(e)) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, depth - 1, acc);
    else acc.push(p);
  }
  return acc;
}

const ENGINE_BY_PROVIDER = { postgresql: 'postgres', postgres: 'postgres', mysql: 'mysql', mariadb: 'mariadb', sqlite: 'sqlite', mongodb: 'mongodb', cockroachdb: 'cockroachdb', sqlserver: 'generic' };
const PARADIGM_BY_ENGINE = {
  postgres: 'relational', mysql: 'relational', mariadb: 'relational', sqlite: 'relational', cockroachdb: 'relational', yugabyte: 'relational',
  planetscale: 'relational', supabase: 'relational', neon: 'relational', turso: 'relational', d1: 'relational',
  mongodb: 'document', firestore: 'document', redis: 'key-value', dynamodb: 'key-value', cassandra: 'wide-column', scylla: 'wide-column',
  pgvector: 'vector', qdrant: 'vector', pinecone: 'vector', weaviate: 'vector', timescaledb: 'time-series', influxdb: 'time-series', clickhouse: 'time-series', neo4j: 'graph',
};

const DEP_ENGINE = [
  [/drizzle-orm/, { orm: 'drizzle' }], [/@prisma\/client|^prisma$/, { orm: 'prisma' }], [/typeorm/, { orm: 'typeorm' }],
  [/sequelize/, { orm: 'sequelize' }], [/mongoose/, { orm: 'mongoose', engine: 'mongodb' }], [/kysely/, { orm: 'kysely' }],
  [/\bpg\b|postgres/, { engine: 'postgres' }], [/mysql2?|mariadb/, { engine: 'mysql' }], [/better-sqlite3|^sqlite3?$/, { engine: 'sqlite' }],
  [/mongodb/, { engine: 'mongodb' }], [/ioredis|^redis$/, { engine: 'redis' }], [/@planetscale\/database/, { engine: 'planetscale' }],
  [/@supabase\/supabase-js/, { engine: 'supabase' }], [/@neondatabase\/serverless/, { engine: 'neon' }], [/@libsql\/client|@turso/, { engine: 'turso' }],
  [/@aws-sdk\/client-dynamodb|dynamodb/, { engine: 'dynamodb' }], [/cassandra-driver/, { engine: 'cassandra' }], [/neo4j-driver/, { engine: 'neo4j' }],
  [/pgvector/, { engine: 'pgvector' }], [/@qdrant\/js-client/, { engine: 'qdrant' }], [/@pinecone-database/, { engine: 'pinecone' }],
];

function main() {
  const args = parseArgs();
  const dir = args.dir || args._[0] || process.cwd();
  const files = walk(dir, 5, []).map((f) => relative(dir, f));
  const rel = (p) => files.find((f) => f === p || f.endsWith('/' + p));
  const has = (rx) => files.filter((f) => rx.test(f));
  const stacks = [];
  const add = (s) => { s.paradigm = s.paradigm || PARADIGM_BY_ENGINE[s.engine] || 'relational'; stacks.push(s); };

  // 1. Prisma (declarative — authoritative)
  const prisma = rel('prisma/schema.prisma') || has(/schema\.prisma$/)[0];
  if (prisma) {
    let provider;
    try { provider = (readFileSync(join(dir, prisma), 'utf8').match(/provider\s*=\s*"(\w+)"/g) || []).map((x) => x.match(/"(\w+)"/)[1]).find((p) => ENGINE_BY_PROVIDER[p]); } catch {}
    add({ engine: ENGINE_BY_PROVIDER[provider] || 'postgres', orm: 'prisma', source_of_truth: prisma, confidence: 'established', files: [prisma] });
  }

  // 2. Drizzle snapshot (generated — authoritative) vs source (.ts — directional)
  const snap = has(/drizzle\/meta\/.*_snapshot\.json$|drizzle-snapshot\.json$/)[0];
  const drizzleSrc = has(/drizzle\.config\.(t|j)s$/)[0];
  if (snap || drizzleSrc) {
    let dialect;
    if (snap) { try { dialect = JSON.parse(readFileSync(join(dir, snap), 'utf8')).dialect; } catch {} }
    const engine = dialect === 'mysql' ? 'mysql' : dialect === 'sqlite' ? 'sqlite' : 'postgres';
    add({ engine, orm: 'drizzle', source_of_truth: snap || drizzleSrc, confidence: snap ? 'established' : 'directional', files: [snap, drizzleSrc].filter(Boolean) });
  }

  // 3. Rails schema.rb / structure.sql (generated — authoritative)
  const railsSchema = rel('db/schema.rb') || has(/(^|\/)schema\.rb$/)[0];
  const structureSql = has(/(^|\/)structure\.sql$/)[0];
  if (railsSchema || structureSql) add({ engine: structureSql ? 'postgres' : 'postgres', orm: 'activerecord', source_of_truth: structureSql || railsSchema, confidence: 'established', files: [railsSchema, structureSql].filter(Boolean) });

  // 4. Django (models.py + migrations)
  if (has(/(^|\/)models\.py$/).length && (rel('manage.py') || has(/\/migrations\/\d+.*\.py$/).length)) {
    add({ engine: 'postgres', orm: 'django', source_of_truth: has(/\/migrations\/\d+.*\.py$/)[0] || has(/(^|\/)models\.py$/)[0], confidence: 'directional', files: ['models.py'] });
  }

  // 5. SQLAlchemy / Alembic
  if (rel('alembic.ini') || has(/alembic\/versions\/.*\.py$/).length) add({ engine: 'postgres', orm: 'alembic', source_of_truth: has(/alembic\/versions\/.*\.py$/)[0], confidence: 'directional', files: ['alembic'] });

  // 6. Mongoose source (.js/.ts) — directional
  const mongooseFile = files.find((f) => { try { return /require\(['"]mongoose|from ['"]mongoose/.test(readFileSync(join(dir, f), 'utf8')); } catch { return false; } });
  if (mongooseFile && !stacks.some((s) => s.orm === 'mongoose')) add({ engine: 'mongodb', orm: 'mongoose', source_of_truth: mongooseFile, confidence: 'directional', files: [mongooseFile] });

  // 7. Raw SQL migrations (no ORM detected yet)
  const sqlFiles = has(/\.(sql)$/);
  if (sqlFiles.length && !stacks.length) add({ engine: 'postgres', orm: 'raw-sql', source_of_truth: sqlFiles[0], confidence: 'established', files: sqlFiles.slice(0, 5) });

  // 8. Platform configs
  if (rel('wrangler.toml')) { try { if (/\[\[\s*d1_databases/.test(readFileSync(join(dir, 'wrangler.toml'), 'utf8'))) add({ engine: 'd1', orm: 'raw-sql', platform: 'cloudflare-d1', source_of_truth: 'wrangler.toml', confidence: 'directional', files: ['wrangler.toml'] }); } catch {} }
  if (has(/(^|\/)supabase\//).length) stacks.forEach((s) => { if (s.engine === 'postgres') s.platform = s.platform || 'supabase'; });

  // 9. package.json dependencies (enrich / detect engine when no schema artifact). Iterate EVERY
  // package.json so a monorepo (apps/web + apps/api with different stacks) is fully detected.
  for (const pkg of has(/(^|\/)package\.json$/)) {
    try {
      const json = JSON.parse(readFileSync(join(dir, pkg), 'utf8'));
      const deps = Object.keys({ ...json.dependencies, ...json.devDependencies });
      for (const [rx, info] of DEP_ENGINE) {
        if (deps.some((d) => rx.test(d))) {
          const existing = stacks.find((s) => (info.orm && s.orm === info.orm) || (info.engine && s.engine === info.engine));
          if (existing) { Object.assign(existing, { engine: existing.engine || info.engine, orm: existing.orm || info.orm }); }
          else if (info.engine && !stacks.some((s) => s.engine === info.engine)) add({ engine: info.engine, orm: info.orm || 'unknown', source_of_truth: pkg, confidence: 'directional', files: [pkg] });
        }
      }
    } catch {}
  }

  // 9b. docker-compose service images (a DB declared only in compose).
  const IMG = [[/postgres|supabase\/postgres|pgvector/i, 'postgres'], [/mysql|mariadb/i, 'mysql'], [/mongo/i, 'mongodb'], [/redis/i, 'redis'], [/cassandra|scylla/i, 'cassandra'], [/neo4j/i, 'neo4j'], [/clickhouse/i, 'clickhouse'], [/timescale/i, 'timescaledb']];
  for (const dc of has(/(^|\/)(docker-compose|compose)(\.\w+)?\.ya?ml$/)) {
    try {
      const body = readFileSync(join(dir, dc), 'utf8');
      for (const im of body.matchAll(/image:\s*["']?([\w./:-]+)/gi)) {
        for (const [rx, eng] of IMG) if (rx.test(im[1]) && !stacks.some((s) => s.engine === eng)) add({ engine: eng, orm: 'docker-compose', source_of_truth: dc, confidence: 'directional', files: [dc] });
      }
    } catch {}
  }

  // 10. Connection strings in .env* — one of the most common real-world signals. The value is
  // redacted; we never echo a credential. Scheme → engine, then paradigm from the table.
  const SCHEME_ENGINE = { postgres: 'postgres', postgresql: 'postgres', mysql: 'mysql', mariadb: 'mariadb', 'mongodb+srv': 'mongodb', mongodb: 'mongodb', redis: 'redis', rediss: 'redis', cassandra: 'cassandra', sqlserver: 'generic', libsql: 'turso' };
  for (const envFile of has(/(^|\/)\.env(\.\w+)?$/)) {
    let body;
    try { body = readFileSync(join(dir, envFile), 'utf8'); } catch { continue; }
    for (const m of body.matchAll(/^\s*[\w.]*?(?:DATABASE|DB|MONGO|REDIS|POSTGRES|MYSQL)?_?URL\s*=\s*["']?(\w[\w+]*):\/\//gim)) {
      const engine = SCHEME_ENGINE[m[1].toLowerCase()];
      if (engine && !stacks.some((s) => s.engine === engine)) {
        add({ engine, orm: 'connection-string', source_of_truth: envFile, confidence: 'directional', files: [envFile], note: `connection string in ${envFile} (value redacted)` });
      }
    }
  }

  if (!stacks.length) {
    emit({ stacks: [], hint: 'No database artifacts detected. Use `/claude-db:start` (guided wizard) or pass a plain-language description; never guessing an engine.', files_scanned: files.length });
  }
  emit({ stacks, files_scanned: files.length });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
