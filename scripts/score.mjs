#!/usr/bin/env node
// Compute the two never-blended database scores (Design & Integrity + Performance & Scale)
// from findings. Pure logic — fully reproducible. Implements references/scoring-model.md.
//
// Usage:
//   node score.mjs --findings findings.json [--paradigm relational|document|key-value|wide-column|vector|time-series|graph]
//   cat findings.json | node score.mjs --paradigm document
//
// Input: a JSON array of findings, or { "findings": [...] }, each conforming to
// schema/finding.schema.json. Paradigm selects the category profile (default: relational);
// categories whose modules emit no scored finding go inactive and leave the denominator,
// so a document store is never penalised for lacking foreign keys.

import { readFileSync } from 'node:fs';
import { parseArgs, emit, parentModule, band } from './lib/util.mjs';

// Each profile partitions the relevant modules into weighted categories per axis.
// Within one axis a module appears in exactly ONE category (no double counting).
// Weights sum to 100 per axis; the scorer re-normalises over the ACTIVE weight only.
export const PROFILES = {
  relational: {
    design: [
      { name: 'Modelado', weight: 16, modules: ['M1', 'M19'] },
      { name: 'Llaves & identidad', weight: 14, modules: ['M2'] },
      { name: 'Integridad referencial', weight: 16, modules: ['M3'] },
      { name: 'Tipos & precisión', weight: 14, modules: ['M4', 'M6'] },
      { name: 'Constraints', weight: 12, modules: ['M5'] },
      { name: 'Naming & consistencia', weight: 6, modules: ['M7'] },
      { name: 'Seguridad & acceso', weight: 14, modules: ['M9', 'M10', 'M20', 'M21'] },
      { name: 'Temporal & auditoría', weight: 8, modules: ['M8'] },
    ],
    performance: [
      { name: 'Indexación', weight: 20, modules: ['M11'] },
      { name: 'Higiene de índices', weight: 16, modules: ['M12'] },
      { name: 'Patrones de query', weight: 18, modules: ['M13', 'M3', 'M19'] },
      { name: 'Transacciones & concurrencia', weight: 12, modules: ['M14'] },
      { name: 'Conexión & pooling', weight: 10, modules: ['M15'] },
      { name: 'Topología de escala', weight: 12, modules: ['M16', 'M17', 'M2', 'M9'] },
      { name: 'Almacenamiento & operabilidad', weight: 12, modules: ['M18', 'M22', 'M20', 'M21'] },
    ],
  },
  document: {
    design: [
      { name: 'Access-pattern & embedding', weight: 26, modules: ['M19', 'M20'] },
      { name: 'Llaves & identidad', weight: 12, modules: ['M2'] },
      { name: 'Tipos & precisión', weight: 14, modules: ['M4', 'M6'] },
      { name: 'Validación de schema', weight: 16, modules: ['M5'] },
      { name: 'Seguridad & acceso', weight: 18, modules: ['M9', 'M10', 'M21'] },
      { name: 'Naming & consistencia', weight: 6, modules: ['M7'] },
      { name: 'Temporal & lifecycle', weight: 8, modules: ['M8'] },
    ],
    performance: [
      { name: 'Indexación', weight: 30, modules: ['M11', 'M12'] },
      { name: 'Patrones de query', weight: 22, modules: ['M13', 'M14', 'M19'] },
      { name: 'Crecimiento de documento / 16MB & migración', weight: 18, modules: ['M18', 'M20', 'M22'] },
      { name: 'Shard key', weight: 16, modules: ['M16'] },
      { name: 'Conexión & pooling', weight: 14, modules: ['M15'] },
    ],
  },
  'key-value': {
    design: [
      { name: 'Access-pattern & key design', weight: 30, modules: ['M19', 'M20'] },
      { name: 'Llaves & identidad', weight: 12, modules: ['M2'] },
      { name: 'Tipos & precisión', weight: 12, modules: ['M4'] },
      { name: 'Idempotencia & write-safety', weight: 18, modules: ['M14'] },
      { name: 'Seguridad & acceso', weight: 18, modules: ['M9', 'M10', 'M21'] },
      { name: 'TTL & temporal', weight: 10, modules: ['M8'] },
    ],
    performance: [
      { name: 'Partición & hot-partition', weight: 34, modules: ['M16'] },
      { name: 'Acceso & GSI', weight: 22, modules: ['M13', 'M11'] },
      { name: 'Tamaño de ítem & capacidad', weight: 14, modules: ['M18'] },
      { name: 'Throughput & conexión', weight: 14, modules: ['M15'] },
      { name: 'Durabilidad, eviction & migración', weight: 16, modules: ['M12', 'M17', 'M22'] },
    ],
  },
  'wide-column': {
    design: [
      { name: 'Tabla-por-query fit', weight: 28, modules: ['M19', 'M20'] },
      { name: 'Partition key', weight: 22, modules: ['M2'] },
      { name: 'Tipos & precisión', weight: 12, modules: ['M4'] },
      { name: 'Idempotencia', weight: 12, modules: ['M14'] },
      { name: 'Seguridad & acceso', weight: 16, modules: ['M9', 'M10', 'M21'] },
      { name: 'Naming & consistencia', weight: 10, modules: ['M7'] },
    ],
    performance: [
      { name: 'Partition sizing & hot-partition', weight: 30, modules: ['M16'] },
      { name: 'Tombstones, compaction & migración', weight: 24, modules: ['M18', 'M22'] },
      { name: 'Patrones de query', weight: 20, modules: ['M13', 'M11'] },
      { name: 'Consistencia', weight: 14, modules: ['M17'] },
      { name: 'Conexión', weight: 12, modules: ['M15', 'M12'] },
    ],
  },
  vector: {
    design: [
      { name: 'Métrica & dimensión match', weight: 24, modules: ['M20', 'M4'] },
      { name: 'Versión de modelo co-almacenada', weight: 16, modules: ['M19'] },
      { name: 'Llaves & identidad', weight: 12, modules: ['M2'] },
      { name: 'Tipos & precisión', weight: 12, modules: ['M6'] },
      { name: 'Metadata & filtro co-locado', weight: 18, modules: ['M1', 'M9'] },
      { name: 'Seguridad & acceso', weight: 18, modules: ['M10', 'M21'] },
    ],
    performance: [
      { name: 'Índice & params (HNSW/IVFFlat)', weight: 30, modules: ['M11'] },
      { name: 'Búsqueda filtrada / híbrida', weight: 22, modules: ['M13'] },
      { name: 'Recall vs latencia', weight: 18, modules: ['M12'] },
      { name: 'Escala & migración', weight: 16, modules: ['M16', 'M17', 'M22'] },
      { name: 'Conexión', weight: 14, modules: ['M15'] },
    ],
  },
  'time-series': {
    design: [
      { name: 'Hypertable / medición fit', weight: 24, modules: ['M1', 'M20'] },
      { name: 'Precisión de timestamp & tz', weight: 18, modules: ['M4'] },
      { name: 'Retención & lifecycle', weight: 18, modules: ['M8'] },
      { name: 'Tags & llaves', weight: 12, modules: ['M2'] },
      { name: 'Tipos & precisión', weight: 12, modules: ['M6'] },
      { name: 'Seguridad & acceso', weight: 16, modules: ['M9', 'M10', 'M21'] },
    ],
    performance: [
      { name: 'Chunk / partición & retención', weight: 26, modules: ['M16'] },
      { name: 'Continuous aggregates', weight: 22, modules: ['M17'] },
      { name: 'Compresión & migración', weight: 16, modules: ['M18', 'M22'] },
      { name: 'Patrones de query', weight: 22, modules: ['M13', 'M11'] },
      { name: 'Conexión', weight: 14, modules: ['M15', 'M12'] },
    ],
  },
  graph: {
    design: [
      { name: 'Modelado de aristas', weight: 28, modules: ['M3', 'M19'] },
      { name: 'Nodos / traversal fit', weight: 22, modules: ['M1', 'M20'] },
      { name: 'Llaves & identidad', weight: 12, modules: ['M2'] },
      { name: 'Tipos & precisión', weight: 10, modules: ['M4'] },
      { name: 'Seguridad & acceso', weight: 18, modules: ['M9', 'M10', 'M21'] },
      { name: 'Naming & consistencia', weight: 10, modules: ['M7'] },
    ],
    performance: [
      { name: 'Índice en claves de lookup', weight: 26, modules: ['M11'] },
      { name: 'Eficiencia de traversal', weight: 26, modules: ['M13'] },
      { name: 'Supernodo / hot-node', weight: 20, modules: ['M16'] },
      { name: 'Patrones de query (Cypher)', weight: 16, modules: ['M12'] },
      { name: 'Conexión & migración', weight: 12, modules: ['M15', 'M17', 'M22'] },
    ],
  },
};

const STATUS_FACTOR = { pass: 1, warn: 0.5, fail: 0 };

function axisMatches(finding, axis) {
  const a = finding && finding.expected_impact && finding.expected_impact.axis;
  return a === axis || a === 'both';
}

// Exclude needs_api / not_applicable BEFORE summing; guard against division by zero.
function categoryValue(findings) {
  let num = 0, den = 0, scored = 0, needsApi = 0;
  for (const f of findings) {
    if (f.status === 'needs_api') { needsApi++; continue; }
    if (f.status === 'not_applicable') continue;
    const sev = Number(f.severity) || 0;
    const factor = STATUS_FACTOR[f.status];
    if (factor === undefined || sev <= 0) continue;
    num += factor * sev;
    den += sev;
    scored++;
  }
  return { value: den > 0 ? +(100 * num / den).toFixed(1) : null, scored, needsApi };
}

function computeScore(categories, findings, axis) {
  // Only findings whose module belongs to this paradigm profile score OR gate. A finding for a
  // module the profile doesn't cover (e.g. a foreign-key finding under the document profile) is
  // ignored entirely — that is how a document store is never penalised for lacking FKs.
  const profileModules = new Set(categories.flatMap((c) => c.modules));
  const inAxis = findings.filter((f) => axisMatches(f, axis) && profileModules.has(parentModule(f.module)));
  const cats = categories.map((c) => {
    const fs = inAxis.filter((f) => c.modules.includes(parentModule(f.module)));
    const { value, scored, needsApi } = categoryValue(fs);
    return { name: c.name, weight: c.weight, value: value == null ? 0 : value, active: scored > 0, needsApi };
  });
  const active = cats.filter((c) => c.active && c.weight > 0);
  const totalW = active.reduce((s, c) => s + c.weight, 0);
  const computed = totalW > 0 ? +(active.reduce((s, c) => s + c.value * c.weight, 0) / totalW).toFixed(1) : 0;

  // Severity gating: an ESTABLISHED sev-5 fail caps the score at band F (value = min(computed, 59)).
  // Only `established` caps — `directional`, `speculative`, and `needs_api` never cap (modules
  // promise this). The gate is scoped to `inAxis` (modules this paradigm actually scores), so a
  // leaked finding for a module that doesn't apply to the paradigm (e.g. a foreign-key M3 finding
  // on a document store) never caps. Modules that genuinely apply to every paradigm (e.g. M22
  // migration safety) are present in every paradigm profile, so their fatal findings DO cap here.
  const gated = inAxis.some(
    (f) => Number(f.severity) === 5 && f.status === 'fail' &&
      f.expected_impact && f.expected_impact.confidence === 'established'
  );
  const capped = gated;
  const value = capped ? Math.min(computed, 59) : computed;

  return {
    value,
    computed,
    band: band(value),
    capped,
    needs_api_count: cats.reduce((s, c) => s + c.needsApi, 0),
    categories: cats.map(({ name, weight, value, active }) => ({ name, weight, value, active })),
  };
}

function interpret(design, perf) {
  const ok = (s) => s.value >= 70, bad = (s) => s.value < 60;
  if (ok(design) && ok(perf)) return ['Modelo sólido y construido para escalar.', 'Aguanta carga; vigila los warns.'];
  if (ok(design) && bad(perf)) return ['Modelo limpio y correcto.', 'No aguanta carga aún — arregla índices, pooling y migraciones.'];
  if (bad(design) && ok(perf)) return ['Rápido hoy, pero el modelo se pudre — arregla integridad y constraints.', 'Rendimiento bien por ahora.'];
  if (bad(design) && bad(perf)) return ['Problemas de base — pausa features y ataca los caps primero.', 'Problemas de base en rendimiento — empieza por lo capeado.'];
  return ['Mixto — ve las acciones priorizadas.', 'Mixto — ve las acciones priorizadas.'];
}

function main() {
  const args = parseArgs();
  const paradigm = args.paradigm || 'relational';
  const profile = PROFILES[paradigm];
  if (!profile) {
    emit({ error: `unknown paradigm: ${paradigm}`, known: Object.keys(PROFILES) }, 1);
  }
  let raw;
  try {
    raw = args.findings ? readFileSync(args.findings, 'utf8') : readFileSync(0, 'utf8');
  } catch (e) {
    emit({ error: 'could not read findings: ' + String((e && e.message) || e), hint: 'pass --findings <file.json> or pipe JSON on stdin' }, 1);
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { emit({ error: 'invalid JSON: ' + String((e && e.message) || e) }, 1); }
  const findings = Array.isArray(parsed) ? parsed : ((parsed && parsed.findings) || []);

  const design = computeScore(profile.design, findings, 'design');
  const perf = computeScore(profile.performance, findings, 'performance');
  const [di, pi] = interpret(design, perf);
  design.interpretation = di;
  perf.interpretation = pi;

  emit({ paradigm, findings_count: findings.length, design_integrity: design, performance_scale: perf });
}

// Run as CLI only when invoked directly (so tests can import PROFILES without side effects).
if (import.meta.url === `file://${process.argv[1]}`) main();
