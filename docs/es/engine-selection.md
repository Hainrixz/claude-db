# Selección de motor — entregada por `/claude-db:design` (y `/claude-db:start`) — M0

La selección de motor responde una pregunta: **¿qué paradigma y motor de base de datos encajan con lo
que construyes?** Es el módulo **M0** — una *recomendación, no una auditoría puntuada*. No existe un
comando `recommend`/`engine` aparte: la lógica M0 la entrega **`/claude-db:design`** (y, para
no-programadores, el asistente **`/claude-db:start`**). No produce puntuación de Diseño ni de
Rendimiento; produce una elección razonada con trade-offs honestos. El valor por defecto es Postgres
salvo que tus requisitos apunten a otra cosa.

## Cómo se hace la recomendación

La recomendación va de **patrones de acceso → paradigma → motor → plataforma**, en ese orden. Nunca parte
de una marca.

1. **Capturar la carga de trabajo.** Qué almacenas, cómo lo lees (lookups puntuales, rangos, joins,
   full-text, similitud vectorial, traversal de grafo, eventos ordenados en el tiempo), tasa de
   escritura, necesidades de consistencia y tamaño del equipo/apetito operativo. Cuando un número
   importa, se **pregunta**, nunca se inventa.
2. **Elegir el paradigma.** Mapea el patrón de acceso dominante a un paradigma:
   - Relacional — relaciones ricas, transacciones, queries ad-hoc, integridad referencial.
   - Documental — orientado a agregados, modelos de lectura desnormalizados, forma flexible por
     documento.
   - Key-value — lookups puntuales de alto throughput por una clave conocida, caché, sesiones.
   - Wide-column — tabla-por-query, volumen de escritura enorme, acceso por partition key.
   - Vector — búsqueda por similitud de embeddings (con filtrado de metadata).
   - Series temporales — eventos append-only ordenados en el tiempo, retención, downsampling.
   - Grafo — relaciones con mucho traversal, queries de profundidad variable.
3. **Elegir el motor dentro del paradigma**, sopesando madurez, ecosistema/soporte ORM, carga operativa y
   fit con los patrones de acceso. **Por defecto Postgres** para relacional y para muchas necesidades
   "especializadas" que cubre bien (JSONB para datos tipo documento, `pgvector` para vectores,
   TimescaleDB para series temporales) antes de recurrir a un sistema separado.
4. **Elegir la plataforma/host** — auto-gestionado vs gestionado (Supabase, Neon, PlanetScale, RDS,
   Turso, D1, Atlas, …) — sopesando vigencia de versión, honestidad de precios/lock-in y soporte de
   features por plataforma.

## Reglas de honestidad (sin comparaciones fabricadas)

- **Sin estadísticas fabricadas** — nunca inventa latencia, throughput, QPS, conteos de filas ni números
  de benchmark para justificar una elección. Las comparaciones son trade-offs cualitativos, no cifras
  inventadas.
- **Sin afirmaciones fabricadas de EOL o versión** — la vigencia de versión se reporta solo desde hechos
  verificables; la herramienta no inventa fechas de fin de vida.
- **Honestidad de precios y lock-in** — los trade-offs de costo y lock-in se describen de forma
  direccional (p. ej. "el egress y el pricing por branch pueden sorprenderte a escala; verifica el
  precio actual"), nunca como cifras en dólares fabricadas.
- **Soporte de FK por plataforma** — marca limitaciones reales de plataforma (p. ej. motores/hosts con
  llaves foráneas limitadas o no impuestas) para que una elección relacional no quede socavada por el
  host.
- **Una recomendación es un punto de partida**, no una garantía; nombra los supuestos que hizo y las
  preguntas que no pudo responder sin tu input.

## "Aún no agregues otra base de datos"

Una salida frecuente y deliberada es **"Postgres ya hace esto"** — JSONB en vez de un almacén documental
separado, `pgvector` en vez de una DB vectorial dedicada, TimescaleDB en vez de un sistema de series
temporales separado — porque la persistencia polyglot prematura multiplica el costo operativo. La
recomendación lo dice claramente cuando aplica, y marca el **sharding prematuro** de la misma forma.

## Cómo conecta con el resto de la suite

- Para un proyecto nuevo sin esquema, `/claude-db:start` (el [asistente de diseño](./design-wizard.md))
  usa esta misma lógica M0 para elegir dónde poner el esquema inicial.
- Cuando ya conoces tus requisitos, `/claude-db:design` ejecuta la recomendación M0 como primer paso y
  luego dibuja el esquema y un diagrama alrededor del motor elegido.
- Una vez elegido un motor y existiendo un esquema, `/claude-db:audit` lo puntúa en ambos ejes; los
  concerns de fit de plataforma (vigencia de versión, lock-in, soporte de FK) siguen apareciendo allí
  como **M21**.

```
/claude-db:design "analítica de eventos, ingesta 50k eventos/seg, dashboards de los últimos 90 días"
# → probablemente series temporales (TimescaleDB sobre Postgres, o ClickHouse) con los trade-offs explicados
```
