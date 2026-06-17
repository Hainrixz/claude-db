#!/usr/bin/env node
// Render a paradigm-aware diagram of a parsed schema. Relational -> Mermaid ERD; document ->
// access-pattern / entity map; DynamoDB -> key-schema + GSI table; Redis -> structure list.
// Best-effort: when the source model was parsed heuristically (directional), the diagram is
// labelled as such so no one mistakes a guessed shape for ground truth. Read-only.
//
// Usage: node gen-diagram.mjs --file <schema> [--format mermaid] [--paradigm relational|document|key-value|wide-column]
//   -> JSON { paradigm, format, diagram, directional }

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseArgs, emit } from './lib/util.mjs';

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

function inferParadigm(model, explicit) {
  if (explicit) return explicit;
  const d = String(model.dialect || '').toLowerCase();
  if (/mongo|document|firestore/.test(d)) return 'document';
  if (/dynamo/.test(d)) return 'key-value';
  if (/cassandra|scylla|wide/.test(d)) return 'wide-column';
  if (/redis/.test(d)) return 'key-value';
  if (/neo4j|graph/.test(d)) return 'graph';
  if (/pgvector|vector|qdrant|pinecone|weaviate/.test(d)) return 'vector';
  if (/timescale|influx|clickhouse|time-?series/.test(d)) return 'time-series';
  return 'relational';
}

// Graph (Neo4j) — render nodes + the edges the FK graph implies, not an ER diagram.
function graphMap(model) {
  const lines = ['%% Graph model (approximate — labels are nodes, FKs become relationships)', 'graph LR'];
  for (const t of model.tables || []) lines.push(`  ${safe(t.name)}([${safe(t.name)}])`);
  for (const t of model.tables || []) for (const f of t.foreignKeys || []) lines.push(`  ${safe(t.name)} -->|${safe((f.columns || []).join('_'))}| ${safe(f.refTable)}`);
  return lines.join('\n');
}

// Mermaid-safe identifier.
function safe(s) { return String(s).replace(/[^A-Za-z0-9_]/g, '_'); }

function mermaidErd(model) {
  const lines = ['erDiagram'];
  for (const t of model.tables || []) {
    lines.push(`  ${safe(t.name)} {`);
    for (const c of t.columns || []) {
      const pk = (t.primaryKey || []).includes(c.name) || c.pk ? ' PK' : '';
      const fk = (t.foreignKeys || []).some((f) => (f.columns || []).includes(c.name)) ? ' FK' : '';
      const tag = (pk + fk).trim();
      lines.push(`    ${safe(c.type || 'col')} ${safe(c.name)}${tag ? ' "' + tag + '"' : ''}`);
    }
    lines.push('  }');
  }
  for (const t of model.tables || []) {
    for (const f of t.foreignKeys || []) {
      // child }o--|| parent : references
      lines.push(`  ${safe(f.refTable)} ||--o{ ${safe(t.name)} : "${safe(f.columns.join('_'))}"`);
    }
  }
  return lines.join('\n');
}

function documentMap(model) {
  // Access-pattern / entity map: each collection, its fields, and embedded vs referenced links.
  const lines = ['# Document model — entity & access-pattern map', ''];
  for (const t of model.tables || []) {
    lines.push(`## ${t.name}`);
    lines.push('Fields: ' + (t.columns || []).map((c) => `${c.name}:${c.type}${c.notNull ? ' (required)' : ''}${c.unique ? ' (unique)' : ''}`).join(', '));
    const refs = (t.foreignKeys || []);
    if (refs.length) {
      lines.push('References (consider embed vs reference per access pattern):');
      for (const f of refs) lines.push(`  - ${f.columns.join(',')} -> ${f.refTable}`);
    } else {
      lines.push('References: none detected (root/aggregate document).');
    }
    lines.push('Access patterns: <document the read/write queries this collection must serve — drives embed/reference and index choices>');
    lines.push('');
  }
  return lines.join('\n');
}

function dynamoTable(model) {
  // Key-schema + GSI table. We can only see attributes statically, so PK/SK are best-effort:
  // first PK column -> partition key, second -> sort key; unique/indexed cols -> candidate GSIs.
  const lines = ['# DynamoDB single-table / key-schema map', ''];
  for (const t of model.tables || []) {
    const pk = (t.primaryKey && t.primaryKey.length ? t.primaryKey : (t.columns || []).filter((c) => c.pk).map((c) => c.name));
    lines.push(`## ${t.name}`);
    lines.push('| Role | Attribute |');
    lines.push('| --- | --- |');
    lines.push(`| Partition key (PK) | ${pk[0] || '<undetermined — set from primary access pattern>'} |`);
    lines.push(`| Sort key (SK) | ${pk[1] || '<none / composite SK to model 1:N>'} |`);
    const gsis = [...(t.indexes || []).filter((i) => i.columns && i.columns.length), ...(t.columns || []).filter((c) => c.unique).map((c) => ({ columns: [c.name], unique: true }))];
    if (gsis.length) {
      lines.push('');
      lines.push('Candidate GSIs (verify against query patterns — DynamoDB indexes are access-pattern-driven):');
      gsis.forEach((g, i) => lines.push(`  - GSI${i + 1}: PK=${g.columns[0]}${g.columns[1] ? ', SK=' + g.columns[1] : ''}`));
    }
    lines.push('');
  }
  lines.push('> Note: key schema inferred from declared keys/indexes; DynamoDB modeling is driven by access patterns, not normalized tables. Validate.');
  return lines.join('\n');
}

function redisStructures(model) {
  const lines = ['# Redis key-space / structure map', ''];
  for (const t of model.tables || []) {
    lines.push(`## ${t.name}`);
    const keyCol = (t.primaryKey && t.primaryKey[0]) || ((t.columns || [])[0] || {}).name || 'id';
    lines.push(`Suggested key pattern: \`${t.name}:{${keyCol}}\``);
    lines.push('Suggested structure: HASH (one field per attribute) — ' + (t.columns || []).map((c) => c.name).join(', '));
    lines.push('Consider: SET/ZSET for membership/ranking indexes, TTL for ephemeral data.');
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs();
  if (args.help) {
    process.stdout.write('Usage: node gen-diagram.mjs --file <schema> [--format mermaid] [--paradigm relational|document|key-value|wide-column]\nPrints JSON { paradigm, format, diagram, directional }.\n');
    process.exit(0);
  }
  const file = args.file || args._[0];
  if (!file) emit({ error: 'pass --file <schema>' }, 1);

  const model = parseSchema(file);
  const paradigm = inferParadigm(model, typeof args.paradigm === 'string' ? args.paradigm : null);
  const format = typeof args.format === 'string' ? args.format : 'mermaid';
  const directional = model.confidence === 'directional';

  let diagram, approximate = false;
  if (paradigm === 'document') diagram = documentMap(model);
  else if (paradigm === 'key-value' && /dynamo/i.test(String(model.dialect || args.paradigm || ''))) diagram = dynamoTable(model);
  else if (paradigm === 'key-value') diagram = (/dynamo/i.test(file) ? dynamoTable(model) : redisStructures(model));
  else if (paradigm === 'wide-column') diagram = dynamoTable(model); // partition/clustering key shape is close enough to render
  else if (paradigm === 'graph') diagram = graphMap(model);
  else if (paradigm === 'vector' || paradigm === 'time-series') { diagram = `%% ${paradigm}: the host tables are shown as an ER diagram; the ${paradigm === 'vector' ? 'embedding/index' : 'hypertable/retention'} shape is not natively diagrammed — review separately.\n` + mermaidErd(model); approximate = true; }
  else diagram = mermaidErd(model);

  if (directional) {
    diagram = `%% DIRECTIONAL: source parsed heuristically (${model.note || 'program source'}); shape is best-effort, verify against a generated artifact or live introspection.\n` + diagram;
  }

  emit({ source: file, paradigm, format, table_count: (model.tables || []).length, directional, approximate, diagram });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
