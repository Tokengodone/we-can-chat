# WeFlow Agent 可复刻开发规范

> 目标：让具备 TypeScript / Electron / React 能力的编码 Agent，在不依赖原工程实现细节的前提下，复刻当前软件的用户可见能力、桌面端运行模型和核心数据流程。
>
> 本文的“复刻”指功能等价与架构重建，不要求逐行复制源码、品牌、更新源、密钥、原生数据库实现或上游发布配置。源代码仍是行为细节的最终依据。

## 1. 成品定义

成品是一个 Windows 优先、兼容 macOS/Linux 的本地优先桌面应用。用户提供本机微信数据目录与解密信息后，可以浏览聊天数据、查看或处理媒体、统计分析、生成报告、导出数据、备份数据，并可选择开启本地 HTTP API 和消息通知。

### 1.1 必须具备的用户效果

| 模块 | 用户可见结果 | 优先级 |
| --- | --- | --- |
| 初始配置 | 能选择微信数据目录、保存账户/解密信息、验证数据连接 | P0 |
| 聊天 | 会话列表、分页消息、关键词搜索、按日期跳转、图片/视频/语音预览 | P0 |
| 联系人 | 查看联系人、群聊、群成员；支持导出 | P1 |
| 导出 | 可选择会话、时间范围、文件格式和媒体选项；展示实时进度；能取消 | P0 |
| 数据分析 | 私聊和群聊的消息量、时段、成员排行、媒体统计 | P1 |
| 报告 | 年度、长期、双人报告；可以单独打开报告窗口 | P2 |
| 朋友圈 | 时间线浏览、媒体预览、统计与导出 | P2 |
| 备份 | 对本地数据库创建、查看、恢复备份 | P1 |
| 自动化 | 本地 HTTP API、消息通知、Webhook/推送和 AI 洞察 | P2 |
| 设置 | 主题、语言/显示、导出默认值、路径、通知、隐私/锁定 | P1 |

### 1.2 明确不应复刻的内容

- 上游项目的名称、图标、作者信息、GitHub 发布仓库或更新 URL。
- 用户机器上的 `WeFlow-config.json`、解密密钥、令牌、聊天数据或个人路径。
- `resources/` 内平台特定二进制的来源与授权；新的实现必须自行确认许可证和平台兼容性。
- “强制更新”策略。更新必须由用户发起或明确确认。

## 2. 当前工程的事实基线

### 2.1 技术选型

| 领域 | 当前实现 |
| --- | --- |
| 桌面容器 | Electron 43 |
| 前端 | React 19 + React Router 7 |
| 状态 | Zustand 5 |
| 语言与构建 | TypeScript 6 + Vite 8 + vite-plugin-electron |
| 样式 | Sass |
| 本地设置 | electron-store |
| 图表与表格 | ECharts、ExcelJS |
| 图片/媒体 | Sharp、FFmpeg、WASM、原生模块 |
| 打包 | electron-builder |
| 计算隔离 | Node.js `worker_threads` |

工程的构建入口在 `vite.config.ts`；其分别构建 Electron 主进程、preload 和多个 Worker。应用和平台打包规则在 `package.json`。

### 2.2 进程架构

```text
React Renderer
  Pages / Components / Zustand Stores
          │
          ▼
window.electronAPI  ←  preload: 白名单 API
          │ IPC invoke / event
          ▼
Electron Main
  IPC handlers → domain services → repositories / filesystem
          │
          ├── Worker RPC → DB 查询、导出、图片、报告、转写
          ├── electron-store → 偏好和轻量配置
          └── Native resources → WCDB、媒体和系统能力
```

安全基线：所有窗口默认 `contextIsolation: true` 且 `nodeIntegration: false`。渲染进程没有直接 Node.js 权限，只能调用 preload 明确暴露的功能。

## 3. 页面与交互规格

### 3.1 主导航

主侧边栏的一级能力：聊天、朋友圈、机器人、通讯录、资源库、聊天分析、导出数据、数据库备份；账户菜单提供账户管理、设置和锁定。

### 3.2 路由清单

| 路由 | 页面职责 |
| --- | --- |
| `/` | 欢迎页、首次引导、数据连接状态 |
| `/account-management` | 多账户/数据目录管理 |
| `/chat` | 主聊天界面 |
| `/contacts` | 联系人、群聊与群成员 |
| `/resources` | 媒体与资源库 |
| `/sns` | 朋友圈时间线 |
| `/analytics` | 聊天分析入口 |
| `/analytics/private/view` | 私聊统计详情 |
| `/analytics/group` | 群聊统计详情 |
| `/annual-report`、`/annual-report/view` | 年度报告和独立报告窗口 |
| `/dual-report`、`/dual-report/view` | 双人报告和独立报告窗口 |
| `/export` | 导出中心（在当前实现中可由独立窗口承载） |
| `/backup` | 数据库备份 |
| `/insight-inbox` | AI 洞察收件箱 |
| `/bots` | 机器人与自动化 |
| `/biz` | 业务/扩展页 |
| `/settings` | 应用设置 |
| `/chat-history/:sessionId/:messageId` | 单条消息定位/独立历史窗口 |

### 3.3 UI 规则

- 主页使用常驻标题栏、侧边栏和内容区；大页面必须懒加载。
- 长任务始终可见：显示阶段、百分比、当前会话、已写出文件数和取消动作。
- 所有不可逆操作必须有确认；导出覆盖策略必须允许“增量、覆盖、重命名”。
- 聊天、报告、通知、图片和视频可以使用独立窗口；独立窗口只加载自己所需路由。
- 明确提示本地数据、外部网络请求和可能上传的数据，AI/推送一律用户主动开启。

## 4. 分层与目录规范（新实现的目标结构）

```text
src/
  app/                 # 路由、布局、全局错误边界
  features/            # 以业务功能分组的页面、组件、hooks
  components/          # 跨功能复用的纯 UI 组件
  stores/              # 仅渲染层状态
  services/            # renderer 对 electronAPI 的轻薄封装
  types/               # renderer 专用类型

electron/
  main.ts              # 仅启动、依赖装配和窗口创建
  preload.ts           # 组合分模块 API，禁止业务逻辑
  ipc/                 # 每个领域一个 IPC 注册文件
  domain/              # 纯业务规则、DTO、校验、策略
  services/            # 用例编排，不直接依赖 UI
  repositories/        # 数据访问、文件访问抽象
  workers/             # 重 CPU/IO 任务
  infrastructure/      # 日志、配置、备份、通知、平台适配

shared/
  contracts/           # IPC 请求/响应/事件类型及 Zod schema
  constants/
```

严格依赖方向：`renderer → preload contract → ipc → service → repository/worker`。不允许页面直接访问文件、数据库或 Node API；不允许 repository 调用 UI；不允许 Worker 引用 BrowserWindow。

## 5. IPC 契约

当前应用约有 197 个 IPC 通道，按 `config`、`chat`、`analytics`、`export`、`sns`、`backup`、`http`、`insight` 等命名空间分组。新实现不得把这些字符串散落在多处，应由 `shared/contracts` 定义唯一来源。

### 5.1 通用规则

```ts
// shared/contracts/export.ts
export const ExportRequestSchema = z.object({
  sessionIds: z.array(z.string()).min(1),
  format: z.enum(['json', 'html', 'markdown', 'txt', 'excel', 'sql', 'chatlab']),
  dateRange: z.object({ start: z.number(), end: z.number() }).nullable(),
  media: z.object({ images: z.boolean(), videos: z.boolean(), voices: z.boolean() })
})

export interface ExportApi {
  start(request: ExportRequest): Promise<{ taskId: string }>
  pause(taskId: string): Promise<void>
  resume(taskId: string): Promise<void>
  cancel(taskId: string): Promise<void>
  onProgress(listener: (event: ExportProgress) => void): () => void
}
```

- 每个 `invoke` 请求与返回值必须有 TypeScript 类型和运行时 schema 校验。
- IPC handler 必须重新校验来自渲染进程的参数，不能信任前端。
- 事件监听必须返回 unsubscribe，组件卸载时必须调用。
- 文件路径、URL、导出目录和任何外部地址都必须在主进程验证。

### 5.2 必需 API 命名空间

| 命名空间 | 最小能力 |
| --- | --- |
| `config` | get/set/clear，按 schema 管理 |
| `app` | 版本、启动项、更新检查、路径、存储统计 |
| `dialog` | 打开文件、目录、保存文件 |
| `window` | 最小化、最大化、关闭、打开专用窗口 |
| `auth` | 应用锁、密码/系统凭据验证 |
| `chat` | 会话、消息、检索、定位、编辑（若启用） |
| `contacts` | 联系人、群成员、导出 |
| `analytics` | 统计请求、报告生成与缓存失效 |
| `export` | 预估、开始、进度、暂停、恢复、取消、清理 |
| `backup` | 创建、列出、恢复、删除备份 |
| `http` | 启动、停止、状态、令牌管理 |
| `notification` | 显示、关闭、点击回调 |

## 6. 数据与存储规格

### 6.1 分层存储

| 数据种类 | 推荐位置 | 示例 |
| --- | --- | --- |
| 用户偏好 | electron-store | 主题、窗口尺寸、默认导出目录、功能开关 |
| 敏感秘密 | OS keychain / Electron safeStorage | HTTP token、AI key、应用锁凭据 |
| 正式业务数据 | SQLite/目标数据源 | 会话、消息索引、导出记录、报告元数据 |
| 可再生成缓存 | cache 目录/数据库 cache 表 | 头像、统计、媒体索引、导出预估 |
| 大文件产物 | 用户指定输出目录 | 导出文件、备份包、报告附件 |

禁止把聊天正文、媒体二进制、用户密码或大量缓存塞进 electron-store 或 Zustand。

### 6.2 配置要求

- 提供 `ConfigSchema`，为每个 key 指定默认值、类型和是否敏感。
- 应用配置存入用户数据目录，源码仓库永不保存实际配置。
- 路径变更后清空相关缓存并重新初始化数据服务。
- 配置读取失败时使用可恢复的默认值，并记录诊断日志。

### 6.3 数据访问原则

- 数据库连接、解密、批量检索和索引构建必须位于主进程或 Worker。
- 所有分页 API 使用稳定游标或明确 `limit/offset`，避免一次加载全量消息。
- 任何用户可编辑的本地消息必须记录审计信息和备份点。

## 7. Worker/RPC 规格

### 7.1 Worker 列表

当前构建包含：数据库、导出、图片搜索、图片解密、语音转写、年度报告、双人报告、API 消息映射等 Worker。重建时至少保留：

```text
databaseWorker     # 查询、解析、索引、批处理
exportWorker       # 大量格式化、媒体复制、压缩
reportWorker       # 年度/双人统计和图片生成
mediaWorker        # 图片解密、缩略图、视频元数据
```

### 7.2 RPC 协议

```ts
type WorkerRequest = { id: number; type: string; payload: unknown }
type WorkerResponse = { id: number; result?: unknown; error?: { code: string; message: string } }
type WorkerEvent = { type: 'progress' | 'log' | 'monitor'; payload: unknown }
```

主进程维护 `pending: Map<id, { resolve, reject }>`；Worker 崩溃、退出或超时时，必须 reject 所有挂起请求，并可按有限次数重启。任何 Worker 任务必须支持 `AbortSignal` 或 `taskId` 取消。

### 7.3 性能约束

- 渲染进程禁止执行解密、整库统计、全量导出和大图处理。
- 进度事件节流至每秒不超过 10 次。
- 单任务内限制媒体复制/下载并发数；默认 2–4。
- 所有大量文件操作必须流式执行，不一次读入内存。

## 8. 核心用例流程

### 8.1 启动与数据连接

```text
app ready
  → 初始化 ConfigService / 日志 / 路径
  → 创建主窗口
  → renderer 请求当前配置
  → 用户选择数据目录并填写/获取密钥
  → Main 校验路径与连接
  → databaseWorker 初始化
  → 返回 account、会话数量与错误诊断
  → renderer 进入聊天主页
```

失败时显示可行动的错误：路径不存在、没有权限、数据库版本不支持、密钥无效、原生运行库缺失。不得只有“连接失败”。

### 8.2 聊天浏览

```text
ChatPage 打开
  → chat.listSessions(cursor, filters)
  → 用户选择会话
  → chat.getMessages(sessionId, cursor, query)
  → 渲染虚拟列表
  → 图片/视频按需请求本地预览路径
  → 需要处理的媒体交给 mediaWorker
```

需要支持：滚动分页、日期跳转、关键词搜索、引用消息跳转、消息类型呈现、发送者显示名优先级（群昵称/备注/昵称）。

### 8.3 导出

```text
用户选择会话、时间与格式
  → export.estimate(request)
  → 选择输出目录和冲突策略
  → export.start(request) 返回 taskId
  → 注册 TaskControl，创建输出 manifest
  → 收集消息 → 解析内容 → 处理媒体 → formatter 写文件
  → 推送 progress
  → complete / failed / cancelled
  → cancelled 时仅清理 manifest 中、且位于输出目录内的产物
```

支持格式：ChatLab JSON/JSONL、普通 JSON、HTML、Markdown、TXT、Excel、SQL，以及当前工程中的兼容格式。格式化器必须使用策略模式：一个格式一个类，禁止在一个巨大 `switch` 中拼所有文件。

导出进度包含：阶段、当前/总会话、当前会话名、已收集消息、已导出消息、已写文件、媒体缓存命中/未命中和写入字节数。

### 8.4 分析与报告

```text
analytics request
  → 从缓存读取；失效则 databaseWorker 聚合
  → 返回消息总量、类型、小时/日期分布、成员排名、媒体统计
  → React + ECharts 渲染

report generate
  → reportWorker 生成统计与图表数据
  → 保存 report snapshot
  → 在独立 BrowserWindow 打开只读报告路由
```

统计缓存必须带：数据源账户、时间范围、过滤条件、算法版本、创建时间。原数据变化、配置改变或用户点击刷新时必须失效。

### 8.5 备份和恢复

- 创建备份前检查可用磁盘空间。
- 备份是不可变快照，记录版本、创建时间、数据源账户和校验摘要。
- 恢复前自动创建当前状态的安全备份。
- 任何删除操作只能删除应用自己登记的备份文件。

## 9. 导出引擎的标准实现

```text
ExportFacade
  → ExportOrchestrator
      → ExportContext
          → MessageCollector
          → ContentParser
          → AttachmentResolver
          → MediaPipeline
          → Formatter strategy
          → TaskControl / OutputManifest
```

### 9.1 组件职责

| 组件 | 职责 |
| --- | --- |
| `ExportFacade` | 对 IPC 提供少量稳定入口 |
| `ExportOrchestrator` | 编排完整工作流和错误边界 |
| `ExportContext` | 单次任务共享的账户、范围、路径、缓存和回调 |
| `MessageCollector` | 按会话/日期分页读取、估算与去重 |
| `ContentParser` | 文本、引用、链接、文件、转账、位置等标准化 |
| `AttachmentResolver` | 定位原图、视频、语音、表情和文件 |
| `MediaPipeline` | 解密、复制、转码、缓存与并发控制 |
| `Formatter` | 只关心目标格式输出 |
| `TaskControl` | 暂停、恢复、取消、文件 manifest 与安全清理 |

### 9.2 Formatter 接口

```ts
interface ExportFormatter {
  readonly format: ExportFormat
  write(input: ExportDocument, target: ExportTarget, signal: AbortSignal): Promise<WrittenArtifact[]>
}
```

每个 Formatter 必须可单测，不依赖 BrowserWindow、IPC 或 React。

## 10. 安全与隐私验收

- 默认完全离线；任何 AI、HTTP API、Webhook、媒体下载均为显式 opt-in。
- 不将密钥、token、聊天内容、真实路径写进日志、错误弹窗、Git 或导出文件名。
- 本地 HTTP API 仅监听 `127.0.0.1`，默认关闭，必须使用随机 token。
- `shell.openExternal` 只允许 `https:`；文件打开只允许经过路径校验。
- 保持 `contextIsolation: true`、`nodeIntegration: false`；避免关闭 `webSecurity`。若本地媒体确有需要，使用自定义受限协议而非全局降级。
- 对导出目录执行 canonical path 校验，清理时只能删除任务 manifest 登记、且属于该目录的文件。

## 11. 测试与验收标准

### 11.1 必须自动化的测试

| 层 | 必测内容 |
| --- | --- |
| Domain | 消息解析、显示名优先级、时间过滤、导出命名、路径安全 |
| Worker | 请求/响应匹配、崩溃恢复、取消、超时、进度事件 |
| Export | 每种 Formatter、媒体缺失、重复媒体、取消清理、覆盖策略 |
| IPC | schema 拒绝非法参数、无权限路径、事件 unsubscribe |
| Repository | 分页稳定性、空库、坏数据、索引失效 |
| E2E | 初始连接、聊天浏览、单会话导出、恢复备份、API token 鉴权 |

### 11.2 P0 验收清单

- [ ] 新用户可完成配置，失败时看得懂原因并能修复。
- [ ] 10 万条消息的数据源上，打开会话和继续滚动不冻结界面。
- [ ] 长导出过程可显示连续进度，可取消，取消后不残留未登记文件。
- [ ] 至少可导出 JSON、HTML、Markdown、TXT 和 Excel。
- [ ] 导出不泄露配置密钥，不意外覆盖文件。
- [ ] 重启后主题、窗口状态和最近账户仍存在。
- [ ] 本地 HTTP API 默认关闭且 token 校验有效。
- [ ] Windows 安装包可安装、启动、卸载；开发模式与打包模式都能找到 Worker 和原生资源。

## 12. 当前实现的技术债：复刻时必须避免

- `electron/main.ts`、`chatService.ts`、`ExportContext.ts`、`wcdbCore.ts` 已达到数千至上万行，不要继续堆功能。
- 当前 preload API 很大，新的 API 要按领域文件组织并共享类型。
- 避免服务全局单例互相直接引用；通过构造函数注入 repository、worker client、logger 和 config。
- 当前测试量不足；新实现必须先为消息解析、导出、路径安全、Worker 取消补齐测试。
- 原项目存在少量窗口关闭 `webSecurity` 的做法；新实现不要复制。
- 更新机制必须替换发布地址和 appId，且不可恢复强制更新行为。

## 13. Agent 实施顺序

1. 搭建 Electron + React + TypeScript 工程，完成安全 preload 与主窗口。
2. 建立 shared IPC contract、日志、配置、错误模型和诊断页。
3. 实现数据源适配接口与 `databaseWorker`，完成账户验证、会话列表、分页消息。
4. 实现聊天页、虚拟列表、媒体按需预览和基础搜索。
5. 实现导出引擎、任务控制、JSON/HTML/Markdown/TXT/Excel Formatter。
6. 实现联系人、统计缓存、图表和报告 Worker。
7. 实现备份恢复、本地 HTTP API、通知和可选 AI 功能。
8. 补齐安全、性能、打包和端到端验收。

每一步都必须可运行、可测试、可提交；不要同时开始全部页面或先做视觉效果再补数据边界。

## 14. 源码定位索引

| 主题 | 当前源码位置 |
| --- | --- |
| React 与路由 | `src/main.tsx`、`src/App.tsx` |
| 侧边栏导航 | `src/components/Sidebar.tsx` |
| 前端 Store | `src/stores/` |
| renderer IPC 封装 | `src/services/` |
| Preload API | `electron/preload.ts`、`src/types/electron.d.ts` |
| 主进程与 IPC handler | `electron/main.ts` |
| 配置与缓存 | `electron/services/config.ts`、`electron/services/cacheMapStore.ts` |
| 数据库 Worker 代理 | `electron/services/wcdbService.ts` |
| 数据库 Worker/核心 | `electron/wcdbWorker.ts`、`electron/services/wcdbCore.ts` |
| 导出引擎 | `electron/services/export/` |
| 导出任务控制 | `electron/services/exportTaskControlService.ts` |
| HTTP API | `electron/services/httpService.ts`、`docs/HTTP-API.md` |
| 构建与打包 | `vite.config.ts`、`package.json`、`scripts/` |

下一份文档 `AGENT-BUILD-PROMPT.md` 是可直接提交给编码 Agent 的执行指令。
