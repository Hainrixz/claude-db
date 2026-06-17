---
name: start
description: Guided, jargon-free starting point for people with no schema and no database yet — a short 7-question wizard that turns "I want to build an app" into a concrete engine recommendation and a first data model. Zero artifacts required. Use when the user has nothing to audit, asks how to begin, says they're not technical, or doesn't know what database or schema they need.
argument-hint: "[one-line description of your project]"
allowed-tools: Read, Glob, Bash
---

# /claude-db:start

The front door for someone with **zero artifacts** — no schema, no migrations, no database. It asks a short, plain-language wizard and ends with a concrete recommendation. No jargon: no "normalization", "cardinality", or "partition key" in the questions.

`$ARGUMENTS` = an optional one-line description. If present, pre-fill what you can and skip questions already answered.

## How to run it
Follow the 7-question wizard in **`references/design-wizard.md`** (the canonical question set and the mapping from answers → paradigm/engine). Ask the questions conversationally, one cluster at a time, in plain words — roughly:
1. What are you building, in one sentence?
2. What are the main *things* you'll store (people, orders, messages, posts…)?
3. How do those things relate to each other?
4. What will you do most — look one thing up, list/search many, or crunch numbers over lots of rows?
5. How much data and how many users, roughly (a hobby project, a startup, or huge)?
6. Any hard rules — must never lose a record, must be fast above all, has to handle money or personal data?
7. What are you comfortable running or paying for (managed/serverless vs self-hosted)?

## What to produce
- A **plain-language recommendation**: which database to start with, in one sentence, and why — defaulting to the boring, safe choice (usually Postgres) unless an answer genuinely points elsewhere.
- A **starter data model** for the main things named, with the obvious relationships and the few constraints/keys that keep data clean — described in words, with a simple diagram.
- A clear next step: "Save this as your schema, then run `/claude-db:audit` to score it" or "Run `/claude-db:design` for the full technical layer."

## Honesty
- Never fabricate prices, performance numbers, or row counts; describe trade-offs in plain qualitative terms.
- If an answer is missing, ask — don't assume. Respond in the user's language (EN/ES).
