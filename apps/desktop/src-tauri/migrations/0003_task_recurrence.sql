ALTER TABLE tasks ADD COLUMN repeat_frequency TEXT NOT NULL DEFAULT 'none';
ALTER TABLE tasks ADD COLUMN repeat_end_mode TEXT NOT NULL DEFAULT 'never';
ALTER TABLE tasks ADD COLUMN repeat_end_date TEXT;
ALTER TABLE tasks ADD COLUMN repeat_count INTEGER;
ALTER TABLE tasks ADD COLUMN repeat_series_id TEXT;
ALTER TABLE tasks ADD COLUMN repeat_occurrence INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN repeat_anchor_month INTEGER;
ALTER TABLE tasks ADD COLUMN repeat_anchor_day INTEGER;
