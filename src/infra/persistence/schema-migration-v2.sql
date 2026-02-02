-- Migration from v1 to v2: Add allowed_actions field to goals table
-- This field enforces tool allowlist per goal (Tier 3 Capability Area 3)

ALTER TABLE goals ADD COLUMN allowed_actions TEXT;

-- Set default allowed_actions for existing goals (if any)
UPDATE goals SET allowed_actions = '["read_file","write_file","run_command"]' WHERE allowed_actions IS NULL;
