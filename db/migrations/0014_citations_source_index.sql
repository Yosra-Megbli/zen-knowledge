-- Add source_index to citations so each citation can be traced back to
-- the [SOURCE n] marker in the LLM answer. Nullable for backward compat
-- with any existing rows (there are none in prod yet).
ALTER TABLE citations ADD COLUMN IF NOT EXISTS source_index int;
