# Puntuación

`claude-db` reporta **dos puntuaciones independientes de 0–100** y **nunca las mezcla en un solo
número**. Comparten hallazgos pero los ponderan distinto. Un esquema puede ser limpio pero lento, o
rápido pero frágil — exponer ambos es el punto.

- **Diseño e Integridad** — modelado, llaves, integridad referencial, tipos/precisión, constraints,
  naming, seguridad/acceso, temporal/ciclo de vida.
- **Rendimiento y Escala** — indexación, patrones de query, concurrencia, pooling, topología de escala,
  almacenamiento/operabilidad, seguridad de migración.

## Cómo se calcula una puntuación

Cada puntuación es un promedio ponderado de valores de categoría sobre los pesos **activos**:

```
score = Σ(category_value × weight) / Σ(peso activo)
```

El valor de una categoría es la tasa de pase ponderada por severidad de sus hallazgos, tras excluir
`needs_api` y `not_applicable` **primero**:

```
factor: pass = 1.0, warn = 0.5, fail = 0.0
category_value = 100 × Σ(factor × severity) / Σ(severity)   (sobre los hallazgos puntuables restantes)
```

| status | factor | ¿cuenta? |
|---|---|---|
| `pass` | 1.0 | sí |
| `warn` | 0.5 | sí |
| `fail` | 0.0 | sí (en el denominador) |
| `needs_api` | — | **excluido**, contado aparte como confianza de la puntuación |
| `not_applicable` | — | **excluido** de ambas sumas |

Un hallazgo solo contribuye a la(s) puntuación(es) nombradas en su `expected_impact.axis` (`design`,
`performance` o `both`). Un hallazgo `both` alimenta la categoría dueña de su módulo **en cada eje de
forma independiente**. Los sufijos de módulo se normalizan al padre (p. ej. `M20a` → `M20`).

### La guarda de división por cero

Si, tras excluir `needs_api`/`not_applicable`, una categoría tiene `Σ(severity) = 0`, la categoría queda
**inactiva** — sale tanto del numerador como del denominador, y los pesos restantes se re-normalizan. La
puntuación siempre se calcula sobre el total **activo**, así que una categoría ausente nunca penaliza al
resto.

## Pesos por paradigma — re-normalización dinámica

El paradigma detectado selecciona un perfil de categorías (`scripts/score.mjs` → `PROFILES`). Las
categorías exclusivas de relacional no existen en los perfiles documental/KV/etc., así que un almacén
documental **nunca es penalizado por carecer de llaves foráneas**. Cada perfil reparte los módulos
relevantes en categorías ponderadas que suman 100 por eje; dentro de un eje un módulo aparece en
exactamente una categoría (sin doble conteo).

### Relacional (base)

| Eje | Categorías (peso) |
|---|---|
| **Diseño (100)** | Modelado 16 · Llaves 14 · Integridad referencial 16 · Tipos 14 · Constraints 12 · Naming 6 · Seguridad 14 · Temporal 8 |
| **Rendimiento (100)** | Indexación 20 · Higiene de índices 16 · Query 18 · Concurrencia 12 · Pooling 10 · Topología de escala 12 · Almacenamiento/ops 12 |

### NoSQL y especializadas (quitan lo exclusivo de relacional, agregan categorías del paradigma — cada una suma 100)

| Paradigma | Diseño (100) | Rendimiento (100) |
|---|---|---|
| **Documental** | Access-pattern & embedding 26 · Llaves 12 · Tipos 14 · Validación de schema 16 · Seguridad 18 · Naming 6 · Temporal 8 | Indexación 30 · Query 22 · Crecimiento doc / 16MB 18 · Shard key 16 · Pooling 14 |
| **Key-value** | Access-pattern & key 30 · Llaves 12 · Tipos 12 · Idempotencia 18 · Seguridad 18 · TTL 10 | Partición & hot 34 · Acceso/GSI 22 · Tamaño de ítem 14 · Throughput 14 · Durabilidad 16 |
| **Wide-column** | Tabla-por-query 28 · Partition key 22 · Tipos 12 · Idempotencia 12 · Seguridad 16 · Naming 10 | Partition sizing & hot 30 · Tombstones 24 · Query 20 · Consistencia 14 · Conexión 12 |
| **Vector** | Métrica & dimensión 24 · Versión de modelo 16 · Llaves 12 · Tipos 12 · Metadata/filtro 18 · Seguridad 18 | Índice & params 30 · Búsqueda filtrada 22 · Recall vs latencia 18 · Escala 16 · Conexión 14 |
| **Series temporales** | Hypertable fit 24 · Precisión ts & tz 18 · Retención 18 · Tags/llaves 12 · Tipos 12 · Seguridad 16 | Chunk/retención 26 · Continuous agg 22 · Compresión 16 · Query 22 · Conexión 14 |
| **Grafo** | Modelado de aristas 28 · Nodos/traversal 22 · Llaves 12 · Tipos 10 · Seguridad 18 · Naming 10 | Índice lookup 26 · Traversal 26 · Supernodo 20 · Query (Cypher) 16 · Conexión 12 |

## Bandas de letra

| Banda | Rango |
|---|---|
| A | ≥ 90 |
| B | ≥ 80 |
| C | ≥ 70 |
| D | ≥ 60 |
| F | < 60 |

## Gating por severidad (un fail sev-5 capea en F)

Cualquier hallazgo en el eje que se calcula con `severity: 5` **y** `status: fail` capea esa puntuación
en **59 (banda F)** y marca `capped: true`. El valor `computed` sin capear y el desglose completo de
`categories[]` siempre se renderizan al lado, así que el cap es transparente. Una puntuación capeada
nunca se sube por buenos hallazgos en otra parte. **Los hallazgos `needs_api` y `confidence:
speculative` nunca capean.**

Ejemplos sev-5 que capean: sin llave primaria · money en float/`double` (incl. Mongo) · secretos en
texto plano en el esquema · inyección SQL por concatenación cruda · una FK faltante que permite filas
huérfanas financieras/de auth · RLS apagado en una tabla multi-tenant/Supabase de la que se depende · una
partición/fila ancha sin límite en una tabla de eventos · wraparound TXID inminente · una migración
destructiva sin reversibilidad/expand-contract · PK `int4`/serial agotándose. Algunos capean **solo con
evidencia en vivo** (p. ej. wraparound, partición caliente bajo alta tasa de escritura); de lo contrario
quedan `directional` o `needs_api` y no capean.

## Qué significa `needs_api`

Algunas verificaciones no pueden confirmarse offline — necesitan una base de datos en vivo (Tier 1+). Se
marcan `needs_api`, se **excluyen de la matemática de la puntuación** y se cuentan aparte como
**confianza de la puntuación**, así una puntuación alta respaldada por muchas verificaciones no
verificables se reporta con honestidad en vez de inflarse. Abrir una conexión de solo lectura o un MCP de
DB (ver [`mcp.md`](./mcp.md)) las convierte en hallazgos reales.

## Rollup multi-store

Cuando se detecta más de un almacén, cada puntuación de nivel superior es el **peor de entre los almacenes
por eje** (`design = min sobre almacenes`). El desglose por almacén se renderiza debajo, con un banner que
nombra el almacén que pone el piso (p. ej. "Diseño 58 — limitado por `redis-cache`").

## Forma de salida

```bash
node scripts/score.mjs --findings findings.json --paradigm relational
# o
cat findings.json | node scripts/score.mjs --paradigm document
```

La entrada es un arreglo JSON de hallazgos, o `{ "findings": [...] }`, cada uno conforme a
`schema/finding.schema.json`. El paradigma selecciona el perfil (por defecto `relational`). El scorer es
lógica pura y totalmente reproducible; el cálculo manual de respaldo sigue la misma fórmula en
`references/scoring-model.md`.
