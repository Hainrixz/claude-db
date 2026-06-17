# MCP y niveles de datos

`claude-db` está diseñado para funcionar con **cero servidores MCP y cero API keys**. Una auditoría
completa corre offline en Tier 0 desde tu esquema, migraciones, código ORM, o una descripción en
lenguaje natural. Todo lo demás es opcional y solo **afina** los hallazgos. Cuando un nivel superior no
está disponible, una verificación degrada a `status: needs_api` con honestidad — la herramienta nunca
fabrica un valor medido ni devuelve un `pass` falso.

## Los tres niveles de datos

| Nivel | Requiere | Desbloquea | Si no está disponible |
|---|---|---|---|
| **0 — offline (por defecto)** | Nada — leer archivos o una descripción, más los scripts incluidos | Estructura: constraints, FK-sin-índice (estático), money en float, naming, normalización, anti-patrones, RLS-no-declarado, ops de migración inseguras | Es el piso — siempre disponible |
| **1 — introspección en vivo de solo lectura** | Un `$DATABASE_URL` de solo lectura con mínimos privilegios **o** un servidor MCP de DB (preferido) | Inventario real de índices, join FK-sin-índice, tamaños de tabla/fila, estado de RLS, extensiones, versión del motor → eleva hallazgos a `established` | Hallazgos dependientes de runtime → `needs_api` |
| **2 — estadísticas en vivo** | Estadísticas sostenidas de runtime (`pg_stat_statements`, `pg_stat_user_*`, `EXPLAIN (ANALYZE)`, `age(datfrozenxid)`) | Planes reales, índices genuinamente no usados, tuplas muertas, particiones calientes, edad de wraparound TXID | Hallazgos dependientes de stats → `needs_api` |

El skill `introspect` registra el `tier` realmente alcanzado; los módulos anotan cualquier hallazgo
`needs_api` cuando requiere un nivel superior al alcanzado. Los parses de código fuente en Tier 0
(Drizzle `.ts`, Mongoose `.js`, CDK) se topan en `confidence: directional` y **nunca elevan un cap de
severidad-5** — empujan hacia un artefacto generado o hacia Tier-1.

## Tier 0 — qué funciona sin configuración

- Parsear `schema.prisma`, Drizzle `*_snapshot.json`, `structure.sql`, DDL SQL crudo, `schema.rb` y SQL
  generado por Alembic/Flyway/Liquibase (confiable → `established`).
- Parse best-effort de Drizzle `schema.ts`, modelos Mongoose, CDK de DynamoDB (→ `directional`).
- Detectar constraints faltantes, FK-sin-índice (estático), money en float/`double`, deriva de naming,
  problemas de normalización, el catálogo unificado de anti-patrones, RLS-no-declarado y ops de
  migración inseguras.
- Aceptar una **descripción en lenguaje natural** cuando no hay archivos de esquema (el asistente
  `/claude-db:start`).

Cualquier cosa que requiera verdad en runtime (uso real de índices, conteos de filas, planes, estado de
autovacuum/bloat) se difiere a Tier 1/2 y se reporta como `needs_api` — nunca un pase silencioso.

## Tier 1 — activar un MCP de DB de solo lectura (recomendado) o `$DATABASE_URL`

Tier 1 es opcional y **nunca lo iniciamos automáticamente**. Activar el plugin nunca fuerza una descarga,
una solicitud de credenciales ni una conexión. Para activar la introspección en vivo de solo lectura, el
camino más limpio es un servidor MCP de base de datos de solo lectura. Copia la entrada de
[`.mcp.json.example`](../../.mcp.json.example) en tu `.mcp.json` de proyecto (o `mcpServers` en
`~/.claude.json`) y apruébala:

```jsonc
{
  "mcpServers": {
    "postgres-readonly": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "${DATABASE_URL_READONLY}"]
    }
  }
}
```

`DATABASE_URL_READONLY` debe apuntar a un **rol de solo lectura con mínimos privilegios**. El camino MCP
se prefiere sobre una cadena de conexión cruda porque dibuja una frontera de permisos más limpia: el
skill `introspect` invoca solo tools de clase lectura (`*query*`/`*read*`/`*list*`/`*describe*`), y un
tool `query` genérico con capacidad de escritura se enruta por el mismo validador de solo lectura. Un
hook PreToolUse (`mcp__.*`) lo respalda bloqueando todo lo que no sea una lectura
`SELECT`/`EXPLAIN`/catálogo.

Si prefieres una cadena de conexión cruda en vez de un MCP, exporta un `$DATABASE_URL` de solo lectura;
la introspección impone `SET default_transaction_read_only = on`, un `statement_timeout` y solo queries
`SELECT`/`EXPLAIN`/catálogo. Las cadenas de conexión se leen del entorno, nunca se imprimen;
`redactSecrets()` limpia cualquier credencial antes de que llegue a un hallazgo, reporte o log, y cada
`verification.reproduce` referencia `$DATABASE_URL`, nunca una credencial literal.

## Tier 2 — estadísticas en vivo

Tier 2 reutiliza la misma conexión o MCP de solo lectura pero lee estadísticas sostenidas de runtime
(`pg_stat_statements`, `pg_stat_user_indexes`/`pg_stat_user_tables`, `EXPLAIN (ANALYZE, BUFFERS)`,
`age(datfrozenxid)`, `pg_stat_replication`; Mongo `$collStats`; Cassandra `nodetool tablehistograms`;
DynamoDB CloudWatch). Sin estadísticas sostenidas estos hallazgos quedan `directional`; si una decisión
realmente necesita stats, el hallazgo es `needs_api`.

## Degradación elegante, en resumen

- **Tier 0 siempre basta para ejecutar una auditoría.** Sin MCP, sin key, sin conexión.
- Sin conexión en vivo → solo hallazgos estructurales; las verificaciones de runtime se reportan como
  `needs_api`.
- Parse de solo código fuente → topado en `directional`, nunca un cap de severidad-5, con un empujón
  hacia un artefacto generado o hacia Tier-1.
- Cuando el nivel requerido no está disponible, el estado es **`needs_api`** — nunca una métrica
  fabricada ni un `pass` falso.
