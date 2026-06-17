---
name: score
description: Recompute and display the two database scores (Design & Integrity + Performance & Scale) from a findings JSON, without re-auditing. Use to re-show or refresh the scores after an audit, to re-score with a different paradigm profile, or to score a saved findings file.
argument-hint: "[findings.json] [--paradigm relational|document|key-value|wide-column|vector|time-series|graph]"
allowed-tools: Read, Bash
---

# /claude-db:score

Recompute and show the two 0–100 scores from a set of findings by re-running **`scripts/score.mjs`** (pure, fully reproducible — it implements `references/scoring-model.md`).

- If a findings JSON path is given in `$ARGUMENTS`, score that file:
  `node scripts/score.mjs --findings <path> [--paradigm <p>]`.
  The file is a JSON array of findings (or `{ "findings": [...] }`) conforming to `schema/finding.schema.json`.
- Otherwise use the findings from the most recent audit this session. If no audit has run yet, tell the user to run `/claude-db:audit <target>` first — do not invent findings.
- The `--paradigm` flag selects the category profile (`PROFILES` in `score.mjs`); the default is `relational`. Re-scoring under a different profile is how you show, e.g., the same Mongo findings under the `document` profile (no foreign-key categories in the denominator).

Show both scores with bands (A ≥ 90 · B ≥ 80 · C ≥ 70 · D ≥ 60 · F < 60), the per-category breakdown (value × weight, active?), any **severity-gating cap** (`capped:true` with the uncapped `computed` shown), and the `needs_api` count as score confidence. `needs_api` and `speculative` findings never cap. Two scores, never blended.
