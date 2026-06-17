-- Sample UNSAFE migration fixture for claude-db migration-safety (M22) tests.
-- Multiple destructive / locking operations that lint-migration.mjs must flag.

-- Destructive + irreversible: drops a column (data loss, no down path).
ALTER TABLE orders DROP COLUMN legacy_notes;

-- Full table rewrite + long lock on a large table (Postgres < 11 style default fill).
ALTER TABLE orders ADD COLUMN archived boolean NOT NULL DEFAULT false;

-- Destructive: drops a whole table.
DROP TABLE audit_log;

-- Unbounded data change without a guard.
UPDATE orders SET status = 'archived';

-- Adding a UNIQUE constraint without de-duplicating first can fail mid-migration.
ALTER TABLE customers ADD CONSTRAINT customers_email_key UNIQUE (email);
