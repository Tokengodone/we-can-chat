import { app, dialog } from 'electron'
import { spawn } from 'child_process'
import { existsSync, statSync } from 'fs'
import path from 'path'
import { ConfigService } from './config'
import { wechatReplyMediaLibraryService } from './wechatReplyMediaLibraryService'
import {
  DEFAULT_WECHAT_REPLY_SETTINGS,
  type WechatReplyResult,
  type WechatReplyRuntimeStatus,
  type WechatReplySettings
} from '../../shared/wechatReply'

type SidecarResponse = WechatReplyResult & {
  pythonVersion?: string
  wxautoVersion?: string
  detail?: string
  partial?: boolean
  confirmationPending?: boolean
}

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const numeric = Math.round(Number(value))
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback
}

const isClock = (value: unknown): value is string => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''))

class WechatReplyService {
  private readonly config = ConfigService.getInstance()
  private consecutiveFailures = 0
  private circuitOpen = false
  private sentAt: number[]
  private lastSentAt: number
  private environment: WechatReplyRuntimeStatus['environment']

  constructor() {
    const history = this.config.get('wechatReplySendHistory')
    this.sentAt = Array.isArray(history)
      ? history.filter(timestamp => Number.isFinite(timestamp) && timestamp > 0)
      : []
    const lastSentAt = Number(this.config.get('wechatReplyLastSentAt') || 0)
    this.lastSentAt = Number.isFinite(lastSentAt) && lastSentAt > 0 ? lastSentAt : 0
    this.pruneSentHistory()
  }

  getSettings(): WechatReplySettings {
    const stored = this.config.get('wechatReplySettings')
    return this.sanitizeSettings(stored)
  }

  saveSettings(input: unknown): WechatReplyResult & { settings?: WechatReplySettings } {
    const settings = this.sanitizeSettings(input)
    if (settings.enabled && !settings.riskAcceptedAt) {
      return { success: false, code: 'RISK_NOT_ACCEPTED', message: '启用发送器前需要确认非官方自动化风险' }
    }
    if (settings.enabled && !settings.bindings.some(binding => binding.enabled)) {
      return { success: false, code: 'NO_BINDING', message: '至少启用一个会话绑定后才能开启发送器' }
    }
    if (settings.enabled && settings.automationMode !== 'draft' && !settings.aiEnabled) {
      return { success: false, code: 'AI_DISABLED', message: '倒计时或全自动模式需要先启用 AI 草稿' }
    }
    if (settings.enabled && settings.automationMode !== 'draft' && (!String(this.config.get('aiModelApiBaseUrl') || '').trim() || !String(this.config.get('aiModelApiKey') || '').trim())) {
      return { success: false, code: 'AI_NOT_CONFIGURED', message: '倒计时或全自动模式需要先完成 AI 基础配置' }
    }
    if (settings.enabled && settings.automationMode !== 'draft' && !settings.bindings.some(binding => binding.enabled && binding.autoReplyEnabled)) {
      return { success: false, code: 'NO_AUTO_BINDING', message: '至少为一个白名单会话开启自动回复' }
    }
    this.config.set('wechatReplySettings', settings)
    if (!settings.enabled) this.resetCircuit()
    return { success: true, message: '微信回复设置已保存', settings }
  }

  async checkEnvironment(): Promise<WechatReplyRuntimeStatus> {
    if (process.platform !== 'win32') {
      this.environment = { ok: false, message: '微信回复兼容层仅支持 Windows' }
      return this.getStatus()
    }
    const result = await this.invokeSidecar({ action: 'status' })
    this.environment = {
      ok: result.success,
      pythonVersion: result.pythonVersion,
      wxautoVersion: result.wxautoVersion,
      message: result.success ? result.message : this.formatSidecarError(result)
    }
    return this.getStatus()
  }

  getStatus(): WechatReplyRuntimeStatus {
    this.pruneSentHistory()
    const settings = this.getSettings()
    const now = Date.now()
    return {
      platformSupported: process.platform === 'win32',
      enabled: settings.enabled,
      circuitOpen: this.circuitOpen,
      consecutiveFailures: this.consecutiveFailures,
      sentToday: this.sentAt.filter(timestamp => now - timestamp < 24 * 60 * 60 * 1000).length,
      sentThisHour: this.sentAt.filter(timestamp => now - timestamp < 60 * 60 * 1000).length,
      lastSentAt: this.lastSentAt || undefined,
      environment: this.environment
    }
  }

  async sendTest(bindingId: unknown, content: unknown): Promise<WechatReplyResult> {
    const settings = this.getSettings()
    if (!settings.riskAcceptedAt) {
      return { success: false, code: 'RISK_NOT_ACCEPTED', message: '请先阅读并确认风险说明' }
    }
    const binding = settings.bindings.find(item => item.enabled && item.id === String(bindingId || ''))
    if (!binding) {
      return { success: false, code: 'NOT_ALLOWED', message: '测试目标尚未保存或不在已启用白名单中' }
    }
    return this.dispatch(binding.targetName, String(content || '').trim(), settings, true)
  }

  async sendMediaTest(bindingId: unknown, mediaKind: unknown): Promise<WechatReplyResult> {
    const settings = this.getSettings()
    if (!settings.riskAcceptedAt) return { success: false, code: 'RISK_NOT_ACCEPTED', message: '请先阅读并确认风险说明' }
    const binding = settings.bindings.find(item => item.enabled && item.id === String(bindingId || ''))
    if (!binding) return { success: false, code: 'NOT_ALLOWED', message: '测试目标尚未保存或不在已启用白名单中' }

    const kind = mediaKind === 'emoji' ? 'emoji' : 'image'
    const result = await dialog.showOpenDialog({
      title: kind === 'emoji' ? '选择要发送的表情图片' : '选择要发送的图片',
      properties: ['openFile'],
      filters: [{
        name: kind === 'emoji' ? '表情图片' : '图片',
        extensions: kind === 'emoji' ? ['gif', 'webp', 'png', 'jpg', 'jpeg'] : ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif']
      }]
    })
    if (result.canceled || result.filePaths.length === 0) return { success: false, code: 'CANCELLED', message: '已取消选择' }
    return this.dispatchMedia(binding.targetName, result.filePaths[0], kind, settings)
  }

  async sendLibraryAsset(bindingId: unknown, assetId: unknown): Promise<WechatReplyResult> {
    const settings = this.getSettings()
    if (!settings.riskAcceptedAt) return { success: false, code: 'RISK_NOT_ACCEPTED', message: '请先阅读并确认风险说明' }
    const binding = settings.bindings.find(item => item.enabled && item.id === String(bindingId || ''))
    if (!binding) return { success: false, code: 'NOT_ALLOWED', message: '发送目标尚未保存或不在已启用白名单中' }
    const asset = wechatReplyMediaLibraryService.get(assetId)
    if (!asset) return { success: false, code: 'MEDIA_NOT_FOUND', message: '回复素材不存在或文件已经失效' }
    const isGroup = binding.sessionId.endsWith('@chatroom')
    if (asset.scope !== 'all' && asset.scope !== (isGroup ? 'group' : 'private')) {
      return { success: false, code: 'MEDIA_SCOPE_BLOCKED', message: '该素材不允许发送到当前会话类型' }
    }
    return this.dispatchMedia(binding.targetName, asset.filePath, asset.kind, settings)
  }

  async sendReply(sessionId: string, content: string, assetId?: string): Promise<WechatReplyResult> {
    const settings = this.getSettings()
    if (!settings.enabled) return { success: false, code: 'DISABLED', message: '微信回复发送器未启用' }
    const binding = settings.bindings.find(item => item.enabled && item.sessionId === sessionId)
    if (!binding) return { success: false, code: 'NOT_ALLOWED', message: '当前会话未在回复白名单中' }
    if (!assetId) return this.dispatch(binding.targetName, content, settings, false)
    const asset = wechatReplyMediaLibraryService.get(assetId)
    if (!asset) return { success: false, code: 'MEDIA_NOT_FOUND', message: '匹配的回复素材不存在或文件已经失效' }
    const isGroup = binding.sessionId.endsWith('@chatroom')
    if (asset.scope !== 'all' && asset.scope !== (isGroup ? 'group' : 'private')) {
      return { success: false, code: 'MEDIA_SCOPE_BLOCKED', message: '匹配的素材不允许发送到当前会话类型' }
    }
    return this.dispatchBundle(binding.targetName, content, asset.filePath, asset.kind, settings)
  }

  async sendGeneratedReply(sessionId: string, content: string, filePath: string): Promise<WechatReplyResult> {
    const settings = this.getSettings()
    if (!settings.enabled || !settings.imageGenerationEnabled) return { success: false, code: 'DISABLED', message: '图片生成发送未启用' }
    const binding = settings.bindings.find(item => item.enabled && item.sessionId === sessionId)
    if (!binding) return { success: false, code: 'NOT_ALLOWED', message: '当前会话未在回复白名单中' }
    const generatedRoot = path.resolve(this.config.getCacheBasePath(), 'wechat-reply-generated')
    const resolved = path.resolve(String(filePath || ''))
    if (!resolved.startsWith(`${generatedRoot}${path.sep}`)) return { success: false, code: 'INVALID_FILE_PATH', message: '生成图片路径不在受控缓存目录内' }
    return this.dispatchBundle(binding.targetName, content, resolved, 'image', settings)
  }

  async sendFallbackMention(sessionId: string): Promise<WechatReplyResult> {
    const settings = this.getSettings()
    const binding = settings.bindings.find(item => item.enabled && item.sessionId === sessionId)
    const mentionName = String(binding?.fallbackMentionName || '').trim()
    const mentionUsername = String(binding?.fallbackMentionUsername || '').trim()
    if (!binding || !binding.sessionId.endsWith('@chatroom') || !mentionName || !mentionUsername) {
      return { success: false, code: 'NO_FALLBACK_MENTION', message: '当前群聊没有配置兜底回答人' }
    }
    return this.dispatch(binding.targetName, settings.fallbackMentionTemplate, settings, false, mentionName)
  }

  async sendText(sessionId: string, content: string): Promise<WechatReplyResult> {
    const settings = this.getSettings()
    if (!settings.enabled) return { success: false, code: 'DISABLED', message: '微信回复发送器未启用' }
    const binding = settings.bindings.find(item => item.enabled && item.sessionId === sessionId)
    if (!binding) return { success: false, code: 'NOT_ALLOWED', message: '当前会话未在回复白名单中' }
    return this.dispatch(binding.targetName, content, settings, false)
  }

  private async dispatch(targetName: string, content: string, settings: WechatReplySettings, manual: boolean, mentionName = ''): Promise<WechatReplyResult> {
    if (process.platform !== 'win32') return { success: false, code: 'UNSUPPORTED_PLATFORM', message: '微信回复兼容层仅支持 Windows' }
    if (!targetName) return { success: false, code: 'EMPTY_TARGET', message: '微信窗口名称不能为空' }
    if (!content) return { success: false, code: 'EMPTY_CONTENT', message: '回复内容不能为空' }
    if (content.length > 1000) return { success: false, code: 'CONTENT_TOO_LONG', message: '单条回复不能超过 1000 个字符' }
    if (this.circuitOpen) return { success: false, code: 'CIRCUIT_OPEN', message: '连续发送失败，发送器已熔断；请检查环境后重试' }

    this.pruneSentHistory()
    const now = Date.now()
    const hourCount = this.sentAt.filter(timestamp => now - timestamp < 60 * 60 * 1000).length
    const dayCount = this.sentAt.length
    if (hourCount >= settings.hourlyLimit) return { success: false, code: 'HOURLY_LIMIT', message: '已达到每小时发送上限' }
    if (dayCount >= settings.dailyLimit) return { success: false, code: 'DAILY_LIMIT', message: '已达到每日发送上限' }
    if (!manual && this.isQuietHours(settings)) return { success: false, code: 'QUIET_HOURS', message: '当前处于安静时段，已阻止自动发送' }

    const minimumWait = settings.minIntervalSeconds * 1000 - (now - this.lastSentAt)
    if (minimumWait > 0) {
      return { success: false, code: 'RATE_LIMIT', retryAfterMs: minimumWait, message: `发送过快，请在 ${Math.ceil(minimumWait / 1000)} 秒后重试` }
    }

    const delay = manual ? 0 : Math.round(settings.randomDelayMinMs + Math.random() * (settings.randomDelayMaxMs - settings.randomDelayMinMs))
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))

    const result = await this.invokeSidecar({ action: mentionName ? 'send_mention' : 'send_text', target: targetName, content, mentionName })
    if (result.success) {
      const sentAt = Date.now()
      this.sentAt.push(sentAt)
      this.lastSentAt = sentAt
      this.config.set('wechatReplySendHistory', this.sentAt)
      this.config.set('wechatReplyLastSentAt', sentAt)
      this.consecutiveFailures = 0
      return { success: true, ...(result.confirmationPending ? { code: 'SEND_CONFIRMATION_PENDING' } : {}), message: result.message }
    }
    this.consecutiveFailures += 1
    if (this.consecutiveFailures >= settings.failureThreshold) this.circuitOpen = true
    return { success: false, code: this.circuitOpen ? 'CIRCUIT_OPEN' : 'SEND_FAILED', message: this.formatSidecarError(result) }
  }

  private async dispatchMedia(targetName: string, filePath: string, mediaKind: 'image' | 'emoji', settings: WechatReplySettings): Promise<WechatReplyResult> {
    if (process.platform !== 'win32') return { success: false, code: 'UNSUPPORTED_PLATFORM', message: '微信回复兼容层仅支持 Windows' }
    if (!targetName) return { success: false, code: 'EMPTY_TARGET', message: '微信窗口名称不能为空' }
    if (!existsSync(filePath)) return { success: false, code: 'FILE_NOT_FOUND', message: '所选图片不存在' }
    const allowedExtensions = mediaKind === 'emoji'
      ? new Set(['.gif', '.webp', '.png', '.jpg', '.jpeg'])
      : new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'])
    if (!allowedExtensions.has(path.extname(filePath).toLowerCase())) {
      return { success: false, code: 'INVALID_FILE_TYPE', message: '所选文件不是支持的图片格式' }
    }
    if (statSync(filePath).size > 20 * 1024 * 1024) return { success: false, code: 'FILE_TOO_LARGE', message: '图片不能超过 20 MB' }
    if (this.circuitOpen) return { success: false, code: 'CIRCUIT_OPEN', message: '连续发送失败，发送器已熔断；请检查环境后重试' }

    this.pruneSentHistory()
    const now = Date.now()
    const hourCount = this.sentAt.filter(timestamp => now - timestamp < 60 * 60 * 1000).length
    if (hourCount >= settings.hourlyLimit) return { success: false, code: 'HOURLY_LIMIT', message: '已达到每小时发送上限' }
    if (this.sentAt.length >= settings.dailyLimit) return { success: false, code: 'DAILY_LIMIT', message: '已达到每日发送上限' }
    const minimumWait = settings.minIntervalSeconds * 1000 - (now - this.lastSentAt)
    if (minimumWait > 0) return { success: false, code: 'RATE_LIMIT', retryAfterMs: minimumWait, message: `发送过快，请在 ${Math.ceil(minimumWait / 1000)} 秒后重试` }

    const result = await this.invokeSidecar({ action: 'send_media', target: targetName, filePath, mediaKind })
    if (result.success) {
      const sentAt = Date.now()
      this.sentAt.push(sentAt)
      this.lastSentAt = sentAt
      this.config.set('wechatReplySendHistory', this.sentAt)
      this.config.set('wechatReplyLastSentAt', sentAt)
      this.consecutiveFailures = 0
      return { success: true, ...(result.confirmationPending ? { code: 'SEND_CONFIRMATION_PENDING' } : {}), message: result.message }
    }
    this.consecutiveFailures += 1
    if (this.consecutiveFailures >= settings.failureThreshold) this.circuitOpen = true
    return { success: false, code: this.circuitOpen ? 'CIRCUIT_OPEN' : 'SEND_FAILED', message: this.formatSidecarError(result) }
  }

  private async dispatchBundle(targetName: string, content: string, filePath: string, mediaKind: 'image' | 'emoji', settings: WechatReplySettings): Promise<WechatReplyResult> {
    if (process.platform !== 'win32') return { success: false, code: 'UNSUPPORTED_PLATFORM', message: '微信回复兼容层仅支持 Windows' }
    if (!targetName || !content.trim()) return { success: false, code: 'EMPTY_CONTENT', message: '回复目标或文字内容不能为空' }
    if (content.length > 1000) return { success: false, code: 'CONTENT_TOO_LONG', message: '单条回复不能超过 1000 个字符' }
    if (!existsSync(filePath)) return { success: false, code: 'FILE_NOT_FOUND', message: '回复素材文件不存在' }
    if (statSync(filePath).size > 20 * 1024 * 1024) return { success: false, code: 'FILE_TOO_LARGE', message: '图片不能超过 20 MB' }
    if (this.circuitOpen) return { success: false, code: 'CIRCUIT_OPEN', message: '连续发送失败，发送器已熔断；请检查环境后重试' }
    if (this.isQuietHours(settings)) return { success: false, code: 'QUIET_HOURS', message: '当前处于安静时段，已阻止自动发送' }

    this.pruneSentHistory()
    const now = Date.now()
    const hourCount = this.sentAt.filter(timestamp => now - timestamp < 60 * 60 * 1000).length
    if (hourCount >= settings.hourlyLimit) return { success: false, code: 'HOURLY_LIMIT', message: '已达到每小时发送上限' }
    if (this.sentAt.length >= settings.dailyLimit) return { success: false, code: 'DAILY_LIMIT', message: '已达到每日发送上限' }
    const minimumWait = settings.minIntervalSeconds * 1000 - (now - this.lastSentAt)
    if (minimumWait > 0) return { success: false, code: 'RATE_LIMIT', retryAfterMs: minimumWait, message: `发送过快，请在 ${Math.ceil(minimumWait / 1000)} 秒后重试` }

    const delay = Math.round(settings.randomDelayMinMs + Math.random() * (settings.randomDelayMaxMs - settings.randomDelayMinMs))
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
    const result = await this.invokeSidecar({ action: 'send_bundle', target: targetName, content, filePath, mediaKind })
    if (result.success && !result.partial) {
      const sentAt = Date.now()
      this.sentAt.push(sentAt)
      this.lastSentAt = sentAt
      this.config.set('wechatReplySendHistory', this.sentAt)
      this.config.set('wechatReplyLastSentAt', sentAt)
      this.consecutiveFailures = 0
      return { success: true, ...(result.confirmationPending ? { code: 'SEND_CONFIRMATION_PENDING' } : {}), message: result.message }
    }
    if (result.partial) {
      const sentAt = Date.now()
      this.sentAt.push(sentAt)
      this.lastSentAt = sentAt
      this.config.set('wechatReplySendHistory', this.sentAt)
      this.config.set('wechatReplyLastSentAt', sentAt)
      return { success: false, code: 'MEDIA_SEND_FAILED', message: this.formatSidecarError(result) }
    }
    this.consecutiveFailures += 1
    if (this.consecutiveFailures >= settings.failureThreshold) this.circuitOpen = true
    return { success: false, code: this.circuitOpen ? 'CIRCUIT_OPEN' : 'SEND_FAILED', message: this.formatSidecarError(result) }
  }

  private invokeSidecar(payload: Record<string, unknown>): Promise<SidecarResponse> {
    const settings = this.getSettings()
    const configuredPythonPath = String(settings.pythonPath || 'python').trim() || 'python'
    const developmentPythonPath = path.join(process.cwd(), '.venv-wxauto', 'Scripts', 'python.exe')
    const pythonPath = !app.isPackaged && configuredPythonPath === 'python' && existsSync(developmentPythonPath)
      ? developmentPythonPath
      : configuredPythonPath
    const scriptPath = app.isPackaged
      ? path.join(process.resourcesPath, 'wxauto-sidecar', 'server.py')
      : path.join(process.cwd(), 'resources', 'wxauto-sidecar', 'server.py')

    return new Promise(resolve => {
      let settled = false
      let stdout = ''
      let stderr = ''
      const child = spawn(pythonPath, [scriptPath], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8'
        }
      })
      const finish = (result: SidecarResponse) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
      const timer = setTimeout(() => {
        child.kill()
        finish({ success: false, message: '微信兼容引擎响应超时，请确认微信客户端处于可操作状态' })
      }, 60_000)

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', chunk => { stdout += chunk })
      child.stderr.on('data', chunk => { stderr += chunk })
      child.on('error', error => finish({ success: false, message: `无法启动 Python：${error.message}` }))
      child.on('close', () => {
        try {
          const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop()
          if (!line) throw new Error(stderr.trim() || 'sidecar 未返回结果')
          finish(JSON.parse(line) as SidecarResponse)
        } catch (error) {
          finish({ success: false, message: `微信兼容引擎返回异常：${String((error as Error).message || error)}` })
        }
      })
      child.stdin.end(`${JSON.stringify(payload)}\n`)
    })
  }

  private sanitizeSettings(input: unknown): WechatReplySettings {
    const raw = input && typeof input === 'object' ? input as Partial<WechatReplySettings> : {}
    const minDelay = clampInt(raw.randomDelayMinMs, 0, 60_000, DEFAULT_WECHAT_REPLY_SETTINGS.randomDelayMinMs)
    const maxDelay = clampInt(raw.randomDelayMaxMs, minDelay, 120_000, DEFAULT_WECHAT_REPLY_SETTINGS.randomDelayMaxMs)
    const storedImageModel = String(raw.imageGenerationModel || DEFAULT_WECHAT_REPLY_SETTINGS.imageGenerationModel).trim().slice(0, 200)
    const imageGenerationModel = storedImageModel === 'gpt-image-1'
      ? DEFAULT_WECHAT_REPLY_SETTINGS.imageGenerationModel
      : storedImageModel || DEFAULT_WECHAT_REPLY_SETTINGS.imageGenerationModel
    const bindings = Array.isArray(raw.bindings) ? raw.bindings.slice(0, 100).map((binding, index) => ({
      id: String(binding?.id || `binding-${index}`).slice(0, 100),
      sessionId: String(binding?.sessionId || '').trim().slice(0, 200),
      sessionName: String(binding?.sessionName || '').trim().slice(0, 200),
      targetName: String(binding?.targetName || '').trim().slice(0, 200),
      enabled: binding?.enabled !== false,
      autoReplyEnabled: binding?.autoReplyEnabled === true,
      fallbackMentionName: String(binding?.fallbackMentionName || '').trim().slice(0, 100),
      fallbackMentionUsername: String(binding?.fallbackMentionUsername || '').trim().slice(0, 200)
    })).filter(binding => binding.sessionId && binding.targetName) : []

    return {
      enabled: raw.enabled === true,
      riskAcceptedAt: Math.max(0, Number(raw.riskAcceptedAt || 0)),
      pythonPath: String(raw.pythonPath || DEFAULT_WECHAT_REPLY_SETTINGS.pythonPath).trim().slice(0, 500) || 'python',
      bindings,
      minIntervalSeconds: clampInt(raw.minIntervalSeconds, 5, 3600, DEFAULT_WECHAT_REPLY_SETTINGS.minIntervalSeconds),
      hourlyLimit: clampInt(raw.hourlyLimit, 1, 120, DEFAULT_WECHAT_REPLY_SETTINGS.hourlyLimit),
      dailyLimit: clampInt(raw.dailyLimit, 1, 500, DEFAULT_WECHAT_REPLY_SETTINGS.dailyLimit),
      randomDelayMinMs: minDelay,
      randomDelayMaxMs: maxDelay,
      quietHoursEnabled: raw.quietHoursEnabled !== false,
      quietHoursStart: isClock(raw.quietHoursStart) ? raw.quietHoursStart : DEFAULT_WECHAT_REPLY_SETTINGS.quietHoursStart,
      quietHoursEnd: isClock(raw.quietHoursEnd) ? raw.quietHoursEnd : DEFAULT_WECHAT_REPLY_SETTINGS.quietHoursEnd,
      failureThreshold: clampInt(raw.failureThreshold, 1, 10, DEFAULT_WECHAT_REPLY_SETTINGS.failureThreshold),
      aiEnabled: raw.aiEnabled === true,
      contextMessageCount: clampInt(raw.contextMessageCount, 1, 50, DEFAULT_WECHAT_REPLY_SETTINGS.contextMessageCount),
      temperature: Math.min(1.5, Math.max(0, Number.isFinite(Number(raw.temperature)) ? Number(raw.temperature) : DEFAULT_WECHAT_REPLY_SETTINGS.temperature)),
      maxReplyChars: clampInt(raw.maxReplyChars, 20, 1000, DEFAULT_WECHAT_REPLY_SETTINGS.maxReplyChars),
      apiRequestTimeoutSeconds: clampInt(raw.apiRequestTimeoutSeconds, 30, 600, DEFAULT_WECHAT_REPLY_SETTINGS.apiRequestTimeoutSeconds),
      memberMemoryEnabled: raw.memberMemoryEnabled === true,
      memberMemoryMessageCount: clampInt(raw.memberMemoryMessageCount, 20, 100, DEFAULT_WECHAT_REPLY_SETTINGS.memberMemoryMessageCount),
      autoMediaEnabled: raw.autoMediaEnabled === true,
      imageGenerationEnabled: raw.imageGenerationEnabled === true,
      imageGenerationModel,
      imageGenerationSize: raw.imageGenerationSize === '1536x1024' || raw.imageGenerationSize === '1024x1536' ? raw.imageGenerationSize : '1024x1024',
      knowledgeBaseEnabled: raw.knowledgeBaseEnabled === true,
      knowledgeBasePath: String(raw.knowledgeBasePath || '').trim().slice(0, 1000),
      knowledgeBaseMaxResults: clampInt(raw.knowledgeBaseMaxResults, 1, 10, DEFAULT_WECHAT_REPLY_SETTINGS.knowledgeBaseMaxResults),
      webSearchEnabled: raw.webSearchEnabled === true,
      webSearchMaxResults: clampInt(raw.webSearchMaxResults, 1, 8, DEFAULT_WECHAT_REPLY_SETTINGS.webSearchMaxResults),
      fallbackMentionTemplate: String(raw.fallbackMentionTemplate || DEFAULT_WECHAT_REPLY_SETTINGS.fallbackMentionTemplate).trim().slice(0, 500) || DEFAULT_WECHAT_REPLY_SETTINGS.fallbackMentionTemplate,
      automationMode: raw.automationMode === 'countdown' || raw.automationMode === 'auto' ? raw.automationMode : 'draft',
      countdownSeconds: clampInt(raw.countdownSeconds, 5, 120, DEFAULT_WECHAT_REPLY_SETTINGS.countdownSeconds),
      replyDebounceSeconds: clampInt(raw.replyDebounceSeconds, 2, 60, DEFAULT_WECHAT_REPLY_SETTINGS.replyDebounceSeconds)
    }
  }

  private isQuietHours(settings: WechatReplySettings): boolean {
    if (!settings.quietHoursEnabled) return false
    const now = new Date()
    const current = now.getHours() * 60 + now.getMinutes()
    const toMinutes = (value: string) => {
      const [hours, minutes] = value.split(':').map(Number)
      return hours * 60 + minutes
    }
    const start = toMinutes(settings.quietHoursStart)
    const end = toMinutes(settings.quietHoursEnd)
    return start <= end ? current >= start && current < end : current >= start || current < end
  }

  private pruneSentHistory(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    const pruned = this.sentAt.filter(timestamp => timestamp >= cutoff)
    if (pruned.length !== this.sentAt.length) {
      this.sentAt = pruned
      this.config.set('wechatReplySendHistory', pruned)
    }
  }

  private resetCircuit(): void {
    this.consecutiveFailures = 0
    this.circuitOpen = false
  }

  private formatSidecarError(result: SidecarResponse): string {
    const detail = String(result.detail || '').trim()
    return detail ? `${result.message}：${detail}` : result.message
  }
}

export const wechatReplyService = new WechatReplyService()
