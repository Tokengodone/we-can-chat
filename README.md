# We Can Chat

We Can Chat（基于 WeFlow）是一个本地优先的微信 4.x 数据工作台：在用户自己的电脑上读取、搜索、分析和导出微信数据，并提供可选的本地 HTTP API、AI 洞察和 Windows 微信回复能力。

项目默认不包含任何个人聊天数据、账号配置、数据库、运行日志或 API 密钥。首次启动时，所有用户都需要自行选择微信数据目录并配置自己的密钥。

## 能做什么

- 浏览和搜索聊天记录、联系人、群成员及朋友圈内容。
- 生成私聊、群聊和年度统计报告。
- 将聊天导出为 JSON、HTML、Markdown、TXT、Excel、SQL、ChatLab 等格式。
- 导出图片、视频、语音和表情，并可使用本地模型转写语音。
- 使用仅监听 `127.0.0.1` 的本地 HTTP API 和 SSE 消息推送。
- 在 Windows 上通过 `wxauto4` 发送测试消息、图片或受控自动回复。
- 按需接入兼容 OpenAI 的模型服务、知识库和公开网络搜索。

## 环境要求

- Windows 10/11（主要支持平台）
- Node.js 20+ 与 npm
- 如需微信回复：Python 3.12、已登录的 Windows 微信 4.x 和 Python 依赖

## 安装与启动

在项目目录打开 PowerShell：

```powershell
npm install
npm run electron:dev
```

首次启动后，在应用内选择自己的微信数据目录，并按提示配置数据库解密密钥。密钥只应来自数据所有者本人。

## 可选：微信回复

```powershell
py -3.12 -m venv .venv-wxauto
.\.venv-wxauto\Scripts\python.exe -m pip install -r .\resources\wxauto-sidecar\requirements.txt
npm run electron:dev
```

进入“微信回复”页面后，先检测 Python 和微信连接，再绑定一个明确的测试会话。建议先使用“仅草稿”模式和小号，确认目标名称、发送间隔和限流设置无误后再考虑自动模式。

## 检查与构建

```powershell
npm run typecheck
npm run build
```

## 文档

- [快速使用指南](docs/GETTING-STARTED.md)
- [本地 HTTP API](docs/HTTP-API.md)
- [隐私与安全说明](SECURITY.md)
- [项目架构与重建指南](docs/AGENT-REIMPLEMENTATION-GUIDE.md)

## 隐私边界

默认情况下，聊天内容在本机处理。AI、HTTP API、Webhook、主动推送和自动回复均需要用户主动开启；开启 AI 后，相关上下文会发送到用户配置的外部模型服务。不要提交或分享以下内容：`WeFlow-config.json`、`.env`、微信数据库、导出文件、日志、缓存、数据库解密密钥、API Key 和 Token。

## 许可证

见 [LICENSE](LICENSE)。
