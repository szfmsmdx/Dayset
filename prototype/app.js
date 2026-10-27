(() => {
  "use strict";

  const STORAGE_KEY = "dayset-prototype-v1";
  const $ = id => document.getElementById(id);
  const refs = {
    title: $("view-title"), count: $("view-count"), dateLabel: $("date-label"),
    heroCaption: $("hero-caption"), progressBadge: $("progress-badge"), progressValue: $("progress-value"),
    tabs: $("tabs"), list: $("task-list"), addForm: $("add-form"),
    addInput: $("add-input"), moreButton: $("more-button"),
    moreMenu: $("more-menu"), completedCount: $("completed-count"),
    toast: $("toast"), toastMessage: $("toast-message"), toastUndo: $("toast-undo"),
  };

  function day(offset = 0) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function formatDay(value) {
    if (!value) return "未安排";
    if (value === day()) return "今天";
    if (value === day(1)) return "明天";
    const [year, month, date] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(year, month - 1, date));
  }

  function sampleTasks() {
    return [
      { id: "sample-1", title: "写下今天最重要的一件事", date: day(), time: null, reminderMinutes: null, notes: "", completedAt: null, createdAt: 1 },
      { id: "sample-2", title: "给朋友回一条消息", date: day(), time: "17:30", reminderMinutes: 15, notes: "", completedAt: null, createdAt: 2 },
      { id: "sample-3", title: "试着添加一条自己的任务", date: null, time: null, reminderMinutes: null, notes: "", completedAt: null, createdAt: 3 },
      { id: "sample-4", title: "整理明天的安排", date: day(1), time: null, reminderMinutes: null, notes: "", completedAt: null, createdAt: 4 },
    ];
  }

  function loadTasks() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.map(task => ({ time: null, reminderMinutes: null, ...task }));
      }
    } catch (error) { console.warn("无法读取本地任务。", error); }
    return sampleTasks();
  }

  const state = { tasks: loadTasks(), view: "today", selectedId: null, undo: null, toastTimer: null };

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks)); }
    catch (error) { console.warn("无法保存本地任务。", error); }
  }

  function byId(id) { return state.tasks.find(task => task.id === id); }
  function visibleTasks() {
    const tasks = state.tasks.filter(task => {
      if (state.view === "completed") return !!task.completedAt;
      if (task.completedAt) return false;
      if (state.view === "inbox") return !task.date;
      if (state.view === "today") return !!task.date && task.date <= day();
      return !!task.date;
    });
    return tasks.sort((a, b) => {
      if (state.view === "completed") return b.completedAt - a.completedAt;
      if (state.view === "planned" && a.date !== b.date) return a.date.localeCompare(b.date);
      if (state.view === "today" && a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.date && b.date && a.date === b.date && a.time !== b.time) return (a.time || "99:99").localeCompare(b.time || "99:99");
      return b.createdAt - a.createdAt;
    });
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Lucide icon paths; licenses: prototype/third-party/LUCIDE-LICENSE.txt.
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", name === "check" ? "M20 6 9 17l-5-5" : "m9 18 6-6-6-6");
    svg.append(path);
    return svg;
  }

  function showToast(message, undo = null) {
    clearTimeout(state.toastTimer);
    state.undo = undo;
    refs.toastMessage.textContent = message;
    refs.toastUndo.hidden = !undo;
    refs.toast.hidden = false;
    state.toastTimer = setTimeout(() => { refs.toast.hidden = true; state.undo = null; }, 6000);
  }

  function setMenu(open) {
    refs.moreMenu.hidden = !open;
    refs.moreButton.setAttribute("aria-expanded", String(open));
  }

  function setView(view) {
    state.view = view;
    state.selectedId = null;
    setMenu(false);
    render();
  }

  function setDate(id, value) {
    const task = byId(id);
    if (!task || task.date === value) return;
    const previous = { date: task.date, time: task.time, reminderMinutes: task.reminderMinutes };
    task.date = value;
    if (!value) { task.time = null; task.reminderMinutes = null; }
    save(); render();
    showToast(value ? `已安排到${formatDay(value)}` : "已移回待安排", () => {
      const current = byId(id);
      if (current) { Object.assign(current, previous); save(); render(); }
    });
  }

  function setTime(id, value) {
    const task = byId(id);
    if (!task || !task.date || task.time === value) return;
    const previous = { time: task.time, reminderMinutes: task.reminderMinutes };
    task.time = value;
    if (!value) task.reminderMinutes = null;
    save(); render();
    showToast(value ? `已设为 ${value}` : "已移除时间", () => {
      const current = byId(id);
      if (current) { Object.assign(current, previous); save(); render(); }
    });
  }

  function setReminder(id, value) {
    const task = byId(id);
    if (!task || !task.date || !task.time) return;
    const previous = task.reminderMinutes;
    task.reminderMinutes = value;
    save(); render();
    showToast(value === null ? "已关闭提醒" : "已保存提醒时间", () => {
      const current = byId(id);
      if (current) { current.reminderMinutes = previous; save(); render(); }
    });
  }

  function toggleComplete(id) {
    const task = byId(id);
    if (!task) return;
    const previous = task.completedAt;
    task.completedAt = previous ? null : Date.now();
    state.selectedId = null;
    save(); render();
    showToast(previous ? "任务已恢复" : "任务已完成", () => {
      const current = byId(id);
      if (current) { current.completedAt = previous; save(); render(); }
    });
  }

  function makeDetail(task) {
    const detail = element("div", "task-detail");
    const titleLabel = element("label", "detail-label", "任务名称");
    const titleInput = element("input", "detail-title");
    titleInput.type = "text";
    titleInput.maxLength = 180;
    titleInput.value = task.title;
    titleLabel.append(titleInput);
    titleInput.addEventListener("change", () => {
      task.title = titleInput.value.trim() || "未命名任务";
      save(); render();
    });
    titleInput.addEventListener("keydown", event => { if (event.key === "Enter") titleInput.blur(); });

    const schedule = element("div", "schedule-inputs");
    const dateField = element("div", "schedule-field");
    const dateHeading = element("div", "schedule-field-heading");
    const dateLabel = element("label", "schedule-field-label", "日期");
    const dateInput = element("input", "detail-date");
    dateInput.type = "date";
    dateInput.id = `task-date-${task.id}`;
    dateLabel.htmlFor = dateInput.id;
    dateInput.value = task.date || "";
    dateHeading.append(dateLabel);
    const clearDateButton = element("button", "no-date-button", "无日期");
    clearDateButton.type = "button";
    clearDateButton.disabled = !task.date;
    clearDateButton.setAttribute("aria-label", task.date ? `清除日期：${task.title}` : `当前任务无日期：${task.title}`);
    clearDateButton.addEventListener("click", () => setDate(task.id, null));
    dateHeading.append(clearDateButton);
    dateField.append(dateHeading, dateInput);
    dateInput.addEventListener("change", () => setDate(task.id, dateInput.value || null));
    const timeField = element("label", "schedule-field");
    const timeHeading = element("span", "schedule-field-heading");
    timeHeading.append(element("span", "schedule-field-label", "时间"));
    const timeInput = element("input", "detail-time");
    timeInput.type = "time";
    timeInput.value = task.time || "";
    timeInput.disabled = !task.date;
    timeField.append(timeHeading, timeInput);
    timeInput.addEventListener("change", () => setTime(task.id, timeInput.value || null));
    schedule.append(dateField, timeField);

    const reminderLabel = element("label", "detail-label", "提前多久提醒");
    const reminderSelect = element("select", "detail-reminder");
    for (const [label, value] of [["不提醒", "none"], ["准时", "0"], ["提前 5 分钟", "5"], ["提前 15 分钟", "15"], ["提前 30 分钟", "30"], ["提前 1 小时", "60"], ["提前 1 天", "1440"]]) {
      const option = element("option", "", label);
      option.value = value;
      reminderSelect.append(option);
    }
    reminderSelect.value = task.reminderMinutes === null ? "none" : String(task.reminderMinutes);
    reminderSelect.disabled = !task.date || !task.time;
    reminderSelect.addEventListener("change", () => setReminder(task.id, reminderSelect.value === "none" ? null : Number(reminderSelect.value)));
    reminderLabel.append(reminderSelect);

    const notesLabel = element("label", "detail-label", "备注");
    const notesInput = element("textarea", "detail-notes");
    notesInput.rows = 1;
    notesInput.placeholder = "补充一点细节…";
    notesInput.value = task.notes || "";
    notesInput.addEventListener("input", () => { task.notes = notesInput.value; save(); });
    notesLabel.append(notesInput);

    const foot = element("div", "detail-foot");
    const deleteButton = element("button", "delete-button", "删除任务");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () => {
      if (!window.confirm(`删除“${task.title}”？`)) return;
      const index = state.tasks.indexOf(task);
      state.tasks.splice(index, 1);
      state.selectedId = null;
      save(); render();
      showToast("任务已删除", () => { state.tasks.splice(index, 0, task); save(); render(); });
    });
    foot.append(deleteButton);
    detail.append(titleLabel, schedule, dateButtons, reminderLabel, notesLabel, foot);
    return detail;
  }

  function makeRow(task) {
    const open = state.selectedId === task.id;
    const row = element("div", `task-row${task.completedAt ? " done" : ""}${open ? " open" : ""}`);
    const line = element("div", "task-line");
    const check = element("button", "check-button");
    check.type = "button";
    check.setAttribute("aria-label", `${task.completedAt ? "恢复" : "完成"}任务：${task.title}`);
    if (task.completedAt) check.append(icon("check"));
    check.addEventListener("click", () => toggleComplete(task.id));
    const openButton = element("button", "task-open");
    openButton.type = "button";
    openButton.setAttribute("aria-label", `查看任务详情：${task.title}`);
    openButton.setAttribute("aria-expanded", String(open));
    openButton.addEventListener("click", () => { state.selectedId = open ? null : task.id; render(); });
    openButton.append(element("span", "task-text", task.title));
    if (state.view === "planned" || state.view === "completed" || task.time || (state.view === "today" && task.date < day())) {
      const overdue = task.date && task.date < day() && !task.completedAt;
      const dateText = overdue ? `逾期${task.time ? ` · ${task.time}` : ""}` : state.view === "today" ? task.time : `${formatDay(task.date)}${task.time ? ` · ${task.time}` : ""}`;
      const date = element("span", `task-date${overdue ? " overdue" : ""}`, dateText);
      openButton.append(date);
    }
    const chevron = icon("chevron");
    chevron.classList.add("chevron");
    openButton.append(chevron);
    line.append(check, openButton);
    row.append(line);
    if (open) row.append(makeDetail(task));
    return row;
  }

  function render() {
    const tasks = visibleTasks();
    document.querySelector(".widget").classList.toggle("editing", tasks.some(task => task.id === state.selectedId));
    const labels = { today: "今天", inbox: "待安排", planned: "计划", completed: "已完成" };
    refs.title.textContent = labels[state.view];
    refs.count.textContent = state.view === "today" ? `还有 ${tasks.length} 件` : `${tasks.length} 件`;
    refs.dateLabel.textContent = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
    const completedToday = task => !!task.completedAt && new Date(task.completedAt).toDateString() === new Date().toDateString();
    const dueToday = state.tasks.filter(task => task.date && task.date <= day() && (!task.completedAt || completedToday(task)));
    const done = dueToday.filter(completedToday).length;
    refs.progressBadge.hidden = state.view !== "today" || dueToday.length === 0;
    refs.progressBadge.style.setProperty("--progress", `${dueToday.length ? (done / dueToday.length) * 100 : 0}%`);
    refs.progressBadge.setAttribute("aria-label", `今日已完成 ${done} 件，共 ${dueToday.length} 件`);
    refs.progressValue.textContent = `${done}/${dueToday.length}`;
    refs.heroCaption.textContent = {
      today: !dueToday.length ? "今天还没有任务。" : tasks.length ? "先做一件，剩下的慢慢来。" : "今天的事情都处理好了。",
      inbox: "先记下来，再决定什么时候做。",
      planned: "看看接下来的节奏。",
      completed: "做过的事，都留在这里。",
    }[state.view];
    refs.tabs.querySelectorAll("[data-view]").forEach(button => {
      const active = button.dataset.view === state.view;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    refs.completedCount.textContent = state.tasks.filter(task => !!task.completedAt).length || "";
    refs.list.replaceChildren();
    if (!tasks.length) {
      const empty = element("div", "empty-state");
      empty.append(element("div", "empty-symbol", "✧"));
      empty.append(element("strong", "", state.view === "completed" ? "还没有完成记录" : "这里暂时空着"));
      empty.append(element("p", "", state.view === "today" ? "在下方添加今天想做的事。" : state.view === "inbox" ? "想到什么，先记下来。" : "在下方添加一件要做的事。"));
      refs.list.append(empty);
    } else refs.list.append(...tasks.map(makeRow));
  }

  refs.tabs.addEventListener("click", event => {
    const button = event.target.closest("[data-view]");
    if (button) setView(button.dataset.view);
  });
  refs.moreButton.addEventListener("click", () => setMenu(refs.moreMenu.hidden));
  $("completed-button").addEventListener("click", () => setView("completed"));
  $("reset-button").addEventListener("click", () => {
    setMenu(false);
    if (!window.confirm("重置示例任务？当前原型中保存的任务会被清除。")) return;
    state.tasks = sampleTasks();
    state.selectedId = null;
    state.view = "today";
    save(); render(); showToast("示例任务已重置");
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".more-wrap")) setMenu(false);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") { setMenu(false); if (state.selectedId) { state.selectedId = null; render(); } }
  });
  refs.addForm.addEventListener("submit", event => {
    event.preventDefault();
    const title = refs.addInput.value.trim();
    if (!title) return;
    const targetView = state.view === "completed" ? "inbox" : state.view;
    const date = targetView === "today" ? day() : targetView === "planned" ? day(1) : null;
    const id = globalThis.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random()}`;
    state.tasks.push({ id, title, date, time: null, reminderMinutes: null, notes: "", completedAt: null, createdAt: Date.now() });
    refs.addInput.value = "";
    state.view = targetView;
    save(); render(); refs.addInput.focus();
    showToast("已添加任务");
  });
  refs.toastUndo.addEventListener("click", () => {
    const undo = state.undo;
    if (!undo) return;
    state.undo = null;
    refs.toast.hidden = true;
    clearTimeout(state.toastTimer);
    undo();
  });

  save(); render();
})();
