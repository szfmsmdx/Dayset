ALTER TABLE tasks ADD COLUMN parent_task_id TEXT;
ALTER TABLE tasks ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS tasks_parent_task_id_idx ON tasks(parent_task_id);
