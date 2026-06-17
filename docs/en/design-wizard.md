# Design wizard — `/claude-db:start`

`/claude-db:start` is the **guided design wizard for non-coders**. You describe what you're building in
plain language and answer a short series of questions; the wizard turns your answers into a starter
schema with sensible keys, types, constraints, and relationships — no SQL or ORM knowledge required.
It writes nothing on its own; the output is a proposal you review and then hand to `design`/`migrate`.

## Who it's for

- You know your **domain** ("a booking app", "an inventory tracker") but not database modeling.
- You have no schema files yet, so stack detection returns an empty list and routes you here.
- You want a defensible starting point that already avoids the common sev-5 mistakes (no primary key,
  float money, plaintext secrets) rather than a blank file.

## How it works

The wizard runs as a short, plain-language interview. It never assumes an engine and never fabricates
numbers; when a choice depends on scale it **asks** rather than guessing.

1. **What are you building?** A one-line description of the app and who uses it.
2. **What things do you track?** The wizard turns nouns into entities (e.g. *customer*, *order*,
   *product*) and asks how they relate ("does an order belong to one customer?").
3. **For each field, what kind of value?** Plain-language type questions — "is this money?" maps to
   `numeric`/`Decimal128` (never float); "a date and time?" maps to `timestamptz` in UTC; "one of a
   fixed set?" maps to an enum or a lookup table.
4. **What must always be true?** Turns rules into constraints — required fields (`NOT NULL`), unique
   values (email), value ranges (`CHECK`), and which records may never be orphaned (foreign keys).
5. **Lifecycle & privacy.** Asks about soft-delete, audit trails, retention/erasure (GDPR), and whether
   any field is personal data that needs care.
6. **Scale & sharing.** Asks roughly how many users/tenants and whether data is shared or isolated per
   tenant — enough to pick a primary-key strategy (UUIDv7/ULID vs bigint) and flag multi-tenancy.

## What you get

- A **proposed schema** in the engine that fits (chosen via the same M0 logic as
  [`engine-selection.md`](./engine-selection.md) — defaulting to Postgres unless your answers point
  elsewhere), expressed as DDL or an ORM schema.
- Each table with a sensible **primary key**, **NOT NULL**/**UNIQUE**/**CHECK** constraints, and
  **foreign keys** with explicit `ON DELETE` behavior.
- Money as `numeric`, timestamps as `timestamptz` (UTC), enums-vs-lookup chosen deliberately.
- A short plain-language explanation of **why** each choice was made, and any open questions the wizard
  could not answer for you.

## Honesty in the wizard

- It **never fabricates** row counts, traffic, latency, or prices to justify a choice; when scale
  matters it asks you.
- It surfaces trade-offs plainly (e.g. "a lookup table is more flexible than an enum but adds a join").
- It produces a **proposal**, not applied changes. To turn it into real migrations, review it and run
  `/claude-db:design` (to refine) and `/claude-db:migrate` (to roll out safely, with a reversible step).

## After the wizard

```
/claude-db:start                       # interview → starter schema proposal
/claude-db:design  "<refinements>"     # adjust the proposal
/claude-db:migrate "<first migration>" # plan a safe, reversible rollout (dry-run by default)
/claude-db:audit                       # once you have a schema file, audit it on both axes
```
