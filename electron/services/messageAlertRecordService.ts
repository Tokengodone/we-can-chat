import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { createHash, randomUUID } from 'crypto'
import { ConfigService } from './config'

export type MessageAlertEvent = 'message.new' | 'message.revoke'
export type MessageAlertSessionType = 'private' | 'group' | 'official' | 'other'
export type MessageAlertMatchType = 'rule' | 'ai'

export interface MessageAlertRecord {
  id: string
  accountScope: string
  createdAt: number
  event: MessageAlertEvent
  sessionId: string
  sessionType: MessageAlertSessionType
  groupName?: string
  sourceName: string
  avatarUrl?: string
  content: string
  timestamp: number
  matchType: MessageAlertMatchType
  matchedKeywords: string[]
  matchedRegex: boolean
  aiReason?: string
  aiSummary?: string
  sound?: boolean
}

export interface MessageAlertRecordFilters {
  keyword?: string
  sessionId?: string
  startTime?: number
  endTime?: number
  limit?: number
  offset?: number
}

export interface MessageAlertSessionFacet {
  sessionId: string
  displayName: string
  avatarUrl?: string
  count: number
}

export interface MessageAlertKeywordFacet {
  keyword: string
  count: number
}

export interface MessageAlertListResult {
  success: boolean
  records: MessageAlertRecord[]
  total: number
  todayCount: number
  sessions: MessageAlertSessionFacet[]
  keywords: MessageAlertKeywordFacet[]
  error?: string
}

class MessageAlertRecordService {
  private readonly maxRecordsPerScope = 2000
  private filePath: string | null = null
  private loaded = false
  private records: MessageAlertRecord[] = []

  private resolveFilePath(): string {
    if (this.filePath) return this.filePath
    const workerUserDataPath = String(process.env.WEFLOW_USER_DATA_PATH || process.env.WEFLOW_CONFIG_CWD || '').trim()
    const userDataPath = workerUserDataPath || app?.getPath?.('userData') || process.cwd()
    fs.mkdirSync(userDataPath, { recursive: true })
    this.filePath = path.join(userDataPath, 'weflow-message-alert-records.json')
    return this.filePath
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    const filePath = this.resolveFilePath()
    try {
      if (!fs.existsSync(filePath)) return
      const raw = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed?.records)) {
        this.records = parsed.records.filter((item: unknown) => item && typeof item === 'object') as MessageAlertRecord[]
      } else if (Array.isArray(parsed)) {
        this.records = parsed.filter((item) => item && typeof item === 'object') as MessageAlertRecord[]
      }
    } catch {
      this.records = []
    }
  }

  private persist(): void {
    try {
      const filePath = this.resolveFilePath()
      fs.writeFileSync(filePath, JSON.stringify({ version: 1, records: this.records }, null, 2), 'utf-8')
    } catch {
      // 记录持久化失败不应阻塞实时监控
    }
  }

  private getCurrentAccountScope(): string {
    const config = ConfigService.getInstance()
    const myWxid = String(config.getMyWxidCleaned() || '').trim()
    if (myWxid) return `wxid:${myWxid}`

    const dbPath = String(config.get('dbPath') || '').trim()
    if (dbPath) {
      const hash = createHash('sha1').update(dbPath).digest('hex').slice(0, 16)
      return `db:${hash}`
    }
    return 'default'
  }

  private getStartOfToday(): number {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }

  private getScopedRecords(): MessageAlertRecord[] {
    this.ensureLoaded()
    const scope = this.getCurrentAccountScope()
    return this.records.filter((record) => record.accountScope === scope)
  }

  addRecord(input: {
    event: MessageAlertEvent
    sessionId: string
    sessionType: MessageAlertSessionType
    groupName?: string
    sourceName: string
    avatarUrl?: string
    content: string
    timestamp: number
    matchType?: MessageAlertMatchType
    matchedKeywords: string[]
    matchedRegex: boolean
    aiReason?: string
    aiSummary?: string
    sound?: boolean
  }): MessageAlertRecord {
    this.ensureLoaded()
    const scope = this.getCurrentAccountScope()
    const record: MessageAlertRecord = {
      id: randomUUID(),
      accountScope: scope,
      createdAt: Date.now(),
      event: input.event,
      sessionId: input.sessionId,
      sessionType: input.sessionType,
      groupName: input.groupName,
      sourceName: input.sourceName,
      avatarUrl: input.avatarUrl,
      content: input.content,
      timestamp: input.timestamp,
      matchType: input.matchType || 'rule',
      matchedKeywords: Array.isArray(input.matchedKeywords) ? input.matchedKeywords : [],
      matchedRegex: Boolean(input.matchedRegex),
      aiReason: input.aiReason,
      aiSummary: input.aiSummary,
      sound: input.sound
    }

    this.records.push(record)
    const scopedRecords = this.records
      .filter((item) => item.accountScope === scope)
      .sort((a, b) => b.createdAt - a.createdAt)
    const keepIds = new Set(scopedRecords.slice(0, this.maxRecordsPerScope).map((item) => item.id))
    this.records = this.records.filter((item) => item.accountScope !== scope || keepIds.has(item.id))
    this.persist()
    return record
  }

  listRecords(filters: MessageAlertRecordFilters = {}): MessageAlertListResult {
    try {
      const allScoped = this.getScopedRecords()
      const todayStart = this.getStartOfToday()

      const sessionsMap = new Map<string, MessageAlertSessionFacet>()
      const keywordsMap = new Map<string, number>()
      for (const record of allScoped) {
        const displayName = record.groupName || record.sourceName || record.sessionId
        const existing = sessionsMap.get(record.sessionId)
        if (existing) {
          existing.count += 1
        } else {
          sessionsMap.set(record.sessionId, {
            sessionId: record.sessionId,
            displayName,
            avatarUrl: record.avatarUrl,
            count: 1
          })
        }
        for (const keyword of record.matchedKeywords || []) {
          keywordsMap.set(keyword, (keywordsMap.get(keyword) || 0) + 1)
        }
      }

      const keyword = String(filters.keyword || '').trim().toLowerCase()
      const sessionId = String(filters.sessionId || '').trim()
      const startTime = Number(filters.startTime || 0)
      const endTime = Number(filters.endTime || 0)
      const offset = Math.max(0, Math.floor(Number(filters.offset || 0)))
      const limit = Math.min(500, Math.max(1, Math.floor(Number(filters.limit || 200))))

      const filtered = allScoped
        .filter((record) => {
          if (sessionId && record.sessionId !== sessionId) return false
          if (startTime > 0 && record.createdAt < startTime) return false
          if (endTime > 0 && record.createdAt > endTime) return false
          if (keyword) {
            const haystack = [
              record.sourceName,
              record.groupName,
              record.sessionId,
              record.content,
              (record.matchedKeywords || []).join(' ')
            ].join('\n').toLowerCase()
            if (!haystack.includes(keyword)) return false
          }
          return true
        })
        .sort((a, b) => b.createdAt - a.createdAt)

      return {
        success: true,
        records: filtered.slice(offset, offset + limit),
        total: filtered.length,
        todayCount: allScoped.filter((record) => record.createdAt >= todayStart).length,
        sessions: Array.from(sessionsMap.values()).sort((a, b) => b.count - a.count),
        keywords: Array.from(keywordsMap.entries())
          .map(([kw, count]) => ({ keyword: kw, count }))
          .sort((a, b) => b.count - a.count)
      }
    } catch (error) {
      return {
        success: false,
        records: [],
        total: 0,
        todayCount: 0,
        sessions: [],
        keywords: [],
        error: (error as Error).message
      }
    }
  }

  clearRecords(filters: MessageAlertRecordFilters = {}): { success: boolean; removed: number; error?: string } {
    this.ensureLoaded()
    const scope = this.getCurrentAccountScope()
    const sessionId = String(filters.sessionId || '').trim()
    const startTime = Number(filters.startTime || 0)
    const endTime = Number(filters.endTime || 0)
    let removed = 0
    this.records = this.records.filter((record) => {
      if (record.accountScope !== scope) return true
      if (sessionId && record.sessionId !== sessionId) return true
      if (startTime > 0 && record.createdAt < startTime) return true
      if (endTime > 0 && record.createdAt > endTime) return true
      removed += 1
      return false
    })
    this.persist()
    return { success: true, removed }
  }
}

export const messageAlertRecordService = new MessageAlertRecordService()
