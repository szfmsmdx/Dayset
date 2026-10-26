# Dayset Windows 客户端

正式客户端使用 Svelte、TypeScript 和 Tauri 2；任务由本机 SQLite 保存。面向用户的功能与操作说明见[项目首页](../../README.md)。

## 本地运行

需要 Windows、Node.js/npm、Rust 1.90 或更新版本、Microsoft C++ Build Tools 和 WebView2 Runtime。在本目录运行：

```powershell
npm ci
npm run tauri -- dev
```

只预览页面可运行 `npm run dev`，打开 Vite 给出的本地地址。浏览器预览使用独立的 `localStorage`；它与正式客户端的 SQLite 数据、旧网页原型的数据互不共享。

## 检查与构建

```powershell
npm run check
npm test
npm run tauri -- build --bundles nsis
```

构建后可在以下位置找到 Windows x64 文件：

| 文件 | 用途 |
| --- | --- |
| `src-tauri/target/release/dayset.exe` | 直接运行的 EXE |
| `src-tauri/target/release/bundle/nsis/Dayset_<版本号>_x64-setup.exe` | NSIS 安装包 |

发布新版本时，应同步更新 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 的版本号，再构建并将 EXE、安装包作为 GitHub Release 附件上传。仓库保存源码，构建产物不提交到 Git。现有 `v0.1.0` Release 已包含旧构建；本次改动准备作为 `v0.1.1` 发布。

目前“提醒”只显示预计时间，尚未接入 Windows 系统通知；设置页也尚无可配置选项。数据模型和后续同步方向见[架构文档](../../docs/architecture.md)。界面中的少量图标路径来自 Lucide，许可见 [LUCIDE-LICENSE.txt](LUCIDE-LICENSE.txt)。
