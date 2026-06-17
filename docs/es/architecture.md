# Arquitectura

`claude-db` es un plugin de Claude Code — un experto senior en bases de datos multi-paradigma que
**diseña**, **audita** y **migra** esquemas en almacenes relacionales, documentales, key-value,
wide-column, vectoriales, de series temporales y de grafos. Reporta **dos puntuaciones independientes**
— Diseño e Integridad y Rendimiento y Escala — que nunca se mezclan. Este documento describe el diseño
**actual**.

## Puntos de entrada: diez skills de comando

No hay skill raíz ni enrutador de subcomandos. El plugin expone **diez skills de comando**
directamente bajo `skills/`, cada uno invocado como un comando slash con namespace (el nombre del
plugin `claude-db` es el namespace). **No** existe un comando `engine` ni `recommend` — la selección de
motor M0 la entregan `design` y `start`:

| Comando | Skill | Propósito | ¿Escribe? |
|---|---|---|---|
| `/claude-db:start` | `start` | Asistente de diseño guiado para no-programadores — preguntas en lenguaje natural → esquema inicial (M0) | No |
| `/claude-db:design` | `design` | Recomienda un motor (M0) + dibuja un esquema y un diagrama desde requisitos; emite DDL/diffs, no los aplica | No |
| `/claude-db:audit` | `audit` | Auditoría completa de solo lectura → ambas puntuaciones + reporte priorizado | No |
| `/claude-db:explain` | `explain` | Explicación en lenguaje natural de un hallazgo, tabla o query (por-qué-es-lento) | No |
| `/claude-db:migrate` | `migrate` | Lintea un archivo de migración, o difunde dos esquemas en una migración reversible; previsualiza antes de aplicar | Sí (con confirmación) |
| `/claude-db:fix` | `fix` | Aplica correcciones deterministas tras confirmación por cambio | Sí (con confirmación) |
| `/claude-db:next` | `next` | Coach: la única corrección de mayor impacto, priorizada desde los hallazgos | No |
| `/claude-db:score` | `score` | Recalcula/muestra las dos puntuaciones desde el último (o un) findings JSON | No |
| `/claude-db:seed` | `seed` | Genera datos de muestra/seed conscientes de FK para un esquema | No |
| `/claude-db:checklist` | `checklist` | Grilla go/no-go de preparación para producción | No |

`fix` lleva **`disable-model-invocation: true`** — el modelo **nunca** puede dispararlo; solo se ejecuta
cuando el usuario escribe `/claude-db:fix`. Los comandos de solo lectura sí pueden ser invocados por el
modelo.

## Modelo de tres capas

```
Capa 1  DIRECTIVA       start · design · audit · explain · migrate · fix · next · score · seed · checklist
                                   |
                                   v
Capa 2  ORQUESTACIÓN     db-orchestrator
            detecta stack(s) -> despacha auditores de solo lectura (en paralelo)
            -> fusiona hallazgos -> score.mjs (por paradigma) -> renderiza el reporte de dos puntuaciones
                                   |
                                   v
Capa 3  EJECUCIÓN        módulos de auditoría M0 + M1..M22 (skills/db-*)
            + scripts cero-dependencias (detect-stack.mjs, parse-schema.mjs, score.mjs,
              schema-diff.mjs, gen-seed.mjs, parse-orm-python.py)
```

**Capa 1 — Directiva.** Los skills de comando son delgados. `start`/`design` ejecutan la recomendación
M0 y producen DDL (`design` también dibuja un diagrama); `audit` pasa el objetivo y los flags a
`db-orchestrator`; `explain` y `next` narran los hallazgos; `score` re-ejecuta `score.mjs` sobre
hallazgos existentes; `seed` y `checklist` producen datos de seed y una grilla go/no-go; `migrate`/`fix`
ejecutan el flujo de escritura con confirmación. Cada uno renderiza en el idioma del usuario (EN/ES).

**Capa 2 — Orquestación.** `db-orchestrator` ejecuta la auditoría en tres fases — **detectar →
despachar → sintetizar**:
1. Resuelve el objetivo (una ruta de repo, un archivo de esquema/migración, un `$DATABASE_URL`, o una
   descripción en lenguaje natural), ejecuta `detect-stack.mjs` para clasificar uno o más stacks
   `{paradigm, engine, orm, platform, source_of_truth, confidence}` (ver
   `references/detection-signals.md`).
2. Despacha los subagentes auditores de solo lectura **en paralelo** — varias llamadas `Task` en un solo
   mensaje — para aislar la salida intermedia verbosa. Cada uno recibe el esquema parseado, el stack
   detectado y sus módulos asignados.
3. Fusiona los hallazgos, deduplica por `id` (conserva el estado más severo), ejecuta `score.mjs` con el
   perfil del paradigma detectado y renderiza el reporte de dos puntuaciones según el contrato de
   render.

**Capa 3 — Ejecución.** Un skill-módulo por concern: **M0** (selección de motor, una recomendación, sin
puntuación) y **M1..M22** (con puntuación). Cada uno evalúa un concern y emite hallazgos conformes a
`schema/finding.schema.json`. Los módulos invocan scripts **cero-dependencias** (`detect-stack.mjs`,
`parse-schema.mjs`, `parse-orm-python.py`, `score.mjs`) para resultados reproducibles y verificables en
CI. La auditoría funciona offline (Tier 0) sin base de datos en vivo.

## Mapa de módulos

`M0` selección de motor (recomendación) · `M1` normalización · `M2` llaves · `M3` integridad
referencial · `M4` tipos/precisión · `M5` constraints · `M6` defaults/generadas · `M7` naming · `M8`
temporal/historia · `M9` multi-tenancy · `M10` seguridad/acceso · `M11` indexación · `M12` higiene de
índices · `M13` patrones de query · `M14` concurrencia · `M15` connection pooling · `M16`
particionado/sharding · `M17` réplicas/vistas · `M18` almacenamiento/bloat · `M19` anti-patrones
(catálogo unificado) · `M20` fit especializado (vector/series temporales/grafo/búsqueda) · `M21` fit de
plataforma · `M22` seguridad de migración.

Cada módulo con puntuación declara un eje: **Diseño e Integridad** (`design`), **Rendimiento y Escala**
(`performance`), o **ambos** (`both`). Un hallazgo `both` alimenta la categoría dueña de su módulo **en
cada eje de forma independiente**.

## Subagentes

Los subagentes viven en `agents/`. Los auditores son estrictamente de **solo lectura** (tools `Read,
Grep, Glob, Bash, WebFetch` — sin `Write`/`Edit`), de modo que una auditoría nunca puede mutar archivos
ni una base de datos. Solo `db-migration-writer` puede escribir, y solo vía los skills `migrate`/`fix`
tras confirmación.

| Subagente | Tools | Rol |
|---|---|---|
| Auditores de solo lectura | Read, Grep, Glob, Bash, WebFetch | Ejecutan los módulos M0–M22 asignados, emiten hallazgos JSON |
| `db-migration-writer` | Read, Edit, Write, Bash | **El único escritor** — aplica migraciones/correcciones tras confirmación |

## Detección de stack y enrutamiento por paradigma

`detect-stack.mjs` clasifica un proyecto en uno o más stacks y nunca adivina un motor: cuando nada
coincide devuelve una lista vacía y enruta al usuario a `/claude-db:start` o al modo descripción. El
**paradigma** detectado selecciona un perfil de categorías en `score.mjs` (`PROFILES`). Las categorías
exclusivas de relacional (integridad referencial, cobertura de índices en FK) simplemente no existen en
los perfiles documental/KV/etc., así que un almacén documental **nunca es penalizado por carecer de
llaves foráneas**.

## Dos puntuaciones, nunca mezcladas

`score.mjs` produce **dos puntuaciones independientes de 0–100** con bandas de letra (A–F):

- **Diseño e Integridad** (`design`) — modelado, llaves, integridad referencial, tipos/precisión,
  constraints, naming, seguridad/acceso, temporal/ciclo de vida.
- **Rendimiento y Escala** (`performance`) — indexación, patrones de query, concurrencia, pooling,
  topología de escala, almacenamiento/operabilidad, seguridad de migración.

Un esquema puede ser limpio pero lento, o rápido pero frágil — exponer ambos es la tesis del producto.
La fórmula completa, las tablas de pesos por paradigma, el gating por severidad y el rollup multi-store
"peor de" están en `references/scoring-model.md` y se reflejan para usuarios en [`scoring.md`](./scoring.md).

## Contrato de hallazgos

Cada módulo emite hallazgos conformes a `schema/finding.schema.json`. El esquema es falsabilidad-primero:
cada hallazgo es observable y re-verificable de forma independiente. Campos requeridos: `id` (con prefijo
de módulo), `module`, `title`, `status` (`pass`/`warn`/`fail`/`not_applicable`/`needs_api`), `severity`
(0–5), `scope`, `evidence.observed` (DDL/migración/query verbatim, secretos redactados), `expected`,
`recommendation`, `fixable`, `verification` (`method` + `assertion` + un `reproduce` ejecutable usando
`$DATABASE_URL`), y `expected_impact` (`axis` + `confidence` + `magnitude` + `rationale`).

## Salvaguardas de honestidad

- **Sin fabricación** — nunca inventa estadísticas, latencia, throughput, conteos de filas ni precios,
  ni en hallazgos *ni* en recomendaciones de diseño. La magnitud es por bandas `high`/`medium`/`low`,
  nunca un porcentaje desnudo.
- **`needs_api`, nunca un pase silencioso** — una verificación que requiere base de datos en vivo emite
  `needs_api` y se cuenta como confianza de la puntuación, no como un pase.
- **Niveles de confianza** — `established` (hecho durable o respaldado por Tier-1/2, puede capear) ·
  `directional` (señal estática fuerte) · `speculative` (inferencia sin datos en vivo, nunca capea).
- **Solo lectura por defecto** — los auditores no tienen tools de escritura; el escritor está detrás de
  confirmación explícita y de `disable-model-invocation` en `fix`.
