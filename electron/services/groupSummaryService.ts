import https from 'https'
import http from 'http'
import { URL } from 'url'
import { ConfigService } from './config'
import { chatService, type Message } from './chatService'
import { wcdbService } from './wcdbService'
import {
  groupSummaryRecordService,
  type GroupSummaryLog,
  type GroupSummaryRecord,
  type GroupSummaryRecordFilters,
  type GroupSummaryRecordListResult,
  type GroupSummaryRecordSummary,
  type GroupSummaryCustomSectionItem,
  type GroupSummaryCustomSection,
  type GroupSummaryDigest,
  type GroupSummaryTopic,
  type GroupSummaryTriggerType,
  type GroupSummaryDelivery
} from './groupSummaryRecordService'
import { wecomWebhookService, type WeComPushFormat } from './wecomWebhookService'
import { renderGroupSummaryImages } from './groupSummaryImageRenderer'
import {
  buildGroupSummaryTimePeriodsFromInterval,
  normalizeGroupSummaryTimePeriods,
  timeToMinutes,
  validateGroupSummaryTimePeriods,
  type GroupSummaryTimePeriod
} from '../../shared/groupSummarySchedule'
import { repairGroupSummaryJson } from '../../shared/groupSummaryJsonRepair'

const API_TIMEOUT_MS = 90_000
const API_TEMPERATURE = 0.4
const MIN_SUMMARY_MESSAGES = 5
const MAX_MANUAL_RANGE_SECONDS = 48 * 60 * 60
const MAX_MESSAGES_PER_SUMMARY = 3000
const SUMMARY_CURSOR_BATCH_SIZE = 360
const GROUP_SUMMARY_OUTPUT_CONTRACT = `【WeFlow 最终输出格式】
无论前文是否要求 Markdown，最终都必须只输出一个可解析的 JSON 对象，不要使用代码块。
固定字段：
{
  "overview": "本期总览",
  "important_reminders": ["重要提醒"],
  "topics": [{
    "title": "主题标题",
    "time_range": "时间范围",
    "participants": ["参与者"],
    "key_points": ["关键内容"],
    "quotes": [{"speaker": "说话者", "text": "原话"}],
    "conclusion": "结论"
  }],
  "action_items": [{"task": "行动项", "owner": "负责人", "deadline": "截止时间"}],
  "unresolved_issues": [{"problem": "问题", "raised_by": "提出者", "status": "状态", "solution": "方案"}],
  "member_highlights": [{"name": "成员", "role": "角色", "observations": ["观察"]}],
  "custom_sections": [
    {"title": "商机雷达", "items": [{"title": "需求或机会标题", "fields": [{"label": "类型", "value": "明确需求/潜在需求"}, {"label": "提出者", "value": "发言人"}, {"label": "原话", "value": "逐字原话或保留原意的节选"}, {"label": "强度", "value": "高/中/低"}, {"label": "价值说明", "value": "为什么值得关注"}]}]},
    {"title": "信息差地图", "items": [{"title": "信息差线索标题", "fields": [{"label": "少数人掌握", "value": "信息内容"}, {"label": "多数人可能忽略", "value": "盲区"}, {"label": "来源", "value": "发言人或原始依据"}, {"label": "可信度", "value": "高/中/低"}, {"label": "价值说明", "value": "可带来的判断或行动"}]}]},
    {"title": "趋势观察", "items": [{"title": "趋势标题", "fields": [{"label": "方向", "value": "升温/稳定/降温"}, {"label": "依据", "value": "来自群聊的理由"}]}]},
    {"title": "蛋仔趣闻", "items": [{"title": "趣闻标题", "fields": [{"label": "发言人", "value": "昵称"}, {"label": "原话", "value": "逐字原话"}, {"label": "看点", "value": "为什么有代表性或有趣"}]}]},
    {"title": "明日关注", "items": ["未来需要继续观察的事项"]}
  ]
}
custom_sections 用于“蛋仔日报”的正反面图片：商机雷达、信息差地图、趋势观察、蛋仔趣闻、明日关注等栏目应按材料质量输出；没有合格材料时允许为空数组或省略对应栏目，不要为凑数编造。每个条目应提炼一个 title，并把提出者、原始依据、来源、可信度、商业价值、影响、原因、建议动作、下一步等拆进 fields，不要揉成一个长字符串。直接引用必须来自原始群聊，不能改写成不存在的句子。`
const GROUP_SUMMARY_JSON_REPAIR_PROMPT = `你是 JSON 修复器。请把用户提供的群聊总结修复为一个完整、可被 JSON.parse 解析的 JSON 对象。
只修复 JSON 语法，不删减、不改写、不新增事实。尤其检查对象中缺少键名的字符串、尾随逗号、未转义引号和括号不匹配。
只输出修复后的 JSON 对象，不要使用 Markdown 代码块，不要解释。`
type GroupSummaryPushFormat = WeComPushFormat | 'image'
const normalizePushFormat = (value: unknown): GroupSummaryPushFormat => value === 'text' || value === 'markdown_v2' || value === 'image' ? value : 'markdown'
const SUMMARY_CONFIG_KEYS = new Set([
  'aiGroupSummaryEnabled',
  'aiGroupSummaryIntervalHours',
  'aiGroupSummaryTimePeriods',
  'aiGroupSummaryFilterMode',
  'aiGroupSummaryFilterList',
  'aiGroupSummaryWeComEnabled',
  'aiGroupSummaryWeComSendAuto',
  'aiGroupSummaryWeComSendManual',
  'aiGroupSummaryWeComMentionAll',
  'aiGroupSummaryWeComBots',
  'aiModelApiBaseUrl',
  'aiModelApiKey',
  'aiModelApiModel',
  'aiInsightApiBaseUrl',
  'aiInsightApiKey',
  'aiInsightApiModel',
  'dbPath',
  'decryptKey',
  'myWxid'
])

interface SharedAiModelConfig {
  apiBaseUrl: string
  apiKey: string
  model: string
}

interface ConfiguredWeComBot {
  id?: string
  name?: string
  webhook: string
  mode?: 'manual' | 'auto' | 'both'
  enabled?: boolean
  mentionAll?: boolean
  prompt?: string
  frequencyHours?: number
  scheduleMode?: 'global' | 'custom'
  timePeriods?: GroupSummaryTimePeriod[]
  scope?: 'all' | 'selected'
  scopeIds: string[]
  format?: GroupSummaryPushFormat
  aiApiBaseUrl?: string
  aiApiKey?: string
  aiModel?: string
  titleColor?: 'info' | 'comment' | 'warning'
  titleBold?: boolean
  sectionTitleBold?: boolean
  groupOverrides?: Record<string, { title?: string; badge?: string; badgeColor?: 'info' | 'comment' | 'warning' }>
}

interface GroupSummaryTriggerResult {
  success: boolean
  message: string
  recordId?: string
  record?: GroupSummaryRecordSummary
  skipped?: boolean
  skippedReason?: string
}

interface GroupSummaryDayTriggerResult {
  success: boolean
  message: string
  generated: number
  skipped: number
  records: GroupSummaryRecordSummary[]
}

class ApiRequestError extends Error {
  statusCode?: number
  responseBody?: string

  constructor(message: string, statusCode?: number, responseBody?: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.statusCode = statusCode
    this.responseBody = responseBody
  }
}

function buildApiUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}

function normalizeSessionIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)))
}

function normalizeIntervalHours(value: unknown): number {
  const allowed = new Set([1, 2, 4, 8, 12, 24])
  const numeric = Math.floor(Number(value) || 4)
  return allowed.has(numeric) ? numeric : 4
}

function getStartOfDaySeconds(date: Date = new Date()): number {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return Math.floor(next.getTime() / 1000)
}

function clampText(value: unknown, maxLength: number): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`
}

function stripJsonFence(value: string): string {
  const text = String(value || '').trim()
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced) return fenced[1].trim()
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim()
  }
  return text
}

function shouldFallbackJsonMode(error: unknown): boolean {
  const statusCode = (error as ApiRequestError)?.statusCode
  if (statusCode === 400 || statusCode === 404 || statusCode === 422) return true
  const text = `${(error as Error)?.message || ''}\n${(error as ApiRequestError)?.responseBody || ''}`.toLowerCase()
  return text.includes('response_format') || text.includes('json_object') || text.includes('json mode')
}

function formatTimestamp(createTime: number): string {
  const ms = createTime > 1_000_000_000_000 ? createTime : createTime * 1000
  const date = new Date(ms)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

function callChatCompletions(
  apiBaseUrl: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  options?: { responseFormatJson?: boolean }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const endpoint = buildApiUrl(apiBaseUrl, '/chat/completions')
    let urlObj: URL
    try {
      urlObj = new URL(endpoint)
    } catch {
      reject(new Error(`无效的 API URL: ${endpoint}`))
      return
    }

    const payload: Record<string, unknown> = {
      model,
      messages,
      temperature: API_TEMPERATURE,
      stream: false
    }
    if (options?.responseFormatJson) {
      payload.response_format = { type: 'json_object' }
    }

    const body = JSON.stringify(payload)
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST' as const,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body).toString(),
        Authorization: `Bearer ${apiKey}`
      }
    }

    const requestFn = urlObj.protocol === 'https:' ? https.request : http.request
    const req = requestFn(requestOptions, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new ApiRequestError(`API 请求失败 (${res.statusCode}): ${data.slice(0, 200)}`, res.statusCode, data))
            return
          }
          const parsed = JSON.parse(data)
          const content = parsed?.choices?.[0]?.message?.content
          if (typeof content === 'string' && content.trim()) {
            resolve(content.trim())
          } else {
            reject(new Error(`API 返回格式异常: ${data.slice(0, 200)}`))
          }
        } catch {
          reject(new Error(`JSON 解析失败: ${data.slice(0, 200)}`))
        }
      })
    })

    req.setTimeout(API_TIMEOUT_MS, () => {
      req.destroy()
      reject(new Error('API 请求超时'))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function normalizeStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => clampText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems)
}

const CUSTOM_FIELD_LABELS: Record<string, string> = {
  proposer: '提出者',
  raised_by: '提出者',
  original_evidence: '原始依据',
  evidence: '依据',
  source: '来源',
  clue_source: '线索来源',
  related_discussion: '相关讨论',
  discussion: '相关讨论',
  credibility: '可信度',
  confidence: '可信度',
  viral_potential: '爆款潜力',
  potential: '爆款潜力',
  potential_reasons: '潜力依据',
  viral_reason: '潜力依据',
  content_angle: '内容角度',
  suggested_angle: '内容角度',
  suitable_format: '适合形式',
  verification_note: '核实提醒',
  opportunity_level: '商机等级',
  business_value: '商业价值',
  possible_value: '可能价值',
  value: '可能价值',
  impact: '影响与启示',
  insight: '影响与启示',
  reason: '原因',
  why_it_matters: '为什么值得注意',
  type: '可能类型',
  content_type: '可能类型',
  next_step: '下一步建议',
  suggested_action: '建议动作',
  action: '建议动作',
  possible_solution: '可能的解决方案',
  solution: '可能的解决方案',
  trigger: '触发条件',
  owner: '负责人',
  deadline: '截止时间'
}

function normalizeCustomFieldLabel(value: unknown): string {
  const key = String(value || '').trim()
  return clampText(CUSTOM_FIELD_LABELS[key] || key.replace(/_/g, ' '), 24)
}

function normalizeCustomSectionItem(value: unknown): string | GroupSummaryCustomSectionItem {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return clampText(value, 360)
  }
  if (!value || typeof value !== 'object') return ''
  const source = value as Record<string, unknown>
  const leadKeys = ['title', 'name', 'need', 'clue', 'trend', 'topic', 'content', 'task']
  const leadKey = leadKeys.find((key) => source[key] !== undefined)
  const lead = leadKey ? clampText(source[leadKey], 120) : ''
  const explicitFields = Array.isArray(source.fields)
    ? source.fields.map((field) => {
        const entry = field && typeof field === 'object' ? field as Record<string, unknown> : {}
        return {
          label: normalizeCustomFieldLabel(entry.label),
          value: formatCustomSectionValue(entry.value)
        }
      }).filter((field) => field.label && field.value)
    : []
  const inferredFields = Object.entries(source)
    .filter(([key, item]) => key !== leadKey && key !== 'fields' && item !== undefined && item !== null && item !== '')
    .map(([key, item]) => ({
      label: normalizeCustomFieldLabel(key),
      value: formatCustomSectionValue(item)
    }))
    .filter((field) => field.label && field.value)
  const fields = [...explicitFields, ...inferredFields].slice(0, 10)
  const title = lead || (fields.length > 0 ? fields[0].value : '')
  if (!title) return ''
  return {
    title,
    fields: lead ? fields : fields.slice(1)
  }
}

function formatCustomSectionValue(value: unknown, depth = 0): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return clampText(value, depth === 0 ? 240 : 160)
  }
  if (depth >= 2) return ''
  if (Array.isArray(value)) {
    return clampText(value.map((item) => formatCustomSectionValue(item, depth + 1)).filter(Boolean).join('；'), 300)
  }
  if (typeof value === 'object') {
    return clampText(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        const text = formatCustomSectionValue(item, depth + 1)
        return text ? `${key}：${text}` : ''
      })
      .filter(Boolean)
      .join('；'), 300)
  }
  return ''
}

function normalizeCustomSections(value: unknown): GroupSummaryCustomSection[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const section = item && typeof item === 'object' ? item as Record<string, unknown> : {}
      const rawItems = Array.isArray(section.items)
        ? section.items
        : (typeof section.content === 'string' ? section.content.split(/\r?\n/).filter(Boolean) : [])
      return {
        title: clampText(section.title, 64),
        items: rawItems.map(normalizeCustomSectionItem).filter(Boolean).slice(0, 20)
      }
    })
    .filter((section) => section.title && section.items.length > 0)
    .slice(0, 16)
}

const FIXED_SUMMARY_KEYS = new Set([
  'overview',
  'important_reminders',
  'importantReminders',
  'topics',
  'action_items',
  'actionItems',
  'unresolved_issues',
  'unresolvedIssues',
  'member_highlights',
  'memberHighlights',
  'custom_sections',
  'customSections'
])

const CUSTOM_SECTION_TITLE_ALIASES: Record<string, string> = {
  topic_radar: '选题雷达',
  content_radar: '选题雷达',
  viral_topics: '选题雷达',
  viral_topic_radar: '选题雷达',
  business_radar: '需求与商机雷达',
  opportunity_radar: '需求与商机雷达',
  information_gaps: '信息差与值得验证的线索',
  information_gap: '信息差与值得验证的线索',
  trends: '值得关注的趋势',
  notable_content: '有趣和值得收藏的内容',
  valuable_content: '有趣和值得收藏的内容',
  follow_ups: '建议继续关注',
  message_statistics: '消息统计补充',
  conclusion: '总结'
}

function normalizeImplicitCustomSections(source: Record<string, unknown>): GroupSummaryCustomSection[] {
  return Object.entries(source)
    .filter(([key, value]) => !FIXED_SUMMARY_KEYS.has(key) && value !== undefined && value !== null && value !== '')
    .map(([key, value]) => {
      const items = Array.isArray(value)
        ? value.map(normalizeCustomSectionItem).filter(Boolean)
        : (value && typeof value === 'object'
            ? Object.entries(value as Record<string, unknown>).map(([itemKey, itemValue]) =>
                normalizeCustomSectionItem({ title: itemKey, value: itemValue })
              ).filter(Boolean)
            : [clampText(value, 360)].filter(Boolean))
      return {
        title: clampText(CUSTOM_SECTION_TITLE_ALIASES[key] || key.replace(/_/g, ' '), 64),
        items: items.slice(0, 20)
      }
    })
    .filter((section) => section.title && section.items.length > 0)
}

function parseSummary(rawOutput: string): {
  topics: GroupSummaryTopic[]
  digest: Omit<GroupSummaryDigest, 'leaderboard' | 'coverageStart' | 'coverageEnd'>
  jsonRepairApplied: boolean
  jsonRepairReasons: string[]
  normalizedOutput: string
} {
  const jsonText = stripJsonFence(rawOutput)
  let normalizedOutput = jsonText
  let parsed: unknown
  let jsonRepairApplied = false
  let jsonRepairReasons: string[] = []
  try {
    parsed = JSON.parse(jsonText) as unknown
  } catch (initialError) {
    const repaired = repairGroupSummaryJson(jsonText)
    if (!repaired.changed) throw initialError
    parsed = JSON.parse(repaired.text) as unknown
    normalizedOutput = repaired.text
    jsonRepairApplied = true
    jsonRepairReasons = repaired.reasons
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('模型输出格式异常：JSON 根节点不是对象')
  }
  const source = parsed as Record<string, unknown>
  const rawTopics = Array.isArray(source.topics) ? source.topics : []
  const topics = rawTopics.map((item, index) => {
    const topic = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const participantsRaw = Array.isArray(topic.participants) ? topic.participants : []
    const keyPointsRaw = Array.isArray(topic.key_points)
      ? topic.key_points
      : (Array.isArray(topic.keyPoints) ? topic.keyPoints : [])
    return {
      title: clampText(topic.title || `话题 ${index + 1}`, 48) || `话题 ${index + 1}`,
      timeRange: clampText(topic.time_range || topic.timeRange, 32) || undefined,
      participants: participantsRaw.map((value) => clampText(value, 24)).filter(Boolean).slice(0, 12),
      keyPoints: keyPointsRaw.map((value) => clampText(value, 120)).filter(Boolean).slice(0, 8),
      quotes: (Array.isArray(topic.quotes) ? topic.quotes : []).map((item) => {
        const quote = item && typeof item === 'object' ? item as Record<string, unknown> : {}
        return { speaker: clampText(quote.speaker, 24), text: clampText(quote.text, 160) }
      }).filter((quote) => quote.speaker && quote.text).slice(0, 4),
      conclusion: clampText(topic.conclusion, 180) || '无明确结论'
    }
  }).filter((topic) => topic.title || topic.keyPoints.length > 0 || topic.conclusion)

  if (topics.length === 0) {
    throw new Error('模型输出格式异常：topics 为空')
  }
  const actionItemsSource = Array.isArray(source.action_items) ? source.action_items : source.actionItems
  const actionItems = (Array.isArray(actionItemsSource) ? actionItemsSource : []).map((item) => {
    const action = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    return { task: clampText(action.task, 160), owner: clampText(action.owner, 32), deadline: clampText(action.deadline, 48) }
  }).filter((item) => item.task).slice(0, 20)
  const unresolvedIssuesSource = Array.isArray(source.unresolved_issues) ? source.unresolved_issues : source.unresolvedIssues
  const unresolvedIssues = (Array.isArray(unresolvedIssuesSource) ? unresolvedIssuesSource : []).map((item) => {
    const issue = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    return {
      problem: clampText(issue.problem, 160),
      raisedBy: clampText(issue.raised_by || issue.raisedBy, 32),
      status: clampText(issue.status, 24) || '仍未解决',
      solution: clampText(issue.solution, 180) || '暂无方案'
    }
  }).filter((item) => item.problem).slice(0, 12)
  const memberHighlightsSource = Array.isArray(source.member_highlights) ? source.member_highlights : source.memberHighlights
  const memberHighlights = (Array.isArray(memberHighlightsSource) ? memberHighlightsSource : []).map((item) => {
    const member = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    return {
      name: clampText(member.name, 32),
      role: clampText(member.role, 48),
      observations: normalizeStringList(member.observations, 5, 140)
    }
  }).filter((item) => item.name && item.observations.length > 0).slice(0, 16)
  const customSections = [...normalizeCustomSections(source.custom_sections || source.customSections), ...normalizeImplicitCustomSections(source)]
    .filter((section, index, all) => all.findIndex((candidate) => candidate.title === section.title) === index)
    .slice(0, 16)

  return {
    topics,
    digest: {
      overview: clampText(source.overview, 800),
      importantReminders: normalizeStringList(source.important_reminders || source.importantReminders, 12, 180),
      actionItems,
      unresolvedIssues,
      memberHighlights,
      customSections
    },
    jsonRepairApplied,
    jsonRepairReasons,
    normalizedOutput
  }
}

function buildSummaryText(topics: GroupSummaryTopic[], digest: GroupSummaryDigest): string {
  const lines: string[] = []
  if (digest.overview) lines.push(digest.overview, '')
  if (digest.importantReminders.length > 0) {
    lines.push('重要提醒', ...digest.importantReminders.map((item) => `• ${item}`), '')
  }
  topics.forEach((topic) => {
    lines.push(`${topic.timeRange ? `${topic.timeRange} ` : ''}${topic.title}`)
    topic.keyPoints.forEach((point) => lines.push(`• ${point}`))
    topic.quotes?.forEach((quote) => lines.push(`• ${quote.speaker}：「${quote.text}」`))
    lines.push(`结论：${topic.conclusion}`, '')
  })
  if (digest.actionItems.length > 0) {
    lines.push('行动项', ...digest.actionItems.map((item) => `• ${item.task}${item.owner ? `｜负责人：${item.owner}` : ''}${item.deadline ? `｜截止：${item.deadline}` : ''}`), '')
  }
  if (digest.unresolvedIssues.length > 0) {
    lines.push('今日待解决问题')
    digest.unresolvedIssues.forEach((issue) => lines.push(`• ${issue.problem}｜${issue.status}｜${issue.solution}`))
    lines.push('')
  }
  for (const section of digest.customSections || []) {
    lines.push(section.title)
    section.items.forEach((item) => {
      if (typeof item === 'string') {
        lines.push(`• ${item}`)
        return
      }
      lines.push(`• ${item.title}`)
      item.fields.forEach((field) => lines.push(`  ${field.label}：${field.value}`))
    })
    lines.push('')
  }
  if (digest.leaderboard.length > 0) {
    lines.push(`消息统计：共 ${digest.leaderboard.reduce((sum, item) => sum + item.count, 0)} 条消息`)
    digest.leaderboard.slice(0, 10).forEach((item, index) => lines.push(`${index + 1}. ${item.name}: ${item.count} 条`))
    lines.push('')
  }
  if (digest.memberHighlights.length > 0) {
    lines.push('群友画像')
    digest.memberHighlights.forEach((member) => {
      lines.push(`${member.name}（${member.role || '本期活跃成员'}）`)
      member.observations.forEach((item) => lines.push(`• ${item}`))
    })
    lines.push('')
  }
  lines.push('本简报由 AI 自动生成')
  return lines.join('\n').trim()
}

function escapeMarkdownText(value: string): string {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\uFFFD/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
}

function buildWeComReport(params: {
  displayName: string
  periodStart: number
  periodEnd: number
  messageCount: number
  topics: GroupSummaryTopic[]
  digest: GroupSummaryDigest
  mentionAll: boolean
  title?: string
  badge?: string
  badgeColor?: 'info' | 'comment' | 'warning'
}): string {
  const lines = [
    `## ${escapeMarkdownText(params.title || `${params.displayName} 群聊报告`)}`,
    `> 时段：${formatTimestamp(params.periodStart)} 至 ${formatTimestamp(params.periodEnd)}`,
    `> 有效消息：${params.messageCount} 条`,
    ''
  ]
  if (params.digest.overview) lines.push(escapeMarkdownText(params.digest.overview), '')
  if (params.digest.importantReminders.length > 0) {
    // Keep the push layout aligned with the in-app digest: make reminders a
    // visually distinct callout instead of a plain list.
    lines.push('> **重要提醒**', ...params.digest.importantReminders.map((item) => `> - ${escapeMarkdownText(item)}`), '')
  }
  params.topics.forEach((topic, index) => {
    lines.push(`**${index + 1}. ${escapeMarkdownText(topic.title)}**`)
    if (topic.timeRange) lines.push(`时间范围：${escapeMarkdownText(topic.timeRange)}`)
    if (topic.participants.length > 0) lines.push(`参与者：${topic.participants.map(escapeMarkdownText).join('、')}`)
    topic.keyPoints.forEach((point) => lines.push(`- ${escapeMarkdownText(point)}`))
    topic.quotes?.forEach((quote) => {
      lines.push(`> “${escapeMarkdownText(quote.text)}”`, `> ——${escapeMarkdownText(quote.speaker)}`)
    })
    lines.push(`结论：${escapeMarkdownText(topic.conclusion)}`, '')
  })
  if (params.digest.actionItems.length > 0) {
    lines.push('**行动项**')
    params.digest.actionItems.forEach((item) => lines.push(`- ${escapeMarkdownText(item.task)}${item.owner ? `｜负责人：${escapeMarkdownText(item.owner)}` : ''}${item.deadline ? `｜截止：${escapeMarkdownText(item.deadline)}` : ''}`))
    lines.push('')
  }
  if (params.digest.unresolvedIssues.length > 0) {
    lines.push('**待解决问题**')
    params.digest.unresolvedIssues.forEach((item) => lines.push(`- ${escapeMarkdownText(item.problem)}｜${escapeMarkdownText(item.status)}｜${escapeMarkdownText(item.solution)}`))
    lines.push('')
  }
  for (const section of params.digest.customSections || []) {
    lines.push(`**${escapeMarkdownText(section.title)}**`)
    section.items.forEach((item) => {
      if (typeof item === 'string') {
        lines.push(`- ${escapeMarkdownText(item)}`)
        return
      }
      lines.push(`- **${escapeMarkdownText(item.title)}**`)
      item.fields.forEach((field) => lines.push(`  - ${escapeMarkdownText(field.label)}：${escapeMarkdownText(field.value)}`))
    })
    lines.push('')
  }
  if (params.digest.leaderboard.length > 0) {
    lines.push(`**消息统计：共 ${params.messageCount} 条**`)
    params.digest.leaderboard.slice(0, 10).forEach((item, index) => {
      const name = escapeMarkdownText(item.name)
      const badge = params.badge || ''
      const label = index === 0 && badge ? `<font color="${params.badgeColor || 'warning'}">${escapeMarkdownText(badge)}｜${name}</font>` : name
      lines.push(`${index + 1}. ${label}：${item.count} 条`)
    })
    lines.push('')
  }
  if (params.mentionAll) lines.push('<@all>')
  return lines.join('\n').trim()
}

function buildStyledWeComReport(params: {
  displayName: string
  periodStart: number
  periodEnd: number
  messageCount: number
  topics: GroupSummaryTopic[]
  digest: GroupSummaryDigest
  mentionAll: boolean
  titleColor?: 'info' | 'comment' | 'warning'
  titleBold?: boolean
  sectionTitleBold?: boolean
  title?: string
  badge?: string
  badgeColor?: 'info' | 'comment' | 'warning'
}): string {
  const lines = buildWeComReport(params).split('\n')
  const title = lines[0].replace(/^##\s+/, '')
  const titleColor = params.titleColor || 'info'
  const titleBold = params.titleBold !== false
  lines[0] = `## <font color="${titleColor}">${titleBold ? '**' : ''}${title}${titleBold ? '**' : ''}</font>`
  if (params.sectionTitleBold === false) {
    return lines.map((line) => line.replace(/^\*\*(.+)\*\*$/, '$1')).join('\n').trim()
  }
  return lines.join('\n').trim()
}

function buildDanziDailyPushText(params: {
  title: string
  messageCount: number
  topics: GroupSummaryTopic[]
  digest: GroupSummaryDigest
  badge?: string
  mentionAll?: boolean
}): string {
  const customSections = params.digest.customSections || []
  const countSectionItems = (patterns: RegExp[]) => customSections
    .filter((section) => patterns.some((pattern) => pattern.test(section.title)))
    .reduce((sum, section) => sum + section.items.length, 0)
  const headline = params.topics[0]?.title || params.digest.overview || '今日群聊情报已生成'
  const dayNo = params.badge || ''
  const lines = [
    `🥚 **${escapeMarkdownText(params.title || '蛋仔日报')}${dayNo ? ` ${escapeMarkdownText(dayNo)}` : ''}**`,
    '',
    '今日发现：',
    `🔥 热点 ${params.topics.length} 个`,
    `💰 商机 ${countSectionItems([/商机|需求|雷达|opportunity|need/i])} 个`,
    `🧠 信息差 ${countSectionItems([/信息差|线索|验证|gap/i])} 条`,
    `😂 趣闻 ${countSectionItems([/趣闻|有趣|收藏|内容|fun|notable/i])} 条`,
    '',
    '今日头条：',
    escapeMarkdownText(headline)
  ]
  if (params.messageCount > 0) lines.splice(3, 0, `📨 消息 ${params.messageCount} 条`)
  if (params.mentionAll) lines.push('', '<@all>')
  return lines.join('\n').trim()
}

function fallbackTopicFromParseFailure(): GroupSummaryTopic {
  return {
    title: '总结生成异常',
    participants: [],
    keyPoints: ['模型返回的内容格式异常，自动修复与重试均未成功。完整原始内容已保留在日志中。'],
    conclusion: '本次未展示未经解析的 JSON 源码，请稍后重新生成。'
  }
}

class GroupSummaryService {
  private config: ConfigService
  private started = false
  private scanTimer: NodeJS.Timeout | null = null
  private processing = false
  private pendingAutoRun = false
  private dbConnected = false

  constructor() {
    this.config = ConfigService.getInstance()
  }

  private async getReportAvatarUrls(sessionId: string, periodStart: number, periodEnd: number): Promise<Record<string, string>> {
    try {
      const messages = await this.readMessagesInPeriod(sessionId, periodStart, periodEnd)
      const senderIds = Array.from(new Set(messages
        .map((message) => String(message.senderUsername || '').trim())
        .filter(Boolean)))
      if (senderIds.length === 0) return {}

      const contacts = (await chatService.enrichSessionsContactInfo(senderIds).catch(() => null))?.contacts || {}
      const myWxid = String(this.config.getMyWxidCleaned() || '').trim()
      const candidates = new Map<string, Set<string>>()

      for (const senderId of senderIds) {
        const contact = contacts[senderId] || {}
        const avatarUrl = String(contact.avatarUrl || '').trim()
        if (!avatarUrl) continue
        const names = new Set([
          senderId,
          String(contact.displayName || '').trim(),
          String((contact as any).nickname || '').trim(),
          String((contact as any).remark || '').trim(),
          String((contact as any).alias || '').trim(),
          senderId === myWxid ? '我' : ''
        ].filter(Boolean))
        for (const name of names) {
          const urls = candidates.get(name) || new Set<string>()
          urls.add(avatarUrl)
          candidates.set(name, urls)
        }
      }

      return Object.fromEntries(Array.from(candidates.entries())
        .filter(([, urls]) => urls.size === 1)
        .map(([name, urls]) => [name, Array.from(urls)[0]]))
    } catch (error) {
      console.warn('[GroupSummaryService] Failed to resolve report avatars:', error)
      return {}
    }
  }

  private async sendReportToBot(bot: ConfiguredWeComBot, params: {
    sessionId: string
    displayName: string
    periodStart: number
    periodEnd: number
    messageCount: number
    topics: GroupSummaryTopic[]
    digest: GroupSummaryDigest
  }) {
    const override = bot.groupOverrides?.[params.sessionId]
    const title = String(override?.title || '').trim() || `${params.displayName} 群聊报告`
    const format = normalizePushFormat(bot.format)
    if (format === 'image') {
      const imageTitle = String(override?.title || '').trim() || '蛋仔日报'
      const avatarUrls = await this.getReportAvatarUrls(params.sessionId, params.periodStart, params.periodEnd)
      const images = await renderGroupSummaryImages({
        title: imageTitle,
        period: `${formatTimestamp(params.periodStart)} 至 ${formatTimestamp(params.periodEnd)}`,
        messageCount: params.messageCount,
        topics: params.topics,
        digest: params.digest,
        badge: String(override?.badge || '').trim() || undefined,
        badgeColor: override?.badgeColor,
        avatarUrls
      })
      const textResult = await wecomWebhookService.send(bot.webhook, buildDanziDailyPushText({
        title: imageTitle,
        messageCount: params.messageCount,
        topics: params.topics,
        digest: params.digest,
        badge: String(override?.badge || '').trim() || undefined,
        mentionAll: bot.mentionAll === true
      }), 'markdown')
      if (!textResult.success) return textResult
      const imageResult = await wecomWebhookService.sendImages(bot.webhook, images)
      return {
        ...imageResult,
        partsSent: (textResult.partsSent || 0) + (imageResult.partsSent || 0),
        message: imageResult.success
          ? `蛋仔日报已发送（摘要 + ${images.length} 张图片）`
          : imageResult.message
      }
    }
    return wecomWebhookService.send(bot.webhook, buildStyledWeComReport({
      displayName: params.displayName,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      messageCount: params.messageCount,
      topics: params.topics,
      digest: params.digest,
      mentionAll: bot.mentionAll === true,
      titleColor: bot.titleColor,
      titleBold: bot.titleBold,
      sectionTitleBold: bot.sectionTitleBold,
      title: override?.title || undefined,
      badge: override?.badge || undefined,
      badgeColor: override?.badgeColor
    }), format)
  }

  async sendRecord(recordId: string, selectedBotNames: string[] = []): Promise<{ success: boolean; message: string; delivery?: GroupSummaryDelivery }> {
    const result = groupSummaryRecordService.getRecord(String(recordId || ''))
    if (!result.success || !result.record) return { success: false, message: result.error || '找不到这条总结' }
    const configuredBots = (() => { try { const value = JSON.parse(String(this.config.get('aiGroupSummaryWeComBots') || '[]')); return Array.isArray(value) ? value.filter((bot) => bot && bot.enabled !== false && bot.mode !== 'auto' && typeof bot.webhook === 'string' && String(bot.webhook).trim()) : [] } catch { return [] } })()
    const allBots = configuredBots
    const scopedBots = allBots.filter((bot) => {
      if (bot.scope !== 'selected') return true
      const scopeIds = Array.isArray(bot.scopeIds) ? bot.scopeIds.map((value) => String(value || '').trim()).filter(Boolean) : []
      return scopeIds.length === 0 || scopeIds.includes(String(result.record?.sessionId || '').trim())
    })
    const bots = selectedBotNames.length > 0
      ? scopedBots.filter((bot) => selectedBotNames.includes(String(bot.name || bot.webhook)))
      : scopedBots
    if (!this.config.get('aiGroupSummaryWeComEnabled')) return { success: false, message: '请先开启企业微信群推送' }
    if (allBots.length === 0) return { success: false, message: '请先配置并启用企业微信机器人' }
    if (bots.length === 0) return { success: false, message: '未选择有效的企业微信机器人' }
    if (!this.config.get('aiGroupSummaryWeComEnabled') || bots.length === 0) return { success: false, message: '请先配置并启用企业微信机器人' }
    const record = result.record
    const results = await Promise.all(bots.map((bot) => this.sendReportToBot(bot, {
        sessionId: record.sessionId,
        displayName: record.displayName,
        periodStart: record.periodStart,
        periodEnd: record.periodEnd,
        messageCount: record.readableMessageCount,
        topics: record.topics,
        digest: record.digest
      })))
    const failed = results
      .map((item, index) => ({ item, bot: bots[index] }))
      .filter(({ item }) => !item.success)
    const failureDetails = failed
      .map(({ item, bot }) => `${String(bot.name || '未命名机器人')}: ${String(item.message || '未知错误')}`)
      .join('；')
    const delivery: GroupSummaryDelivery = {
      channel: 'wecom-webhook',
      attemptedAt: Date.now(),
      success: failed.length === 0,
      message: failed.length === 0
        ? `已发送给 ${bots.length} 个机器人`
        : `${failed.length} 个机器人发送失败${failureDetails ? `：${failureDetails}` : ''}`,
      partsSent: results.reduce((sum, item) => sum + (item.partsSent || 0), 0)
    }
    groupSummaryRecordService.updateDelivery(record.id, delivery)
    return { success: delivery.success, message: delivery.message, delivery }
  }

  start(): void {
    if (this.started) return
    this.started = true
    void this.refreshConfiguration('startup')
  }

  stop(): void {
    this.started = false
    this.clearTimers()
    this.processing = false
    this.pendingAutoRun = false
    this.dbConnected = false
  }

  async handleConfigChanged(key: string): Promise<void> {
    const normalizedKey = String(key || '').trim()
    if (!SUMMARY_CONFIG_KEYS.has(normalizedKey)) return
    if (normalizedKey === 'dbPath' || normalizedKey === 'decryptKey' || normalizedKey === 'myWxid') {
      this.dbConnected = false
      groupSummaryRecordService.clearRuntimeCache()
    }
    await this.refreshConfiguration(`config:${normalizedKey}`)
  }

  handleConfigCleared(): void {
    this.clearTimers()
    this.processing = false
    this.pendingAutoRun = false
    this.dbConnected = false
    groupSummaryRecordService.clearRuntimeCache()
  }

  listRecords(filters?: GroupSummaryRecordFilters): GroupSummaryRecordListResult {
    return groupSummaryRecordService.listRecords(filters || {})
  }

  getRecord(id: string): { success: boolean; record?: GroupSummaryRecord; error?: string } {
    return groupSummaryRecordService.getRecord(id)
  }

  async triggerManual(params: {
    sessionId: string
    displayName?: string
    avatarUrl?: string
    startTime: number
    endTime: number
    targetSenderName?: string
    botName?: string
  }): Promise<GroupSummaryTriggerResult> {
    if (!this.isEnabled()) {
      return { success: false, message: '请先在设置中开启「AI 群聊总结」' }
    }
    const sessionId = String(params?.sessionId || '').trim()
    if (!sessionId.endsWith('@chatroom')) {
      return { success: false, message: 'AI 群聊总结仅支持群聊' }
    }
    const startTime = this.normalizeTimestampSeconds(params?.startTime)
    const endTime = this.normalizeTimestampSeconds(params?.endTime)
    if (startTime <= 0 || endTime <= startTime) {
      return { success: false, message: '请选择有效的总结时段' }
    }
    if (endTime - startTime > MAX_MANUAL_RANGE_SECONDS) {
      return { success: false, message: '手动总结时段不能超过 48 小时' }
    }

    const rawDisplayName = typeof params?.displayName === 'string' ? params.displayName : ''
    const displayName = rawDisplayName.length > 0 ? (rawDisplayName.trim() || rawDisplayName) : sessionId
    const avatarUrl = String(params?.avatarUrl || '').trim() || undefined
    return this.generateSummaryForPeriod({
      sessionId,
      displayName,
      avatarUrl,
      periodStart: startTime,
      periodEnd: endTime,
      triggerType: 'manual'
      ,targetSenderName: String(params.targetSenderName || '').trim() || undefined
      ,botName: String(params.botName || '').trim() || undefined
    })
  }

  async triggerDay(params: {
    sessionId: string
    displayName?: string
    avatarUrl?: string
    date: string
    intervalHours?: number
    botName?: string
  }): Promise<GroupSummaryDayTriggerResult> {
    if (!this.isEnabled()) {
      return { success: false, message: '请先在设置中开启「AI 群聊总结」', generated: 0, skipped: 0, records: [] }
    }
    const sessionId = String(params?.sessionId || '').trim()
    if (!sessionId.endsWith('@chatroom')) {
      return { success: false, message: 'AI 群聊总结仅支持群聊', generated: 0, skipped: 0, records: [] }
    }
    const dayRange = this.parseLocalDateDayRange(params?.date)
    if (!dayRange) {
      return { success: false, message: '请选择有效日期', generated: 0, skipped: 0, records: [] }
    }
    const todayStart = getStartOfDaySeconds(new Date())
    if (dayRange.start > todayStart) {
      return { success: false, message: '不能总结未来日期', generated: 0, skipped: 0, records: [] }
    }

    const now = Math.floor(Date.now() / 1000)
    const effectiveEnd = dayRange.start === todayStart ? Math.min(dayRange.end, now) : dayRange.end
    const requestedInterval = normalizeIntervalHours(params?.intervalHours)
    const periods = this.getIntervalPeriods(dayRange.start, effectiveEnd, false, requestedInterval)
    if (periods.length === 0) {
      return { success: true, message: '当前日期暂无已完成的总结时段', generated: 0, skipped: 0, records: [] }
    }

    const rawDisplayName = typeof params?.displayName === 'string' ? params.displayName : ''
    const displayName = rawDisplayName.length > 0 ? (rawDisplayName.trim() || rawDisplayName) : sessionId
    const avatarUrl = String(params?.avatarUrl || '').trim() || undefined
    return this.generateSummariesForPeriods({
      sessionId,
      displayName,
      avatarUrl,
      periods,
      triggerType: 'manual',
      botName: String(params.botName || '').trim() || undefined
    })
  }

  private async refreshConfiguration(_reason: string): Promise<void> {
    if (!this.started) return
    this.clearTimers()
    this.pendingAutoRun = false
    if (!this.isEnabled()) return
    // 配置保存或应用启动只负责重建未来的定时器。不要在这里补扫已经
    // 结束的时段，否则修改机器人、作用群或推送样式会立即重发报告。
    // 到达下一个自然时段边界时，scheduleNextAutoRun 的回调会正常生成。
    this.scheduleNextAutoRun()
  }

  private isEnabled(): boolean {
    return this.config.get('aiGroupSummaryEnabled') === true
  }

  private clearTimers(): void {
    if (this.scanTimer !== null) {
      clearTimeout(this.scanTimer)
      this.scanTimer = null
    }
  }

  private scheduleNextAutoRun(): void {
    if (!this.started || !this.isEnabled()) return
    const now = Math.floor(Date.now() / 1000)
    const nextBoundary = this.getNextAutoBoundarySeconds(now)
    if (nextBoundary === null) return
    const delayMs = Math.max(1_000, (nextBoundary - now) * 1000 + 1_000)

    this.scanTimer = setTimeout(async () => {
      this.scanTimer = null
      await this.queueDueAutoSummaries()
      this.scheduleNextAutoRun()
    }, delayMs)
  }

  private async ensureConnected(): Promise<boolean> {
    if (this.dbConnected) return true
    const result = await chatService.connect()
    this.dbConnected = result.success === true
    return this.dbConnected
  }

  private getSharedAiModelConfig(): SharedAiModelConfig {
    const apiBaseUrl = String(
      this.config.get('aiModelApiBaseUrl')
      || this.config.get('aiInsightApiBaseUrl')
      || ''
    ).trim()
    const apiKey = String(
      this.config.get('aiModelApiKey')
      || this.config.get('aiInsightApiKey')
      || ''
    ).trim()
    const model = String(
      this.config.get('aiModelApiModel')
      || this.config.get('aiInsightApiModel')
      || 'gpt-4o-mini'
    ).trim() || 'gpt-4o-mini'
    return { apiBaseUrl, apiKey, model }
  }

  private getAiModelConfigForBot(bot?: ConfiguredWeComBot): SharedAiModelConfig {
    const shared = this.getSharedAiModelConfig()
    return {
      apiBaseUrl: String(bot?.aiApiBaseUrl || '').trim() || shared.apiBaseUrl,
      apiKey: String(bot?.aiApiKey || '').trim() || shared.apiKey,
      model: String(bot?.aiModel || '').trim() || shared.model
    }
  }

  private getAutoScopeSessionIds(autoBots = this.getConfiguredWeComBots().filter((bot) => bot.mode === 'auto' || bot.mode === 'both')): string[] {
    const globalScope = normalizeSessionIdList(this.config.get('aiGroupSummaryFilterList'))
      .filter((sessionId) => sessionId.endsWith('@chatroom'))
    const botScope = autoBots.flatMap((bot) => bot.scope === 'selected' ? bot.scopeIds : [])
      .filter((sessionId) => sessionId.endsWith('@chatroom'))
    return Array.from(new Set([...globalScope, ...botScope]))
  }

  private getConfiguredWeComBots(): ConfiguredWeComBot[] {
    try {
      const value = JSON.parse(String(this.config.get('aiGroupSummaryWeComBots') || '[]'))
      const configured = Array.isArray(value) ? value
        .filter((bot) => bot && bot.enabled !== false && typeof bot.webhook === 'string' && String(bot.webhook).trim())
        .map((bot) => ({
          id: String(bot.id || '').trim() || undefined,
          name: String(bot.name || '').trim() || undefined,
          webhook: String(bot.webhook).trim(),
          mode: bot.mode === 'auto' || bot.mode === 'both' ? bot.mode : 'manual',
          enabled: bot.enabled !== false,
          mentionAll: bot.mentionAll === true,
          prompt: String(bot.prompt || '').trim(),
          frequencyHours: Math.max(1 / 60, Number(bot.frequencyHours) || normalizeIntervalHours(this.config.get('aiGroupSummaryIntervalHours'))),
          scheduleMode: bot.scheduleMode === 'custom' ? 'custom' : 'global',
          timePeriods: normalizeGroupSummaryTimePeriods(bot.timePeriods),
          scope: bot.scope === 'selected' ? 'selected' : 'all',
          scopeIds: Array.isArray(bot.scopeIds) ? bot.scopeIds.map((id: unknown) => String(id || '').trim()).filter(Boolean) : [],
          format: normalizePushFormat(bot.format),
          aiApiBaseUrl: String(bot.aiApiBaseUrl || '').trim() || undefined,
          aiApiKey: String(bot.aiApiKey || '').trim() || undefined,
          aiModel: String(bot.aiModel || '').trim() || undefined,
          titleColor: bot.titleColor === 'comment' || bot.titleColor === 'warning' ? bot.titleColor : 'info',
          titleBold: bot.titleBold !== false,
          sectionTitleBold: bot.sectionTitleBold !== false,
          groupOverrides: bot.groupOverrides && typeof bot.groupOverrides === 'object' ? bot.groupOverrides : {}
        })) : []
      return configured
    } catch {
      return []
    }
  }

  private isBotScopeMatch(bot: { scope?: 'all' | 'selected'; scopeIds: string[] }, sessionId: string): boolean {
    return bot.scope !== 'selected' || bot.scopeIds.length === 0 || bot.scopeIds.includes(sessionId)
  }

  private getSummaryBot(sessionId: string, botName?: string): ConfiguredWeComBot | undefined {
    const matchingBots = this.getConfiguredWeComBots()
      .filter((bot) => this.isBotScopeMatch(bot, sessionId) && String(bot.prompt || '').trim())
    const requested = String(botName || '').trim()
    if (requested) {
      const named = matchingBots.find((bot) => [bot.id, bot.name, bot.webhook].some((value) => String(value || '').trim() === requested))
      if (named) return named
    }
    return matchingBots.find((bot) => bot.scope === 'selected' && bot.scopeIds.includes(sessionId)) || matchingBots[0]
  }

  private async deliverAutoSummary(params: {
    sessionId: string
    displayName: string
    periodStart: number
    periodEnd: number
    messageCount: number
    topics: GroupSummaryTopic[]
    digest: GroupSummaryDigest
    bot: ConfiguredWeComBot
  }): Promise<GroupSummaryDelivery | undefined> {
    if (this.config.get('aiGroupSummaryWeComEnabled') !== true || this.config.get('aiGroupSummaryWeComSendAuto') !== true) return undefined
    const bots = [params.bot]

    const targets: NonNullable<GroupSummaryDelivery['targets']> = []
    for (const bot of bots) {
      const result = await this.sendReportToBot(bot, {
        sessionId: params.sessionId,
        displayName: params.displayName,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        messageCount: params.messageCount,
        topics: params.topics,
        digest: params.digest
      })
      targets.push({ name: bot.name || '未命名机器人', success: result.success, message: result.message, partsSent: result.partsSent })
    }
    const failed = targets.filter((target) => !target.success)
    return {
      channel: 'wecom-webhook',
      attemptedAt: Date.now(),
      success: failed.length === 0,
      message: failed.length === 0
        ? `已自动发送给 ${targets.length} 个机器人`
        : `${failed.length} 个机器人自动发送失败：${failed.map((target) => `${target.name}: ${target.message}`).join('；')}`,
      partsSent: targets.reduce((sum, target) => sum + (target.partsSent || 0), 0),
      targets
    }
  }

  private normalizeTimestampSeconds(value: unknown): number {
    const numeric = Number(value || 0)
    if (!Number.isFinite(numeric) || numeric <= 0) return 0
    let normalized = Math.floor(numeric)
    while (normalized > 10000000000) {
      normalized = Math.floor(normalized / 1000)
    }
    return normalized
  }

  private parseLocalDateDayRange(value: unknown): { start: number; end: number } | null {
    const text = String(value || '').trim()
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!match) return null
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const start = new Date(year, month - 1, day, 0, 0, 0, 0)
    if (
      !Number.isFinite(start.getTime()) ||
      start.getFullYear() !== year ||
      start.getMonth() !== month - 1 ||
      start.getDate() !== day
    ) {
      return null
    }
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return {
      start: Math.floor(start.getTime() / 1000),
      end: Math.floor(end.getTime() / 1000)
    }
  }

  private getIntervalPeriods(startTime: number, endTime: number, includePartial: boolean, intervalHoursOverride?: number): Array<{ start: number; end: number }> {
    const intervalHours = normalizeIntervalHours(intervalHoursOverride || this.config.get('aiGroupSummaryIntervalHours'))
    const intervalSeconds = intervalHours * 60 * 60
    const periods: Array<{ start: number; end: number }> = []
    for (let start = startTime; start < endTime; start += intervalSeconds) {
      const end = Math.min(start + intervalSeconds, endTime)
      if (!includePartial && end - start < intervalSeconds) continue
      if (end > start) periods.push({ start, end })
    }
    return periods
  }

  private getConfiguredTimePeriods(): GroupSummaryTimePeriod[] {
    const configured = this.config.get('aiGroupSummaryTimePeriods')
    if (Array.isArray(configured)) {
      const normalized = normalizeGroupSummaryTimePeriods(configured)
      const validation = validateGroupSummaryTimePeriods(normalized)
      if (!validation.valid || normalized.length !== configured.length) {
        console.warn('[GroupSummaryService] 群聊总结时段配置无效，已暂停自动总结')
        return []
      }
      return normalized
    }

    const migrated = buildGroupSummaryTimePeriodsFromInterval(this.config.get('aiGroupSummaryIntervalHours'))
    this.config.set('aiGroupSummaryTimePeriods', migrated)
    return migrated
  }

  private getTimePeriodsForBot(bot: ConfiguredWeComBot): GroupSummaryTimePeriod[] {
    if (bot.scheduleMode !== 'custom') return this.getConfiguredTimePeriods()
    const configured = Array.isArray(bot.timePeriods) ? bot.timePeriods : []
    const normalized = normalizeGroupSummaryTimePeriods(configured)
    const validation = validateGroupSummaryTimePeriods(normalized)
    if (normalized.length === 0 || !validation.valid || normalized.length !== configured.length) {
      console.warn(`[GroupSummaryService] 机器人“${bot.name || bot.id || '未命名'}”的独立推送时段无效，已暂停该机器人的自动总结`)
      return []
    }
    return normalized
  }

  private getScheduledPeriodsForAnchorDate(anchorDate: Date, configuredPeriods: GroupSummaryTimePeriod[]): Array<{ start: number; end: number }> {
    const dayStart = new Date(anchorDate)
    dayStart.setHours(0, 0, 0, 0)
    return configuredPeriods.flatMap((period) => {
      const startMinutes = timeToMinutes(period.start)
      const endMinutes = timeToMinutes(period.end)
      if (startMinutes === null || endMinutes === null) return []

      const start = new Date(dayStart)
      start.setMinutes(startMinutes)
      const end = new Date(dayStart)
      end.setMinutes(endMinutes)
      if (endMinutes <= startMinutes) end.setDate(end.getDate() + 1)
      return [{
        start: Math.floor(start.getTime() / 1000),
        end: Math.floor(end.getTime() / 1000)
      }]
    })
  }

  private getNextAutoBoundarySeconds(nowSeconds: number): number | null {
    const now = new Date(nowSeconds * 1000)
    const candidates: number[] = []
    const autoBots = this.getConfiguredWeComBots().filter((bot) =>
      (bot.mode === 'auto' || bot.mode === 'both') && String(bot.prompt || '').trim()
    )
    for (const bot of autoBots) {
      const configuredPeriods = this.getTimePeriodsForBot(bot)
      for (const dayOffset of [-1, 0, 1]) {
        const anchor = new Date(now)
        anchor.setHours(0, 0, 0, 0)
        anchor.setDate(anchor.getDate() + dayOffset)
        for (const period of this.getScheduledPeriodsForAnchorDate(anchor, configuredPeriods)) {
          if (period.end > nowSeconds) candidates.push(period.end)
        }
      }
    }
    return candidates.length > 0 ? Math.min(...candidates) : null
  }

  private getCompletedAutoPeriods(bot: ConfiguredWeComBot): Array<{ start: number; end: number }> {
    const now = Math.floor(Date.now() / 1000)
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const earliestEnd = Math.floor(todayStart.getTime() / 1000)
    const periods: Array<{ start: number; end: number }> = []
    const configuredPeriods = this.getTimePeriodsForBot(bot)

    for (const dayOffset of [-1, 0]) {
      const anchor = new Date(todayStart)
      anchor.setDate(anchor.getDate() + dayOffset)
      periods.push(...this.getScheduledPeriodsForAnchorDate(anchor, configuredPeriods).filter((period) =>
        period.end >= earliestEnd && period.end <= now
      ))
    }

    const unique = new Map<string, { start: number; end: number }>()
    for (const period of periods) unique.set(`${period.start}-${period.end}`, period)
    return Array.from(unique.values()).sort((first, second) => first.end - second.end)
  }

  private async queueDueAutoSummaries(): Promise<void> {
    if (!this.started || !this.isEnabled()) return
    if (this.processing) {
      this.pendingAutoRun = true
      return
    }
    this.processing = true
    try {
      do {
        this.pendingAutoRun = false
        await this.runDueAutoSummariesOnce()
      } while (this.pendingAutoRun && this.started && this.isEnabled())
    } finally {
      this.processing = false
    }
  }

  private async runDueAutoSummariesOnce(): Promise<void> {
    if (!this.started || !this.isEnabled()) return
    try {
      const bots = this.getConfiguredWeComBots().filter((bot) =>
        (bot.mode === 'auto' || bot.mode === 'both') &&
        String(bot.prompt || '').trim()
      )
      const scopeSessionIds = this.getAutoScopeSessionIds(bots)
      if (scopeSessionIds.length === 0) return
      if (!await this.ensureConnected()) return

      const contacts = (await chatService.enrichSessionsContactInfo(scopeSessionIds).catch(() => null))?.contacts || {}

      for (const bot of bots) {
        const periods = this.getCompletedAutoPeriods(bot)
        const botKey = bot.id || bot.name || bot.webhook
        const { apiBaseUrl, apiKey } = this.getAiModelConfigForBot(bot)
        if (!apiBaseUrl || !apiKey) continue
        for (const sessionId of scopeSessionIds) {
          if (!this.started || !this.isEnabled()) return
          if (!sessionId || !this.isBotScopeMatch(bot, sessionId)) continue
          for (const period of periods) {
            if (groupSummaryRecordService.hasAutoRecord(sessionId, period.start, period.end, botKey)) continue
            await this.generateSummaryForPeriod({
              sessionId,
              displayName: contacts[sessionId]?.displayName || sessionId,
              avatarUrl: contacts[sessionId]?.avatarUrl,
              periodStart: period.start,
              periodEnd: period.end,
              triggerType: 'auto',
              bot,
              botKey
            })
          }
        }
      }
    } catch (error) {
      console.warn('[GroupSummaryService] 自动总结失败:', error)
    }
  }

  private async readMessagesInPeriod(sessionId: string, startTime: number, endTime: number): Promise<Message[]> {
    if (!await this.ensureConnected()) {
      throw new Error('数据库连接失败，请先在“数据库连接”页完成配置')
    }
    const cursorResult = await wcdbService.openMessageCursor(
      sessionId,
      SUMMARY_CURSOR_BATCH_SIZE,
      true,
      startTime,
      endTime
    )
    if (!cursorResult.success || !cursorResult.cursor) {
      throw new Error(cursorResult.error || '打开消息游标失败')
    }

    const cursor = cursorResult.cursor
    const messages: Message[] = []
    try {
      let hasMore = true
      while (hasMore && messages.length < MAX_MESSAGES_PER_SUMMARY) {
        const batch = await wcdbService.fetchMessageBatch(cursor)
        if (!batch.success) {
          throw new Error(batch.error || '读取消息失败')
        }
        hasMore = batch.hasMore === true
        const rows = Array.isArray(batch.rows) ? batch.rows as Record<string, any>[] : []
        if (rows.length === 0) {
          if (!hasMore) break
          continue
        }
        const mapped = chatService.mapRowsToMessagesForApi(rows, sessionId)
        for (const message of mapped) {
          const createTime = Number(message.createTime || 0)
          if (createTime < startTime || createTime > endTime) continue
          messages.push(message)
          if (messages.length >= MAX_MESSAGES_PER_SUMMARY) break
        }
      }
    } finally {
      await wcdbService.closeMessageCursor(cursor).catch(() => {})
    }

    return messages.sort((a, b) => {
      if (a.createTime !== b.createTime) return a.createTime - b.createTime
      if (a.sortSeq !== b.sortSeq) return a.sortSeq - b.sortSeq
      return a.localId - b.localId
    })
  }

  private normalizeMessageText(message: Message): string {
    const parsedContent = String(message.parsedContent || '').replace(/\s+/g, ' ').trim()
    const quotedContent = String(message.quotedContent || '').replace(/\s+/g, ' ').trim()
    const quotedSender = String(message.quotedSender || '').replace(/\s+/g, ' ').trim()
    let text = parsedContent
    if (quotedContent) {
      const quote = quotedSender ? `${quotedSender}：${quotedContent}` : quotedContent
      text = text && text !== '[引用消息]' ? `${text} [引用 ${quote}]` : `[引用 ${quote}]`
    }
    if (!text) {
      text = String(message.linkTitle || message.fileName || message.appMsgDesc || '').replace(/\s+/g, ' ').trim()
    }
    if (!text) return ''
    if (/^<\?xml|^<msg\b|^<appmsg\b|^<img\b|^<emoji\b/i.test(text)) return ''
    return text
  }

  private async buildTranscript(sessionId: string, messages: Message[]): Promise<{
    transcript: string
    readableMessages: Message[]
    leaderboard: Array<{ name: string; count: number }>
  }> {
    const readableMessages = messages.filter((message) => this.normalizeMessageText(message))
    const senderIds = Array.from(new Set(
      readableMessages
        .map((message) => String(message.senderUsername || '').trim())
        .filter(Boolean)
    ))
    const contacts = senderIds.length > 0
      ? (await chatService.enrichSessionsContactInfo(senderIds).catch(() => null))?.contacts || {}
      : {}
    const myWxid = String(this.config.getMyWxidCleaned() || '').trim()

    const senderCounts = new Map<string, { name: string; count: number }>()
    const lines = readableMessages.map((message) => {
      const senderUsername = String(message.senderUsername || '').trim()
      const senderName = message.isSend === 1 || (senderUsername && myWxid && senderUsername === myWxid)
        ? '我'
        : (contacts[senderUsername]?.displayName || senderUsername || '未知成员')
      const senderKey = senderUsername || senderName
      const current = senderCounts.get(senderKey)
      senderCounts.set(senderKey, { name: senderName, count: (current?.count || 0) + 1 })
      return `[id:${message.localId || message.serverId || ''}] ${formatTimestamp(message.createTime)} ${senderName}：${this.normalizeMessageText(message)}`
    })

    return {
      transcript: lines.join('\n'),
      readableMessages,
      leaderboard: Array.from(senderCounts.values()).sort((a, b) => b.count - a.count)
    }
  }

  private async generateSummaryForPeriod(params: {
    sessionId: string
    displayName: string
    avatarUrl?: string
    periodStart: number
    periodEnd: number
    triggerType: GroupSummaryTriggerType
    targetSenderName?: string
    botName?: string
    bot?: ConfiguredWeComBot
    botKey?: string
  }): Promise<GroupSummaryTriggerResult> {
    const summaryBot = params.bot || this.getSummaryBot(params.sessionId, params.botName)
    const { apiBaseUrl, apiKey, model } = this.getAiModelConfigForBot(summaryBot)
    if (!apiBaseUrl || !apiKey) {
      return { success: false, message: '请先填写通用 AI 模型配置（API 地址和 Key）' }
    }

    try {
      let messages = await this.readMessagesInPeriod(params.sessionId, params.periodStart, params.periodEnd)
      if (params.targetSenderName) {
        const target = params.targetSenderName.toLowerCase()
        const senderIds = Array.from(new Set(messages.map((message) => String(message.senderUsername || '').trim()).filter(Boolean)))
        const contacts = (await chatService.enrichSessionsContactInfo(senderIds).catch(() => null))?.contacts || {}
        const matchedIds = new Set(senderIds.filter((id) => {
          const contact = contacts[id] || {}
          return id.toLowerCase() === target || [contact.displayName, contact.nickname, contact.remark, contact.alias].some((value) => String(value || '').toLowerCase() === target)
        }))
        messages = messages.filter((message) => matchedIds.has(String(message.senderUsername || '').trim()))
      }
      const { transcript, readableMessages, leaderboard } = await this.buildTranscript(params.sessionId, messages)
      if (readableMessages.length < MIN_SUMMARY_MESSAGES) {
        return {
          success: true,
          skipped: true,
          skippedReason: 'message_count_too_low',
          message: `该时段可总结消息少于 ${MIN_SUMMARY_MESSAGES} 条，已跳过`
        }
      }

      const botPrompt = String(summaryBot?.prompt || '').trim()
      if (!botPrompt) {
        return { success: false, message: '当前群聊没有匹配到已启用且已填写提示词的机器人，请先到机器人设置中完成配置' }
      }
      const recentRecords = groupSummaryRecordService.listRecords({ sessionId: params.sessionId, limit: 3 }).records
      const profileContext = recentRecords
        .flatMap((record) => record.digest?.memberHighlights || [])
        .slice(0, 30)
        .map((member) => `${member.name}（${member.role}）：${member.observations.join('；')}`)
        .join('\n')
      const userPrompt = `群聊：${params.displayName}
总结时段：${formatTimestamp(params.periodStart)} 至 ${formatTimestamp(params.periodEnd)}
消息数量：${readableMessages.length}
机械统计排行榜：${leaderboard.slice(0, 10).map((item, index) => `${index + 1}. ${item.name} ${item.count}条`).join('；')}
${profileContext ? `\n最近几期群友观察（仅用于识别延续或变化，不可替代本期消息，也不可作为事实来源）：\n${profileContext}\n` : ''}

群聊记录：
${transcript}`
      const endpoint = buildApiUrl(apiBaseUrl, '/chat/completions')
      const effectiveBotPrompt = `${botPrompt}\n\n${GROUP_SUMMARY_OUTPUT_CONTRACT}`
      const requestMessages = [
        { role: 'system', content: effectiveBotPrompt },
        { role: 'user', content: userPrompt }
      ]

      let rawOutput = ''
      let responseFormatJson = true
      let responseFormatFallback = false
      let responseFormatFallbackReason = ''
      const startedAt = Date.now()
      try {
        rawOutput = await callChatCompletions(apiBaseUrl, apiKey, model, requestMessages, { responseFormatJson: true })
      } catch (error) {
        if (!shouldFallbackJsonMode(error)) throw error
        responseFormatJson = false
        responseFormatFallback = true
        responseFormatFallbackReason = (error as Error).message || 'response_format 不受支持'
        rawOutput = await callChatCompletions(apiBaseUrl, apiKey, model, requestMessages)
      }

      let topics: GroupSummaryTopic[]
      let parsedDigest: Omit<GroupSummaryDigest, 'leaderboard' | 'coverageStart' | 'coverageEnd'>
      let finalSummary: string
      let originalRawOutput: string | undefined
      let jsonRepairApplied = false
      let jsonRepairReasons: string[] = []
      let jsonRepairRetried = false
      let jsonParseError = ''
      let summaryParsed = false
      try {
        const parsed = parseSummary(rawOutput)
        topics = parsed.topics
        parsedDigest = parsed.digest
        summaryParsed = true
        jsonRepairApplied = parsed.jsonRepairApplied
        jsonRepairReasons = parsed.jsonRepairReasons
        if (parsed.jsonRepairApplied) {
          originalRawOutput = rawOutput
          rawOutput = parsed.normalizedOutput
        }
      } catch (initialParseError) {
        jsonParseError = (initialParseError as Error).message || String(initialParseError)
        originalRawOutput = rawOutput
        jsonRepairRetried = true
        try {
          const repairedByModel = await callChatCompletions(apiBaseUrl, apiKey, model, [
            { role: 'system', content: GROUP_SUMMARY_JSON_REPAIR_PROMPT },
            { role: 'user', content: rawOutput }
          ], { responseFormatJson: true })
          const parsed = parseSummary(repairedByModel)
          topics = parsed.topics
          parsedDigest = parsed.digest
          summaryParsed = true
          rawOutput = parsed.normalizedOutput
          jsonRepairApplied = parsed.jsonRepairApplied
          jsonRepairReasons = parsed.jsonRepairReasons
        } catch (retryError) {
          jsonParseError = `${jsonParseError}; retry: ${(retryError as Error).message || String(retryError)}`
          topics = [fallbackTopicFromParseFailure()]
          parsedDigest = { overview: '', importantReminders: [], actionItems: [], unresolvedIssues: [], memberHighlights: [], customSections: [] }
        }
      }
      const digest: GroupSummaryDigest = {
        ...parsedDigest,
        leaderboard,
        coverageStart: readableMessages[0]?.createTime,
        coverageEnd: readableMessages[readableMessages.length - 1]?.createTime
      }
      finalSummary = summaryParsed
        ? (rawOutput.trim() || buildSummaryText(topics, digest))
        : buildSummaryText(topics, digest)

      const log: GroupSummaryLog = {
        endpoint,
        model,
        temperature: API_TEMPERATURE,
        triggerType: params.triggerType,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        messageCount: messages.length,
        readableMessageCount: readableMessages.length,
        systemPrompt: effectiveBotPrompt,
        userPrompt,
        rawOutput,
        finalSummary,
        durationMs: Date.now() - startedAt,
        createdAt: Date.now(),
        responseFormatJson,
        responseFormatFallback,
        responseFormatFallbackReason,
        originalRawOutput,
        jsonRepairApplied,
        jsonRepairReasons,
        jsonRepairRetried,
        jsonParseError: jsonParseError || undefined,
        parsedTopics: topics,
        botKey: params.botKey || summaryBot?.id || summaryBot?.name || summaryBot?.webhook
      }

      const delivery = params.triggerType === 'auto'
        ? await this.deliverAutoSummary({
            sessionId: params.sessionId,
            displayName: params.displayName,
            periodStart: params.periodStart,
            periodEnd: params.periodEnd,
            messageCount: readableMessages.length,
            topics,
            digest,
            bot: summaryBot as ConfiguredWeComBot
          })
        : undefined
      if (delivery) log.delivery = delivery

      const record = groupSummaryRecordService.addRecord({
        sessionId: params.sessionId,
        displayName: params.displayName,
        avatarUrl: params.avatarUrl,
        triggerType: params.triggerType,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        messageCount: messages.length,
        readableMessageCount: readableMessages.length,
        topics,
        summaryText: finalSummary,
        digest,
        rawOutput,
        log,
        botKey: params.botKey || summaryBot?.id || summaryBot?.name || summaryBot?.webhook,
        delivery
      })

      const message = delivery
        ? (delivery.success ? `群聊总结已生成，${delivery.message}` : `群聊总结已生成，但推送失败：${delivery.message}`)
        : '群聊总结已生成'
      return { success: true, message, recordId: record.id, record }
    } catch (error) {
      return { success: false, message: `生成失败：${(error as Error).message || String(error)}` }
    }
  }

  private async generateSummariesForPeriods(params: {
    sessionId: string
    displayName: string
    avatarUrl?: string
    periods: Array<{ start: number; end: number }>
    triggerType: GroupSummaryTriggerType
    botName?: string
  }): Promise<GroupSummaryDayTriggerResult> {
    const records: GroupSummaryRecordSummary[] = []
    let skipped = 0
    let failed = 0
    let firstError = ''

    for (const period of params.periods) {
      const result = await this.generateSummaryForPeriod({
        sessionId: params.sessionId,
        displayName: params.displayName,
        avatarUrl: params.avatarUrl,
        periodStart: period.start,
        periodEnd: period.end,
        triggerType: params.triggerType,
        botName: params.botName
      })
      if (result.success && result.record) {
        records.push(result.record)
        continue
      }
      if (result.success && result.skipped) {
        skipped += 1
        continue
      }
      failed += 1
      if (!firstError) firstError = result.message
    }

    const generated = records.length
    const parts = [`生成 ${generated} 段`, `跳过 ${skipped} 段`]
    if (failed > 0) parts.push(`失败 ${failed} 段`)
    const message = failed > 0 && generated === 0 && skipped === 0
      ? (firstError || '群聊总结生成失败')
      : `群聊总结完成：${parts.join('，')}`

    return {
      success: generated > 0 || skipped > 0 || failed === 0,
      message,
      generated,
      skipped,
      records
    }
  }
}

export const groupSummaryService = new GroupSummaryService()
