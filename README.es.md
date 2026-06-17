<div align="right">
<sub><a href="README.md">EN</a> · <strong>Español</strong></sub>
</div>

<p align="center">
  <img src="https://raw.githubusercontent.com/Hainrixz/claude-db/main/assets/hero.png" alt="claude-db — kit de diseño, auditoría y migración de bases de datos multi-paradigma para Claude Code, con la mascota pixel de Claude (una criatura naranja en bloques) inspeccionando una pila de tablas" width="840">
</p>

<h1 align="center">claude-db</h1>

<p align="center">
  <strong>El experto en bases de datos multi-paradigma para Claude Code.</strong><br>
  Diseña un esquema nuevo, audita uno existente en <strong>dos ejes independientes</strong> — <strong>Diseño e Integridad</strong> y <strong>Rendimiento y Escala</strong> — y opcionalmente planifica la migración segura por ti.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-000000.svg" alt="Licencia MIT">
  <img src="https://img.shields.io/badge/Claude%20Code-plugin-da7756.svg" alt="Plugin de Claude Code">
  <img src="https://img.shields.io/badge/cross--agent-Vercel%20Skills-000000.svg" alt="Vercel Skills">
  <img src="https://img.shields.io/badge/paradigmas-SQL%20%C2%B7%20doc%20%C2%B7%20KV%20%C2%B7%20vector%20%C2%B7%20TS%20%C2%B7%20grafo-7c5cff.svg" alt="Multi-paradigma">
  <img src="https://img.shields.io/badge/funciona-offline%20(Tier%200)-2ea44f.svg" alt="Funciona offline">
</p>

> **Dos puntajes, nunca mezclados.** Un esquema puede estar impecablemente modelado y aun así colapsar bajo carga, o ser velocísimo y corromper tus datos en silencio. `claude-db` mide **Diseño e Integridad** y **Rendimiento y Escala** por separado y te dice exactamente qué arreglar en cada uno.

🇬🇧 *[README in English](README.md) · guías en [`docs/es/`](docs/es/).*

---

## Por qué

La mayoría de las herramientas de bases de datos hace una sola cosa: un linter revisa el estilo, una pestaña de EXPLAIN muestra una consulta, un ORM esconde el esquema por completo. Ninguna te sienta al lado a un DBA senior que pueda leer tu `schema.prisma` o el catálogo en vivo, razonar a la vez sobre **modelado, integridad, indexación, concurrencia y seguridad de migración**, y sopesar las decisiones para *tu* paradigma — relacional, documento, clave-valor, columna-ancha, vectorial, series de tiempo o grafo.

`claude-db` es ese revisor. Es honesto por construcción: cada hallazgo trae evidencia observada y un comando de verificación ejecutable, las magnitudes vienen en **bandas** (alta/media/baja), y **nunca inventa** una latencia, un conteo de filas ni un precio. Cuando una verificación realmente necesita una base en vivo, lo dice con `needs_api` — nunca un aprobado silencioso.

Trabajo original, con licencia MIT — *inspirado en* los patrones de las herramientas comunitarias de bases de datos pero sin copiar **ninguna** marca, texto ni nombre de otro proyecto.

## Instalar

**Como plugin de Claude Code (recomendado):**

```text
/plugin marketplace add Hainrixz/claude-db
/plugin install claude-db@claude-db
/reload-plugins
```

**Cross-agente** (Cursor, Codex, Gemini CLI, Windsurf…) vía [Vercel Skills](https://vercel.com/docs/agent-resources/skills):

```text
npx skills add Hainrixz/claude-db
```

El plugin funciona **totalmente offline** (Tier 0, sin claves) sobre tus archivos de esquema/migración/ORM o una descripción en lenguaje natural. Ver [Niveles de datos](#niveles-de-datos) para la introspección en vivo opcional.

## Uso

```text
/claude-db:start                                           # ← empieza aquí: un asistente sin jerga (no necesitas archivos)
/claude-db:design   "<lo que construyes>" [--scale small|medium|large]   # recomienda un motor + dibuja un esquema + diagrama
/claude-db:audit    "<ruta|$DATABASE_URL>" [--paradigm auto|…] [--tier 0|1|2]  # dos puntajes + hallazgos priorizados (solo lectura)
/claude-db:explain  "<ruta|tabla|id-hallazgo>" [--query "<SQL>"]            # explicación en lenguaje natural / por-qué-es-lento
/claude-db:migrate  "<archivo-migración>"  |  "<esquema-desde>" "<esquema-hacia>"   # lintea una migración, o difunde dos esquemas → migración
/claude-db:fix      "<ruta>" [--category keys|indexing|constraints|migration|…] [--dry-run]   # opt-in, confirma cada cambio
/claude-db:next     "[findings.json]"                      # coach: la única corrección de mayor impacto, priorizada
/claude-db:score    "[findings.json]" [--paradigm …]       # recalcula los dos puntajes
/claude-db:seed     "<ruta>" [--rows N]                    # genera datos de muestra/seed conscientes de FK para un esquema
/claude-db:checklist "<ruta|$DATABASE_URL>"                # grilla go/no-go de preparación para producción
```

`audit`, `explain`, `score`, `next` y `checklist` son **de solo lectura** y nunca tocan tus archivos ni escriben en tu base de datos. `fix` muestra los diffs por defecto y escribe solo después de que confirmes cada cambio; las migraciones destructivas requieren teclear de vuelta el nombre del objeto. ¿Primera vez? Corre **`/claude-db:start`** — hace 7 preguntas simples y recomienda qué construir. Los usuarios avanzados pueden llamar cualquier módulo directamente, p. ej. `/claude-db:db-indexing`.

## Dos puntajes, nunca mezclados

Cada auditoría reporta dos puntajes de **0–100** con bandas de letra (A–F) y una interpretación de una línea ([detalles](references/scoring-model.md)):

- **Diseño e Integridad** — modelado, llaves, integridad referencial, tipos/precisión, constraints, naming, seguridad/acceso, temporal/ciclo de vida.
- **Rendimiento y Escala** — indexación, higiene de índices, patrones de consulta, concurrencia, pooling, particionado/réplicas, almacenamiento/operabilidad, seguridad de migración.

Cada hallazgo declara su `axis` (`design` | `performance` | `both`) y alimenta la categoría dueña de su módulo **en cada eje de forma independiente** — sin doble conteo, sin promediar. El **gating por severidad** limita un puntaje a **F** si un fallo `severity:5` cae en ese eje (p. ej. una tabla sin llave primaria, RLS apagado sobre PII, riesgo de wraparound de TXID). El **paradigma** detectado intercambia los pesos de categoría, así un store de documentos nunca se penaliza por no tener llaves foráneas, y las verificaciones `needs_api` se excluyen del cálculo y se cuentan aparte como confianza del puntaje.

## Cómo funciona

Un diseño de tres capas centrado en skills (Claude es el runtime; los helpers en Node/Python son opcionales):

1. **Directiva** — uno de los skills de comando (`engine`/`design`/`audit`/`introspect`/`migrate`/`score`/`explain`/`fix`).
2. **Orquestación** — `db-orchestrator` detecta el stack y el paradigma, construye un snapshot del esquema compartido y despacha auditores especialistas de solo lectura **en paralelo**, luego fusiona hallazgos y corre `score.mjs`.
3. **Ejecución** — módulos `db-*` enfocados (M0–M22) que emiten hallazgos conformes a [`schema/finding.schema.json`](schema/finding.schema.json) — con evidencia observada y un `verification.reproduce` ejecutable. Ver [`docs/es/architecture.md`](docs/es/architecture.md).

## Qué audita

Una suite completa de 23 módulos (M0 consultivo; M1–M22 puntuados), cada uno alimentando el eje **design**, **performance** o **both**:

| Módulo | M | Eje | Verificaciones |
|---|---|---|---|
| `db-engine-selection` | M0 | — | recomendación de motor/paradigma para un proyecto nuevo (consultivo, no puntuado) |
| `db-normalization` | M1 | design | 1NF–3NF, desnormalización deliberada |
| `db-keys` | M2 | both | estrategia de PK (UUIDv7/ULID/bigint), sin-PK (sev5), agotamiento int4 |
| `db-referential-integrity` | M3 | both | FKs, `ON DELETE`, ciclos (sev4), FKs compuestas |
| `db-types-precision` | M4 | design | dinero=numeric/Decimal (float=sev5), timestamptz/UTC, jsonb-como-evasión, enum vs lookup, utf8mb4 |
| `db-constraints` | M5 | design | `NOT NULL`, `CHECK`, `UNIQUE` (incl. trampa sobre-nullable) |
| `db-defaults-generated` | M6 | design | defaults, columnas generadas/computadas |
| `db-naming` | M7 | design | consistencia y convenciones de nombres |
| `db-temporal-history` | M8 | design | soft-delete, auditoría, retención / borrado GDPR |
| `db-multitenancy` | M9 | both | aislamiento por tenant, índice con `tenant_id` líder |
| `db-security-access` | M10 | design | RLS apagado (sev5), PII, cifrado en reposo/TLS (`sslmode=disable` sev4), inyección |
| `db-indexing` | M11 | perf | ESR compuesto, covering/partial, GIN/GiST/BRIN, FK-sin-índice, FTS/geo/JSONB |
| `db-index-hygiene` | M12 | perf | índices duplicados / redundantes / sin uso |
| `db-query-patterns` | M13 | perf | `SELECT *`, N+1 estructural, OFFSET vs keyset, no-SARGable |
| `db-concurrency` | M14 | perf | aislamiento, lost-update, `SKIP LOCKED`, idempotencia |
| `db-connection-pooling` | M15 | perf | serverless + PG directo, pooler en modo transacción |
| `db-partitioning-sharding` | M16 | perf | particionado declarativo, partición caliente, sharding prematuro |
| `db-replicas-views` | M17 | perf | read-your-writes, refresco de vistas materializadas |
| `db-storage-bloat` | M18 | perf | VACUUM, wraparound de TXID (sev5), tombstones |
| `db-antipatterns` | M19 | both | catálogo unificado de anti-patrones (hereda la categoría del módulo natural) |
| `db-specialized-fit` | M20 | both | vectorial (dims/métrica/HNSW), series de tiempo/OLAP, grafo, búsqueda |
| `db-platform-fit` | M21 | both | vigencia de versión (sin EOL inventado), honestidad de precio/lock-in, soporte de FK por plataforma |
| `db-migration-safety` | M22 | perf | reversibilidad, nivel de bloqueo, reescritura de tabla, ops destructivas, mutación de enum, drift |

## Cobertura de paradigmas

`claude-db` detecta el paradigma desde tu stack e intercambia el perfil de puntaje para que cada eje siga sumando 100 con solo las categorías que aplican ([pesos](references/scoring-model.md)):

- **Relacional** (Postgres, MySQL, SQLite, SQL Server) — el perfil base.
- **Documento** (MongoDB, Firestore) — patrón de acceso y embebido, crecimiento de doc / 16MB, shard key.
- **Clave-valor** (Redis, DynamoDB) — patrón de acceso y key, idempotencia, partición caliente, throughput.
- **Columna-ancha** (Cassandra, ScyllaDB) — tabla-por-consulta, tamaño de partición, tombstones.
- **Vectorial** (pgvector, Pinecone, Qdrant) — métrica y dimensión, parámetros de índice, búsqueda filtrada, recall-vs-latencia.
- **Series de tiempo** (TimescaleDB, ClickHouse) — encaje de hypertable, retención, agregados continuos, compresión.
- **Grafo** (Neo4j) — modelado de aristas, traversal, supernodo, lookup por índice.

Cuando se detecta más de un datastore, cada puntaje de nivel superior es el **peor entre stores por eje**, con el desglose por store debajo y el store que pone el piso nombrado.

## Niveles de datos

| Nivel | Necesita | Añade |
|---|---|---|
| **0** (por defecto) | nada | auditoría offline completa de archivos de esquema/migración/ORM o una descripción en lenguaje natural |
| **1** | un `$DATABASE_URL` de solo lectura o un MCP de base de datos | introspección de catálogo en vivo — inventario real de índices, FK-sin-índice, estado de RLS, versión del motor |
| **2** | estadísticas en runtime (`pg_stat_statements`, `pg_stat_user_*`, `EXPLAIN ANALYZE`) | planes reales, índices realmente sin uso, tuplas muertas, edad de wraparound, particiones calientes |

El Tier 0 produce hallazgos `established`/`directional` desde artefactos generados y hallazgos best-effort (limitados a `directional`) desde código fuente. Los niveles superiores elevan los hallazgos afectados a `established`. La conexión Tier 1 es **de solo lectura por contrato** (`default_transaction_read_only=on`, `statement_timeout`, solo lecturas `SELECT`/`EXPLAIN`/catálogo), respaldada por un hook `PreToolUse`. Ver [`references/data-tiers.md`](references/data-tiers.md).

## Garantías de honestidad

Esta herramienta se niega a repartir folclore de bases de datos:

- **Sin números inventados** — nunca inventa latencia, throughput, conteos de filas, tamaños de tabla, fechas de fin de soporte ni precios, ni en hallazgos *ni* en recomendaciones de diseño. La magnitud va en bandas **alta / media / baja**.
- **`needs_api`, nunca un aprobado silencioso** — una verificación que necesita una base en vivo que no tiene lo dice, y se excluye del puntaje y se cuenta como confianza.
- **Niveles de confianza** en cada hallazgo — `established` (hecho durable o respaldado por Tier-1/2 — puede limitar un puntaje), `directional` (señal estática fuerte), `speculative` (inferencia sin datos en vivo — **nunca limita**, nunca un porcentaje desnudo).
- **Solo lectura por defecto** — los auditores son de solo lectura por allowlist de herramientas; solo el subagente escritor (`db-migration-writer`) puede escribir, solo vía `/claude-db:fix`, y solo después de que confirmes cada diff.
- **Justo con el paradigma** — las categorías solo-relacionales se eliminan de los perfiles NoSQL, así un store de documentos/KV/grafo nunca se penaliza por un concepto relacional que no tiene.

## El fixer opcional

El fixer ([`skills/fix`](skills/fix/SKILL.md)) es `disable-model-invocation: true` — Claude **nunca** puede disparar escrituras por su cuenta. Solo `/claude-db:fix` lo hace, y solo `db-migration-writer` tiene Write/Edit. Genera archivos de migración **reversibles y conscientes del bloqueo** (construcción de índices concurrente, división `NOT VALID` + `VALIDATE` de constraints, cambios de columna expand/contract), muestra un diff unificado, se niega ante un árbol git sucio, y nunca escribe en `.git`, secretos ni lockfiles. Las operaciones destructivas (drops, reescritura de tipos, mutación de enums) se presentan como consultivas y nunca se aplican automáticamente.

## Estructura del proyecto

```text
.claude-plugin/   plugin.json + marketplace.json
skills/           8 skills de comando (engine, design, audit, introspect, migrate, score, explain, fix)
                  + db-orchestrator + módulos de auditoría M0–M22 (db-*)
agents/           auditores de solo lectura + 1 escritor (db-migration-writer)
hooks/            guard PreToolUse de escritura/solo-lectura
scripts/          helpers sin dependencias: detect-stack, parse-schema (.mjs), parse-orm-python.py, score.mjs, lib/util.mjs
references/        modelo de puntaje, señales de detección, niveles de datos
schema/           JSON Schemas de finding + audit-report
docs/en, docs/es  guías bilingües
tests/fixtures    esquemas de ejemplo para verificación
```

## Acerca de

Hecho por **Enrique Rocha** — ayudo a equipos a enviar infraestructura de datos e IA: consultoría, automatizaciones y agentes. Este es un proyecto comunitario con licencia MIT: úsalo, hazle fork, abre issues y PRs (ver [`CONTRIBUTING.md`](CONTRIBUTING.md)).

- 🌐 **[tododeia.com](https://tododeia.com)**
- 📸 Instagram **[@soyenriquerocha](https://instagram.com/soyenriquerocha)**

## Licencia

[MIT](LICENSE) · *Arte de la mascota de Claude generado para este proyecto en estilo pixel-art.*
