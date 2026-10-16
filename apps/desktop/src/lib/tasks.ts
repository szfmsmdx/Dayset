export type View = 'today' | 'inbox' | 'planned' | 'completed'

export interface Task {
  id: string
  title: string
  notes: string
  dueDate: string | null // YYYY-MM-DD in the user's local calendar
  dueTime: string | null // HH:mm; only meaningful with dueDate
  timeZone: string | null // IANA zone captured when a time is set
  dueAt: number | null // UTC epoch milliseconds for an exact reminder instant
  reminderMinutes: number | null
  completedAt: number | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null // tombstone reserved for cross-device sync
}

export function localDay(offset = 0): string {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function dayLabel(value: string | null): string {
  if (!value) return '未安排'
  if (value === localDay()) return '今天'
  if (value === localDay(1)) return '明天'
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(year, month - 1, day))
}

export function reminderAt(task: Task): Date | null {
  if (!task.dueDate || !task.dueTime || task.reminderMinutes === null) return null
  if (task.dueAt !== null) return new Date(task.dueAt - task.reminderMinutes * 60_000)
  const [year, month, day] = task.dueDate.split('-').map(Number)
  const [hour, minute] = task.dueTime.split(':').map(Number)
  const date = new Date(year, month - 1, day, hour, minute)
  date.setMinutes(date.getMinutes() - task.reminderMinutes)
  return date
}

export function localDueAt(dueDate: string | null, dueTime: string | null): number | null {
  if (!dueDate || !dueTime) return null
  const [year, month, day] = dueDate.split('-').map(Number)
  const [hour, minute] = dueTime.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute).getTime()
}

export function reminderDescription(task: Task): string {
  if (!task.dueDate || !task.dueTime) return '先选日期和时间，再决定是否提醒。'
  const date = reminderAt(task)
  if (!date) return '当前不提醒。'
  const formatted = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
  return `预计 ${formatted} 提醒 · 系统通知将在后续版本接入`
}

export function createTask(title: string, view: View): Task {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    title,
    notes: '',
    dueDate: view === 'today' ? localDay() : view === 'planned' ? localDay(1) : null,
    dueTime: null,
    timeZone: null,
    dueAt: null,
    reminderMinutes: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
}

export function tasksForView(tasks: Task[], view: View, today = localDay()): Task[] {
  return tasks.filter(task => {
    if (task.deletedAt !== null) return false
    if (view === 'completed') return task.completedAt !== null
    if (task.completedAt !== null) return false
    if (view === 'inbox') return task.dueDate === null
    if (view === 'today') return task.dueDate !== null && task.dueDate <= today
    return task.dueDate !== null
  }).sort((a, b) => {
    if (view === 'completed') return (b.completedAt ?? 0) - (a.completedAt ?? 0)
    if ((view === 'planned' || view === 'today') && a.dueDate !== b.dueDate) {
      return (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
    }
    if (a.dueDate && a.dueDate === b.dueDate && a.dueTime !== b.dueTime) {
      return (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99')
    }
    return b.createdAt - a.createdAt
  })
}

export function todayProgress(tasks: Task[], today = localDay()): { done: number; total: number } {
  const due = tasks.filter(task => {
    if (task.deletedAt !== null || !task.dueDate || task.dueDate > today) return false
    return task.completedAt === null || new Date(task.completedAt).toDateString() === new Date().toDateString()
  })
  return { done: due.filter(task => task.completedAt !== null).length, total: due.length }
}
