# Agent 项目入口

本仓库的产品与重建规范在 [`docs/AGENT-REIMPLEMENTATION-GUIDE.md`](docs/AGENT-REIMPLEMENTATION-GUIDE.md)。在分析、重构、重写或创建派生项目之前，必须完整阅读该文件。

如果任务目标是从零复刻当前软件，直接采用 [`docs/AGENT-BUILD-PROMPT.md`](docs/AGENT-BUILD-PROMPT.md) 作为实施任务书，并将执行差异记录在 `docs/DECISIONS.md`。

## 强制边界

- 不提交真实聊天数据、账户目录、解密密钥、API token、密码或本机路径。
- 不恢复强制更新；所有更新行为必须由用户明确发起或确认。
- 保持 Electron 的 `contextIsolation: true` 和 `nodeIntegration: false`。
- 不把新的业务逻辑堆入 `electron/main.ts`、preload 或单一巨型 Service；按 IPC、domain、service、repository、worker 分层。
- 修改导出、文件清理或路径逻辑时，必须保留输出目录校验和任务 manifest 保护。
