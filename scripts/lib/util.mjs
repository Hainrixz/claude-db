// Shared zero-dependency helpers for the claude-db Node scripts.
// No external deps; Node >= 18.

/**
 * Minimal CLI arg parser: `--flag value` -> { flag: "value" }, bare `--flag` -> { flag: true },
 * positional args collected under `_`.
 */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

/** Print a JSON result to stdout and exit. Default exit code 0. */
export function emit(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  process.exit(code);
}

/**
 * Scrub credentials from any string (or object, JSON-stringified) before it is written
 * to a finding, report, log, or backup. Connection strings, password=, API keys, tokens.
 * Best-effort and intentionally aggressive — claude-db must never leak the user's own secrets.
 */
export function redactSecrets(input) {
  if (input == null) return input;
  let s = typeof input === 'string' ? input : JSON.stringify(input);
  // scheme://user:password@host  ->  scheme://user:****@host
  s = s.replace(
    /\b((?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis(?:s)?|sqlserver|cassandra):\/\/[^:/\s@]+:)[^@/\s]+@/gi,
    '$1****@'
  );
  // password=... / PGPASSWORD=... / DB_PASSWORD=... / pwd=... / MYSQL_PWD=...
  s = s.replace(/([a-z_]*(?:password|pwd))(\s*[=:]\s*)[^\s;'"&]+/gi, '$1$2****');
  // api keys / secrets / tokens — NO leading \b: the common real shape is PREFIXED
  // (GITHUB_TOKEN=, STRIPE_SECRET_KEY=, AWS_ACCESS_KEY_ID=) and `_` is a word char that would
  // defeat a boundary. Match an optional prefix instead.
  s = s.replace(/([a-z0-9_-]*(?:api[_-]?key|access[_-]?key|private[_-]?key|secret|token)[a-z0-9_-]*)(\s*[=:]\s*)[^\s;'"&]+/gi, '$1$2****');
  // Authorization headers — capture the WHOLE token (a JWT has spaces around it but the value
  // itself can be long; the key=value rule above would only catch the first word).
  s = s.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ****');
  // AWS access key ids (AKIA/ASIA + 16) appear bare, with no key= prefix.
  s = s.replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '****');
  // PEM private-key armor (ssh/tls/service-account keys).
  s = s.replace(/-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g, '-----BEGIN PRIVATE KEY----- **** -----END PRIVATE KEY-----');
  // GCP service-account JSON "private_key": "..."
  s = s.replace(/("private_key"\s*:\s*)"(?:[^"\\]|\\.)*"/g, '$1"****"');
  return s;
}

/** Map a sub-module id to its parent: 'M20a' -> 'M20', 'M7' -> 'M7'. */
export function parentModule(m) {
  return String(m || '').replace(/[a-z]$/, '');
}

/** Letter band for a 0-100 value. */
export function band(v) {
  if (v >= 90) return 'A';
  if (v >= 80) return 'B';
  if (v >= 70) return 'C';
  if (v >= 60) return 'D';
  return 'F';
}

// ---- Shared dialect-aware emit layer (consumed by gen-seed.mjs and schema-diff.mjs) ----

const RESERVED = new Set([
  'order', 'user', 'table', 'select', 'from', 'where', 'group', 'by', 'desc', 'asc', 'index', 'constraint',
  'primary', 'key', 'default', 'check', 'unique', 'references', 'column', 'values', 'insert', 'update',
  'delete', 'grant', 'role', 'limit', 'offset', 'join', 'union', 'case', 'when', 'then', 'end', 'null',
  'true', 'false', 'as', 'on', 'and', 'or', 'not', 'in', 'is', 'like', 'between', 'distinct', 'having',
  'into', 'set', 'create', 'drop', 'alter', 'add', 'all', 'any', 'using', 'returning', 'with', 'window',
]);

/** Quote an identifier only when needed (reserved word, mixed case, or special chars). */
export function quoteIdent(name, dialect = 'postgres') {
  const s = String(name);
  const safe = /^[a-z_][a-z0-9_]*$/.test(s) && !RESERVED.has(s.toLowerCase());
  if (safe) return s;
  return dialect === 'mysql' ? '`' + s.replace(/`/g, '``') + '`' : '"' + s.replace(/"/g, '""') + '"';
}

// Generic/ORM scalar names (e.g. Prisma) — when a model uses these, the emitted DDL is a
// cross-dialect translation, so callers should mark confidence `directional`.
export const GENERIC_SCALARS = new Set(['string', 'int', 'integer', 'bigint', 'boolean', 'bool', 'datetime', 'date', 'decimal', 'float', 'double', 'json', 'uuid', 'bytes']);

const TYPE_MAP = {
  postgres: { string: 'text', int: 'integer', integer: 'integer', bigint: 'bigint', boolean: 'boolean', bool: 'boolean', datetime: 'timestamptz', date: 'date', decimal: 'numeric', float: 'double precision', double: 'double precision', json: 'jsonb', uuid: 'uuid', bytes: 'bytea', text: 'text' },
  mysql: { string: 'varchar(255)', int: 'int', integer: 'int', bigint: 'bigint', boolean: 'tinyint(1)', bool: 'tinyint(1)', datetime: 'datetime', date: 'date', decimal: 'decimal(10,2)', float: 'double', double: 'double', json: 'json', uuid: 'char(36)', bytes: 'blob', text: 'text' },
  sqlite: { string: 'text', int: 'integer', integer: 'integer', bigint: 'integer', boolean: 'integer', bool: 'integer', datetime: 'text', date: 'text', decimal: 'numeric', float: 'real', double: 'real', json: 'text', uuid: 'text', bytes: 'blob', text: 'text' },
};

/** Map a generic/ORM scalar to an engine SQL type. Types that already carry params or spaces
 * (e.g. `numeric(12,2)`, `timestamp with time zone`) pass through unchanged. */
export function mapType(type, dialect = 'postgres') {
  const raw = String(type || '').trim();
  if (!raw || /[(\s]/.test(raw)) return raw;
  const m = TYPE_MAP[dialect] || TYPE_MAP.postgres;
  return m[raw.toLowerCase()] || raw;
}

/** True if any column type in the model is a generic scalar (so emitted DDL is a translation). */
export function modelIsGeneric(model) {
  return (model.tables || []).some((t) => (t.columns || []).some((c) => GENERIC_SCALARS.has(String(c.type || '').toLowerCase())));
}
