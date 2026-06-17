# Scoring model — two scores, never blended

`claude-db` reports **two independent 0–100 scores** with letter bands (A–F). They share findings
but weight them differently and must **never** be averaged into one number. A schema can be clean yet
slow, or fast yet fragile — surfacing both is the product thesis.

- **Design & Integrity** (axis `design`) — modeling, keys, referential integrity, types/precision,
  constraints, naming, security/access, temporal/lifecycle.
- **Performance & Scale** (axis `performance`) — indexing, query patterns, concurrency, pooling,
  scaling topology, storage/operability, migration safety.

A finding declares `expected_impact.axis` = `design` | `performance` | `both`. A `both` finding feeds
the category that owns its module **in each axis independently**; if a module only has a category on
one axis, it contributes only to that axis.

## Per-category value

For the findings in a category, exclude `needs_api` and `not_applicable` **first**, then:

```
factor: pass = 1.0, warn = 0.5, fail = 0.0
category_value = 100 × Σ(factor × severity) / Σ(severity)     # over the remaining scored findings
```

If, after exclusion, `Σ(severity) = 0`, the category is **`active:false`** — it leaves both numerator
and denominator (this is the division-by-zero guard). `needs_api` is counted separately as score
confidence; it is never a silent pass.

```
score = Σ(category_value × weight) / Σ(active weight)
```

Weights are documented per 100 below, but the scorer always divides by the **active** weight, so any
category that goes inactive re-normalises the rest automatically.

## Bands & severity gating

- Bands: **A ≥ 90 · B ≥ 80 · C ≥ 70 · D ≥ 60 · F < 60**.
- **Severity gating:** any `status:"fail"` with `severity:5` on the axis being computed caps that score
  at band F — `value = min(computed, 59)`, `capped:true`. The uncapped `computed` and the full
  `categories[]` breakdown are always rendered alongside. A capped score is never raised by good
  findings elsewhere. Only `established` sev-5 caps; `directional`/`speculative`/`needs_api` findings
  **never** cap. The gate only considers a sev-5 `fail` for a module that belongs to **this paradigm's
  profile** (matching `score.mjs`'s `inAxis`-scoped gate), so a leaked finding for a module inapplicable
  to the detected paradigm never caps the score.
- **Confidence tiers:** `established` (durable fact or Tier-1/2-backed — can cap) · `directional`
  (strong static signal) · `speculative` (inference without live data — never caps, never a naked %).

## Dynamic re-normalization per paradigm

The detected paradigm selects a category profile (`scripts/score.mjs` → `PROFILES`). Relational-only
categories (e.g. Referential Integrity, FK-index coverage) simply don't exist in the document/KV/etc.
profiles, so a document store is **never penalised for lacking foreign keys**. Each profile partitions
the relevant modules into weighted categories summing to 100 per axis; within one axis a module appears
in exactly one category (no double counting).

### Relational (base)
- *Design (100):* Modelado 16 (M1,M19) · Llaves 14 (M2) · Integridad referencial 16 (M3) · Tipos 14
  (M4,M6) · Constraints 12 (M5) · Naming 6 (M7) · Seguridad 14 (M9,M10,M20,M21) · Temporal 8 (M8).
- *Performance (100):* Indexación 20 (M11) · Higiene de índices 16 (M12) · Query 18 (M13,M3,M19) ·
  Concurrencia 12 (M14) · Pooling 10 (M15) · Escala 12 (M16,M17,M2,M9) · Almacenamiento 12 (M18,M22,M20,M21).

### NoSQL & specialized (DROP relational-only, ADD paradigm categories — each still sums to 100)
| Paradigm | Design (100) | Performance (100) |
|---|---|---|
| **Document** | Access-pattern&embedding 26 · Llaves 12 · Tipos 14 · Validación-schema 16 · Seguridad 18 · Naming 6 · Temporal 8 | Indexación 30 · Query 22 · Crecimiento-doc/16MB 18 · Shard-key 16 · Pooling 14 |
| **Key-value** | Access-pattern&key 30 · Llaves 12 · Tipos 12 · Idempotencia 18 · Seguridad 18 · TTL 10 | Partición&hot 34 · Acceso/GSI 22 · Tamaño-ítem 14 · Throughput 14 · Durabilidad 16 |
| **Wide-column** | Tabla-por-query 28 · Partition-key 22 · Tipos 12 · Idempotencia 12 · Seguridad 16 · Naming 10 | Partition-sizing&hot 30 · Tombstones 24 · Query 20 · Consistencia 14 · Conexión 12 |
| **Vector** | Métrica&dimensión 24 · Modelo-version 16 · Llaves 12 · Tipos 12 · Metadata/filtro 18 · Seguridad 18 | Índice&params 30 · Búsqueda filtrada 22 · Recall-vs-latencia 18 · Escala 16 · Conexión 14 |
| **Time-series** | Hypertable-fit 24 · Precisión-ts&tz 18 · Retención 18 · Tags/llaves 12 · Tipos 12 · Seguridad 16 | Chunk/retención 26 · Continuous-agg 22 · Compresión 16 · Query 22 · Conexión 14 |
| **Graph** | Modelado-aristas 28 · Nodos/traversal 22 · Llaves 12 · Tipos 10 · Seguridad 18 · Naming 10 | Índice-lookup 26 · Traversal 26 · Supernodo 20 · Query(Cypher) 16 · Conexión 12 |

### Worked example — Document (Mongo), proving it closes in 0–100 without FKs
Relational-only categories (Integridad referencial, FK-index) are absent from the document profile, so
they never enter the denominator. With Design category values e.g. Access-pattern 70 (w26), Llaves 90
(w12), Tipos 60 (w14), Validación 40 (w16), Seguridad 80 (w18), Naming 100 (w6), Temporal 75 (w8):
`Σw = 100`, `Σ(v·w) = 7020` → **70.2 → band C**.

## Multi-store rollup

When more than one datastore is detected, each top-level score is the **worst-of across stores per
axis** (`design = min over stores`); the per-store breakdown is rendered beneath, with a banner naming
the flooring store (e.g. "Design 58 — floored by `redis-cache`").

## Severity-5 catalog (caps)

No primary key (both; rel/WC) · float/`double` money incl. Mongo (design; rel+doc) · plaintext secrets
in schema (design; all) · SQL-injection raw concat (design; all) · missing FK enabling orphan
financial/auth rows (both; rel) · RLS off on a relied-on multi-tenant/Supabase table (design; PG) ·
unbounded partition/wide row on an event table (perf; WC) · TXID wraparound imminent (perf; PG) ·
destructive migration without reversibility/expand-contract (perf; all) · `int4`/serial PK exhausting
(both; Tier-1) · embedding dimension mismatch vs the declared model (design; vector).

Only `established` sev-5 findings cap; `directional`/`speculative`/`needs_api` **never** cap.

**Sev-5 only with live evidence** (else directional / `needs_api`, never capping): backups/DR/PITR ·
Redis as undurable primary store · hot-partition under high write rate · embedding distance-metric
mismatch (unless the model is declared in-repo).
