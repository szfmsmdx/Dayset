<script lang="ts">
  import { onMount } from 'svelte'
  import { openTaskRepository, type TaskRepository } from './lib/taskRepository'
  import {
    createTask, dayLabel, localDay, localDueAt, reminderDescription, tasksForView, todayProgress,
    type Task, type View,
  } from './lib/tasks'

  const labels: Record<View, string> = {
    today: '今天', inbox: '收件箱', planned: '计划', completed: '已完成',
  }
  const reminderOptions = [
    { value: 'none', label: '不提醒' }, { value: '0', label: '准时' },
    { value: '5', label: '提前 5 分钟' }, { value: '15', label: '提前 15 分钟' },
    { value: '30', label: '提前 30 分钟' }, { value: '60', label: '提前 1 小时' },
    { value: '1440', label: '提前 1 天' },
  ]

  let repository: TaskRepository | null = null
  let tasks: Task[] = []
  let view: View = 'today'
  let selectedId: string | null = null
  let addText = ''
  let addInput: HTMLInputElement
  let menuOpen = false
  let loading = true
  let loadError = ''
  let toastMessage = ''
  let toastUndo: (() => Promise<void>) | null = null
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  let today = localDay()

  $: visible = tasksForView(tasks, view, today)
  $: progress = todayProgress(tasks, today)
  $: completedCount = tasks.filter(task => task.deletedAt === null && task.completedAt !== null).length
  $: heroCaption = view === 'today'
    ? progress.total === 0 ? '今天还没有任务。' : visible.length ? '先做一件，剩下的慢慢来。' : '今天的事情都处理好了。'
    : view === 'inbox' ? '先记下来，再决定什么时候做。'
    : view === 'planned' ? '看看接下来的节奏。' : '做过的事，都留在这里。'
  $: addHint = view === 'today' ? '新任务会安排到今天 · 点击任务可改日期'
    : view === 'inbox' ? '先记下来，之后再安排日期'
    : view === 'planned' ? '新任务会先安排到明天' : '新任务会加入收件箱'

  onMount(() => {
    void loadTasks()
    const timer = setInterval(() => { today = localDay() }, 60_000)
    return () => { clearInterval(timer); if (toastTimer) clearTimeout(toastTimer) }
  })

  async function loadTasks() {
    try {
      repository = await openTaskRepository()
      tasks = await repository.list()
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error)
    } finally {
      loading = false
    }
  }

  function showToast(message: string, undo: (() => Promise<void>) | null = null) {
    if (toastTimer) clearTimeout(toastTimer)
    toastMessage = message
    toastUndo = undo
    toastTimer = setTimeout(() => { toastMessage = ''; toastUndo = null }, 6000)
  }

  async function persist(task: Task) {
    if (!repository) return
    await repository.save(task)
    tasks = tasks.some(item => item.id === task.id)
      ? tasks.map(item => item.id === task.id ? task : item)
      : [...tasks, task]
  }

  async function changeTask(task: Task, changes: Partial<Task>, message = '', allowUndo = false) {
    const updated: Task = { ...task, ...changes, updatedAt: Date.now() }
    try {
      await persist(updated)
      if (message) showToast(message, allowUndo ? async () => {
        await persist({ ...task, updatedAt: Date.now() })
        showToast('已撤销')
      } : null)
    } catch (error) {
      showToast(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function addTask(event: SubmitEvent) {
    event.preventDefault()
    const title = addText.trim()
    if (!title || !repository) return
    const target: View = view === 'completed' ? 'inbox' : view
    try {
      await persist(createTask(title, target))
      addText = ''
      view = target
      addInput.focus()
      showToast('已添加任务')
    } catch (error) {
      showToast(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function setView(next: View) {
    view = next
    selectedId = null
    menuOpen = false
  }

  function setDate(task: Task, value: string | null) {
    if (task.dueDate === value) return
    void changeTask(task, {
      dueDate: value,
      dueTime: value ? task.dueTime : null,
      timeZone: value && task.dueTime ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
      dueAt: localDueAt(value, task.dueTime),
      reminderMinutes: value ? task.reminderMinutes : null,
    }, value ? `已安排到${dayLabel(value)}` : '已移回收件箱', true)
  }

  function setTime(task: Task, value: string | null) {
    if (!task.dueDate || task.dueTime === value) return
    void changeTask(task, {
      dueTime: value,
      timeZone: value ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
      dueAt: localDueAt(task.dueDate, value),
      reminderMinutes: value ? task.reminderMinutes : null,
    }, value ? `已设为 ${value}` : '已移除时间', true)
  }

  function setReminder(task: Task, value: string) {
    if (!task.dueDate || !task.dueTime) return
    void changeTask(task, { reminderMinutes: value === 'none' ? null : Number(value) },
      value === 'none' ? '已关闭提醒' : '已保存提醒时间', true)
  }

  function toggleComplete(task: Task) {
    selectedId = null
    void changeTask(task, { completedAt: task.completedAt ? null : Date.now() },
      task.completedAt ? '任务已恢复' : '任务已完成', true)
  }

  function deleteTask(task: Task) {
    if (!confirm(`删除“${task.title}”？`)) return
    selectedId = null
    void changeTask(task, { deletedAt: Date.now() }, '任务已删除', true)
  }

  function taskBadge(task: Task): string | null {
    if (view !== 'planned' && view !== 'completed' && !task.dueTime && !(view === 'today' && task.dueDate && task.dueDate < localDay())) return null
    if (task.dueDate && task.dueDate < localDay() && !task.completedAt) return `逾期${task.dueTime ? ` · ${task.dueTime}` : ''}`
    if (view === 'today') return task.dueTime
    return `${dayLabel(task.dueDate)}${task.dueTime ? ` · ${task.dueTime}` : ''}`
  }

  function handleKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
      event.preventDefault()
      addInput?.focus()
    }
    if (event.key === 'Escape') { menuOpen = false; selectedId = null }
  }

  function closeMenu(event: MouseEvent) {
    if (!(event.target as HTMLElement).closest('.more-wrap')) menuOpen = false
  }

  async function undo() {
    const action = toastUndo
    if (!action) return
    toastUndo = null
    toastMessage = ''
    try { await action() }
    catch (error) { showToast(`撤销失败：${error instanceof Error ? error.message : String(error)}`) }
  }
</script>

<svelte:window onkeydown={handleKeydown} onclick={closeMenu} />

<main class:editing={selectedId !== null} class="widget" aria-label="Dayset 待办">
  <header class="topbar">
    <div class="brand">Dayset</div>
    <div class="more-wrap">
      <button class="icon-button" type="button" aria-label="更多选项" aria-expanded={menuOpen} onclick={() => menuOpen = !menuOpen}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>
      </button>
      {#if menuOpen}
        <div class="more-menu">
          <button type="button" onclick={() => setView('completed')}>已完成 <span>{completedCount || ''}</span></button>
        </div>
      {/if}
    </div>
  </header>

  <section class="intro" aria-label="当前视图">
    <div class="intro-copy">
      <p class="date-label">{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}</p>
      <div class="title-line"><h1>{labels[view]}</h1><span>{view === 'today' ? `还有 ${visible.length} 件` : `${visible.length} 件`}</span></div>
      <p class="hero-caption">{heroCaption}</p>
    </div>
    {#if view === 'today' && progress.total > 0}
      <div class="progress-badge" style={`--progress: ${progress.done / progress.total * 100}%`} aria-label={`今日已完成 ${progress.done} 件，共 ${progress.total} 件`}>
        <div class="progress-inner"><strong>{progress.done}/{progress.total}</strong><span>完成</span></div>
      </div>
    {/if}
  </section>

  <nav class="tabs" aria-label="任务视图">
    {#each (['today', 'inbox', 'planned', 'completed'] as View[]) as tab}
      <button class:active={view === tab} class:desktop-only={tab === 'completed'} type="button"
        aria-current={view === tab ? 'page' : undefined} onclick={() => setView(tab)}>{labels[tab]}</button>
    {/each}
  </nav>

  <div class="task-list" aria-live="polite">
    {#if loading}
      <div class="empty-state"><strong>正在读取任务…</strong></div>
    {:else if loadError}
      <div class="empty-state"><strong>无法打开本地任务</strong><p>{loadError}</p></div>
    {:else if visible.length === 0}
      <div class="empty-state"><div class="empty-symbol">✧</div><strong>{view === 'completed' ? '还没有完成记录' : '这里暂时空着'}</strong>
        <p>{view === 'today' ? '在下方添加今天想做的事。' : view === 'inbox' ? '想到什么，先记下来。' : '在下方添加一件要做的事。'}</p></div>
    {:else}
      {#each visible as task (task.id)}
        <div class:open={selectedId === task.id} class:done={task.completedAt !== null} class="task-row">
          <div class="task-line">
            <button class="check-button" type="button" aria-label={`${task.completedAt ? '恢复' : '完成'}任务：${task.title}`} onclick={() => toggleComplete(task)}>
              {#if task.completedAt}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>{/if}
            </button>
            <button class="task-open" type="button" aria-label={`查看任务详情：${task.title}`} aria-expanded={selectedId === task.id}
              onclick={() => selectedId = selectedId === task.id ? null : task.id}>
              <span class="task-text">{task.title}</span>
              {#if taskBadge(task)}<span class:overdue={!!task.dueDate && task.dueDate < localDay() && !task.completedAt} class="task-date">{taskBadge(task)}</span>{/if}
              <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          </div>
          {#if selectedId === task.id}
            <div class="task-detail">
              <label class="detail-label">任务名称
                <input class="detail-title" type="text" maxlength="180" value={task.title}
                  onchange={(event) => void changeTask(task, { title: event.currentTarget.value.trim() || '未命名任务' })} />
              </label>
              <div class="schedule-inputs">
                <label class="detail-label">日期
                  <input class="detail-date" type="date" value={task.dueDate || ''} onchange={(event) => setDate(task, event.currentTarget.value || null)} />
                </label>
                <label class="detail-label">时间
                  <input class="detail-time" type="time" value={task.dueTime || ''} disabled={!task.dueDate}
                    onchange={(event) => setTime(task, event.currentTarget.value || null)} />
                </label>
              </div>
              <div class="date-buttons">
                <button type="button" onclick={() => setDate(task, localDay())}>今天</button>
                <button type="button" onclick={() => setDate(task, localDay(1))}>明天</button>
                <button type="button" onclick={() => setDate(task, null)}>无日期</button>
              </div>
              <label class="detail-label">提前多久提醒
                <select class="detail-reminder" value={task.reminderMinutes === null ? 'none' : String(task.reminderMinutes)}
                  disabled={!task.dueDate || !task.dueTime} onchange={(event) => setReminder(task, event.currentTarget.value)}>
                  {#each reminderOptions as option}<option value={option.value}>{option.label}</option>{/each}
                </select>
              </label>
              <p class="reminder-preview">{reminderDescription(task)}</p>
              <label class="detail-label">备注
                <textarea class="detail-notes" rows="2" placeholder="补充一点细节…" value={task.notes}
                  onchange={(event) => void changeTask(task, { notes: event.currentTarget.value })}></textarea>
              </label>
              <div class="detail-foot"><button class="delete-button" type="button" onclick={() => deleteTask(task)}>删除任务</button></div>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <p class="desktop-help">按 Ctrl+N 快速添加<br />点击任务，可安排日期与提醒</p>
  <div class="bottom-area">
    <form class="add-form" onsubmit={addTask}>
      <span class="add-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg></span>
      <label class="sr-only" for="add-input">添加任务</label>
      <input id="add-input" bind:this={addInput} bind:value={addText} type="text" maxlength="180" autocomplete="off" placeholder="添加一件要做的事…" disabled={loading || !!loadError} />
      <button type="submit" aria-label="添加任务" disabled={loading || !!loadError}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M20 4v7a4 4 0 0 1-4 4H4" /><path d="m9 10-5 5 5 5" /></svg></button>
    </form>
    <p>{addHint}</p>
  </div>
</main>

{#if toastMessage}
  <div class="toast" role="status" aria-live="polite"><span>{toastMessage}</span>{#if toastUndo}<button type="button" onclick={undo}>撤销</button>{/if}</div>
{/if}
