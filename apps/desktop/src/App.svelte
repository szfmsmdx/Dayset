<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke, isTauri } from '@tauri-apps/api/core'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
  import { openTaskRepository, type TaskRepository } from './lib/taskRepository'
  import {
    activeTasks, createTask, dayLabel, localDay, localDueAt, nextOccurrence, tasksForView, todayProgress,
    type RepeatEndMode, type RepeatFrequency, type Task, type View,
  } from './lib/tasks'

  interface VisibleTaskRow {
    task: Task
    depth: number
    context: boolean
  }

  interface ParentTaskOption {
    task: Task
    depth: number
  }

  const labels: Record<View, string> = {
    today: '今天', inbox: '待安排', planned: '计划',
  }
  const reminderOptions = [
    { value: 'none', label: '不提醒' }, { value: '0', label: '准时' },
    { value: '5', label: '提前 5 分钟' }, { value: '15', label: '提前 15 分钟' },
    { value: '30', label: '提前 30 分钟' }, { value: '60', label: '提前 1 小时' },
    { value: '1440', label: '提前 1 天' },
  ]

  let repository: TaskRepository | null = null
  let tasks: Task[] = []
  let activeTaskList: Task[] = []
  let activeChildrenByParent = new Map<string, Task[]>()
  let view: View = 'today'
  let page: 'tasks' | 'settings' = 'tasks'
  let selectedId: string | null = null
  let addText = ''
  let composerOpen = false
  let composerRoot: HTMLDivElement
  let composerPullStartY: number | null = null
  let newParentTaskId = ''
  let addDueDate: string | null = localDay()
  let addDueTime = ''
  let addReminder = 'none'
  let tagFilterOpen = false
  let tagFilterRoot: HTMLDivElement
  let tagInput = ''
  let selectedTag: string | null = null
  let addInput: HTMLInputElement
  let draggingTaskId: string | null = null
  let dropTargetId: string | null = null
  let rootDropActive = false
  let maximized = false
  let loading = true
  let loadError = ''
  let toastMessage = ''
  let toastUndo: (() => Promise<void>) | null = null
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  let notificationStatus: 'checking' | 'ready' | 'unavailable' | 'preview' = 'checking'
  let autostartEnabled = false
  let autostartAvailable = true
  let autostartBusy = false
  let testNotificationBusy = false
  let today = localDay()
  const currentWindow = getCurrentWindow()

  $: activeTaskList = activeTasks(tasks)
  $: activeChildrenByParent = groupTasksByParent(activeTaskList)
  $: allTags = Array.from(new Set(activeTaskList.flatMap(task => task.tags)))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
  $: parentTaskOptions = buildParentTaskOptions(activeTaskList)
  $: if (newParentTaskId && !parentTaskOptions.some(option => option.task.id === newParentTaskId)) {
    newParentTaskId = ''
    addDueDate = defaultDueDateForView(view)
    addDueTime = ''
    addReminder = 'none'
  }
  $: if (selectedTag && !allTags.includes(selectedTag)) selectedTag = null
  $: visibleRows = buildVisibleTaskRows(tasks, view, today, selectedTag)
  $: visible = visibleRows.map(row => row.task)
  $: progress = todayProgress(tasks, today)
  $: heroCaption = view === 'today'
    ? progress.total === 0 ? '今天还没有任务。' : visible.length ? '先做一件，剩下的慢慢来。' : '今天的事情都处理好了。'
    : view === 'inbox' ? '先记下来，再决定什么时候做。'
    : '看看接下来的节奏。'

  onMount(() => {
    void loadTasks()
    void currentWindow.isMaximized().then(value => { maximized = value })
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

  async function loadSettings() {
    if (!isTauri()) {
      notificationStatus = 'preview'
      autostartAvailable = false
      return
    }

    notificationStatus = 'checking'
    try {
      notificationStatus = await invoke<boolean>('notification_status') ? 'ready' : 'unavailable'
    } catch {
      notificationStatus = 'unavailable'
    }

    try {
      autostartEnabled = await isEnabled()
      autostartAvailable = true
    } catch {
      autostartAvailable = false
    }
  }

  async function setAutostart(event: Event) {
    const enabled = (event.currentTarget as HTMLInputElement).checked
    autostartBusy = true
    try {
      if (enabled) await enable()
      else await disable()
      autostartEnabled = enabled
      showToast(enabled ? '已开启登录时启动' : '已关闭登录时启动')
    } catch (error) {
      showToast(`设置失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      autostartBusy = false
    }
  }

  async function sendTestNotification() {
    testNotificationBusy = true
    try {
      await invoke('send_test_notification')
      showToast('测试提醒已发送；若未显示，请检查 Windows 通知设置。')
    } catch (error) {
      notificationStatus = 'unavailable'
      showToast(`发送失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      testNotificationBusy = false
    }
  }

  function showToast(message: string, undo: (() => Promise<void>) | null = null) {
    if (toastTimer) clearTimeout(toastTimer)
    toastMessage = message
    toastUndo = undo
    toastTimer = setTimeout(() => { toastMessage = ''; toastUndo = null }, 6000)
  }

  function buildVisibleTaskRows(allTasks: Task[], currentView: View, date: string, tagFilter: string | null): VisibleTaskRow[] {
    const active = activeTasks(allTasks)
    const byId = new Map(active.map(task => [task.id, task]))
    const inView = new Set(tasksForView(active, currentView, date).map(task => task.id))
    const matches = new Set(active
      .filter(task => inView.has(task.id) && (tagFilter === null || task.tags.includes(tagFilter)))
      .map(task => task.id))
    const included = new Set<string>()

    for (const id of matches) {
      let task = byId.get(id)
      const path = new Set<string>()
      while (task && !path.has(task.id)) {
        path.add(task.id)
        included.add(task.id)
        task = task.parentTaskId ? byId.get(task.parentTaskId) : undefined
      }
    }

    const childrenByParent = new Map<string | null, Task[]>()
    for (const task of active) {
      if (!included.has(task.id)) continue
      const siblings = childrenByParent.get(task.parentTaskId) ?? []
      siblings.push(task)
      childrenByParent.set(task.parentTaskId, siblings)
    }
    const compareTasks = (a: Task, b: Task) =>
      (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99')
      || (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99')
      || b.createdAt - a.createdAt
    for (const siblings of childrenByParent.values()) siblings.sort(compareTasks)

    const rows: VisibleTaskRow[] = []
    function visit(task: Task, depth: number) {
      rows.push({ task, depth, context: !matches.has(task.id) })
      for (const child of childrenByParent.get(task.id) ?? []) visit(child, depth + 1)
    }
    for (const root of childrenByParent.get(null) ?? []) visit(root, 0)
    return rows
  }

  function groupTasksByParent(active: Task[]): Map<string, Task[]> {
    const grouped = new Map<string, Task[]>()
    for (const task of active) {
      if (!task.parentTaskId) continue
      const children = grouped.get(task.parentTaskId) ?? []
      children.push(task)
      grouped.set(task.parentTaskId, children)
    }
    return grouped
  }

  function buildParentTaskOptions(active: Task[]): ParentTaskOption[] {
    const children = groupTasksByParent(active)
    const options: ParentTaskOption[] = []
    const visited = new Set<string>()
    function visit(task: Task, depth: number) {
      if (visited.has(task.id)) return
      visited.add(task.id)
      if (task.completedAt === null && !hasCompletedAncestor(task)) options.push({ task, depth })
      for (const child of children.get(task.id) ?? []) visit(child, depth + 1)
    }
    for (const root of active.filter(task => task.parentTaskId === null)) visit(root, 0)
    return options
  }

  function defaultDueDateForView(target: View): string | null {
    return target === 'today' ? localDay() : target === 'planned' ? localDay(1) : null
  }

  function setNewParentTask(parentId: string) {
    newParentTaskId = parentId
    const parent = activeTaskList.find(task => task.id === parentId)
    addDueDate = parent ? parent.dueDate : defaultDueDateForView(view)
    addDueTime = ''
    addReminder = 'none'
  }

  function setNewDueDate(value: string | null) {
    addDueDate = value
    if (!value) {
      addDueTime = ''
      addReminder = 'none'
    }
  }

  function setNewDueTime(value: string) {
    addDueTime = value
    if (!value) addReminder = 'none'
  }

  function selectTag(tag: string | null) {
    selectedTag = tag
    tagFilterOpen = false
  }

  function handleComposerEnter(event: KeyboardEvent, field: 'parent' | 'date' | 'time' | 'reminder') {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const value = (event.currentTarget as HTMLInputElement | HTMLSelectElement).value
    if (field === 'parent' && value !== newParentTaskId) setNewParentTask(value)
    else if (field === 'date') setNewDueDate(value || null)
    else if (field === 'time') setNewDueTime(value)
    else addReminder = value
    void addTask()
  }

  function openComposer() {
    composerOpen = true
  }

  function closeComposer() {
    composerOpen = false
    composerPullStartY = null
  }

  function handleWindowPointerDown(event: PointerEvent) {
    const target = event.target as Node
    if (composerOpen && !composerRoot?.contains(target)) closeComposer()
    if (tagFilterOpen && !tagFilterRoot?.contains(target)) tagFilterOpen = false
  }

  function startComposerPull(event: PointerEvent) {
    if (event.button !== 0) return
    composerPullStartY = event.clientY
    ;(event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId)
  }

  function finishComposerPull(event: PointerEvent) {
    if (composerPullStartY !== null && event.clientY - composerPullStartY >= 36) closeComposer()
    composerPullStartY = null
  }

  function activeSubtasks(parentId: string): Task[] {
    return activeChildrenByParent.get(parentId) ?? []
  }

  function canMoveUnder(task: Task, parent: Task | null): boolean {
    if (!parent) return true
    if (parent.id === task.id || parent.deletedAt !== null || parent.completedAt !== null || hasCompletedAncestor(parent)) return false
    const visited = new Set<string>()
    let current: Task | undefined = parent
    while (current && !visited.has(current.id)) {
      if (current.id === task.id) return false
      visited.add(current.id)
      const parentId: string | null = current.parentTaskId
      current = parentId ? tasks.find(item => item.id === parentId) : undefined
    }
    return true
  }

  function startTaskDrag(event: DragEvent, task: Task) {
    if (!event.dataTransfer) return
    draggingTaskId = task.id
    dropTargetId = null
    rootDropActive = false
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', task.id)
  }

  function finishTaskDrag() {
    draggingTaskId = null
    dropTargetId = null
    rootDropActive = false
  }

  function allowTaskDrop(event: DragEvent, target: Task) {
    const draggedId = event.dataTransfer?.getData('text/plain') || draggingTaskId
    const dragged = tasks.find(task => task.id === draggedId)
    if (!dragged || !canMoveUnder(dragged, target)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    dropTargetId = target.id
  }

  function allowRootDrop(event: DragEvent) {
    if (!draggingTaskId) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    rootDropActive = true
  }

  function dropTaskOnTask(event: DragEvent, target: Task) {
    event.preventDefault()
    const draggedId = event.dataTransfer?.getData('text/plain') || draggingTaskId
    const dragged = tasks.find(task => task.id === draggedId)
    if (dragged && canMoveUnder(dragged, target) && dragged.parentTaskId !== target.id) {
      void changeTask(dragged, { parentTaskId: target.id }, `已将“${dragged.title}”移到“${target.title}”下`, true)
    }
    finishTaskDrag()
  }

  function dropTaskAtRoot(event: DragEvent) {
    event.preventDefault()
    const draggedId = event.dataTransfer?.getData('text/plain') || draggingTaskId
    const dragged = tasks.find(task => task.id === draggedId)
    if (dragged && dragged.parentTaskId !== null) {
      void changeTask(dragged, { parentTaskId: null }, `已将“${dragged.title}”移回顶层`, true)
    }
    finishTaskDrag()
  }

  function activeDescendants(parentId: string): Task[] {
    const descendants: Task[] = []
    const visited = new Set<string>([parentId])
    function visit(id: string) {
      for (const child of activeSubtasks(id)) {
        if (visited.has(child.id)) continue
        visited.add(child.id)
        descendants.push(child)
        visit(child.id)
      }
    }
    visit(parentId)
    return descendants
  }

  function hasIncompleteDescendants(parentId: string): boolean {
    return activeDescendants(parentId).some(task => task.completedAt === null)
  }

  function hasCompletedAncestor(task: Task): boolean {
    const byId = new Map(tasks.map(item => [item.id, item]))
    const visited = new Set<string>([task.id])
    let parentId = task.parentTaskId
    while (parentId) {
      if (visited.has(parentId)) return true
      visited.add(parentId)
      const parent = byId.get(parentId)
      if (!parent || parent.deletedAt !== null) return false
      if (parent.completedAt !== null) return true
      parentId = parent.parentTaskId
    }
    return false
  }

  function subtaskProgress(task: Task): string | null {
    const children = activeSubtasks(task.id)
    if (children.length === 0) return null
    return `${children.filter(child => child.completedAt !== null).length}/${children.length}`
  }

  function shiftCalendarDate(value: string | null, from: string | null, to: string | null): string | null {
    if (!value || !from || !to) return value
    const parse = (date: string) => {
      const [year, month, day] = date.split('-').map(Number)
      return Date.UTC(year, month - 1, day)
    }
    const offset = Math.round((parse(to) - parse(from)) / 86_400_000)
    const shifted = new Date(parse(value) + offset * 86_400_000)
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
  }

  function createNextSubtasks(previousParent: Task, nextParent: Task): Task[] {
    const now = Date.now()
    const clones: Task[] = []
    for (const child of activeSubtasks(previousParent.id)) {
      const dueDate = shiftCalendarDate(child.dueDate, previousParent.dueDate, nextParent.dueDate)
      const clone: Task = {
        ...child,
        id: crypto.randomUUID(),
        parentTaskId: nextParent.id,
        dueDate,
        timeZone: dueDate && child.dueTime ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
        dueAt: localDueAt(dueDate, child.dueTime),
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
      clones.push(clone, ...createNextSubtasks(child, clone))
    }
    return clones
  }

  function applyTaskUpdates(updates: Task[]) {
    const byId = new Map(updates.map(task => [task.id, task]))
    const existingIds = new Set(tasks.map(task => task.id))
    tasks = [
      ...tasks.map(task => byId.get(task.id) ?? task),
      ...updates.filter(task => !existingIds.has(task.id)),
    ]
  }

  async function persist(task: Task) {
    if (!repository) return
    await repository.save(task)
    tasks = tasks.some(item => item.id === task.id)
      ? tasks.map(item => item.id === task.id ? task : item)
      : [...tasks, task]
  }

  async function changeTask(task: Task, changes: Partial<Task>, message = '', allowUndo = false): Promise<boolean> {
    const updated: Task = { ...task, ...changes, updatedAt: Date.now() }
    try {
      await persist(updated)
      if (message) showToast(message, allowUndo ? async () => {
        await persist({ ...task, updatedAt: Date.now() })
        showToast('已撤销')
      } : null)
      return true
    } catch (error) {
      showToast(`保存失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  async function addTask(event?: SubmitEvent) {
    event?.preventDefault()
    const title = addText.trim()
    if (!title || !repository) return
    const target = view
    const parent = newParentTaskId ? activeTaskList.find(task => task.id === newParentTaskId) : null
    if (newParentTaskId && (!parent || parent.completedAt !== null || hasCompletedAncestor(parent))) {
      showToast('请选择一个未完成的父任务。')
      return
    }
    const dueTime = addDueDate ? addDueTime || null : null
    const reminderMinutes = dueTime && addReminder !== 'none' ? Number(addReminder) : null
    const task: Task = {
      ...createTask(title, target),
      parentTaskId: parent?.id ?? null,
      dueDate: addDueDate,
      dueTime,
      timeZone: dueTime ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
      dueAt: localDueAt(addDueDate, dueTime),
      reminderMinutes,
    }
    try {
      await persist(task)
      addText = ''
      view = target
      addInput.focus()
      showToast('已添加任务')
    } catch (error) {
      showToast(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function addTag(event: SubmitEvent, task: Task) {
    event.preventDefault()
    const tag = tagInput.trim().replace(/^#+/, '')
    if (!tag) return
    if (task.tags.some(existing => existing.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
      showToast('这个标签已添加')
      return
    }
    if (await changeTask(task, { tags: [...task.tags, tag] }, '已添加标签')) tagInput = ''
  }

  async function removeTag(task: Task, tag: string) {
    const tags = task.tags.filter(item => item !== tag)
    if (await changeTask(task, { tags }, '已移除标签')
      && selectedTag === tag
      && !tasks.some(item => item.id !== task.id && item.deletedAt === null && item.tags.includes(tag))) {
      selectedTag = null
    }
  }

  function setView(next: View) {
    view = next
    selectedId = null
    newParentTaskId = ''
    addDueDate = defaultDueDateForView(next)
    addDueTime = ''
    addReminder = 'none'
    tagInput = ''
  }

  function toggleTaskDetails(task: Task) {
    selectedId = selectedId === task.id ? null : task.id
    tagInput = ''
  }

  function setDate(task: Task, value: string | null) {
    if (task.dueDate === value) return
    const [anchorYear, anchorMonth, anchorDay] = value?.split('-').map(Number) ?? []
    const changes: Partial<Task> = {
      dueDate: value,
      dueTime: value ? task.dueTime : null,
      timeZone: value && task.dueTime ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
      dueAt: localDueAt(value, task.dueTime),
      reminderMinutes: value ? task.reminderMinutes : null,
      repeatFrequency: value ? task.repeatFrequency : 'none',
      repeatEndMode: value ? task.repeatEndMode : 'never',
      repeatEndDate: value ? task.repeatEndDate : null,
      repeatCount: value ? task.repeatCount : null,
      repeatSeriesId: value ? task.repeatSeriesId : null,
      repeatOccurrence: value ? task.repeatOccurrence : 1,
      repeatAnchorMonth: value && task.repeatFrequency !== 'none' ? anchorMonth : value ? task.repeatAnchorMonth : null,
      repeatAnchorDay: value && task.repeatFrequency !== 'none' ? anchorDay : value ? task.repeatAnchorDay : null,
    }
    void changeTask(task, changes, value ? `已安排到${dayLabel(value)}` : '已移回待安排', true)
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

  function setRepeatFrequency(task: Task, value: string) {
    if (!task.dueDate || task.completedAt !== null || task.parentTaskId !== null) return
    const frequency = value as RepeatFrequency
    if (frequency === 'none') {
      void changeTask(task, {
        repeatFrequency: 'none', repeatEndMode: 'never', repeatEndDate: null, repeatCount: null,
        repeatSeriesId: null, repeatOccurrence: 1, repeatAnchorMonth: null, repeatAnchorDay: null,
      }, '已关闭重复')
      return
    }
    const [, month, day] = task.dueDate.split('-').map(Number)
    void changeTask(task, {
      repeatFrequency: frequency,
      repeatSeriesId: task.repeatSeriesId ?? task.id,
      repeatOccurrence: task.repeatFrequency === 'none' ? 1 : task.repeatOccurrence,
      repeatAnchorMonth: month,
      repeatAnchorDay: day,
    }, '已保存重复设置')
  }

  function setRepeatEndMode(task: Task, value: string) {
    const endMode = value as RepeatEndMode
    void changeTask(task, {
      repeatEndMode: endMode,
      repeatEndDate: endMode === 'until' ? task.repeatEndDate : null,
      repeatCount: endMode === 'count' ? Math.max(task.repeatOccurrence + 1, task.repeatCount ?? 2) : null,
    }, '已更新重复结束方式')
  }

  function setRepeatEndDate(task: Task, value: string) {
    if (value && task.dueDate && value < task.dueDate) {
      showToast('结束日期不能早于首次日期')
      return
    }
    void changeTask(task, { repeatEndDate: value || null }, value ? '已设置重复结束日期' : '请选择重复结束日期')
  }

  function setRepeatCount(task: Task, value: string) {
    const count = Number(value)
    if (!Number.isInteger(count) || count < task.repeatOccurrence + 1) {
      showToast(`总次数至少为 ${task.repeatOccurrence + 1}`)
      return
    }
    void changeTask(task, { repeatCount: count }, '已更新重复次数')
  }

  async function toggleComplete(task: Task) {
    selectedId = null
    if (task.completedAt !== null && hasCompletedAncestor(task)) {
      showToast('请先恢复上级任务，再恢复此任务。')
      return
    }
    if (task.completedAt === null && hasIncompleteDescendants(task.id)) {
      showToast('请先完成所有下级任务，再完成此任务。')
      return
    }

    if (task.repeatFrequency === 'none' || !repository) {
      await changeTask(task, { completedAt: task.completedAt ? null : Date.now() },
        task.completedAt ? '任务已恢复' : '任务已完成', true)
      return
    }

    const now = Date.now()
    if (task.completedAt === null) {
      const completed = { ...task, completedAt: now, updatedAt: now }
      const next = nextOccurrence(task, today)
      const nextTasks = next ? [next, ...createNextSubtasks(task, next)] : []
      try {
        await repository.saveMany([completed, ...nextTasks])
        applyTaskUpdates([completed, ...nextTasks])
        showToast(next ? `任务已完成，下次安排在 ${dayLabel(next.dueDate)}` : '任务已完成', async () => {
          const restored = { ...task, updatedAt: Date.now() }
          const removedNextTasks = nextTasks.map(item => ({ ...item, deletedAt: Date.now(), updatedAt: Date.now() }))
          try {
            await repository?.saveMany([...removedNextTasks, restored])
            applyTaskUpdates([...removedNextTasks, restored])
            showToast('已撤销')
          } catch (error) {
            showToast(`撤销失败：${error instanceof Error ? error.message : String(error)}`)
          }
        })
      } catch (error) {
        showToast(`保存失败：${error instanceof Error ? error.message : String(error)}`)
      }
      return
    }

    const next = tasks.find(item => item.deletedAt === null
      && item.repeatSeriesId === task.repeatSeriesId
      && item.repeatOccurrence === task.repeatOccurrence + 1)
    const nextChildren = next ? activeDescendants(next.id) : []
    const restored = { ...task, completedAt: null, updatedAt: now }
    const removedNextTasks = next
      ? [next, ...nextChildren].map(item => ({ ...item, deletedAt: now, updatedAt: now }))
      : []
    try {
      await repository.saveMany([...removedNextTasks, restored])
      applyTaskUpdates([...removedNextTasks, restored])
      showToast('任务已恢复', async () => {
        try {
          await repository?.saveMany([task, ...(next ? [next, ...nextChildren] : [])])
          applyTaskUpdates([task, ...(next ? [next, ...nextChildren] : [])])
          showToast('已撤销')
        } catch (error) {
          showToast(`撤销失败：${error instanceof Error ? error.message : String(error)}`)
        }
      })
    } catch (error) {
      showToast(`保存失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function deleteTask(task: Task) {
    if (!confirm(`删除“${task.title}”？`)) return
    selectedId = null
    void changeTask(task, { deletedAt: Date.now() }, '任务已删除', true)
  }

  function taskBadge(task: Task): string | null {
    if (view !== 'planned' && !task.dueTime && !(view === 'today' && task.dueDate && task.dueDate < localDay())) return null
    if (task.dueDate && task.dueDate < localDay() && !task.completedAt) return `逾期${task.dueTime ? ` · ${task.dueTime}` : ''}`
    if (view === 'today') return task.dueTime
    return `${dayLabel(task.dueDate)}${task.dueTime ? ` · ${task.dueTime}` : ''}`
  }

  function handleKeydown(event: KeyboardEvent) {
    if (page === 'settings') {
      if (event.key === 'Escape') page = 'tasks'
      return
    }
    if (event.key === 'Escape') {
      if (tagFilterOpen) tagFilterOpen = false
      else if (composerOpen) closeComposer()
      else selectedId = null
    }
  }

  function openSettings() {
    closeComposer()
    tagFilterOpen = false
    selectedId = null
    page = 'settings'
    void loadSettings()
  }

  function dragMainWindow(event: MouseEvent) {
    if (event.button === 0) {
      event.preventDefault()
      void currentWindow.startDragging()
    }
  }

  function minimizeWindow() {
    void currentWindow.minimize()
  }

  async function toggleMaximize() {
    if (await currentWindow.isMaximized()) await currentWindow.unmaximize()
    else await currentWindow.maximize()
    maximized = await currentWindow.isMaximized()
  }

  function hideWindow() {
    void currentWindow.hide()
  }

  function resizeWindow(event: MouseEvent, direction: 'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest') {
    event.preventDefault()
    void currentWindow.startResizeDragging(direction)
  }

  function resizeWindowByKeyboard(event: KeyboardEvent, direction: 'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest') {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      void currentWindow.startResizeDragging(direction)
    }
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

<svelte:window onkeydown={handleKeydown} onpointerdown={handleWindowPointerDown} />

<main class:editing={page === 'tasks' && selectedId !== null} class:settings-active={page === 'settings'} class="widget" aria-label={page === 'settings' ? 'Dayset 设置' : 'Dayset 待办'}>
  <header class="topbar">
    <button class="titlebar-drag" type="button" aria-label="拖动 Dayset 窗口" onmousedown={dragMainWindow}>
      <span class="brand">Dayset</span>
    </button>
    <div class="topbar-actions">
      {#if page === 'tasks'}
        <button class="icon-button" type="button" aria-label="设置" title="设置" onclick={openSettings}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.7 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.7h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1.08 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08Z" />
          </svg>
        </button>
      {/if}
      <div class="window-controls">
        <button class="window-control" type="button" aria-label="最小化到任务栏" title="最小化" onclick={minimizeWindow}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M3 8h10" /></svg>
        </button>
        <button class="window-control" type="button" aria-label={maximized ? '还原窗口' : '最大化窗口'} title={maximized ? '还原' : '最大化'} onclick={toggleMaximize}>
          {#if maximized}
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1" aria-hidden="true"><path d="M5 3.5h7.5V11M11 5H4v7h7V5Z" /></svg>
          {:else}
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" /></svg>
          {/if}
        </button>
        <button class="window-control close-control" type="button" aria-label="隐藏到托盘" title="隐藏到托盘" onclick={hideWindow}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
        </button>
      </div>
    </div>
  </header>

  {#if page === 'settings'}
  <section class="settings-page" aria-labelledby="settings-title">
    <div class="settings-page-inner">
      <button class="settings-back" type="button" onclick={() => page = 'tasks'}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
        <span>返回任务</span>
      </button>
      <h1 id="settings-title">设置</h1>
      <div class="settings-divider"></div>
      <section class="settings-group" aria-labelledby="notification-settings-title">
        <h2 id="notification-settings-title">系统通知</h2>
        <div class="settings-row">
          <div class="settings-copy">
            <strong>通知状态</strong>
            <p>Dayset 的通知接口{notificationStatus === 'ready' ? '已就绪' : notificationStatus === 'checking' ? '正在检查' : notificationStatus === 'preview' ? '仅在桌面版可用' : '暂不可用'}。Windows 设置或专注助手仍可能影响横幅显示。</p>
          </div>
          <span class="settings-status" class:ready={notificationStatus === 'ready'} class:unavailable={notificationStatus === 'unavailable'}>
            {notificationStatus === 'ready' ? '可用' : notificationStatus === 'checking' ? '检查中' : notificationStatus === 'preview' ? '桌面版' : '不可用'}
          </span>
        </div>
        <div class="settings-row">
          <div class="settings-copy">
            <strong>测试提醒</strong>
            <p>发送一条系统通知，确认当前 Windows 通知设置。</p>
          </div>
          <button class="settings-action" type="button" onclick={sendTestNotification}
            disabled={!isTauri() || testNotificationBusy}>
            {testNotificationBusy ? '发送中…' : '发送测试'}
          </button>
        </div>
      </section>
      <section class="settings-group" aria-labelledby="startup-settings-title">
        <h2 id="startup-settings-title">后台运行</h2>
        <label class="settings-row settings-toggle">
          <span class="settings-copy">
            <strong>登录时启动并隐藏到托盘</strong>
            <p>开启后，登录 Windows 时 Dayset 会在托盘运行并继续检查提醒。</p>
          </span>
          <input type="checkbox" checked={autostartEnabled} disabled={!autostartAvailable || autostartBusy}
            onchange={setAutostart} />
        </label>
        <p class="settings-note">关闭主窗口会隐藏到托盘；从托盘选择“退出 Dayset”后，提醒检查会停止。</p>
      </section>
    </div>
  </section>
  {:else}
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
    {#each (['today', 'inbox', 'planned'] as View[]) as tab}
      <button class:active={view === tab} type="button"
        aria-current={view === tab ? 'page' : undefined} onclick={() => setView(tab)}>{labels[tab]}</button>
    {/each}
    {#if allTags.length > 0}
      <div class="tag-filter-wrap" bind:this={tagFilterRoot}>
        <button class:filter-open={tagFilterOpen} class="tag-filter-trigger" type="button"
          aria-label="按标签筛选" aria-haspopup="true" aria-expanded={tagFilterOpen}
          onclick={() => tagFilterOpen = !tagFilterOpen}>
          <span>{selectedTag ?? '全部标签'}</span>
          <svg class="tag-filter-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
        </button>
        {#if tagFilterOpen}
          <div class="tag-filter-menu" role="group" aria-label="选择标签">
            <button class:selected={selectedTag === null} class="tag-filter-option" type="button"
              aria-pressed={selectedTag === null} onclick={() => selectTag(null)}>全部标签</button>
            {#each allTags as tag (tag)}
              <button class:selected={selectedTag === tag} class="tag-filter-option" type="button"
                aria-pressed={selectedTag === tag} onclick={() => selectTag(tag)}>{tag}</button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </nav>

  <div class="task-list" role="region" aria-label="任务列表" aria-live="polite">
    {#if draggingTaskId}
      <div class:drop-active={rootDropActive} class="root-drop-zone"
        role="region" aria-label="移回顶层的放置区域"
        ondragover={allowRootDrop} ondragleave={() => rootDropActive = false} ondrop={dropTaskAtRoot}>
        拖到这里移回顶层
      </div>
    {/if}
    {#if loading}
      <div class="empty-state"><strong>正在读取任务…</strong></div>
    {:else if loadError}
      <div class="empty-state"><strong>无法打开本地任务</strong><p>{loadError}</p></div>
    {:else if visible.length === 0}
      <div class="empty-state"><div class="empty-symbol">✧</div><strong>这里暂时空着</strong>
        <p>{selectedTag ? '当前标签下没有任务。' : view === 'today' ? '在下方添加今天想做的事。' : view === 'inbox' ? '想到什么，先记下来。' : '在下方添加一件要做的事。'}</p></div>
    {:else}
      {#each visibleRows as row (row.task.id)}
        {@const task = row.task}
        <div class:open={selectedId === task.id} class:done={task.completedAt !== null}
          class:subtask={row.depth > 0} class:context={row.context} class:drop-target={dropTargetId === task.id} class="task-row"
          role="group" aria-label={`任务：${task.title}`}
          style={`margin-left: ${row.depth * 16}px`}
          ondragover={(event) => allowTaskDrop(event, task)} ondragleave={() => dropTargetId = null}
          ondrop={(event) => dropTaskOnTask(event, task)}>
          <div class="task-line">
            <button class="drag-handle" type="button" draggable="true" aria-label={`拖动任务：${task.title}`}
              title="拖动以调整层级" ondragstart={(event) => startTaskDrag(event, task)} ondragend={finishTaskDrag}>
              <svg viewBox="0 0 12 18" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.2" /><circle cx="9" cy="3" r="1.2" /><circle cx="3" cy="9" r="1.2" /><circle cx="9" cy="9" r="1.2" /><circle cx="3" cy="15" r="1.2" /><circle cx="9" cy="15" r="1.2" /></svg>
            </button>
            <button class="check-button" type="button" aria-label={`${task.completedAt ? '恢复' : '完成'}任务：${task.title}`} onclick={() => toggleComplete(task)}>
              {#if task.completedAt}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>{/if}
            </button>
            <button class="task-open" type="button" aria-label={`查看任务详情：${task.title}`} aria-expanded={selectedId === task.id}
              onclick={() => toggleTaskDetails(task)}>
              <span class="task-text">{task.title}</span>
              {#if subtaskProgress(task)}<span class="subtask-progress">{subtaskProgress(task)}</span>{/if}
              {#if task.tags.length > 0}<span class="task-tag-preview">{task.tags[0]}{#if task.tags.length > 1}<span>+{task.tags.length - 1}</span>{/if}</span>{/if}
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
              {#if activeSubtasks(task.id).length > 0}
                <p class="repeat-hint">完成所有下级任务后，才能完成此任务。</p>
              {/if}
              <div class="schedule-inputs">
                <div class="schedule-field">
                  <div class="schedule-field-heading schedule-date-heading">
                    <label class="schedule-field-label" for={`due-date-${task.id}`}>日期</label>
                    <button class="no-date-button" type="button"
                      aria-label={task.dueDate ? `清除日期：${task.title}` : `当前任务无日期：${task.title}`}
                      disabled={!task.dueDate} onclick={() => setDate(task, null)}>无日期</button>
                  </div>
                  <input id={`due-date-${task.id}`} class="detail-date" type="date" value={task.dueDate || ''}
                    onchange={(event) => setDate(task, event.currentTarget.value || null)} />
                </div>
                <label class="schedule-field">
                  <span class="schedule-field-heading"><span class="schedule-field-label">时间</span></span>
                  <input class="detail-time" type="time" value={task.dueTime || ''} disabled={!task.dueDate}
                    onchange={(event) => setTime(task, event.currentTarget.value || null)} />
                </label>
                <label class="schedule-field schedule-reminder-field">
                  <span class="schedule-field-heading"><span class="schedule-field-label">提醒</span></span>
                  <select class="detail-reminder" value={task.reminderMinutes === null ? 'none' : String(task.reminderMinutes)}
                    disabled={!task.dueDate || !task.dueTime} onchange={(event) => setReminder(task, event.currentTarget.value)}>
                    {#each reminderOptions as option}<option value={option.value}>{option.label}</option>{/each}
                  </select>
                </label>
              </div>
              <div class="repeat-settings-row">
                <label class="compact-setting">重复
                  <select class="detail-reminder" value={task.repeatFrequency}
                    disabled={!task.dueDate || task.completedAt !== null || task.parentTaskId !== null}
                    onchange={(event) => setRepeatFrequency(task, event.currentTarget.value)}>
                    <option value="none">不重复</option><option value="daily">每天</option>
                    <option value="weekly">每周</option><option value="monthly">每月</option><option value="yearly">每年</option>
                  </select>
                </label>
                <label class="compact-setting">结束方式
                  <select class="detail-reminder" value={task.repeatEndMode}
                    disabled={!task.dueDate || task.repeatFrequency === 'none' || task.completedAt !== null}
                    onchange={(event) => setRepeatEndMode(task, event.currentTarget.value)}>
                    <option value="never">永不结束</option><option value="until">结束日期</option><option value="count">重复次数</option>
                  </select>
                </label>
                {#if task.repeatFrequency === 'none'}
                  <div class="compact-setting repeat-parameter"><span>结束</span><span class="repeat-parameter-value">—</span></div>
                {:else if task.repeatEndMode === 'until'}
                  <label class="compact-setting">结束日期
                    <input class="detail-date" type="date" value={task.repeatEndDate || ''}
                      disabled={task.completedAt !== null} onchange={(event) => setRepeatEndDate(task, event.currentTarget.value)} />
                  </label>
                {:else if task.repeatEndMode === 'count'}
                  <label class="compact-setting">重复次数
                    <input class="detail-repeat-count" type="number" min={task.repeatOccurrence + 1}
                      value={task.repeatCount ?? task.repeatOccurrence + 1} disabled={task.completedAt !== null}
                      onchange={(event) => setRepeatCount(task, event.currentTarget.value)} />
                  </label>
                {:else}
                  <div class="compact-setting repeat-parameter"><span>结束</span><span class="repeat-parameter-value">不限</span></div>
                {/if}
              </div>
              {#if task.parentTaskId !== null}<p class="repeat-hint">重复频率请在顶层任务设置；重复时会复制整棵下级任务树。</p>
              {:else if !task.dueDate}<p class="repeat-hint">先设置日期，再选择重复频率。</p>{/if}
              <div class="tag-setting">
                <span class="compact-setting-label">标签</span>
                <div class="task-tag-editor">
                  <div class="tag-chip-list">
                    {#each task.tags as tag (tag)}
                      <button class="detail-tag" type="button" aria-label={`移除标签：${tag}`} onclick={() => void removeTag(task, tag)}>
                        {tag}<span aria-hidden="true">×</span>
                      </button>
                    {/each}
                  </div>
                  <form class="tag-add-form" onsubmit={(event) => void addTag(event, task)}>
                    <input bind:value={tagInput} type="text" maxlength="24" placeholder="添加标签…" aria-label="输入新标签" />
                    <button type="submit" disabled={!tagInput.trim()}>添加</button>
                  </form>
                </div>
              </div>
              <label class="compact-setting notes-setting">备注
                <textarea class="detail-notes" rows="1" placeholder="补充一点细节…" value={task.notes}
                  onchange={(event) => void changeTask(task, { notes: event.currentTarget.value })}></textarea>
              </label>
              <div class="detail-foot">
                <button class="detail-action finish-settings-button" type="button"
                  aria-label={`完成设置：${task.title}`}
                  onclick={() => selectedId = null}>完成设置</button>
                <button class="detail-action delete-button" type="button" onclick={() => deleteTask(task)}>删除任务</button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <div class="bottom-area" bind:this={composerRoot}>
    {#if composerOpen}
      <div class="creation-popover" role="group" aria-label="新任务设置">
        <div class="composer-popover-header">
          <span>任务安排</span>
          <button class="composer-pull-handle" type="button" aria-label="向下拖动或点击收起设置"
            title="向下拖动或点击收起" onpointerdown={startComposerPull} onpointerup={finishComposerPull}
            onpointercancel={() => composerPullStartY = null} onclick={closeComposer}>
            <span class="composer-grip" aria-hidden="true"></span><span>收起</span>
          </button>
        </div>
        <div class="composer-options">
          <label class="composer-option parent-option">父任务
            <select value={newParentTaskId} disabled={loading || !!loadError}
              onkeydown={(event) => handleComposerEnter(event, 'parent')}
              onchange={(event) => setNewParentTask(event.currentTarget.value)}>
              <option value="">无</option>
              {#each parentTaskOptions as option (option.task.id)}
                <option value={option.task.id}>{'　'.repeat(option.depth)}{option.task.title}</option>
              {/each}
            </select>
          </label>
          <div class="composer-schedule-grid">
            <label class="composer-option">日期
              <input type="date" value={addDueDate ?? ''} disabled={loading || !!loadError}
                onkeydown={(event) => handleComposerEnter(event, 'date')}
                onchange={(event) => setNewDueDate(event.currentTarget.value || null)} />
            </label>
            <label class="composer-option">时间
              <input type="time" value={addDueTime} disabled={!addDueDate || loading || !!loadError}
                onkeydown={(event) => handleComposerEnter(event, 'time')}
                onchange={(event) => setNewDueTime(event.currentTarget.value)} />
            </label>
            <label class="composer-option">提醒
              <select value={addReminder} disabled={!addDueDate || !addDueTime || loading || !!loadError}
                onkeydown={(event) => handleComposerEnter(event, 'reminder')}
                onchange={(event) => addReminder = event.currentTarget.value}>
                {#each reminderOptions as option}<option value={option.value}>{option.label}</option>{/each}
              </select>
            </label>
          </div>
        </div>
        <div class="composer-footer">
          <button class="composer-submit" type="button" disabled={!addText.trim() || loading || !!loadError}
            onclick={() => void addTask()}>确认添加</button>
        </div>
      </div>
    {/if}
    <form class="add-form" onsubmit={addTask}>
      <span class="add-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg></span>
      <label class="sr-only" for="add-input">添加任务</label>
      <input id="add-input" bind:this={addInput} bind:value={addText} type="text" maxlength="180" autocomplete="off" placeholder="添加一件要做的事…" disabled={loading || !!loadError} onfocus={openComposer} />
      <button type="submit" aria-label="确认添加任务" title="确认添加任务（Enter）" disabled={loading || !!loadError}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M20 4v7a4 4 0 0 1-4 4H4" /><path d="m9 10-5 5 5 5" /></svg></button>
    </form>
  </div>
  {/if}
  <button class="resize-handle resize-n" type="button" aria-label="调整窗口上边缘" onmousedown={(event) => resizeWindow(event, 'North')} onkeydown={(event) => resizeWindowByKeyboard(event, 'North')}></button>
  <button class="resize-handle resize-s" type="button" aria-label="调整窗口下边缘" onmousedown={(event) => resizeWindow(event, 'South')} onkeydown={(event) => resizeWindowByKeyboard(event, 'South')}></button>
  <button class="resize-handle resize-e" type="button" aria-label="调整窗口右边缘" onmousedown={(event) => resizeWindow(event, 'East')} onkeydown={(event) => resizeWindowByKeyboard(event, 'East')}></button>
  <button class="resize-handle resize-w" type="button" aria-label="调整窗口左边缘" onmousedown={(event) => resizeWindow(event, 'West')} onkeydown={(event) => resizeWindowByKeyboard(event, 'West')}></button>
  <button class="resize-handle resize-ne" type="button" aria-label="调整窗口右上角" onmousedown={(event) => resizeWindow(event, 'NorthEast')} onkeydown={(event) => resizeWindowByKeyboard(event, 'NorthEast')}></button>
  <button class="resize-handle resize-nw" type="button" aria-label="调整窗口左上角" onmousedown={(event) => resizeWindow(event, 'NorthWest')} onkeydown={(event) => resizeWindowByKeyboard(event, 'NorthWest')}></button>
  <button class="resize-handle resize-se" type="button" aria-label="调整窗口右下角" onmousedown={(event) => resizeWindow(event, 'SouthEast')} onkeydown={(event) => resizeWindowByKeyboard(event, 'SouthEast')}></button>
  <button class="resize-handle resize-sw" type="button" aria-label="调整窗口左下角" onmousedown={(event) => resizeWindow(event, 'SouthWest')} onkeydown={(event) => resizeWindowByKeyboard(event, 'SouthWest')}></button>
</main>

{#if toastMessage}
  <div class="toast" role="status" aria-live="polite"><span>{toastMessage}</span>{#if toastUndo}<button type="button" onclick={undo}>撤销</button>{/if}</div>
{/if}
