#!/usr/bin/env node
// PreToolUse guard (defense in depth). Blocks destructive SQL / NoSQL commands before they
// reach a Bash shell or an MCP database tool. The read-only auditor allowlists and fix's
// `disable-model-invocation: true` are the primary guarantees; this catches anything that
// slips through (e.g. a model running psql in Bash, or an mcp db tool call).
//
// Wired from hooks/hooks.json on the "Bash" and "mcp__.*" matchers. Reads the hook payload
// on stdin, exits 2 (block) with a reason on stderr if the command is destructive; else 0.
//
// Usage: echo '{"tool_input":{"command":"DROP TABLE x"}}' | node guard-sql.mjs

import { readFileSync } from 'node:fs';

// Pull every plausible "command-ish" string out of the tool payload: Bash command, plus any
// string field in an mcp tool_input (query/sql/statement/command/pipeline/script/text/...).
function collectCommands(input) {
  const out = [];
  if (typeof input === 'string') { out.push(input); return out; }
  if (input && typeof input === 'object') {
    for (const v of Object.values(input)) {
      if (typeof v === 'string') out.push(v);
      else if (v && typeof v === 'object') out.push(...collectCommands(v));
    }
  }
  return out;
}

// Strip ONLY block comments. We intentionally do NOT strip quoted content: the SQL we guard is
// usually shell-wrapped (e.g. `psql -c "DROP TABLE x"`), so stripping quotes would delete the very
// command we must inspect. A keyword inside a string literal may cause a (safe) false block — for a
// destructive-write guard, blocking too much is acceptable; letting a DROP through is not.
function strip(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

// Each rule: a label + a regex tested (case-insensitive) against the stripped command.
const RULES = [
  { label: 'DROP TABLE/DATABASE/SCHEMA/INDEX/COLUMN/VIEW/SEQUENCE/ROLE/USER/OWNED', re: /\bDROP\s+(TABLE|DATABASE|SCHEMA|INDEX|COLUMN|VIEW|MATERIALIZED\s+VIEW|SEQUENCE|TYPE|TRIGGER|FUNCTION|ROLE|USER|OWNED)\b/i },
  { label: 'TRUNCATE', re: /\bTRUNCATE\b/i },
  { label: 'ALTER ... DROP', re: /\bALTER\s+\w+[\s\S]*?\bDROP\b/i },
  { label: 'ALTER SYSTEM (cluster-wide config change)', re: /\bALTER\s+SYSTEM\b/i },
  { label: 'COPY ... PROGRAM (shell exec / RCE)', re: /\bCOPY\b[\s\S]*?\bPROGRAM\b/i },
  { label: 'server-side file read/write (pg_read_file / lo_export / …)', re: /\b(pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|lo_export|lo_import|lo_get|lo_put)\s*\(/i },
  { label: 'CREATE EXTENSION (untrusted PL / RCE surface)', re: /\bCREATE\s+EXTENSION\b/i },
  { label: 'SELECT ... INTO OUTFILE/DUMPFILE (MySQL file write)', re: /\bINTO\s+(OUTFILE|DUMPFILE)\b/i },
  { label: 'LOAD_FILE / LOAD DATA INFILE (MySQL file read)', re: /\bLOAD_FILE\s*\(|\bLOAD\s+DATA\b[\s\S]*?\bINFILE\b/i },
  { label: 'psql meta-command file include/output (\\i, \\copy, \\o)', re: /(^|\s)\\(i|ir|include|include_relative|o|out|copy)\b/i },
  { label: 'role privilege escalation (SUPERUSER / BYPASSRLS / REPLICATION / CREATEROLE / CREATEDB)', re: /\b(CREATE|ALTER)\s+(ROLE|USER|GROUP)\b[\s\S]*?\b(SUPERUSER|BYPASSRLS|REPLICATION|CREATEROLE|CREATEDB)\b/i },
  { label: 'GRANT / REVOKE', re: /\b(GRANT|REVOKE)\b/i },
  { label: 'CREATE/ALTER ROLE|USER ... PASSWORD', re: /\b(CREATE|ALTER)\s+(ROLE|USER)\b[\s\S]*?\bPASSWORD\b/i },
  { label: 'pg_terminate_backend / pg_cancel_backend', re: /\bpg_(terminate|cancel)_backend\s*\(/i },
  { label: 'DROP KEYSPACE (Cassandra)', re: /\bDROP\s+KEYSPACE\b/i },
  // NoSQL / server
  { label: 'dropDatabase()', re: /\bdropDatabase\s*\(/i },
  { label: 'collection.drop()', re: /\.\s*drop\s*\(\s*\)/i },
  { label: 'deleteMany({}) (no filter)', re: /\bdeleteMany\s*\(\s*\{\s*\}\s*\)/i },
  { label: 'updateMany({}, ...) (no filter)', re: /\bupdateMany\s*\(\s*\{\s*\}/i },
  { label: 'remove({}) (no filter)', re: /\bremove\s*\(\s*\{\s*\}\s*\)/i },
  { label: 'FLUSHALL / FLUSHDB (Redis)', re: /\bFLUSH(ALL|DB)\b/i },
  { label: 'SHUTDOWN (Redis / server)', re: /\bSHUTDOWN\b/i },
];

// DELETE FROM / UPDATE with no WHERE clause. Scans every occurrence (not just statement starts) so
// it also fires on shell-wrapped commands like `psql -c "DELETE FROM users"`. For each keyword, the
// window runs to the next `;` (or end); if it has no WHERE, it is unscoped.
function hasUnscopedWrite(s) {
  const re = /\b(DELETE\s+FROM|UPDATE)\b/gi;
  let m;
  while ((m = re.exec(s))) {
    const rest = s.slice(m.index);
    const semi = rest.indexOf(';');
    const win = semi === -1 ? rest : rest.slice(0, semi);
    if (!/\bWHERE\b/i.test(win)) return /^DELETE/i.test(m[1]) ? 'DELETE without WHERE' : 'UPDATE without WHERE';
  }
  return null;
}

function evaluate(cmd) {
  const stripped = strip(cmd);
  for (const r of RULES) if (r.re.test(stripped)) return r.label;
  const w = hasUnscopedWrite(stripped);
  if (w) return w;
  return null;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write('Usage: <hook-payload-json> | node guard-sql.mjs\nBlocks destructive SQL/NoSQL (DROP/TRUNCATE/unscoped DELETE|UPDATE/GRANT/ALTER..DROP/role passwords, dropDatabase, deleteMany({}), FLUSHALL, .drop(), DROP KEYSPACE). Exit 2 to block.\n');
    process.exit(0);
  }

  let payload = {};
  try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }

  const input = payload.tool_input || payload.toolInput || {};
  const commands = collectCommands(input);
  if (!commands.length) process.exit(0);

  for (const cmd of commands) {
    const reason = evaluate(cmd);
    if (reason) {
      process.stderr.write(
        'claude-db: blocked a destructive database command (' + reason + ').\n' +
        'claude-db is read-only by default. Run destructive/schema-changing statements yourself,\n' +
        'after reviewing the proposed migration. The tool will never execute them for you.\n'
      );
      process.exit(2); // block
    }
  }
  process.exit(0); // allow
}

if (import.meta.url === `file://${process.argv[1]}`) main();
