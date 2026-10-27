# Dayset 架构与 Windows 第一阶段

## 已确定的方向

Dayset 先做轻巧的 Windows 桌面应用。客户端使用 Tauri 2 承载 Svelte + TypeScript 页面；Rust 负责窗口、系统托盘和 SQLite 等系统能力。现有 `prototype/` 保留为设计参考，正式应用位于 `apps/desktop/`。未来 macOS 可复用桌面端，手机端通过共同的数据协议接入，不要求所有平台使用同一种 UI 语言。

```text
Svelte 视图 → 任务操作 → TaskRepository → 本机 SQLite
                         ↘ 后续同步模块 → HTTPS API → 服务器数据库
Tauri / Rust → 窗口、托盘、通知、系统启动
```

## Windows 第一阶段边界

1. 今天、待安排、计划三个视图；已完成任务留在原列表和原排序位置，以灰色删除线显示。支持新增、改名、备注、日期、时间、重复、提前量、完成、删除和撤销。
2. 本机 SQLite 持久化，断网仍可操作；窗口关闭并重新打开后任务仍在。
3. 保持小窗口布局，放大窗口时展开为双栏。
4. 关闭主窗口时隐藏到系统托盘，可从托盘恢复或退出。`v0.1.3` 的 Windows 安装版在程序运行期间由 Rust 后台检查并发送系统提醒；开机启动和服务器同步仍属于后续阶段。
5. 重复任务支持每天、每周、每月、每年，以及永不结束、按结束日期或总次数停止。完成当前项后生成下一项；晚完成时跳过已错过的周期。

当前浏览器预览使用独立的 `localStorage` 数据，Tauri 安装版使用 SQLite。它们与旧的 `prototype/` 数据互不覆盖。第一阶段不自动迁移旧原型中的试用任务。

## 任务记录

| 字段 | 含义 |
| --- | --- |
| `id` | 客户端生成的 UUID，跨设备保持不变 |
| `title`, `notes` | 名称和备注 |
| `dueDate`, `dueTime` | 用户选择的本地日历日期与可选时间 |
| `timeZone`, `dueAt` | 设置时间时记录的 IANA 时区与对应 UTC 毫秒时间戳 |
| `reminderMinutes` | 提前分钟数；`null` 表示不提醒 |
| `repeatFrequency`, `repeatEndMode` | 重复频率和结束方式 |
| `repeatEndDate`, `repeatCount` | 重复的结束日期或总次数（包含首次任务） |
| `repeatSeriesId`, `repeatOccurrence` | 重复序列标识与当前序号；每次任务仍是独立记录 |
| `repeatAnchorMonth`, `repeatAnchorDay` | 月度、年度重复时保持原定日历日期 |
| `completedAt` | 完成时间；`null` 表示未完成 |
| `createdAt`, `updatedAt` | 创建与最近修改时间 |
| `deletedAt` | 软删除标记，为将来同步保留删除记录 |

没有时间的任务不触发提醒；清除日期时也清除时间、时区、提醒和重复规则。日期和时间分开保存，避免“今天”这类纯日期任务因设备时区变化而移动。

## 后续同步约束

Windows 版先只依赖 `TaskRepository`，不让界面直接调用 HTTP。加服务器时，客户端继续先写本地 SQLite，再由同步模块上传变更并拉取远端变更。服务端负责账号隔离、版本号与冲突处理。删除记录使用 `deletedAt` 传播，不直接从数据库移除。初版同步可以按单条任务的版本解决冲突，不需要实时协作或 CRDT。

提醒由设备本地负责：Rust 后台每 5 秒检查 SQLite 中的待提醒任务，并记录已发送的提醒时间以避免重复。程序启动或电脑唤醒后会补查过去 24 小时内的提醒；明确退出 Dayset 后不会继续调度。Windows 原生通知依赖已安装的应用，仍需通过人工操作验证弹窗可见性和电脑休眠后的行为。
