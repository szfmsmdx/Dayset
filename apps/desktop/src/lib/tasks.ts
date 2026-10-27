export type View = 'today' | 'inbox' | 'planned'
export type RepeatFrequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
export type RepeatEndMode = 'never' | 'until' | 'count'

export interface Task {
  id: string
  parentTaskId: string | null
  title: string
  notes: string
  tags: string[]
  dueDate: string | null // YYYY-MM-DD in the user's local calendar
  dueTime: string | null // HH:mm; only meaningful with dueDate
  timeZone: string | null // IANA zone captured when a time is set
  dueAt: number | null // UTC epoch milliseconds for an exact reminder instant
  reminderMinutes: number | null
  repeatFrequency: RepeatFrequency
  repeatEndMode: RepeatEndMode
  repeatEndDate: string | null
  repeatCount: number | null
  repeatSeriesId: string | null
  repeatOccurrence: number
  repeatAnchorMonth: number | null
  repeatAnchorDay: number | null
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

function formatCalendarDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function advanceOccurrence(task: Task, from: string): string {
  const [year, month, day] = from.split('-').map(Number)
  if (task.repeatFrequency === 'daily' || task.repeatFrequency === 'weekly') {
    const date = new Date(year, month - 1, day, 12)
    date.setDate(date.getDate() + (task.repeatFrequency === 'daily' ? 1 : 7))
    return formatCalendarDate(date)
  }

  if (task.repeatFrequency === 'monthly') {
    const nextMonth = year * 12 + month
    const nextYear = Math.floor(nextMonth / 12)
    const monthIndex = nextMonth % 12
    const anchorDay = task.repeatAnchorDay ?? day
    const lastDay = new Date(nextYear, monthIndex + 1, 0).getDate()
    return formatCalendarDate(new Date(nextYear, monthIndex, Math.min(anchorDay, lastDay), 12))
  }

  const anchorMonth = task.repeatAnchorMonth ?? month
  const anchorDay = task.repeatAnchorDay ?? day
  const lastDay = new Date(year + 1, anchorMonth, 0).getDate()
  return formatCalendarDate(new Date(year + 1, anchorMonth - 1, Math.min(anchorDay, lastDay), 12))
}

export function nextOccurrence(task: Task, today = localDay()): Task | null {
  if (task.repeatFrequency === 'none' || !task.dueDate) return null

  let dueDate = advanceOccurrence(task, task.dueDate)
  let occurrence = task.repeatOccurrence + 1
  while (dueDate <= today) {
    dueDate = advanceOccurrence(task, dueDate)
    occurrence += 1
  }

  if (task.repeatEndMode === 'until' && (!task.repeatEndDate || dueDate > task.repeatEndDate)) return null
  if (task.repeatEndMode === 'count' && (!task.repeatCount || occurrence > task.repeatCount)) return null

  const now = Date.now()
  return {
    ...task,
    id: crypto.randomUUID(),
    dueDate,
    timeZone: task.dueTime ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
    dueAt: localDueAt(dueDate, task.dueTime),
    repeatSeriesId: task.repeatSeriesId ?? task.id,
    repeatOccurrence: occurrence,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
}

export function createTask(title: string, view: View): Task {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    parentTaskId: null,
    title,
    notes: '',
    tags: [],
    dueDate: view === 'today' ? localDay() : view === 'planned' ? localDay(1) : null,
    dueTime: null,
    timeZone: null,
    dueAt: null,
    reminderMinutes: null,
    repeatFrequency: 'none',
    repeatEndMode: 'never',
    repeatEndDate: null,
    repeatCount: null,
    repeatSeriesId: null,
    repeatOccurrence: 1,
    repeatAnchorMonth: null,
    repeatAnchorDay: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
}

function activeTreePredicate(tasks: Task[]): (task: Task) => boolean {
  const byId = new Map(tasks.map(item => [item.id, item]))
  const cache = new Map<string, boolean>()
  return task => {
    if (cache.has(task.id)) return cache.get(task.id)!
    const path: string[] = []
    const visited = new Set<string>()
    let current: Task | undefined = byId.get(task.id) ?? task
    let isActive = false
    while (current) {
      if (cache.has(current.id)) {
        isActive = cache.get(current.id)!
        break
      }
      if (visited.has(current.id) || current.deletedAt !== null) break
      visited.add(current.id)
      path.push(current.id)
      if (!current.parentTaskId) {
        isActive = true
        break
      }
      current = byId.get(current.parentTaskId)
    }
    for (const id of path) cache.set(id, isActive)
    return isActive
  }
}

export function activeTasks(tasks: Task[]): Task[] {
  const isActive = activeTreePredicate(tasks)
  return tasks.filter(isActive)
}

export function isTaskInActiveTree(task: Task, tasks: Task[]): boolean {
  return activeTreePredicate(tasks)(task)
}

export function tasksForView(tasks: Task[], view: View, today = localDay()): Task[] {
  const isActive = activeTreePredicate(tasks)
  return tasks.filter(task => {
    if (!isActive(task)) return false
    if (view === 'inbox') return task.dueDate === null
    if (view === 'today') return task.dueDate !== null && task.dueDate <= today
    return task.dueDate !== null
  }).sort((a, b) => {
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
  const isActive = activeTreePredicate(tasks)
  const due = tasks.filter(task => {
    if (!isActive(task) || !task.dueDate || task.dueDate > today) return false
    return task.completedAt === null || new Date(task.completedAt).toDateString() === new Date().toDateString()
  })
  return { done: due.filter(task => task.completedAt !== null).length, total: due.length }
}
