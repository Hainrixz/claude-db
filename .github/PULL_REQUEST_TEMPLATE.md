<!-- Thanks for contributing to claude-db. Keep the foundation contracts intact:
     schema/finding.schema.json, references/scoring-model.md, and scripts/score.mjs
     PROFILES are tested — do not change them without a deliberate, documented reason. -->

## What this changes

<!-- One or two sentences. Link the issue it closes: Closes #123 -->

## Type of change

- [ ] New module / check
- [ ] New paradigm or platform support
- [ ] Bug fix (wrong / fabricated / unreproducible finding)
- [ ] Scoring or report-rendering change
- [ ] Docs / references
- [ ] Tooling / CI

## Conventions checklist

- [ ] Module skills: frontmatter has only `name` (== dir) + `description` (+ `allowed-tools` if needed); body ≤ 120 lines; NO `user-invokable` key.
- [ ] Command/orchestration skills carry the right `allowed-tools` (and `Task` if they dispatch agents); only `fix` sets `disable-model-invocation: true`.
- [ ] Findings conform to `schema/finding.schema.json` (status / severity / evidence.observed / verification.reproduce / expected_impact.axis+confidence+magnitude).
- [ ] No fabricated stats/latency/throughput/row-counts/prices; magnitude is banded high|medium|low; live-DB checks emit `needs_api`, never a silent pass.
- [ ] Read-only auditors stay read-only (no Write/Edit tools).
- [ ] `references/*.md` ≤ 200 lines; `docs/{en,es}/*.md` kept in sync.

## Tests

- [ ] `node tests/run.mjs` passes
- [ ] `pytest tests/` passes
- [ ] `node --check` passes on all `.mjs`; `python3 -m py_compile` on the parser

## Notes for reviewers

<!-- Anything tricky, trade-offs, or follow-ups. -->
