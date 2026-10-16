import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createTask, localDay, localDueAt, reminderAt, tasksForView, todayProgress,
} from '../src/lib/tasks.ts'

function task(overrides = {}) {
  return {
    id: crypto.randomUUID(), title: '任务', notes: '', dueDate: null, dueTime: null,
    timeZone: null, dueAt: null, reminderMinutes: null, completedAt: null,
    createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null,
    ...overrides,
  }
}

test('新任务按所在视图安排日期', () => {
  assert.equal(createTask('今天', 'today').dueDate, localDay())
  assert.equal(createTask('计划', 'planned').dueDate, localDay(1))
  assert.equal(createTask('收件箱', 'inbox').dueDate, null)
})

test('今天包含逾期事项，收件箱与已完成独立，删除记录不可见', () => {
  const today = '2026-10-16'
  const overdue = task({ id: 'overdue', dueDate: '2026-10-15' })
  const due = task({ id: 'due', dueDate: today })
  const future = task({ id: 'future', dueDate: '2026-10-17' })
  const inbox = task({ id: 'inbox' })
  const completed = task({ id: 'completed', dueDate: today, completedAt: Date.now() })
  const deleted = task({ id: 'deleted', dueDate: today, deletedAt: Date.now() })
  const all = [future, deleted, due, inbox, completed, overdue]
  assert.deepEqual(tasksForView(all, 'today', today).map(item => item.id), ['overdue', 'due'])
  assert.deepEqual(tasksForView(all, 'inbox', today).map(item => item.id), ['inbox'])
  assert.deepEqual(tasksForView(all, 'planned', today).map(item => item.id), ['overdue', 'due', 'future'])
  assert.deepEqual(tasksForView(all, 'completed', today).map(item => item.id), ['completed'])
})

test('同一天先显示有具体时间的任务', () => {
  const all = [
    task({ id: 'no-time', dueDate: '2026-10-16', createdAt: 30 }),
    task({ id: 'afternoon', dueDate: '2026-10-16', dueTime: '15:00', createdAt: 20 }),
    task({ id: 'morning', dueDate: '2026-10-16', dueTime: '09:30', createdAt: 10 }),
  ]
  assert.deepEqual(tasksForView(all, 'today', '2026-10-16').map(item => item.id), [
    'morning', 'afternoon', 'no-time',
  ])
})

test('提醒基于确定的 UTC 时刻扣除提前量，纯日期不提醒', () => {
  const dueAt = localDueAt('2026-10-16', '09:30')
  assert.notEqual(dueAt, null)
  assert.equal(reminderAt(task({ dueDate: '2026-10-16', dueTime: '09:30', dueAt, reminderMinutes: 15 }))?.getTime(), dueAt - 15 * 60_000)
  assert.equal(reminderAt(task({ dueDate: '2026-10-16', reminderMinutes: 15 })), null)
  assert.equal(localDueAt(null, '09:30'), null)
})

test('今日进度忽略已删除及未来事项', () => {
  const today = localDay()
  const yesterday = localDay(-1)
  const all = [
    task({ dueDate: today }),
    task({ dueDate: yesterday, completedAt: Date.now() }),
    task({ dueDate: localDay(1) }),
    task({ dueDate: today, deletedAt: Date.now() }),
  ]
  assert.deepEqual(todayProgress(all, today), { done: 1, total: 2 })
})
