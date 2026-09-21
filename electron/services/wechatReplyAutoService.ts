import { ConfigService } from './config'
import { wechatReplyAiService } from './wechatReplyAiService'
import { wechatReplyService } from './wechatReplyService'
import type { MessagePushIncomingEvent } from './messagePushService'
import type { WechatReplyAutomationItem, WechatReplyAutomationStatus, WechatReplyResult } from '../../shared/wechatReply'

type RuntimeAutomationItem = WechatReplyAutomationItem & { generatedImagePath?: string }

const PROCESSED_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_PROCESSED_KEYS = 2000
const MAX_ITEMS = 50
const MEDIA_REPEAT_COOLDOWN_MS = 10 * 60 * 1000
const SENSITIVE_PATTERN = /(验证码|动态码|密码|口令|身份证|银行卡|转账|收款|付款|借钱|汇款|合同|签约|医疗|用药|报警|报案|律师|法院)/i
const PAUSE_PATTERN = /(人工回复|请人工|别自动回复|不要自动回复|停止自动回复)/i

class WechatReplyAutoService {
  private readonly config = ConfigService.getInstance()
  private started = false
  private queue: Promise<void> = Promise.resolve()
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly pendingGroupMentions = new Map<string, { sourceId: string; expiresAt: number }>()
  private readonly countdownTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private items: RuntimeAutomationItem[] = []
  private readonly recentMediaBySession = new Map<string, { assetId: string; sentAt: number }>()

  start(): void {
    this.started = true
    this.pruneProcessedKeys()
  }

  stop(): void {
    this.started = false
    for (const timer of this.debounceTimers.values()) clearTimeout(timer)
    for (const timer of this.countdownTimers.values()) clearTimeout(timer)
    this.debounceTimers.clear()
    this.countdownTimers.clear()
    this.pendingGroupMentions.clear()
  }

  handleIncoming(event: MessagePushIncomingEvent): void {
    if (!this.started || !event?.messageKey || event.payload?.event !== 'message.new') return
    const settings = wechatReplyService.getSettings()
    if (!settings.enabled || !settings.aiEnabled || settings.automationMode === 'draft') return
    const binding = settings.bindings.find(item => item.enabled && item.autoReplyEnabled && item.sessionId === event.payload.sessionId)
    if (!binding || this.isProcessed(event.messageKey)) return

    const content = String(event.payload.content || '').trim()
    this.rememberProcessed(event.messageKey)
    if (!content || /^\[[^\]]+\]$/.test(content)) return

    const sessionId = binding.sessionId
    let queuedEvent = event
    if (event.payload.sessionType === 'group') {
      const sourceId = String(event.payload.sourceId || '').trim()
      if (event.payload.mentionsSelf === true) {
        this.pendingGroupMentions.set(sessionId, { sourceId, expiresAt: Date.now() + 2 * 60 * 1000 })
      } else {
        const pendingMention = this.pendingGroupMentions.get(sessionId)
        if (!pendingMention || pendingMention.expiresAt < Date.now() || !sourceId || pendingMention.sourceId !== sourceId) return
        queuedEvent = {
          ...event,
          payload: { ...event.payload, mentionsSelf: true }
        }
      }
    }

    const queueKey = event.messageKey
    const timer = setTimeout(() => {
      this.debounceTimers.delete(queueKey)
      this.queue = this.queue.then(() => this.processIncoming(queuedEvent)).catch(error => {
        console.warn('[WechatReplyAutoService] Queue failed:', (error as Error).message)
      })
    }, settings.replyDebounceSeconds * 1000)
    this.debounceTimers.set(queueKey, timer)
  }

  getStatus(): WechatReplyAutomationStatus {
    const settings = wechatReplyService.getSettings()
    return {
      running: this.started && settings.enabled && settings.aiEnabled && settings.automationMode !== 'draft',
      mode: settings.automationMode,
      pendingCount: this.items.filter(item => item.state === 'countdown').length,
      items: this.items.map(({ generatedImagePath: _generatedImagePath, ...item }) => item)
    }
  }

  cancelPending(id: unknown): WechatReplyResult {
    const key = String(id || '')
    const item = this.items.find(entry => entry.id === key)
    if (!item || item.state !== 'countdown') return { success: false, code: 'NOT_PENDING', message: '该草稿已不在等待发送状态' }
    const timer = this.countdownTimers.get(key)
    if (timer) clearTimeout(timer)
    this.countdownTimers.delete(key)
    item.state = 'cancelled'
    item.message = '已取消自动发送'
    item.sendAt = undefined
    return { success: true, message: '已取消自动发送' }
  }

  private async processIncoming(event: MessagePushIncomingEvent): Promise<void> {
    const settings = wechatReplyService.getSettings()
    const binding = settings.bindings.find(item => item.enabled && item.autoReplyEnabled && item.sessionId === event.payload.sessionId)
    if (!binding || !settings.enabled || !settings.aiEnabled || settings.automationMode === 'draft') return

    const incoming = String(event.payload.content || '').trim()
    if (binding.sessionId.endsWith('@chatroom') && event.payload.mentionsSelf !== true) {
      return
    }
    if (SENSITIVE_PATTERN.test(incoming) || PAUSE_PATTERN.test(incoming)) {
      this.addItem(binding.sessionId, binding.sessionName, '', incoming, 'blocked', '检测到敏感或暂停关键词，内容未发送给模型')
      if (!PAUSE_PATTERN.test(incoming)) await this.tryFallbackMention(binding.sessionId)
      return
    }

    const result = await wechatReplyAiService.generateDraft(binding.id, true, event.messageKey)
    if (!result.success || !result.draft) {
      this.addItem(binding.sessionId, binding.sessionName, '', incoming, 'failed', result.message)
      await this.tryFallbackMention(binding.sessionId)
      return
    }

    const latestSettings = wechatReplyService.getSettings()
    const latestBinding = latestSettings.bindings.find(item => item.enabled && item.autoReplyEnabled && item.sessionId === binding.sessionId)
    if (!latestSettings.enabled || !latestSettings.aiEnabled || latestSettings.automationMode === 'draft' || !latestBinding) {
      this.addItem(binding.sessionId, binding.sessionName, result.draft, result.targetMessage || incoming, 'cancelled', '设置已变化，本次自动发送已取消')
      return
    }

    const recentMedia = result.mediaAssetId ? this.recentMediaBySession.get(binding.sessionId) : undefined
    const mediaBlockedByCooldown = Boolean(
      result.mediaAssetId &&
      recentMedia?.assetId === result.mediaAssetId &&
      Date.now() - recentMedia.sentAt < MEDIA_REPEAT_COOLDOWN_MS
    )
    const mediaAssetId = result.generatedImagePath ? undefined : (mediaBlockedByCooldown ? undefined : result.mediaAssetId)
    const mediaAssetName = result.generatedImagePath ? undefined : (mediaBlockedByCooldown ? undefined : result.mediaAssetName)

    if (latestSettings.automationMode === 'countdown') {
      const item = this.addItem(binding.sessionId, binding.sessionName, result.draft, result.targetMessage || incoming, 'countdown', '等待自动发送', mediaAssetId, mediaAssetName, result.generatedImagePath, result.generatedImageName, result.knowledgeSourceNames, result.webSourceNames, result.webSourceUrls)
      this.schedulePendingSend(item, latestSettings.countdownSeconds * 1000)
      return
    }

    const item = this.addItem(binding.sessionId, binding.sessionName, result.draft, result.targetMessage || incoming, 'draft', '正在自动发送', mediaAssetId, mediaAssetName, result.generatedImagePath, result.generatedImageName, result.knowledgeSourceNames, result.webSourceNames, result.webSourceUrls)
    await this.sendItem(item)
  }

  private async sendPending(id: string): Promise<void> {
    const item = this.items.find(entry => entry.id === id)
    if (!item || item.state !== 'countdown') return
    const settings = wechatReplyService.getSettings()
    const binding = settings.bindings.find(entry => entry.enabled && entry.autoReplyEnabled && entry.sessionId === item.sessionId)
    if (!settings.enabled || !settings.aiEnabled || settings.automationMode === 'draft' || !binding) {
      item.state = 'cancelled'
      item.message = '设置已变化，自动发送已取消'
      item.sendAt = undefined
      return
    }
    await this.sendItem(item)
  }

  private async sendItem(item: RuntimeAutomationItem): Promise<void> {
    item.sendAt = undefined
    const result = item.generatedImagePath
      ? await wechatReplyService.sendGeneratedReply(item.sessionId, item.content, item.generatedImagePath)
      : await wechatReplyService.sendReply(item.sessionId, item.content, item.mediaAssetId)
    if (!result.success && result.code === 'RATE_LIMIT' && Number(result.retryAfterMs) > 0) {
      const waitMs = Math.max(1000, Math.ceil(Number(result.retryAfterMs)) + 300)
      item.state = 'countdown'
      item.message = '触发发送间隔，已自动排队'
      this.schedulePendingSend(item, waitMs)
      return
    }
    item.state = result.success ? 'sent' : 'failed'
    item.message = result.message
    if (result.success && item.mediaAssetId) {
      this.recentMediaBySession.set(item.sessionId, { assetId: item.mediaAssetId, sentAt: Date.now() })
      if (this.recentMediaBySession.size > 500) {
        const cutoff = Date.now() - MEDIA_REPEAT_COOLDOWN_MS
        for (const [sessionId, recent] of this.recentMediaBySession) {
          if (recent.sentAt < cutoff) this.recentMediaBySession.delete(sessionId)
        }
      }
    }
  }

  private schedulePendingSend(item: RuntimeAutomationItem, waitMs: number): void {
    const previous = this.countdownTimers.get(item.id)
    if (previous) clearTimeout(previous)
    item.sendAt = Date.now() + waitMs
    const timer = setTimeout(() => {
      this.countdownTimers.delete(item.id)
      this.queue = this.queue.then(() => this.sendPending(item.id)).catch(error => {
        console.warn('[WechatReplyAutoService] Pending send failed:', (error as Error).message)
      })
    }, waitMs)
    this.countdownTimers.set(item.id, timer)
  }

  private cancelPendingForSession(sessionId: string): void {
    for (const item of this.items) {
      if (item.sessionId !== sessionId || item.state !== 'countdown') continue
      const timer = this.countdownTimers.get(item.id)
      if (timer) clearTimeout(timer)
      this.countdownTimers.delete(item.id)
      item.state = 'cancelled'
      item.message = '收到更新消息，旧回复已取消'
      item.sendAt = undefined
    }
  }

  private addItem(
    sessionId: string,
    sessionName: string,
    content: string,
    targetMessage: string,
    state: WechatReplyAutomationItem['state'],
    message: string,
    mediaAssetId?: string,
    mediaAssetName?: string,
    generatedImagePath?: string,
    generatedImageName?: string,
    knowledgeSourceNames?: string[],
    webSourceNames?: string[],
    webSourceUrls?: string[]
  ): RuntimeAutomationItem {
    const item: RuntimeAutomationItem = {
      id: `auto-reply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      sessionName,
      content,
      targetMessage: targetMessage.slice(0, 500),
      createdAt: Date.now(),
      state,
      message,
      mediaAssetId,
      mediaAssetName,
      generatedImagePath,
      generatedImageName,
      knowledgeSourceNames,
      webSourceNames,
      webSourceUrls
    }
    this.items = [item, ...this.items].slice(0, MAX_ITEMS)
    return item
  }

  private async tryFallbackMention(sessionId: string): Promise<void> {
    const result = await wechatReplyService.sendFallbackMention(sessionId)
    if (!result.success && result.code !== 'NO_FALLBACK_MENTION') {
      console.warn('[WechatReplyAutoService] Fallback mention failed:', result.message)
    }
  }

  private isProcessed(messageKey: string): boolean {
    const values = this.config.get('wechatReplyProcessedMessageKeys') || {}
    return Number(values[messageKey] || 0) > Date.now() - PROCESSED_TTL_MS
  }

  private rememberProcessed(messageKey: string): void {
    const values = { ...(this.config.get('wechatReplyProcessedMessageKeys') || {}) }
    values[messageKey] = Date.now()
    const entries = Object.entries(values)
      .filter(([, timestamp]) => Number(timestamp) > Date.now() - PROCESSED_TTL_MS)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, MAX_PROCESSED_KEYS)
    this.config.set('wechatReplyProcessedMessageKeys', Object.fromEntries(entries))
  }

  private pruneProcessedKeys(): void {
    const values = this.config.get('wechatReplyProcessedMessageKeys') || {}
    const cutoff = Date.now() - PROCESSED_TTL_MS
    const entries = Object.entries(values).filter(([, timestamp]) => Number(timestamp) > cutoff)
    if (entries.length !== Object.keys(values).length) {
      this.config.set('wechatReplyProcessedMessageKeys', Object.fromEntries(entries))
    }
  }
}

export const wechatReplyAutoService = new WechatReplyAutoService()
