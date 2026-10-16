import type { Task } from './tasks'

export const UPSERT_TASK_SQL = `
  INSERT INTO tasks (id, title, notes, due_date, due_time, time_zone, due_at, reminder_minutes,
    completed_at, created_at, updated_at, deleted_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  ON CONFLICT(id) DO UPDATE SET
    title=excluded.title, notes=excluded.notes, due_date=excluded.due_date,
    due_time=excluded.due_time, time_zone=excluded.time_zone, due_at=excluded.due_at,
    reminder_minutes=excluded.reminder_minutes, completed_at=excluded.completed_at,
    updated_at=excluded.updated_at, deleted_at=excluded.deleted_at
`

export function taskSqlParams(task: Task): (string | number | null)[] {
  return [task.id, task.title, task.notes, task.dueDate, task.dueTime, task.timeZone, task.dueAt,
    task.reminderMinutes, task.completedAt, task.createdAt, task.updatedAt, task.deletedAt]
}
