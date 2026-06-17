---
name: next
description: Coach the user on what to fix first — rank the audit findings into a single, ordered to-do list by score impact and effort, and explain why each item is where it is. Read-only; advises, does not change anything. Use when the user asks what to do next, what to fix first, what matters most, how to prioritize, or where to start after an audit.
argument-hint: "[findings.json] [--axis design|performance|both] [--top N]"
allowed-tools: Read, Bash
---

# /claude-db:next

The coach. Turns a pile of findings into one ranked, do-this-next list with a reason for each item. Read-only — it prioritizes, it never writes or migrates.

`$ARGUMENTS` = `[findings.json] [flags]`. Use the most recent audit's findings, or a findings JSON path. If no audit has run, say so and suggest `/claude-db:audit <target>`.

## Ranking (in order)
1. **Capped severity-5 first.** Any `status:"fail"` + `severity:5` on a relied-on axis caps that score at band F. These come first regardless of anything else — fixing them is the only way to lift the cap. (`needs_api` and `confidence:"speculative"` never cap, so they never jump the queue this way.)
2. Then by **severity × axis-weight** — the finding's severity times the weight its module carries in the relevant category/axis (from `references/scoring-model.md` / the active `PROFILES` profile in `score.mjs`). A high-severity finding in a heavily-weighted category (e.g. Indexación at w20, Integridad referencial at w16) outranks the same severity in a light one (Naming at w6).
3. Then by **fixability**: `auto` > `proposed` > `advisory` — surface the changes the tool can safely make for you before the ones needing judgment or that it will never write.
4. Then by **least reproduction cost** — break ties toward findings whose `verification.reproduce` is cheapest to confirm (Tier-0 static check before a Tier-1 query before anything `needs_api`).

## Output
A numbered list. For each item: the finding (id + one-line title), which score/axis it moves and roughly how much (banded magnitude high|medium|low — never a fabricated %), its fixability class, and the next concrete action ("run `/claude-db:fix --category keys`" / "run `/claude-db:migrate <file>`" / "needs a live DB: set `$DATABASE_URL` and re-audit at Tier 1"). Honor `--axis` and `--top N`. Respond in the user's language (EN/ES).
