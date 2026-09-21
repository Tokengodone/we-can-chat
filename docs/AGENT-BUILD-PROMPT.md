# 交给编码 Agent 的复刻任务提示词

将下面内容完整交给负责新项目的编码 Agent，并同时提供 `docs/AGENT-REIMPLEMENTATION-GUIDE.md`。

---

你要从零实现一个本地优先的 Electron 桌面应用，功能目标参考已有 WeFlow 工程，但不得复制品牌、发布源、用户数据、密钥、上游二进制或强制更新逻辑。先阅读 `docs/AGENT-REIMPLEMENTATION-GUIDE.md`，它是产品和架构的验收标准。

## 任务目标

实现一个可打包、可运行、可测试的 Electron + React + TypeScript 应用，支持：

1. 配置本地数据源并验证连接。
2. 浏览会话与分页消息，支持搜索、日期跳转和媒体预览。
3. 导出所选会话，支持 JSON、HTML、Markdown、TXT、Excel；支持时间范围、媒体选项、进度、取消和安全清理。
4. 提供联系人浏览、基础统计、数据库备份与恢复。
5. 为后续报告、本地 HTTP API、通知和 AI 功能保留清晰扩展点。

## 强制架构约束

- 使用 Electron 主进程、preload、React renderer 三层；保持 `contextIsolation: true`、`nodeIntegration: false`。
- 所有 IPC 类型和 Zod schema 放在 `shared/contracts`；前后端都使用同一份定义。
- React 页面不得直接访问 Node.js、文件、数据库或密钥。
- 主进程只做装配和窗口管理；每个 IPC 领域拆到 `electron/ipc/*.ts`。
- 重任务只能在 Worker：数据库读取、全量统计、导出、媒体处理、报告生成。
- 每个 Worker 使用 `{ id, type, payload }` RPC，必须处理错误、退出、超时、取消和进度事件。
- 正式数据放 SQLite/数据源；electron-store 只保存偏好；敏感值使用 safeStorage 或系统凭据库。
- 导出采用 `Facade → Orchestrator → Context → Collector/Parser/MediaPipeline → Formatter`，格式化器互相独立。
- 取消任务时只能清理该任务 manifest 登记、且经 canonical path 校验位于输出目录中的文件。
- 禁止 `any` 作为 IPC 边界类型；禁止未验证的文件路径和 URL；禁止任意 shell 执行能力。

## 实施方式

按以下里程碑完成。每个里程碑结束时运行类型检查、单元测试和最小手工验证，并提交清晰的变更说明。

### M1：应用骨架与安全边界

- 初始化 Electron、Vite、React、TypeScript、Sass、Zustand。
- 创建主窗口、错误边界、HashRouter、基础布局和诊断页。
- 建立 `shared/contracts`、`electron/preload.ts`、模块化 IPC 注册器。
- 实现配置、日志、文件对话框、窗口控制。

验收：开发模式启动，renderer 能通过类型化 API 读取应用版本和写入非敏感设置。

### M2：数据源与聊天浏览

- 定义 `MessageDataSource`、`SessionRepository`、`MessageRepository` 接口。
- 实现 `databaseWorker`、Worker 客户端、取消/超时/进度机制。
- 完成账户配置、连接诊断、会话列表、消息游标分页、搜索、日期跳转。
- 使用虚拟列表，保证大数据源不卡渲染线程。

验收：用 fixture 数据可浏览至少 10 万条消息，连续滚动无明显冻结。

### M3：导出引擎

- 实现任务控制器、输出 manifest、进度事件和安全清理。
- 实现 JSON、HTML、Markdown、TXT、Excel Formatter。
- 完成导出预估、输出目录选择、重名策略、时间过滤、媒体选项。

验收：导出可完成、可取消、可重试；覆盖策略正确；取消不删除输出目录外的文件。

### M4：联系人、分析、备份

- 联系人/群成员的查询和导出。
- 统计聚合 Worker、缓存失效策略、ECharts 图表。
- 备份创建、列表、恢复前安全备份、磁盘空间检查。

验收：缓存可失效；恢复操作不覆盖当前数据而不留备份。

### M5：可选扩展

- 年度/双人报告 Worker 与独立窗口。
- 本地 HTTP API：仅 `127.0.0.1`、默认关闭、随机 token。
- 通知、Webhook、AI 洞察必须显式授权。

## 输出要求

完成时必须给出：

- 实际目录树与每个模块的职责。
- 已实现/未实现功能矩阵。
- 每个 IPC 命名空间的契约说明。
- 测试结果与测试覆盖的关键风险。
- 安装、开发、打包和故障排查步骤。
- 不得输出、提交或记录任何真实密钥、token、微信数据、用户文件路径。

如果需求与现有源码冲突，优先遵守安全性、隐私性、可测试性和本文档的架构边界；将差异记录在 `docs/DECISIONS.md`。
