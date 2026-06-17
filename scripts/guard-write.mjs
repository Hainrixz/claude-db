#!/usr/bin/env node
// PreToolUse guard (defense in depth). Blocks Write/Edit to protected paths regardless
// of workflow — the primary safety guarantees are the read-only auditor tool allowlists
// and fix's `disable-model-invocation: true`; this is the belt-and-suspenders.
//
// Wired from hooks/hooks.json on the Write|Edit matcher. Reads the hook payload on stdin,
// exits 2 (block) with a message on stderr if the target is protected; exits 0 otherwise.
//
// Usage: echo '{"tool_input":{"file_path":"..."}}' | node guard-write.mjs

import { readFileSync } from 'node:fs';

const PROTECTED = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.env(\.|$)|(^|\/)\.env$/i,
  /(^|\/)(id_rsa|id_ed25519|id_ecdsa|id_dsa)(\.|$)/,
  /\.(pem|key|p12|pfx|keystore|jks)$/i,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|Gemfile\.lock|poetry\.lock|Cargo\.lock|composer\.lock)$/,
  /\.lock$/i,
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)\.aws(\/|$)/,
  /(^|\/)\.pgpass$/i,
  /(^|\/)\.my\.cnf$/i,
  /(^|\/)secrets?(\/|\.|$)/i,
  /(^|\/)credentials?(\/|\.|$)/i,
];

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write('Usage: <hook-payload-json> | node guard-write.mjs\nBlocks Write/Edit to .git, .env*, lockfiles, secret/credential/key files (exit 2).\n');
    process.exit(0);
  }

  let payload = {};
  try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }

  const input = payload.tool_input || payload.toolInput || {};
  const path = input.file_path || input.filePath || input.path || '';
  if (!path) process.exit(0);

  if (PROTECTED.some((re) => re.test(path))) {
    process.stderr.write(
      'claude-db: refusing to write to a protected path: ' + path +
      '\nclaude-db never modifies VCS internals, secrets, env files, key material, or lockfiles.\n'
    );
    process.exit(2); // block
  }
  process.exit(0); // allow
}

if (import.meta.url === `file://${process.argv[1]}`) main();
