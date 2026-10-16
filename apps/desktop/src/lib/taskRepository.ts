import { isTauri } from '@tauri-apps/api/core'
import Database from '@tauri-apps/plugin-sql'
import type { Task } from './tasks'
import { taskSqlParams, UPSERT_TASK_SQL } from './taskSql'

export interface TaskRepository {
  list(): Promise<Task[]>
  save(task: Task): Promise<void>
}

const PREVIEW_KEY = 'dayset-desktop-preview-v1'
const DATABASE_URL = 'sqlite:dayset.db'

function browserRepository(): TaskRepository {
  function read(): Task[] {
    const value = localStorage.getItem(PREVIEW_KEY)
    if (!value) return []
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) throw new Error('本地数据格式错误。')
    return parsed as Task[]
  }
  return {
    async list() { return read() },
    async save(task) {
      const tasks = read()
      const index = tasks.findIndex(item => item.id === task.id)
      if (index === -1) tasks.push(task)
      else tasks[index] = task
      localStorage.setItem(PREVIEW_KEY, JSON.stringify(tasks))
    },
  }
}

interface TaskRow {
  id: string
  title: string
  notes: string
  due_date: string | null
  due_time: string | null
  time_zone: string | null
  due_at: number | null
  reminder_minutes: number | null
  completed_at: number | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export async function openTaskRepository(): Promise<TaskRepository> {
  if (!isTauri()) return browserRepository()
  const db = await Database.load(DATABASE_URL)
  return {
    async list() {
      const rows = await db.select<TaskRow[]>('SELECT * FROM tasks ORDER BY created_at DESC')
      return rows.map(row => ({
        id: row.id, title: row.title, notes: row.notes,
        dueDate: row.due_date, dueTime: row.due_time, timeZone: row.time_zone, dueAt: row.due_at,
        reminderMinutes: row.reminder_minutes, completedAt: row.completed_at,
        createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at,
      }))
    },
    async save(task) {
      await db.execute(UPSERT_TASK_SQL, taskSqlParams(task))
    },
  }
}
