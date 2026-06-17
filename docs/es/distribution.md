# Distribución

Cómo se distribuye `claude-db`, cómo instalarlo y cómo publicar actualizaciones. El proyecto se
distribuye por **dos canales** desde el mismo repositorio: un **plugin nativo de Claude Code** y un
paquete cross-agent de **Vercel Skills**.

## Dos canales, un repo

| Canal | Mecanismo | Qué obtienes |
|---|---|---|
| **Plugin de Claude Code** | `.claude-plugin/marketplace.json` (`source: ./`) | Suite completa: skills + orquestación de agentes + MCP/hook opcional |
| **Cross-agent (Vercel Skills)** | `npx skills add` | Solo `skills/<name>/SKILL.md` agnóstico al agente |

La capa de orquestación — los subagentes de `agents/` (auditores de solo lectura + el único
`db-migration-writer`), el hook PreToolUse de guardia de escritura en `hooks/`, y el MCP opcional de
Postgres de solo lectura de `.mcp.json.example` — es **específica de Claude Code**. En otros agentes el
proyecto **degrada a solo-skills**: los skills Markdown siguen funcionando, pero la seguridad a nivel de
agente y la aplicación de la lista de tools que Claude Code provee no están presentes.

## Plugin de Claude Code

El `marketplace.json` interno declara un único plugin con origen en la raíz del repo (`"source": "./"`),
así que el marketplace **es** el repositorio — sin paso de publicación ni subida a un registro.

```
/plugin marketplace add Hainrixz/claude-db
/plugin install claude-db@claude-db
/reload-plugins
```

Publicado en `github.com/Hainrixz/claude-db` — `plugin.json` y `marketplace.json` llevan ese `homepage`
/ `repository`. Si forkeas este repo, actualiza el owner en `plugin.json`, `marketplace.json` y los
`$id` del esquema a los tuyos.

El plugin funciona totalmente offline en **Tier 0** (lee archivos de esquema/migración/ORM, o acepta una
descripción en lenguaje natural, más los scripts cero-dependencias incluidos). La introspección en vivo
de solo lectura (Tier 1) y las estadísticas en runtime (Tier 2) son opcionales — ver [`mcp.md`](./mcp.md)
y la referencia [Niveles de datos](../../references/data-tiers.md).

## Cross-agent vía Vercel Skills

Como cada skill es un archivo Markdown plano `skills/<name>/SKILL.md`, la suite se instala en cualquier
agente compatible (Cursor, Codex, Gemini CLI, Windsurf, …):

```
npx skills add Hainrixz/claude-db
```

Qué se conserva y qué no:

| Capacidad | Plugin de Claude Code | Cross-agent (solo-skills) |
|---|---|---|
| Skills audit / design / migrate / fix (`SKILL.md`) | Sí | Sí |
| Scripts cero-dep (Node ≥ 18, `parse-orm-python.py` con Python 3) | Sí | Sí (si el agente ejecuta Node/Python) |
| `db-migration-writer` como único subagente escritor | Sí | No (sin aislamiento de subagentes) |
| Hook PreToolUse de guardia de escritura (bloquea escrituras a DB / mutación de archivos en auditorías) | Sí | No |
| MCP de DB de solo lectura opcional (`.mcp.json.example`) | Sí | Depende del agente anfitrión |
| `disable-model-invocation` en `fix` | Sí | No se hace cumplir |

> Recordatorio de seguridad: en Claude Code el fixer (`skills/fix`) es `disable-model-invocation: true` y
> solo `db-migration-writer` tiene Write/Edit. Al ejecutar solo-skills en otro agente, esas garantías
> dependen del modelo y los permisos del agente anfitrión, así que revisa cada diff y migración antes de
> aplicar.

## Garantía offline Tier-0

Una auditoría completa se ejecuta con **cero servidores MCP, cero API keys y sin conexión a base de
datos**. Tier 0 lee artefactos declarativos (`schema.prisma`, snapshots de Drizzle, `structure.sql`, DDL
SQL crudo, `schema.rb`) y código fuente (Drizzle `.ts`, Mongoose `.js`, CDK de DynamoDB), o acepta una
descripción en lenguaje natural. Cualquier cosa que requiera verdad en runtime (uso real de índices,
conteos de filas, planes de query, estado de autovacuum) emite `needs_api` en vez de adivinar.

## Versionado

Las versiones viven en dos lugares y deben mantenerse alineadas:

- `.claude-plugin/plugin.json` → `"version"`
- `.claude-plugin/marketplace.json` → el `"version"` de la entrada del plugin

Para publicar una actualización, sube la `version` en `plugin.json` (y haz coincidir en
`marketplace.json`), commitea y haz push. Los usuarios obtienen la nueva build re-ejecutando el flujo de
marketplace/install o `/reload-plugins`.

| Salto | Cuándo |
|---|---|
| Patch (`0.1.0 → 0.1.1`) | Correcciones, ediciones de docs, sin cambio de comportamiento |
| Minor (`0.1.0 → 0.2.0`) | Nuevos módulos, skills o flags; retrocompatible |
| Major (`0.1.0 → 1.0.0`) | Cambios rompedores en comandos, esquema de hallazgos o scoring |

Mantén los docs bilingües (`docs/en` + `docs/es`) sincronizados cuando cambie el comportamiento visible
para el usuario.

## Checklist pre-publicación

```
# verifica la sintaxis de cada script
for f in scripts/*.mjs scripts/lib/*.mjs; do node --check "$f"; done
# ejecuta el self-test de los scripts contra los fixtures
node tests/run.mjs
# valida el manifiesto del plugin (si tienes el CLI)
claude plugin validate .
```

## Licencia y originalidad

`claude-db` tiene **licencia MIT** (texto completo en [`LICENSE`](../../LICENSE)). Es obra original: no
copia **ninguna** marca, texto ni nombre de otro proyecto. Las contribuciones deben mantener el mismo
estándar — incluyendo **ninguna estadística, latencia, throughput, conteo de filas ni precio fabricado**
en hallazgos o recomendaciones de diseño. Al redistribuir, conserva intactos la `LICENSE` MIT y el aviso
de copyright.
