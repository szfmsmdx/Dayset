import type { Task } from './tasks'

export const UPSERT_TASK_SQL = `
  INSERT INTO tasks (id, title, notes, due_date, due_time, time_zone, due_at, reminder_minutes,
    repeat_frequency, repeat_end_mode, repeat_end_date, repeat_count, repeat_series_id,
    repeat_occurrence, repeat_anchor_month, repeat_anchor_day,
    completed_at, created_at, updated_at, deleted_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
  ON CONFLICT(id) DO UPDATE SET
    title=excluded.title, notes=excluded.notes, due_date=excluded.due_date,
    due_time=excluded.due_time, time_zone=excluded.time_zone, due_at=excluded.due_at,
    reminder_minutes=excluded.reminder_minutes, repeat_frequency=excluded.repeat_frequency,
    repeat_end_mode=excluded.repeat_end_mode, repeat_end_date=excluded.repeat_end_date,
    repeat_count=excluded.repeat_count, repeat_series_id=excluded.repeat_series_id,
    repeat_occurrence=excluded.repeat_occurrence, repeat_anchor_month=excluded.repeat_anchor_month,
    repeat_anchor_day=excluded.repeat_anchor_day, completed_at=excluded.completed_at,
    updated_at=excluded.updated_at, deleted_at=excluded.deleted_at
`

export function taskSqlParams(task: Task): (string | number | null)[] {
  return [task.id, task.title, task.notes, task.dueDate, task.dueTime, task.timeZone, task.dueAt,
    task.reminderMinutes, task.repeatFrequency, task.repeatEndMode, task.repeatEndDate, task.repeatCount,
    task.repeatSeriesId, task.repeatOccurrence, task.repeatAnchorMonth, task.repeatAnchorDay,
    task.completedAt, task.createdAt, task.updatedAt, task.deletedAt]
}
