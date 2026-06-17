# Design wizard — 7 plain-language questions (zero-artifact flow)

Drives `/claude-db:design` and `/claude-db:start` when there is **no schema to read** (greenfield, or a
non-expert describing an idea). Ask in plain language, one concept at a time, **never naming an engine in a
question** (the engine is the *output*, via `engine-selection-tree.md`). Each question has one concrete
example and a **"not sure" safe-default branch** so a non-expert is never blocked. Answers route to
`{paradigm, scale, mode}`.

## The 7 questions (verbatim)

1. **"In a sentence or two, what are you building, and what's the main thing it stores?"**
   *Example: "A booking app for barber shops — it stores shops, their staff, services, and appointments."*
   Not sure → ask for the one screen they care most about and infer the main thing from it.

2. **"What are the few things users will do most often with that data — the actions you'd hate to be slow?"**
   *Example: "See a shop's open slots for a day, and book one."*
   Not sure → "What would the busiest screen show?" — that reveals the dominant read.

3. **"How connected is the data — do records relate to each other a lot, or are they mostly standalone
   items you look up by a key?"**
   *Example: "Very connected — appointments link staff, services, and customers."*
   Not sure → safe default: **treat it as connected/relational** (Postgres handles both; this never paints
   you into a corner).

4. **"Roughly how much data and how many users, now and in a year — dozens, thousands, or millions?"**
   *Example: "Hundreds of shops now, maybe low thousands in a year."*
   Not sure → safe default: **assume modest scale** and design for what's visible; the recommendation keeps
   the door open to scale later.

5. **"Does any of it need special handling — money/payments, search-as-you-type, location/maps,
   AI/semantic search, or lots of time-stamped events like sensor or activity logs?"**
   *Example: "Payments for deposits, and search shops near me."*
   Not sure → safe default: **none of the special cases**; revisit if one appears later.

6. **"How fresh must reads be — is it OK if some data is a second or two behind, or must every read be
   bang-up-to-date?"**
   *Example: "Slot availability must be exact; a dashboard can lag a little."*
   Not sure → safe default: **strong/up-to-date reads** (the safer correctness choice).

7. **"Where will this run and who maintains it — a small team that wants it managed, or do you have ops
   muscle and specific cloud/region needs?"**
   *Example: "Two devs, want it fully managed, users mostly in Europe."*
   Not sure → safe default: **fully managed, single region** (lowest operational burden).

## Answer → routing table

| Question | Answer signal | Routes to |
|---|---|---|
| Q1 main thing | files/docs/nested blobs | paradigm hint: document |
| Q1/Q3 | shared entities, many relationships | paradigm: relational |
| Q2 dominant action | deep traversals (who-knows-who, paths) | paradigm hint: graph |
| Q2 | key lookups only, no ad-hoc queries | paradigm hint: key-value/document |
| Q4 scale | dozens/thousands | scale: small |
| Q4 | millions+ / multi-region | scale: large (escalate to tree branch 6/9) |
| Q5 money | yes | constraint: exact numeric types, idempotent writes |
| Q5 search-as-you-type | yes | capability: FTS/search |
| Q5 location/maps | yes | capability: geo (PostGIS) |
| Q5 AI/semantic | yes | capability: vector (pgvector) |
| Q5 time-stamped events | yes, high rate | paradigm hint: time-series |
| Q6 freshness | must be exact | mode: strong consistency |
| Q6 | seconds behind OK | mode: eventual OK (replicas/caches allowed) |
| Q7 managed/region | managed, single region | platform: Supabase/Neon; else tree overlay |
| any | new build | mode: design |
| any | existing schema present | mode: audit (skip wizard, read the schema) |

## Zero-artifact flow
1. Detect there's nothing to read → enter wizard.
2. Ask the 7 questions conversationally (batch follow-ups; don't interrogate). Accept "not sure" anywhere and
   apply the safe default — **never stall**.
3. Assemble `{paradigm, scale, capabilities, consistency, platform, mode}`.
4. Feed `engine-selection-tree.md` → recommended engine + boring default + deviation trigger.
5. Render via `render-contract.md` (plain-language design layer + expandable technical layer): a starter
   schema/key design, the engine recommendation with its honest trade-off, and the next step.
Never name an engine until step 4's output. No fabricated numbers anywhere.
