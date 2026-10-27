import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { UPSERT_TASK_SQL, taskSqlParams } from '../src/lib/taskSql.ts'

test('SQLite 迁移可建表，任务可更新并保留软删除记录', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(readFileSync(new URL('../src-tauri/migrations/0001_create_tasks.sql', import.meta.url), 'utf8'))
    const task = {
      id: 'task-1', title: '初始任务', notes: '', dueDate: '2026-10-16', dueTime: '09:30',
      timeZone: 'Asia/Shanghai', dueAt: 1792114200000, reminderMinutes: 15,
      completedAt: null, createdAt: 1, updatedAt: 1, deletedAt: null,
    }
    const save = db.prepare(UPSERT_TASK_SQL)
    const bind = value => Object.fromEntries(taskSqlParams(value).map((item, index) => [`$${index + 1}`, item]))
    save.run(bind(task))
    db.exec(readFileSync(new URL('../src-tauri/migrations/0002_track_sent_reminders.sql', import.meta.url), 'utf8'))
    db.prepare('UPDATE tasks SET reminded_for = ? WHERE id = ?').run(task.dueAt - 15 * 60_000, task.id)
    save.run(bind({ ...task, title: '已修改', notes: '会保留', updatedAt: 2, deletedAt: 3 }))
    const rows = db.prepare('SELECT * FROM tasks').all()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].title, '已修改')
    assert.equal(rows[0].notes, '会保留')
    assert.equal(rows[0].deleted_at, 3)
    assert.equal(rows[0].created_at, 1)
    assert.equal(rows[0].reminder_minutes, 15)
    assert.equal(rows[0].reminded_for, task.dueAt - 15 * 60_000)
  } finally {
    db.close()
  }
})
