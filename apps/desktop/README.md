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

Windows 上重复打包可在仓库根目录运行 `powershell -ExecutionPolicy Bypass -File scripts/build-fast.ps1`。脚本使用 `sccache` 缓存 Rust 编译结果，并将并行编译任务限制为 8 个，以降低资源峰值。首次使用先执行 `winget install --id Mozilla.sccache --exact`。已有的 Cargo 缓存不会自动转入 `sccache`；它主要加快依赖需要重新编译时的构建，修改 Dayset 主程序后仍需等待 release 优化。只调整前端时，可先运行 `npm run dev` 预览，无需每次制作安装包。需要进一步降低资源占用时可传入 `-Jobs 4`。

构建后可在以下位置找到 Windows x64 文件：

| 文件 | 用途 |
| --- | --- |
| `src-tauri/target/release/dayset.exe` | 直接运行的 EXE |
| `src-tauri/target/release/bundle/nsis/Dayset_<版本号>_x64-setup.exe` | NSIS 安装包 |

发布新版本时，应同步更新 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 的版本号，再构建并将 EXE、安装包作为 GitHub Release 附件上传。仓库保存源码，构建产物不提交到 Git。现有 `v0.1.1` 已发布；`v0.1.2` 的提醒功能正在本地验证。

`v0.1.2` 使用 Rust 后台循环检查本机 SQLite，在应用运行或隐藏到托盘时发送 Windows 系统通知；启动或电脑唤醒后会补查过去 24 小时内尚未提醒的任务。Windows 原生通知需要使用安装版；浏览器预览与直接运行的 EXE 不保证显示。设置页仍无可配置选项，账号同步也尚未接入。数据模型和后续方向见[架构文档](../../docs/architecture.md)。界面中的少量图标路径来自 Lucide，许可见 [LUCIDE-LICENSE.txt](LUCIDE-LICENSE.txt)。
