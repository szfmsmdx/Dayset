# Dayset Windows 客户端

这是从 `prototype/` 设计稿迁出的第一阶段应用：Svelte + TypeScript 界面，Tauri 2 外壳，本机 SQLite 保存任务。

在此目录运行 `npm ci`，然后用 `npm run tauri dev` 打开 Windows 应用；用 `npm run tauri build` 构建安装包，产物位于 `src-tauri/target/release/bundle/`。首次原生构建需要 Rust、Microsoft C++ Build Tools 和 WebView2，并且系统策略须允许执行本地生成的构建程序。仅预览页面可运行 `npm run dev`，打开 Vite 给出的本地地址；该预览使用独立的浏览器本地存储。

`npm run test` 验证任务筛选、排序、提醒时间和今日进度；`npm run check` 检查 Svelte 与 TypeScript，`npm run build` 构建页面。正式应用与浏览器预览、旧网页原型各自保存数据。目前提醒只显示预计时间，尚无系统通知；同步服务器也尚未接入。数据模型与阶段边界见 [架构文档](../../docs/architecture.md)。

界面中的少量图标路径来自 Lucide，许可见 [LUCIDE-LICENSE.txt](LUCIDE-LICENSE.txt)。
