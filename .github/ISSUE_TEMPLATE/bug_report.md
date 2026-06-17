---
name: Bug report
about: Something in claude-db produced a wrong, missing, or unreproducible result
title: "[bug] "
labels: bug
assignees: ""
---

## What happened

<!-- A clear description of the bug. If a finding was wrong, fabricated, or its
     verification.reproduce step did not reproduce, say so here. -->

## Which command / module

- Command: <!-- /claude-db:audit | design | migrate | fix | report -->
- Module (if known): <!-- e.g. db-indexing (M11), db-keys (M2), or "scoring" -->
- Paradigm: <!-- relational | document | key-value | wide-column | vector | time-series | graph -->

## Steps to reproduce

1.
2.
3.

## Expected vs actual

- Expected:
- Actual:

## Environment

- claude-db version (`.claude-plugin/plugin.json`):
- Claude Code version:
- Node version (`node --version`):
- Python version (`python3 --version`):
- OS:

## Relevant output / findings JSON

<!-- Paste the finding(s) or report. REDACT credentials, connection strings, and
     real data — claude-db redacts secrets, please do the same here. -->

```json

```
