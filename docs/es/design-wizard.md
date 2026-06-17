# Asistente de diseño — `/claude-db:start`

`/claude-db:start` es el **asistente de diseño guiado para no-programadores**. Describes qué construyes
en lenguaje natural y respondes una serie corta de preguntas; el asistente convierte tus respuestas en un
esquema inicial con llaves, tipos, constraints y relaciones sensatas — sin necesidad de saber SQL ni ORM.
No escribe nada por su cuenta; la salida es una propuesta que revisas y luego pasas a `design`/`migrate`.

## Para quién es

- Conoces tu **dominio** ("una app de reservas", "un control de inventario") pero no el modelado de bases
  de datos.
- Aún no tienes archivos de esquema, así que la detección de stack devuelve una lista vacía y te enruta
  aquí.
- Quieres un punto de partida defendible que ya evite los errores sev-5 comunes (sin llave primaria,
  money en float, secretos en texto plano) en vez de un archivo en blanco.

## Cómo funciona

El asistente corre como una entrevista corta en lenguaje natural. Nunca asume un motor y nunca fabrica
números; cuando una elección depende de la escala, **pregunta** en vez de adivinar.

1. **¿Qué construyes?** Una línea sobre la app y quién la usa.
2. **¿Qué cosas registras?** El asistente convierte sustantivos en entidades (p. ej. *cliente*, *orden*,
   *producto*) y pregunta cómo se relacionan ("¿una orden pertenece a un solo cliente?").
3. **Para cada campo, ¿qué tipo de valor?** Preguntas de tipo en lenguaje natural — "¿esto es dinero?"
   mapea a `numeric`/`Decimal128` (nunca float); "¿una fecha y hora?" mapea a `timestamptz` en UTC; "¿uno
   de un conjunto fijo?" mapea a un enum o una tabla de lookup.
4. **¿Qué debe ser siempre verdad?** Convierte reglas en constraints — campos requeridos (`NOT NULL`),
   valores únicos (email), rangos de valor (`CHECK`), y qué registros nunca pueden quedar huérfanos
   (llaves foráneas).
5. **Ciclo de vida y privacidad.** Pregunta sobre soft-delete, trazas de auditoría, retención/borrado
   (GDPR), y si algún campo es dato personal que requiere cuidado.
6. **Escala y compartición.** Pregunta cuántos usuarios/tenants aproximadamente y si los datos se
   comparten o se aíslan por tenant — lo suficiente para elegir una estrategia de llave primaria
   (UUIDv7/ULID vs bigint) y marcar multi-tenancy.

## Qué obtienes

- Un **esquema propuesto** en el motor que encaja (elegido con la misma lógica M0 de
  [`engine-selection.md`](./engine-selection.md) — por defecto Postgres salvo que tus respuestas apunten
  a otra cosa), expresado como DDL o un esquema ORM.
- Cada tabla con una **llave primaria** sensata, constraints **NOT NULL**/**UNIQUE**/**CHECK**, y
  **llaves foráneas** con comportamiento `ON DELETE` explícito.
- Money como `numeric`, timestamps como `timestamptz` (UTC), enums-vs-lookup elegidos deliberadamente.
- Una explicación breve en lenguaje natural del **porqué** de cada elección, y cualquier pregunta abierta
  que el asistente no pudo responder por ti.

## Honestidad en el asistente

- **Nunca fabrica** conteos de filas, tráfico, latencia ni precios para justificar una elección; cuando
  la escala importa, te pregunta.
- Expone los trade-offs con claridad (p. ej. "una tabla de lookup es más flexible que un enum pero suma
  un join").
- Produce una **propuesta**, no cambios aplicados. Para convertirla en migraciones reales, revísala y
  ejecuta `/claude-db:design` (para refinar) y `/claude-db:migrate` (para desplegar de forma segura, con
  un paso reversible).

## Después del asistente

```
/claude-db:start                       # entrevista → propuesta de esquema inicial
/claude-db:design  "<refinamientos>"   # ajusta la propuesta
/claude-db:migrate "<primera migración>" # planifica un despliegue seguro y reversible (dry-run por defecto)
/claude-db:audit                       # una vez que tienes un archivo de esquema, audítalo en ambos ejes
```
