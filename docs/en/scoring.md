# Scoring

`claude-db` reports **two independent 0–100 scores** and **never blends them into one number**. They
share findings but weight them differently. A schema can be clean yet slow, or fast yet fragile —
surfacing both is the point.

- **Design & Integrity** — modeling, keys, referential integrity, types/precision, constraints,
  naming, security/access, temporal/lifecycle.
- **Performance & Scale** — indexing, query patterns, concurrency, pooling, scaling topology,
  storage/operability, migration safety.

## How a score is computed

Each score is a weighted average of category values over the **active** weights:

```
score = Σ(category_value × weight) / Σ(active weight)
```

A category's value is the severity-weighted pass rate of its findings, after excluding `needs_api` and
`not_applicable` **first**:

```
factor: pass = 1.0, warn = 0.5, fail = 0.0
category_value = 100 × Σ(factor × severity) / Σ(severity)   (over the remaining scored findings)
```

| status | factor | counted? |
|---|---|---|
| `pass` | 1.0 | yes |
| `warn` | 0.5 | yes |
| `fail` | 0.0 | yes (in denominator) |
| `needs_api` | — | **excluded**, counted separately as score confidence |
| `not_applicable` | — | **excluded** from both sums |

A finding contributes only to the score(s) named in its `expected_impact.axis` (`design`,
`performance`, or `both`). A `both` finding feeds the category that owns its module **in each axis
independently**. Module suffixes are normalized to the parent (e.g. `M20a` → `M20`).

### The division-by-zero guard

If, after excluding `needs_api`/`not_applicable`, a category's `Σ(severity) = 0`, the category is
**inactive** — it leaves both numerator and denominator, and the remaining weights re-normalize. The
score is always out of the **active** total, so a missing category never penalizes the rest.

## Per-paradigm weights — dynamic re-normalization

The detected paradigm selects a category profile (`scripts/score.mjs` → `PROFILES`). Relational-only
categories don't exist in the document/KV/etc. profiles, so a document store is **never penalised for
lacking foreign keys**. Each profile partitions the relevant modules into weighted categories summing
to 100 per axis; within one axis a module appears in exactly one category (no double counting).

### Relational (base)

| Axis | Categories (weight) |
|---|---|
| **Design (100)** | Modeling 16 · Keys 14 · Referential integrity 16 · Types 14 · Constraints 12 · Naming 6 · Security 14 · Temporal 8 |
| **Performance (100)** | Indexing 20 · Index hygiene 16 · Query 18 · Concurrency 12 · Pooling 10 · Scale topology 12 · Storage/ops 12 |

### NoSQL & specialized (drop relational-only, add paradigm categories — each still sums to 100)

| Paradigm | Design (100) | Performance (100) |
|---|---|---|
| **Document** | Access-pattern & embedding 26 · Keys 12 · Types 14 · Schema validation 16 · Security 18 · Naming 6 · Temporal 8 | Indexing 30 · Query 22 · Doc growth / 16MB 18 · Shard key 16 · Pooling 14 |
| **Key-value** | Access-pattern & key 30 · Keys 12 · Types 12 · Idempotency 18 · Security 18 · TTL 10 | Partition & hot 34 · Access/GSI 22 · Item size 14 · Throughput 14 · Durability 16 |
| **Wide-column** | Table-per-query 28 · Partition key 22 · Types 12 · Idempotency 12 · Security 16 · Naming 10 | Partition sizing & hot 30 · Tombstones 24 · Query 20 · Consistency 14 · Connection 12 |
| **Vector** | Metric & dimension 24 · Model version 16 · Keys 12 · Types 12 · Metadata/filter 18 · Security 18 | Index & params 30 · Filtered search 22 · Recall vs latency 18 · Scale 16 · Connection 14 |
| **Time-series** | Hypertable fit 24 · Precision ts & tz 18 · Retention 18 · Tags/keys 12 · Types 12 · Security 16 | Chunk/retention 26 · Continuous agg 22 · Compression 16 · Query 22 · Connection 14 |
| **Graph** | Edge modeling 28 · Nodes/traversal 22 · Keys 12 · Types 10 · Security 18 · Naming 10 | Index lookup 26 · Traversal 26 · Supernode 20 · Query (Cypher) 16 · Connection 12 |

## Letter bands

| Band | Range |
|---|---|
| A | ≥ 90 |
| B | ≥ 80 |
| C | ≥ 70 |
| D | ≥ 60 |
| F | < 60 |

## Severity gating (a sev-5 fail caps at F)

Any finding on the axis being computed with `severity: 5` **and** `status: fail` caps that score at
**59 (band F)** and sets `capped: true`. The uncapped `computed` value and the full `categories[]`
breakdown are always rendered alongside, so the cap is transparent. A capped score is never raised by
good findings elsewhere. **`needs_api` and `confidence: speculative` findings never cap.**

Sev-5 examples that cap: no primary key · float/`double` money (incl. Mongo) · plaintext secrets in
schema · SQL-injection via raw concatenation · a missing FK enabling orphan financial/auth rows · RLS
off on a relied-on multi-tenant/Supabase table · an unbounded partition/wide row on an event table ·
TXID wraparound imminent · a destructive migration without reversibility/expand-contract ·
`int4`/serial PK exhausting. Some of these cap **only with live evidence** (e.g. wraparound, hot
partition under high write rate); otherwise they stay `directional` or `needs_api` and do not cap.

## What `needs_api` means

Some checks can't be verified offline — they need a live database (Tier 1+). These are marked
`needs_api`, **excluded from the score math**, and counted separately as **score confidence**, so a
high score backed by many unverifiable checks is reported honestly rather than inflated. Opening a
read-only connection or DB MCP (see [`mcp.md`](./mcp.md)) turns these into real findings.

## Multi-store rollup

When more than one datastore is detected, each top-level score is the **worst-of across stores per
axis** (`design = min over stores`). The per-store breakdown is rendered beneath, with a banner naming
the flooring store (e.g. "Design 58 — floored by `redis-cache`").

## Output shape

```bash
node scripts/score.mjs --findings findings.json --paradigm relational
# or
cat findings.json | node scripts/score.mjs --paradigm document
```

Input is a JSON array of findings, or `{ "findings": [...] }`, each conforming to
`schema/finding.schema.json`. The paradigm selects the profile (default `relational`). The scorer is
pure logic and fully reproducible; the by-hand fallback follows the same formula in
`references/scoring-model.md`.
