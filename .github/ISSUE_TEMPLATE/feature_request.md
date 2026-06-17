---
name: Feature request
about: Propose a new check, module, paradigm, platform, or workflow improvement
title: "[feat] "
labels: enhancement
assignees: ""
---

## Problem / motivation

<!-- What database design, integrity, performance, or migration problem is not
     covered today? What did you expect claude-db to catch or recommend? -->

## Proposed change

<!-- What should it do? If this is a new check, which module would own it
     (M0–M22) and which axis does it feed: design | performance | both? -->

- Affected module(s):
- Axis: <!-- design | performance | both -->
- Paradigm(s): <!-- relational | document | key-value | wide-column | vector | time-series | graph -->

## Detection signal (how it would be found)

<!-- Tier-0 static check (file/DDL/migration/ORM pattern) and/or the Tier-1
     verification query against a live DB. Be specific — vague checks become
     false positives. -->

## Honesty / impact

<!-- Magnitude must be banded high|medium|low, never a fabricated number. If a
     live DB is required to confirm, the check should emit needs_api, not a
     silent pass. Note that here. -->

## Alternatives considered

<!-- Existing modules, workarounds, or why this can't live in an existing check. -->
