export interface WechatReplyBinding {
  id: string
  sessionId: string
  sessionName: string
  targetName: string
  enabled: boolean
  autoReplyEnabled: boolean
  /** Group member to mention when the assistant cannot produce a safe answer. */
  fallbackMentionName: string
  fallbackMentionUsername: string
}

export type WechatReplyAutomationMode = 'draft' | 'countdown' | 'auto'

export interface WechatReplySettings {
  enabled: boolean
  riskAcceptedAt: number
  pythonPath: string
  bindings: WechatReplyBinding[]
  minIntervalSeconds: number
  hourlyLimit: number
  dailyLimit: number
  randomDelayMinMs: number
  randomDelayMaxMs: number
  quietHoursEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
  failureThreshold: number
  aiEnabled: boolean
  contextMessageCount: number
  temperature: number
  maxReplyChars: number
  apiRequestTimeoutSeconds: number
  memberMemoryEnabled: boolean
  memberMemoryMessageCount: number
  autoMediaEnabled: boolean
  imageGenerationEnabled: boolean
  imageGenerationModel: string
  imageGenerationSize: '1024x1024' | '1536x1024' | '1024x1536'
  knowledgeBaseEnabled: boolean
  knowledgeBasePath: string
  knowledgeBaseMaxResults: number
  webSearchEnabled: boolean
  webSearchMaxResults: number
  fallbackMentionTemplate: string
  automationMode: WechatReplyAutomationMode
  countdownSeconds: number
  replyDebounceSeconds: number
}

export interface WechatReplyAiStatus {
  configured: boolean
  model: string
  apiBaseUrl: string
  message: string
}

export interface WechatReplyDraftResult extends WechatReplyResult {
  draft?: string
  model?: string
  contextCount?: number
  targetMessage?: string
  mediaAssetId?: string
  mediaAssetName?: string
  generatedImagePath?: string
  generatedImageName?: string
  knowledgeSourceNames?: string[]
  webSourceNames?: string[]
  webSourceUrls?: string[]
}

export type WechatReplyMediaKind = 'image' | 'emoji'
export type WechatReplyMediaScope = 'all' | 'private' | 'group'

export interface WechatReplyMediaSource {
  sourceKey: string
  sessionId: string
  localId: number
  createTime: number
  imageMd5?: string
  imageDatName?: string
}

export interface WechatReplyMediaAsset {
  id: string
  name: string
  kind: WechatReplyMediaKind
  tags: string[]
  scope: WechatReplyMediaScope
  autoSend: boolean
  enabled: boolean
  createdAt: number
  updatedAt: number
  filePath: string
  source: WechatReplyMediaSource
}

export interface WechatReplyMediaAssetInput {
  name?: string
  kind: WechatReplyMediaKind
  tags?: string[]
  scope: WechatReplyMediaScope
  autoSend: boolean
  source: WechatReplyMediaSource
}

export interface WechatReplyMediaListResult extends WechatReplyResult {
  items?: WechatReplyMediaAsset[]
}

export interface WechatReplyMediaAssetResult extends WechatReplyResult {
  item?: WechatReplyMediaAsset
}

export interface WechatReplyAutomationItem {
  id: string
  sessionId: string
  sessionName: string
  content: string
  targetMessage: string
  createdAt: number
  sendAt?: number
  state: 'draft' | 'countdown' | 'sent' | 'blocked' | 'failed' | 'cancelled'
  message: string
  mediaAssetId?: string
  mediaAssetName?: string
  generatedImageName?: string
  knowledgeSourceNames?: string[]
  webSourceNames?: string[]
  webSourceUrls?: string[]
}

export interface WechatReplyAutomationStatus {
  running: boolean
  mode: WechatReplyAutomationMode
  pendingCount: number
  items: WechatReplyAutomationItem[]
}

export interface WechatReplyRuntimeStatus {
  platformSupported: boolean
  enabled: boolean
  circuitOpen: boolean
  consecutiveFailures: number
  sentToday: number
  sentThisHour: number
  lastSentAt?: number
  environment?: {
    ok: boolean
    pythonVersion?: string
    wxautoVersion?: string
    message: string
  }
}

export interface WechatReplyResult {
  success: boolean
  message: string
  code?: string
  retryAfterMs?: number
}

export const DEFAULT_WECHAT_REPLY_SETTINGS: WechatReplySettings = {
  enabled: false,
  riskAcceptedAt: 0,
  pythonPath: 'python',
  bindings: [],
  minIntervalSeconds: 20,
  hourlyLimit: 30,
  dailyLimit: 100,
  randomDelayMinMs: 2000,
  randomDelayMaxMs: 5000,
  quietHoursEnabled: true,
  quietHoursStart: '23:00',
  quietHoursEnd: '08:00',
  failureThreshold: 3,
  aiEnabled: false,
  contextMessageCount: 12,
  temperature: 0.7,
  maxReplyChars: 300,
  apiRequestTimeoutSeconds: 180,
  memberMemoryEnabled: false,
  memberMemoryMessageCount: 60,
  autoMediaEnabled: false,
  imageGenerationEnabled: false,
  imageGenerationModel: 'gpt-image-1.5',
  imageGenerationSize: '1024x1024',
  knowledgeBaseEnabled: false,
  knowledgeBasePath: '',
  knowledgeBaseMaxResults: 3,
  webSearchEnabled: false,
  webSearchMaxResults: 4,
  fallbackMentionTemplate: '这个问题我暂时回答不了，麻烦你帮忙看一下。',
  automationMode: 'draft',
  countdownSeconds: 15,
  replyDebounceSeconds: 8
}
