import { groupAnalyticsService } from './groupAnalyticsService'
import { buildWechatMemberMemoryContext } from '../../shared/wechatMemberMemory'

interface MemoryCacheEntry {
  context: string
  updatedAt: number
}

class WechatReplyMemoryService {
  private readonly cache = new Map<string, MemoryCacheEntry>()
  private readonly cacheTtlMs = 5 * 60 * 1000

  async getGroupMemberContext(chatroomId: string, memberUsername: string, limit: number): Promise<string> {
    const groupId = String(chatroomId || '').trim()
    const memberId = String(memberUsername || '').trim()
    if (!groupId.endsWith('@chatroom') || !memberId) return ''

    const cacheKey = `${groupId}\u0001${memberId}`
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.updatedAt < this.cacheTtlMs) return cached.context

    const result = await groupAnalyticsService.getGroupMemberMessages(groupId, memberId, {
      limit: Math.max(20, Math.min(100, Math.floor(limit || 60)))
    })
    const context = result.success && result.data
      ? buildWechatMemberMemoryContext(result.data.messages)
      : ''
    this.cache.set(cacheKey, { context, updatedAt: Date.now() })
    return context
  }
}

export const wechatReplyMemoryService = new WechatReplyMemoryService()
