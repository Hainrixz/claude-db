# Uso

Una guía práctica para ejecutar `claude-db` — instalarlo, correr los diez comandos, leer el reporte de
dos puntuaciones, y aplicar migraciones y correcciones de forma segura.

## Instalación

**Como plugin de Claude Code (recomendado):**

```
/plugin marketplace add Hainrixz/claude-db
/plugin install claude-db@claude-db
/reload-plugins
```

**Cross-agent (Cursor, Codex, Gemini CLI, Windsurf…) vía Vercel Skills:**

```
npx skills add Hainrixz/claude-db
```

> Publicado en `github.com/Hainrixz/claude-db`. El plugin funciona totalmente offline (Tier 0) — sin
> keys, sin conexión a base de datos. La introspección opcional en vivo de solo lectura vive en Tier 1+
> (ver [`mcp.md`](./mcp.md)).

## Los diez comandos

`claude-db` incluye **diez skills de comando**. No hay enrutador raíz ni parseo de subcomandos: cada uno
es su propio comando de nivel superior. Los skills de plugin siempre llevan namespace, así que el nombre
del plugin (`claude-db`) es el namespace, y cada comando se invoca como `/claude-db:<comando>`. El
`target` es una ruta de repo, un archivo de esquema/migración, un `$DATABASE_URL`, o una descripción en
lenguaje natural. **No** existe un comando `engine` ni `recommend` — la selección de motor M0 la entregan
`design` y `start`.

```
/claude-db:start
/claude-db:design    "<lo que construyes>" [--scale small|medium|large]
/claude-db:audit     [<ruta|archivo|url>] [--paradigm auto|relational|document|key-value|wide-column|vector|time-series|graph] [--tier 0|1|2]
/claude-db:explain   "<ruta|tabla|id-hallazgo>" [--query "<SQL>"]
/claude-db:migrate   "<archivo-migración>"  |  "<esquema-desde>" "<esquema-hacia>"
/claude-db:fix       "<ruta>" [--category keys|indexing|constraints|migration|…] [--dry-run]
/claude-db:next      [<findings.json>]
/claude-db:score     [<findings.json>] [--paradigm …]
/claude-db:seed      "<ruta>" [--rows N]
/claude-db:checklist "<ruta|$DATABASE_URL>"
```

| Comando | Qué hace | ¿Escribe? |
|---|---|---|
| `start` | Asistente de diseño guiado para no-programadores (preguntas en lenguaje natural → esquema inicial). | No |
| `design` | Recomienda un motor (M0) + dibuja un esquema y un diagrama desde requisitos; emite solo DDL/diffs. | No |
| `audit` | Auditoría completa de solo lectura en ambos ejes; fusiona hallazgos; puntúa por paradigma. | No — nunca |
| `explain` | Explicación en lenguaje natural de un hallazgo, tabla o query (por-qué-es-lento). | No |
| `migrate` | Lintea un archivo de migración, o difunde dos esquemas en una migración reversible; previsualiza primero. | Solo con confirmación |
| `fix` | Aplica correcciones deterministas de esquema/migración, confirmando cada cambio. | Solo con confirmación |
| `next` | Coach: la única corrección de mayor impacto, priorizada desde los hallazgos. | No |
| `score` | Recalcula/muestra las dos puntuaciones desde el findings JSON más reciente (o uno dado). | No |
| `seed` | Genera datos de muestra/seed conscientes de FK para un esquema. | No |
| `checklist` | Grilla go/no-go de preparación para producción. | No |

`start`, `design`, `audit`, `explain`, `next`, `score`, `seed` y `checklist` son de solo lectura y
pueden dispararse por descripción. `fix` es `disable-model-invocation: true` — solo **tú** puedes
invocarlo.

### `audit`

Solo lectura. Invoca `db-orchestrator`, que detecta el/los stack(s), parsea el esquema, despacha los
subagentes auditores de solo lectura en paralelo, fusiona hallazgos y puntúa según el paradigma
detectado. Nunca toca tus archivos ni tu base de datos.

```
# Auditar el repo actual (auto-detectar el stack)
/claude-db:audit

# Auditar un solo archivo de esquema
/claude-db:audit prisma/schema.prisma

# Auditar con introspección en vivo de solo lectura (Tier 1)
/claude-db:audit --tier 1
```

Obtienes: ambas puntuaciones con bandas e interpretaciones de una línea, un desglose por categoría, el
nivel de datos alcanzado, el conteo de verificaciones `needs_api`, el rollup multi-store (si hay varios
almacenes), y una lista priorizada de correcciones ordenada por impacto ÷ esfuerzo. Cada ítem lleva
status, severidad, evidencia, recomendación, fixability y `expected_impact`.

### `score`

Recalcula y muestra las dos puntuaciones desde la auditoría más reciente re-ejecutando
`scripts/score.mjs` (reproducible). Pasa un findings JSON guardado para puntuar ese archivo.

```
/claude-db:score
/claude-db:score findings.json --paradigm document
```

### `design`

Ejecuta la recomendación de selección de motor M0 como primer paso — una **recomendación, no una
auditoría puntuada** (vigencia de versión, honestidad de precios/lock-in, soporte de FK por plataforma,
nunca benchmarks fabricados; ver [`engine-selection.md`](./engine-selection.md)) — y luego propone un
esquema/modelo concreto y un diagrama, emitiendo **solo DDL o diffs**. No aplica nada. Combínalo con
`migrate` para planificar el despliegue.

```
/claude-db:design "SaaS multi-tenant, cientos de tenants, reporting pesado, equipo pequeño" --scale medium
/claude-db:design "órdenes, líneas de detalle, clientes; necesita soft-delete y trazas de auditoría"
```

### `start`

El asistente de diseño guiado para no-programadores — preguntas en lenguaje natural que construyen un
esquema inicial sin que escribas código. Ver [`design-wizard.md`](./design-wizard.md).

```
/claude-db:start
```

### `explain`

Una explicación en lenguaje natural. Apúntalo a un id de hallazgo, una tabla o una query y te explica
qué pasa y por qué — incluido "¿por qué es lento esto?" De solo lectura.

```
/claude-db:explain orders
/claude-db:explain M11-fk-no-index --query "SELECT * FROM orders WHERE customer_id = $1"
```

### `next`

El coach. Desde el findings JSON más reciente (o uno guardado) devuelve la **única corrección de mayor
impacto** a continuación, priorizada por impacto ÷ esfuerzo. De solo lectura.

```
/claude-db:next
/claude-db:next findings.json
```

### `seed`

Genera datos de muestra/seed **conscientes de FK** para un esquema — los inserts respetan el orden de
las llaves foráneas para que los datos carguen limpiamente. No escribe en tu base de datos (emite SQL de
seed).

```
/claude-db:seed prisma/schema.prisma --rows 100
```

### `checklist`

Una **grilla go/no-go** de preparación para producción sobre un esquema o un `$DATABASE_URL` en vivo —
lo imprescindible antes de salir, cada ítem marcado pasa / requiere-atención / bloqueado. De solo
lectura.

```
/claude-db:checklist prisma/schema.prisma
```

> **Introspección en vivo (Tier 1+).** Cualquier comando de solo lectura puede afinar sus hallazgos
> contra una base de datos en vivo cuando pasas un `$DATABASE_URL` o un MCP de DB — inventario real de
> índices, estado de RLS, tamaños y versión del motor. La conexión es de solo lectura por contrato
> (`SET default_transaction_read_only = on`, `statement_timeout`, solo lecturas
> `SELECT`/`EXPLAIN`/catálogo). Ver [`mcp.md`](./mcp.md).

### `migrate` y `fix`

Escritores opcionales — cubiertos abajo. `migrate` o bien **lintea un archivo de migración** o bien
**difunde dos esquemas** en una migración reversible.

```
/claude-db:migrate db/migrations/0007_add_status.sql
/claude-db:migrate schema.v1.sql schema.v2.sql
/claude-db:fix prisma/schema.prisma --category indexing
```

## Leer el reporte de dos puntuaciones

Dos puntuaciones **independientes** de 0–100, nunca mezcladas. Un esquema puede ser limpio pero lento, o
rápido pero frágil.

| Puntuación | Ponderada hacia |
|---|---|
| **Diseño e Integridad** | modelado, llaves, integridad referencial, tipos, constraints, seguridad |
| **Rendimiento y Escala** | indexación, patrones de query, concurrencia, pooling, escala, almacenamiento, seguridad de migración |

Cada puntuación tiene una banda de letra (A–F) y una interpretación de una línea. Notas:

- El **gating por severidad** capea una puntuación en F si algo crítico falla (p. ej. sin llave primaria,
  money en float, secretos en texto plano) — ver [`scoring.md`](./scoring.md).
- La **re-normalización por paradigma** hace que un almacén documental nunca sea penalizado por carecer
  de llaves foráneas.
- Cada hallazgo lleva un nivel de `confidence` (`established` / `directional` / `speculative`); las
  inferencias sin datos en vivo salen solo como `speculative` y nunca capean.

### Qué significa `needs_api`

Algunas verificaciones no pueden confirmarse offline — necesitan una base de datos en vivo (Tier 1+). Se
marcan `needs_api`, se **excluyen de la matemática de la puntuación** y se cuentan aparte como
**confianza de la puntuación**, así una puntuación alta respaldada por muchas verificaciones no
verificables se reporta con honestidad en vez de inflarse. Abrir una conexión de solo lectura o un MCP de
DB las convierte en hallazgos reales.

## Los escritores opcionales (flujo dry-run / confirmar)

`migrate` y `fix` son los únicos comandos que pueden cambiar algo, y solo `db-migration-writer` (el único
subagente con Write/Edit) hace la escritura. `fix` es `disable-model-invocation: true` — el modelo
**nunca** puede dispararlo por su cuenta.

**Dry-run (solo previsualización) es el valor por defecto.** El flujo:

1. Toma el cambio (un archivo de `migrate` a lintear o un diff de esquema desde→hacia, o hallazgos
   `fix`-ables de la última auditoría). `--category` acota qué hallazgos aplica `fix`.
2. Para cada uno, construye el SQL/DDL de migración y un paso **inverso** (down), más un diff unificado.
   Cualquier dato del mundo real (valores de backfill, elecciones de default) se **te pregunta** — nunca
   se inventa.
3. **Dry-run**: imprime cada migración/diff, clasifica su nivel de bloqueo y si reescribe la tabla, no
   escribe nada, y resume qué cambiaría al quitar `--dry-run`.
4. Solo con confirmación explícita: delega a `db-migration-writer` para aplicar, luego re-verifica.

```
# Lintear un archivo de migración existente (solo previsualización)
/claude-db:migrate db/migrations/0007_add_status.sql

# Difundir dos esquemas en una migración reversible (previsualiza, luego confirma para aplicar)
/claude-db:migrate schema.v1.sql schema.v2.sql
```

### Garantías de seguridad de migración (M22)

- **Reversibilidad** — cada migración trae un paso de bajada o un plan explícito de expand/contract.
- **Conciencia de bloqueo** — cada paso se clasifica por nivel de bloqueo y si reescribe la tabla; un
  paso destructivo o de reescritura completa sin ruta expand/contract se marca (sev-5).
- **Dry-run por defecto** — escribir requiere quitar `--dry-run` y confirmar.
- **Consciente de git** — rechaza un árbol de trabajo sucio salvo con `--force`; prefiere una rama.
- **Nunca toca** `.git/`, `.env`/secretos, ni archivos fuera de la raíz del proyecto (impuesto por un
  hook PreToolUse); las auditorías nunca escriben en la base de datos.
- **Sin fabricación** — nunca escribe datos, estadísticas o valores inventados.

## Scripts auxiliares opcionales

Los skills funcionan como Markdown puro; los auxiliares cero-dependencias en Node/Python (Node ≥ 18,
Python 3 para el parser de ORM) afinan la precisión y hacen ejecutable cada `verification.reproduce`:

```
node   scripts/detect-stack.mjs   --dir .
node   scripts/parse-schema.mjs   --file prisma/schema.prisma
python scripts/parse-orm-python.py --file models.py
node   scripts/score.mjs          --findings findings.json --paradigm relational
```
