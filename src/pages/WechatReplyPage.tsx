import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  BookmarkCheck,
  BookOpenCheck,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Clock3,
  FolderOpen,
  Globe2,
  ImagePlus,
  Link2,
  LoaderCircle,
  MessageSquareReply,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  SmilePlus,
  Sparkles,
  ShieldCheck,
  TimerReset,
  Trash2,
  UserRoundSearch,
  X
} from 'lucide-react'
import type { ChatSession } from '../types/models'
import {
  DEFAULT_WECHAT_REPLY_SETTINGS,
  type WechatReplyAiStatus,
  type WechatReplyAutomationStatus,
  type WechatReplyBinding,
  type WechatReplyMediaAsset,
  type WechatReplyRuntimeStatus,
  type WechatReplySettings
} from '../../shared/wechatReply'
import './WechatReplyPage.scss'

type Notice = { tone: 'success' | 'error' | 'info'; text: string }
type ReplyGroupMember = {
  username: string
  displayName: string
  nickname?: string
  alias?: string
  remark?: string
  groupNickname?: string
  isOwner?: boolean
}

const formatTime = (timestamp?: number): string => {
  if (!timestamp) return '尚未发送'
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

const sessionLabel = (session: ChatSession): string => String(session.displayName || session.username || '未命名会话')

function WechatReplyPage() {
  const navigate = useNavigate()
  const [settings, setSettings] = useState<WechatReplySettings>(DEFAULT_WECHAT_REPLY_SETTINGS)
  const [status, setStatus] = useState<WechatReplyRuntimeStatus | null>(null)
  const [aiStatus, setAiStatus] = useState<WechatReplyAiStatus | null>(null)
  const [automationStatus, setAutomationStatus] = useState<WechatReplyAutomationStatus | null>(null)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [testing, setTesting] = useState(false)
  const [mediaSending, setMediaSending] = useState<'image' | 'emoji' | 'library' | null>(null)
  const [testingAi, setTestingAi] = useState(false)
  const [generatingDraft, setGeneratingDraft] = useState(false)
  const [checkingKnowledge, setCheckingKnowledge] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [newSessionId, setNewSessionId] = useState('')
  const [newTargetName, setNewTargetName] = useState('')
  const [sessionSearch, setSessionSearch] = useState('')
  const [testBindingId, setTestBindingId] = useState('')
  const [testContent, setTestContent] = useState('你好，这是一条来自 WeFlow 的手动测试消息。')
  const [draftTargetMessage, setDraftTargetMessage] = useState('')
  const [draftMeta, setDraftMeta] = useState('')
  const [mediaAssets, setMediaAssets] = useState<WechatReplyMediaAsset[]>([])
  const [selectedMediaAssetId, setSelectedMediaAssetId] = useState('')
  const [memberPickerBindingId, setMemberPickerBindingId] = useState('')
  const [memberSearch, setMemberSearch] = useState('')
  const [groupMembers, setGroupMembers] = useState<Record<string, ReplyGroupMember[]>>({})
  const [memberLoadingSessionId, setMemberLoadingSessionId] = useState('')
  const [memberLoadErrors, setMemberLoadErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [savedSettings, runtime, modelStatus, autoStatus, sessionResult, mediaLibraryResult] = await Promise.all([
          window.electronAPI.wechatReply.getSettings(),
          window.electronAPI.wechatReply.getStatus(),
          window.electronAPI.wechatReply.getAiStatus(),
          window.electronAPI.wechatReply.getAutomationStatus(),
          window.electronAPI.chat.getSessions(),
          window.electronAPI.wechatReply.listMediaLibrary()
        ])
        if (cancelled) return
        setSettings(savedSettings)
        setStatus(runtime)
        setAiStatus(modelStatus)
        setAutomationStatus(autoStatus)
        if (sessionResult.success && Array.isArray(sessionResult.sessions)) setSessions(sessionResult.sessions)
        if (mediaLibraryResult.success && Array.isArray(mediaLibraryResult.items)) {
          setMediaAssets(mediaLibraryResult.items)
          if (mediaLibraryResult.items[0]) setSelectedMediaAssetId(mediaLibraryResult.items[0].id)
        }
        const firstBinding = savedSettings.bindings.find(binding => binding.enabled)
        if (firstBinding) setTestBindingId(firstBinding.id)
      } catch (error) {
        if (!cancelled) setNotice({ tone: 'error', text: `加载微信回复设置失败：${String(error)}` })
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!ready) return
    const refresh = () => void window.electronAPI.wechatReply.getAutomationStatus().then(setAutomationStatus).catch(() => undefined)
    const timer = window.setInterval(refresh, 2000)
    return () => window.clearInterval(timer)
  }, [ready])

  useEffect(() => {
    if (!memberPickerBindingId) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMemberPickerBindingId('')
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [memberPickerBindingId])

  const availableSessions = useMemo(() => {
    const bound = new Set(settings.bindings.map(binding => binding.sessionId))
    return sessions.filter(session => !bound.has(session.username) && !session.username.startsWith('gh_'))
  }, [sessions, settings.bindings])

  const filteredSessions = useMemo(() => {
    const keyword = sessionSearch.trim().toLocaleLowerCase('zh-CN')
    if (!keyword) return availableSessions
    return availableSessions.filter(session => [session.displayName, session.username]
      .some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(keyword)))
  }, [availableSessions, sessionSearch])

  const selectedSession = sessions.find(session => session.username === newSessionId)
  const selectedTestBinding = settings.bindings.find(binding => binding.id === testBindingId)

  const patchSettings = (patch: Partial<WechatReplySettings>) => setSettings(current => ({ ...current, ...patch }))

  const checkEnvironment = async () => {
    setChecking(true)
    setNotice(null)
    try {
      const next = await window.electronAPI.wechatReply.checkEnvironment()
      setStatus(next)
      setNotice({
        tone: next.environment?.ok ? 'success' : 'error',
        text: next.environment?.message || '环境检测完成'
      })
    } finally {
      setChecking(false)
    }
  }

  const save = async (showNotice = true): Promise<boolean> => {
    setSaving(true)
    setNotice(null)
    try {
      const result = await window.electronAPI.wechatReply.saveSettings(settings)
      if (result.settings) setSettings(result.settings)
      setStatus(await window.electronAPI.wechatReply.getStatus())
      if (showNotice || !result.success) setNotice({ tone: result.success ? 'success' : 'error', text: result.message })
      return result.success
    } finally {
      setSaving(false)
    }
  }

  const testAiConnection = async () => {
    setTestingAi(true)
    setNotice(null)
    try {
      const result = await window.electronAPI.wechatReply.testAi()
      setAiStatus(await window.electronAPI.wechatReply.getAiStatus())
      setNotice({ tone: result.success ? 'success' : 'error', text: result.message })
    } finally {
      setTestingAi(false)
    }
  }

  const selectKnowledgeBase = async () => {
    const result = await window.electronAPI.wechatReply.selectKnowledgeBase()
    if (result.success && result.path) patchSettings({ knowledgeBasePath: result.path })
    if (result.code !== 'CANCELLED') setNotice({ tone: result.success ? 'success' : 'error', text: result.message })
  }

  const inspectKnowledgeBase = async () => {
    if (!settings.knowledgeBasePath.trim()) {
      setNotice({ tone: 'error', text: '请先选择 Obsidian 知识库文件夹' })
      return
    }
    setCheckingKnowledge(true)
    try {
      const result = await window.electronAPI.wechatReply.inspectKnowledgeBase(settings.knowledgeBasePath)
      setNotice({ tone: result.success ? 'success' : 'error', text: result.message })
    } finally {
      setCheckingKnowledge(false)
    }
  }

  const generateDraft = async () => {
    if (!selectedTestBinding) {
      setNotice({ tone: 'error', text: '请先选择一个已保存的白名单会话' })
      return
    }
    setGeneratingDraft(true)
    setNotice(null)
    setDraftTargetMessage('')
    setDraftMeta('')
    try {
      if (!(await save(false))) return
      const result = await window.electronAPI.wechatReply.generateDraft(selectedTestBinding.id)
      if (result.success && result.draft) {
        setTestContent(result.draft)
        setDraftTargetMessage(result.targetMessage || '')
        setDraftMeta(`${result.model || '当前模型'} · ${result.contextCount || 0} 条上下文${result.generatedImageName ? ' · 已生成图片' : result.mediaAssetName ? ` · 匹配素材：${result.mediaAssetName}` : ''}${result.knowledgeSourceNames?.length ? ` · 知识库：${result.knowledgeSourceNames.join('、')}` : ''}${result.webSourceNames?.length ? ` · 公开网页：${result.webSourceNames.length} 条` : ''}`)
        if (result.mediaAssetId) setSelectedMediaAssetId(result.mediaAssetId)
      }
      setNotice({ tone: result.success ? 'success' : 'error', text: result.message })
    } finally {
      setGeneratingDraft(false)
    }
  }

  const addBinding = () => {
    if (!selectedSession || !newTargetName.trim()) {
      setNotice({ tone: 'error', text: '请选择 WeFlow 会话，并填写微信窗口中的准确名称' })
      return
    }
    const binding: WechatReplyBinding = {
      id: `reply-binding-${Date.now()}`,
      sessionId: selectedSession.username,
      sessionName: sessionLabel(selectedSession),
      targetName: newTargetName.trim(),
      enabled: true,
      autoReplyEnabled: false,
      fallbackMentionName: '',
      fallbackMentionUsername: ''
    }
    patchSettings({ bindings: [...settings.bindings, binding] })
    setTestBindingId(binding.id)
    setNewSessionId('')
    setNewTargetName('')
    setSessionSearch('')
    setNotice({ tone: 'info', text: '绑定已加入，保存设置后生效。建议先发送测试消息确认目标唯一。' })
  }

  const updateBinding = (id: string, patch: Partial<WechatReplyBinding>) => {
    patchSettings({ bindings: settings.bindings.map(binding => binding.id === id ? { ...binding, ...patch } : binding) })
  }

  const removeBinding = (id: string) => {
    patchSettings({ bindings: settings.bindings.filter(binding => binding.id !== id) })
    if (testBindingId === id) setTestBindingId('')
    if (memberPickerBindingId === id) setMemberPickerBindingId('')
  }

  const loadGroupMembersForBinding = async (binding: WechatReplyBinding) => {
    if (memberLoadingSessionId === binding.sessionId) return
    setMemberLoadingSessionId(binding.sessionId)
    setMemberLoadErrors(current => ({ ...current, [binding.sessionId]: '' }))
    try {
      const result = await window.electronAPI.groupAnalytics.getGroupMembers(binding.sessionId)
      if (!result.success || !result.data) {
        setMemberLoadErrors(current => ({ ...current, [binding.sessionId]: result.error || '群成员加载失败' }))
        return
      }
      setGroupMembers(current => ({ ...current, [binding.sessionId]: result.data || [] }))
    } catch (error) {
      setMemberLoadErrors(current => ({ ...current, [binding.sessionId]: String(error) }))
    } finally {
      setMemberLoadingSessionId(current => current === binding.sessionId ? '' : current)
    }
  }

  const openMemberPicker = async (binding: WechatReplyBinding) => {
    if (!binding.sessionId.endsWith('@chatroom')) return
    if (memberPickerBindingId === binding.id) {
      setMemberPickerBindingId('')
      return
    }
    setMemberPickerBindingId(binding.id)
    setMemberSearch('')
    if (!groupMembers[binding.sessionId]) await loadGroupMembersForBinding(binding)
  }

  const selectFallbackMember = (bindingId: string, member?: ReplyGroupMember) => {
    const mentionName = member
      ? String(member.groupNickname || member.remark || member.displayName || member.nickname || member.username).trim()
      : ''
    updateBinding(bindingId, {
      fallbackMentionName: mentionName,
      fallbackMentionUsername: member?.username || ''
    })
    setMemberPickerBindingId('')
    setMemberSearch('')
  }

  const sendTest = async () => {
    if (!selectedTestBinding) {
      setNotice({ tone: 'error', text: '请选择一个绑定作为测试目标' })
      return
    }
    setTesting(true)
    setNotice(null)
    try {
      const result = await window.electronAPI.wechatReply.sendTest(selectedTestBinding.id, testContent)
      setStatus(await window.electronAPI.wechatReply.getStatus())
      setNotice({ tone: result.success ? 'success' : 'error', text: result.message })
    } finally {
      setTesting(false)
    }
  }

  const sendMediaTest = async (mediaKind: 'image' | 'emoji') => {
    if (!selectedTestBinding) {
      setNotice({ tone: 'error', text: '请选择一个绑定作为测试目标' })
      return
    }
    setMediaSending(mediaKind)
    setNotice(null)
    try {
      const result = await window.electronAPI.wechatReply.sendMediaTest(selectedTestBinding.id, mediaKind)
      setStatus(await window.electronAPI.wechatReply.getStatus())
      if (result.code !== 'CANCELLED') setNotice({ tone: result.success ? 'success' : 'error', text: result.message })
    } finally {
      setMediaSending(null)
    }
  }

  const sendLibraryAsset = async () => {
    if (!selectedTestBinding || !selectedMediaAssetId) {
      setNotice({ tone: 'error', text: '请选择发送目标和回复素材' })
      return
    }
    setMediaSending('library')
    setNotice(null)
    try {
      const result = await window.electronAPI.wechatReply.sendLibraryAsset(selectedTestBinding.id, selectedMediaAssetId)
      setStatus(await window.electronAPI.wechatReply.getStatus())
      setNotice({ tone: result.success ? 'success' : 'error', text: result.message })
    } finally {
      setMediaSending(null)
    }
  }

  const cancelPending = async (id: string) => {
    const result = await window.electronAPI.wechatReply.cancelPending(id)
    setAutomationStatus(await window.electronAPI.wechatReply.getAutomationStatus())
    setNotice({ tone: result.success ? 'success' : 'error', text: result.message })
  }

  if (!ready) return <div className="wechat-reply-loading">正在加载微信回复设置…</div>

  const environmentOk = status?.environment?.ok === true
  const riskAccepted = settings.riskAcceptedAt > 0

  return (
    <main className="wechat-reply-page">
      <header className="wechat-reply-header">
        <div>
          <div className="wechat-reply-title"><MessageSquareReply size={22} /><h1>微信回复</h1></div>
          <p>使用微信 4.1 兼容引擎操作本机 Windows 微信，可发送文字和本地图片。消息读取与聊天数据仍由 WeFlow 处理。</p>
        </div>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
          {saving ? '保存中' : '保存设置'}
        </button>
      </header>

      <section className="wechat-reply-risk" aria-label="风险说明">
        <AlertTriangle size={20} />
        <div>
          <strong>这是非官方桌面自动化能力，无法保证账号不受限制。</strong>
          <p>建议只使用小号和少量白名单会话。不要群发、营销、自动加好友或长时间高频回复；兼容层会临时启用微信的无障碍控件树，微信小版本更新、窗口状态和同名联系人仍可能导致不可用、发送失败或发错对象。</p>
        </div>
      </section>

      {notice && <div className={`wechat-reply-notice ${notice.tone}`} role="status">{notice.text}</div>}

      <section className="wechat-reply-section" aria-labelledby="reply-ai-heading">
        <div className="wechat-reply-section-heading">
          <div>
            <h2 id="reply-ai-heading">模型与回答规则</h2>
            <p>使用当前 API 模型的默认表达能力，生成一条像真人微信消息的受限回答；聊天内容会发送到你配置的 API，联系人名称会先在本地匿名化。</p>
          </div>
          <label className="wechat-reply-feature-switch">
            <span>{settings.aiEnabled ? 'AI 草稿已启用' : 'AI 草稿未启用'}</span>
            <input type="checkbox" checked={settings.aiEnabled} onChange={event => patchSettings({ aiEnabled: event.target.checked })} />
          </label>
        </div>

        <div className="wechat-reply-ai-summary">
          <BrainCircuit size={19} />
          <div>
            <strong className={aiStatus?.configured ? 'ok' : 'bad'}>{aiStatus?.message || '正在读取模型配置'}</strong>
            <span>{aiStatus?.apiBaseUrl || '尚未设置 API Base URL'}</span>
          </div>
          <div className="wechat-reply-ai-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate('/settings')}>打开 AI 基础配置</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={testingAi || !aiStatus?.configured} onClick={() => void testAiConnection()}>
              {testingAi ? <LoaderCircle className="spin" size={14} /> : <Play size={14} />}{testingAi ? '测试中' : '测试模型'}
            </button>
          </div>
        </div>

        <div className="wechat-reply-policy-grid ai-options">
          <label className="wechat-reply-field"><span>上下文消息数</span><input type="number" min="1" max="50" value={settings.contextMessageCount} onChange={event => patchSettings({ contextMessageCount: Number(event.target.value) })} /></label>
          <label className="wechat-reply-field"><span>表达随机度</span><input type="number" min="0" max="1.5" step="0.1" value={settings.temperature} onChange={event => patchSettings({ temperature: Number(event.target.value) })} /></label>
          <label className="wechat-reply-field"><span>回复字数上限</span><input type="number" min="20" max="1000" value={settings.maxReplyChars} onChange={event => patchSettings({ maxReplyChars: Number(event.target.value) })} /></label>
          <label className="wechat-reply-field"><span>API 等待上限（秒）</span><input type="number" min="30" max="600" step="30" value={settings.apiRequestTimeoutSeconds} onChange={event => patchSettings({ apiRequestTimeoutSeconds: Number(event.target.value) })} /><small>慢速推理或直接返回图片的模型建议 180–300 秒</small></label>
          <label className="wechat-reply-field"><span>成员记忆消息数</span><input type="number" min="20" max="100" disabled={!settings.memberMemoryEnabled} value={settings.memberMemoryMessageCount} onChange={event => patchSettings({ memberMemoryMessageCount: Number(event.target.value) })} /><small>仅提取 @你的成员在当前群的历史公开发言</small></label>
        </div>
        <label className="wechat-reply-inline-check"><input type="checkbox" checked={settings.memberMemoryEnabled} onChange={event => patchSettings({ memberMemoryEnabled: event.target.checked })} /><BrainCircuit size={15} /><span>群聊回复启用成员记忆；摘要会随草稿发送给已配置的 AI，不分析敏感属性</span></label>
      </section>

      <section className="wechat-reply-section" aria-labelledby="reply-enhancements-heading">
        <div className="wechat-reply-section-heading">
          <div>
            <h2 id="reply-enhancements-heading">图片、知识库与公开网络</h2>
            <p>明确要求画图时生成并发送成品；回答问题时可综合 Obsidian 笔记、群聊记忆点与公开网页资料。</p>
          </div>
        </div>
        <div className="wechat-reply-enhancement-grid">
          <div className="wechat-reply-capability-card">
            <label className="wechat-reply-inline-check no-margin"><input type="checkbox" checked={settings.imageGenerationEnabled} onChange={event => patchSettings({ imageGenerationEnabled: event.target.checked })} /><ImagePlus size={15} /><span>允许按明确请求生成并发送图片</span></label>
            <div className="wechat-reply-policy-grid compact-grid">
              <label className="wechat-reply-field"><span>图片模型</span><input disabled={!settings.imageGenerationEnabled} value={settings.imageGenerationModel} onChange={event => patchSettings({ imageGenerationModel: event.target.value })} placeholder="gpt-image-1.5" /></label>
              <label className="wechat-reply-field"><span>图片尺寸</span><select disabled={!settings.imageGenerationEnabled} value={settings.imageGenerationSize} onChange={event => patchSettings({ imageGenerationSize: event.target.value as WechatReplySettings['imageGenerationSize'] })}><option value="1024x1024">方图 1024 × 1024</option><option value="1536x1024">横图 1536 × 1024</option><option value="1024x1536">竖图 1024 × 1536</option></select></label>
            </div>
            <small>使用 AI 基础配置派生的 OpenAI 兼容 /images/generations 接口；图片保存在本地受控缓存后发送。</small>
          </div>
          <div className="wechat-reply-capability-card">
            <label className="wechat-reply-inline-check no-margin"><input type="checkbox" checked={settings.knowledgeBaseEnabled} onChange={event => patchSettings({ knowledgeBaseEnabled: event.target.checked })} /><BookOpenCheck size={15} /><span>回复前检索 Obsidian 知识库</span></label>
            <label className="wechat-reply-field"><span>知识库文件夹</span><span className="wechat-reply-path-picker"><input disabled={!settings.knowledgeBaseEnabled} value={settings.knowledgeBasePath} onChange={event => patchSettings({ knowledgeBasePath: event.target.value })} placeholder="选择包含 Markdown 笔记的 Vault" /><button type="button" className="btn btn-secondary btn-sm" disabled={!settings.knowledgeBaseEnabled} onClick={() => void selectKnowledgeBase()}><FolderOpen size={13} />选择</button></span></label>
            <div className="wechat-reply-knowledge-actions">
              <label className="wechat-reply-field"><span>最多引用</span><input type="number" min="1" max="10" disabled={!settings.knowledgeBaseEnabled} value={settings.knowledgeBaseMaxResults} onChange={event => patchSettings({ knowledgeBaseMaxResults: Number(event.target.value) })} /></label>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!settings.knowledgeBaseEnabled || checkingKnowledge || !settings.knowledgeBasePath.trim()} onClick={() => void inspectKnowledgeBase()}>{checkingKnowledge ? <LoaderCircle className="spin" size={13} /> : <BookOpenCheck size={13} />}{checkingKnowledge ? '索引中' : '检查索引'}</button>
            </div>
            <small>只读取 .md、.markdown、.txt；相关摘录与公开链接会发给模型，不会暴露本机路径。</small>
          </div>
          <div className="wechat-reply-capability-card wide-capability">
            <label className="wechat-reply-inline-check no-margin"><input type="checkbox" checked={settings.webSearchEnabled} onChange={event => patchSettings({ webSearchEnabled: event.target.checked })} /><Globe2 size={15} /><span>回答前检索网上公开资料</span></label>
            <div className="wechat-reply-policy-grid compact-grid web-search-options">
              <label className="wechat-reply-field"><span>最多参考网页</span><input type="number" min="1" max="8" disabled={!settings.webSearchEnabled} value={settings.webSearchMaxResults} onChange={event => patchSettings({ webSearchMaxResults: Number(event.target.value) })} /></label>
              <div className="wechat-reply-field"><span>资料融合规则</span><small>优先较新、权威且能相互印证的来源；与知识库冲突时会说明不确定性，必要时附原始链接。</small></div>
            </div>
            <small>隐私提示：开启后，只把移除 @名称后的当前问题发送给 Bing 公共搜索；不会额外上传聊天上下文、联系人列表或本地笔记。检索失败时仍会使用知识库和群聊记忆生成回复。</small>
          </div>
        </div>
      </section>

      <section className="wechat-reply-section" aria-labelledby="reply-automation-heading">
        <div className="wechat-reply-section-heading">
          <div>
            <h2 id="reply-automation-heading">自动回复模式</h2>
            <p>私聊按白名单自动回复；群聊只有在别人明确 @你时才触发。每一条进入队列的文字消息都会独立生成回复，不再用后一条覆盖前一条。</p>
          </div>
          <span className={`wechat-reply-runtime ${automationStatus?.running ? 'running' : ''}`}>{automationStatus?.running ? '监听中' : '未运行'}</span>
        </div>

        <fieldset className="wechat-reply-mode-picker">
          <legend className="sr-only">选择自动回复模式</legend>
          {([
            ['draft', '仅草稿', '在工作台手动生成和发送'],
            ['countdown', '倒计时发送', '生成后保留取消时间'],
            ['auto', '全自动', '生成后立即进入发送限流']
          ] as const).map(([value, label, description]) => (
            <label className={settings.automationMode === value ? 'selected' : ''} key={value}>
              <input type="radio" name="automation-mode" value={value} checked={settings.automationMode === value} onChange={() => patchSettings({ automationMode: value })} />
              <span><strong>{label}</strong><small>{description}</small></span>
            </label>
          ))}
        </fieldset>

        <div className="wechat-reply-policy-grid ai-options automation-options">
          <label className="wechat-reply-field"><span>逐条处理等待（秒）</span><input type="number" min="2" max="60" value={settings.replyDebounceSeconds} onChange={event => patchSettings({ replyDebounceSeconds: Number(event.target.value) })} /><small>每条消息独立等待并排队，避免漏回</small></label>
          <label className="wechat-reply-field"><span>倒计时（秒）</span><input type="number" min="5" max="120" disabled={settings.automationMode !== 'countdown'} value={settings.countdownSeconds} onChange={event => patchSettings({ countdownSeconds: Number(event.target.value) })} /><small>等待期间可在本页取消</small></label>
        </div>
        <label className="wechat-reply-inline-check">
          <input type="checkbox" checked={settings.autoMediaEnabled} onChange={event => patchSettings({ autoMediaEnabled: event.target.checked })} />
          <ImagePlus size={15} />
          <span>允许自动回复按素材标签附带图片；只使用资源库中已明确开启“允许自动发送”的素材</span>
        </label>

        {automationStatus && automationStatus.items.length > 0 && (
          <div className="wechat-reply-automation-list" aria-label="最近自动回复记录">
            {automationStatus.items.slice(0, 8).map(item => (
              <div className="wechat-reply-automation-row" key={item.id}>
                 <div><strong>{item.sessionName}</strong><span>{item.targetMessage || item.message}{item.generatedImageName ? ' · 将发送生成图片' : item.mediaAssetName ? ` · 将附带：${item.mediaAssetName}` : ''}{item.knowledgeSourceNames?.length ? ` · 知识库：${item.knowledgeSourceNames.join('、')}` : ''}{item.webSourceNames?.length ? ` · 公开网页：${item.webSourceNames.length} 条` : ''}</span></div>
                <div className="wechat-reply-automation-state">
                  <span className={item.state}>{item.state === 'countdown' && item.sendAt ? `${item.message} · ${Math.max(0, Math.ceil((item.sendAt - Date.now()) / 1000))} 秒后发送` : item.message}</span>
                  {item.state === 'countdown' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => void cancelPending(item.id)}><TimerReset size={13} />取消</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="wechat-reply-section" aria-labelledby="reply-status-heading">
        <div className="wechat-reply-section-heading">
          <div>
            <h2 id="reply-status-heading">发送器状态</h2>
            <p>先检测 Python、兼容引擎与微信连接，再通过测试消息验证微信窗口名称。</p>
          </div>
          <button type="button" className="btn btn-secondary" disabled={checking} onClick={() => void checkEnvironment()}>
            {checking ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
            {checking ? '检测中' : '检测环境'}
          </button>
        </div>

        <div className="wechat-reply-status-grid">
          <div className="wechat-reply-status-item">
            <span>运行平台</span>
            <strong className={status?.platformSupported ? 'ok' : 'bad'}>{status?.platformSupported ? 'Windows · 支持' : '当前平台不支持'}</strong>
          </div>
          <div className="wechat-reply-status-item">
            <span>Python / 微信兼容引擎</span>
            <strong className={environmentOk ? 'ok' : 'muted'}>{status?.environment?.message || '尚未检测'}</strong>
          </div>
          <div className="wechat-reply-status-item">
            <span>发送熔断</span>
            <strong className={status?.circuitOpen ? 'bad' : 'ok'}>{status?.circuitOpen ? '已触发，请停用后检查' : '未触发'}</strong>
          </div>
          <div className="wechat-reply-status-item">
            <span>发送计数</span>
            <strong>{status?.sentThisHour || 0} / 小时 · {status?.sentToday || 0} / 24 小时</strong>
          </div>
        </div>

        <label className="wechat-reply-field wide">
          <span>Python 可执行文件</span>
          <input value={settings.pythonPath} onChange={event => patchSettings({ pythonPath: event.target.value })} placeholder="python 或 C:\\Python311\\python.exe" />
          <small>开发模式填写 python 时会自动使用项目内的 .venv-wxauto，其中包含 wxauto4 与微信 4.1 兼容层；路径仅保存在本机。</small>
        </label>
      </section>

      <section className="wechat-reply-section" aria-labelledby="reply-bindings-heading">
        <div className="wechat-reply-section-heading">
          <div>
            <h2 id="reply-bindings-heading">会话绑定</h2>
            <p>WeFlow 使用 wxid，而发送引擎通过窗口名称定位聊天。建议为好友设置唯一备注名。</p>
          </div>
          <span className="wechat-reply-count">{settings.bindings.filter(binding => binding.enabled).length} 个已启用</span>
        </div>

        <label className="wechat-reply-session-search" htmlFor="wechat-reply-session-search">
          <span className="wechat-reply-search-label">搜索要绑定的好友或群聊</span>
          <span className="wechat-reply-search-control">
            <Search size={16} aria-hidden="true" />
            <input
              id="wechat-reply-session-search"
              type="search"
              value={sessionSearch}
              onChange={event => setSessionSearch(event.target.value)}
              placeholder="输入好友备注、群名或 wxid"
              autoComplete="off"
            />
            <small aria-live="polite">{filteredSessions.length} 个结果</small>
          </span>
        </label>

        <div className="wechat-reply-binding-form">
          <label className="wechat-reply-field">
            <span>WeFlow 会话</span>
            <select value={newSessionId} onChange={event => {
              const sessionId = event.target.value
              setNewSessionId(sessionId)
              const session = sessions.find(item => item.username === sessionId)
              setNewTargetName(session ? sessionLabel(session) : '')
            }}>
              <option value="">{filteredSessions.length > 0 ? '选择好友或群聊' : '没有匹配的好友或群聊'}</option>
              {filteredSessions.map(session => <option value={session.username} key={session.username}>{session.username.endsWith('@chatroom') ? '群聊' : '好友'} · {sessionLabel(session)}</option>)}
            </select>
          </label>
          <label className="wechat-reply-field">
            <span>微信窗口中的准确名称</span>
            <input value={newTargetName} onChange={event => setNewTargetName(event.target.value)} placeholder="好友备注名或群名" />
          </label>
          <button type="button" className="btn btn-secondary" onClick={addBinding}><Plus size={15} />添加绑定</button>
        </div>

        {settings.bindings.length === 0 ? (
          <div className="wechat-reply-empty"><Link2 size={20} /><span>尚未绑定会话。发送器不会向任何聊天发送消息。</span></div>
        ) : (
          <div className="wechat-reply-binding-list">
            {settings.bindings.map(binding => (
              <div className="wechat-reply-binding-row" key={binding.id}>
                <label className="wechat-reply-check">
                  <input type="checkbox" checked={binding.enabled} onChange={event => updateBinding(binding.id, { enabled: event.target.checked })} />
                  <span className="sr-only">启用 {binding.sessionName}</span>
                </label>
                <div className="wechat-reply-binding-session">
                  <strong>{binding.sessionName}</strong>
                  <span>{binding.sessionId}</span>
                </div>
                <input aria-label={`${binding.sessionName} 的微信窗口名称`} title="微信窗口名称" value={binding.targetName} onChange={event => updateBinding(binding.id, { targetName: event.target.value })} />
                <div className="wechat-reply-member-picker">
                  <button
                    type="button"
                    className="wechat-reply-member-trigger"
                    disabled={!binding.sessionId.endsWith('@chatroom')}
                    aria-expanded={memberPickerBindingId === binding.id}
                    aria-controls={`fallback-member-${binding.id}`}
                    title="回答不了时 @ 的群成员"
                    onClick={() => void openMemberPicker(binding)}
                  >
                    <UserRoundSearch size={14} />
                    <span>{binding.sessionId.endsWith('@chatroom') ? binding.fallbackMentionUsername ? binding.fallbackMentionName : binding.fallbackMentionName ? '请重新选择成员' : '选择兜底成员' : '仅群聊可用'}</span>
                    <ChevronDown size={13} />
                  </button>
                  {memberPickerBindingId === binding.id && (
                    <div className="wechat-reply-member-popover" id={`fallback-member-${binding.id}`} role="dialog" aria-label={`${binding.sessionName} 的兜底成员选择器`}>
                      <div className="wechat-reply-member-popover-head">
                        <strong>选择群成员</strong>
                        <button type="button" className="icon-button" aria-label="关闭成员选择器" onClick={() => setMemberPickerBindingId('')}><X size={14} /></button>
                      </div>
                      <label className="wechat-reply-member-search">
                        <Search size={14} aria-hidden="true" />
                        <input autoFocus type="search" value={memberSearch} onChange={event => setMemberSearch(event.target.value)} placeholder="搜索群昵称、备注或 wxid" />
                      </label>
                      <div className="wechat-reply-member-results" role="listbox">
                        {memberLoadingSessionId === binding.sessionId ? (
                          <div className="wechat-reply-member-state"><LoaderCircle className="spin" size={15} />正在加载群成员…</div>
                        ) : memberLoadErrors[binding.sessionId] ? (
                          <div className="wechat-reply-member-state error"><span>{memberLoadErrors[binding.sessionId]}</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadGroupMembersForBinding(binding)}>重试</button></div>
                        ) : (() => {
                          const keyword = memberSearch.trim().toLocaleLowerCase('zh-CN')
                          const members = (groupMembers[binding.sessionId] || []).filter(member => !keyword || [member.displayName, member.groupNickname, member.remark, member.nickname, member.alias, member.username].some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(keyword)))
                          if (members.length === 0) return <div className="wechat-reply-member-state">没有匹配的群成员</div>
                          return members.slice(0, 100).map(member => {
                            const primaryName = member.groupNickname || member.remark || member.displayName || member.nickname || member.username
                            const secondaryName = [member.displayName, member.username].filter(value => value && value !== primaryName).join(' · ')
                            const selected = member.username === binding.fallbackMentionUsername
                            return <button type="button" role="option" aria-selected={selected} className={`wechat-reply-member-option ${selected ? 'selected' : ''}`} key={member.username} onClick={() => selectFallbackMember(binding.id, member)}><span><strong>{primaryName}{member.isOwner ? ' · 群主' : ''}</strong><small>{secondaryName}</small></span>{selected && <CheckCircle2 size={15} />}</button>
                          })
                        })()}
                      </div>
                      {binding.fallbackMentionName && <button type="button" className="wechat-reply-member-clear" onClick={() => selectFallbackMember(binding.id)}>清除兜底成员</button>}
                    </div>
                  )}
                </div>
                <label className="wechat-reply-auto-check" title={binding.sessionId.endsWith('@chatroom') ? '仅在群成员明确 @你时自动回复' : '允许该私聊进入自动回复'}>
                  <input type="checkbox" checked={binding.autoReplyEnabled} disabled={!binding.enabled} onChange={event => updateBinding(binding.id, { autoReplyEnabled: event.target.checked })} />
                  <span>{binding.sessionId.endsWith('@chatroom') ? '被 @ 时自动' : '自动'}</span>
                </label>
                <button type="button" className="icon-button danger" aria-label={`删除 ${binding.sessionName} 绑定`} onClick={() => removeBinding(binding.id)}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="wechat-reply-section" aria-labelledby="reply-fallback-heading">
        <div className="wechat-reply-section-heading compact">
          <div><h2 id="reply-fallback-heading">回答失败时转交</h2><p>当模型失败、输出被安全策略拦截或问题敏感时，自动在对应群聊 @ 上方为该群配置的成员。</p></div>
        </div>
        <label className="wechat-reply-field wide"><span>转交消息</span><input maxLength={500} value={settings.fallbackMentionTemplate} onChange={event => patchSettings({ fallbackMentionTemplate: event.target.value })} /><small>成员姓名在每个群聊绑定中单独设置；私聊不会自动转交。</small></label>
      </section>

      <section className="wechat-reply-two-column">
        <div className="wechat-reply-section">
          <div className="wechat-reply-section-heading compact">
            <div><h2>草稿工作台</h2><p>读取所选会话最近的纯文本消息，生成后由你检查并手动发送。</p></div>
          </div>
          <label className="wechat-reply-field wide">
            <span>草稿目标</span>
            <select value={testBindingId} onChange={event => setTestBindingId(event.target.value)}>
              <option value="">选择已绑定会话</option>
              {settings.bindings.filter(binding => binding.enabled).map(binding => <option value={binding.id} key={binding.id}>{binding.sessionName} → {binding.targetName}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-secondary" disabled={generatingDraft || !settings.aiEnabled || !selectedTestBinding || !aiStatus?.configured} onClick={() => void generateDraft()}>
            {generatingDraft ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}
            {generatingDraft ? '正在读取上下文并生成' : '根据最近聊天生成草稿'}
          </button>
          {draftTargetMessage && <div className="wechat-reply-draft-source"><span>正在回复</span><p>{draftTargetMessage}</p><small>{draftMeta}</small></div>}
          <label className="wechat-reply-field wide">
            <span>发送前编辑</span>
            <textarea rows={4} maxLength={1000} value={testContent} onChange={event => setTestContent(event.target.value)} />
            <small>{testContent.length} / 1000</small>
          </label>
          <label className="wechat-reply-field wide wechat-reply-media-picker">
            <span>资源库回复素材</span>
            <select value={selectedMediaAssetId} onChange={event => setSelectedMediaAssetId(event.target.value)}>
              <option value="">{mediaAssets.length > 0 ? '选择素材' : '尚未添加回复素材'}</option>
              {mediaAssets.map(asset => (
                <option value={asset.id} key={asset.id}>
                  {asset.kind === 'emoji' ? '表情' : '图片'} · {asset.name}{asset.tags.length ? ` · ${asset.tags.join('、')}` : ''}
                </option>
              ))}
            </select>
            <small>素材由资源库复制到本地稳定目录；发送前仍会检查会话范围和频率限制。</small>
          </label>
          <div className="wechat-reply-send-actions" aria-label="发送操作">
            <button type="button" className="btn btn-secondary" disabled={testing || mediaSending !== null || !selectedTestBinding || !riskAccepted} onClick={() => void sendTest()}>
              {testing ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}
              {testing ? '正在发送文字' : '发送文字'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={testing || mediaSending !== null || !selectedTestBinding || !riskAccepted} onClick={() => void sendMediaTest('image')}>
              {mediaSending === 'image' ? <LoaderCircle className="spin" size={15} /> : <ImagePlus size={15} />}
              {mediaSending === 'image' ? '正在发送图片' : '发送图片'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={testing || mediaSending !== null || !selectedTestBinding || !riskAccepted} onClick={() => void sendMediaTest('emoji')}>
              {mediaSending === 'emoji' ? <LoaderCircle className="spin" size={15} /> : <SmilePlus size={15} />}
              {mediaSending === 'emoji' ? '正在发送表情' : '发送表情包'}
            </button>
            <button type="button" className="btn btn-secondary" disabled={testing || mediaSending !== null || !selectedTestBinding || !selectedMediaAssetId || !riskAccepted} onClick={() => void sendLibraryAsset()}>
              {mediaSending === 'library' ? <LoaderCircle className="spin" size={15} /> : <BookmarkCheck size={15} />}
              {mediaSending === 'library' ? '正在发送素材' : '发送资源库素材'}
            </button>
          </div>
          <small className="wechat-reply-media-help">表情包以 GIF、WebP、PNG 或 JPG 图片形式发送；不会调用微信收藏表情。</small>
        </div>

        <div className="wechat-reply-section">
          <div className="wechat-reply-section-heading compact">
            <div><h2>强制安全策略</h2><p>这些限制在主进程执行，调用方不能绕过。</p></div>
          </div>
          <div className="wechat-reply-policy-grid">
            <label className="wechat-reply-field"><span>最短发送间隔（秒）</span><input type="number" min="5" max="3600" value={settings.minIntervalSeconds} onChange={event => patchSettings({ minIntervalSeconds: Number(event.target.value) })} /></label>
            <label className="wechat-reply-field"><span>每小时上限</span><input type="number" min="1" max="120" value={settings.hourlyLimit} onChange={event => patchSettings({ hourlyLimit: Number(event.target.value) })} /></label>
            <label className="wechat-reply-field"><span>每日上限</span><input type="number" min="1" max="500" value={settings.dailyLimit} onChange={event => patchSettings({ dailyLimit: Number(event.target.value) })} /></label>
            <label className="wechat-reply-field"><span>连续失败熔断</span><input type="number" min="1" max="10" value={settings.failureThreshold} onChange={event => patchSettings({ failureThreshold: Number(event.target.value) })} /></label>
            <label className="wechat-reply-field"><span>随机延迟下限（毫秒）</span><input type="number" min="0" max="60000" step="500" value={settings.randomDelayMinMs} onChange={event => patchSettings({ randomDelayMinMs: Number(event.target.value) })} /></label>
            <label className="wechat-reply-field"><span>随机延迟上限（毫秒）</span><input type="number" min="0" max="120000" step="500" value={settings.randomDelayMaxMs} onChange={event => patchSettings({ randomDelayMaxMs: Number(event.target.value) })} /></label>
          </div>
          <label className="wechat-reply-inline-check"><input type="checkbox" checked={settings.quietHoursEnabled} onChange={event => patchSettings({ quietHoursEnabled: event.target.checked })} /><Clock3 size={15} /><span>启用安静时段</span></label>
          <div className="wechat-reply-quiet-hours">
            <label className="wechat-reply-field"><span>开始</span><input type="time" disabled={!settings.quietHoursEnabled} value={settings.quietHoursStart} onChange={event => patchSettings({ quietHoursStart: event.target.value })} /></label>
            <label className="wechat-reply-field"><span>结束</span><input type="time" disabled={!settings.quietHoursEnabled} value={settings.quietHoursEnd} onChange={event => patchSettings({ quietHoursEnd: event.target.value })} /></label>
          </div>
        </div>
      </section>

      <section className="wechat-reply-activation">
        <div className="wechat-reply-activation-copy">
          {riskAccepted ? <ShieldCheck size={20} /> : <AlertTriangle size={20} />}
          <div>
            <strong>风险确认与发送总开关</strong>
            <p>确认只代表你理解风险，不代表此功能获得微信官方授权，也不代表账号绝对安全。</p>
          </div>
        </div>
        <label className="wechat-reply-consent">
          <input type="checkbox" checked={riskAccepted} onChange={event => patchSettings({ riskAcceptedAt: event.target.checked ? Date.now() : 0, enabled: event.target.checked ? settings.enabled : false })} />
          <span>我理解这是非官方自动化，并愿意使用小号、白名单和低频策略</span>
        </label>
        <label className={`wechat-reply-master ${settings.enabled ? 'enabled' : ''}`}>
          {settings.enabled ? <CheckCircle2 size={18} /> : <CircleStop size={18} />}
          <span><strong>{settings.enabled ? '发送器已准备启用' : '发送器保持关闭'}</strong><small>保存后生效；自动发送还要求 AI、自动模式和会话自动开关同时启用。</small></span>
          <input type="checkbox" checked={settings.enabled} disabled={!riskAccepted || settings.bindings.every(binding => !binding.enabled) || (settings.automationMode !== 'draft' && settings.bindings.every(binding => !binding.enabled || !binding.autoReplyEnabled))} onChange={event => patchSettings({ enabled: event.target.checked })} />
        </label>
        <div className="wechat-reply-last-sent">最近发送：{formatTime(status?.lastSentAt)}</div>
      </section>
    </main>
  )
}

export default WechatReplyPage
