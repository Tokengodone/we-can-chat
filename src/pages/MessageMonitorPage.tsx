import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  Radar, Search, Trash2, BellRing, Volume2, RotateCcw, Filter, Check, X, Hash, Users,
  Sparkles, Loader2, Wand2
} from 'lucide-react'
import * as configService from '../services/config'
import { Avatar } from '../components/Avatar'
import { displayNameOrFallback } from '../utils/displayName'
import type {
  ChatSession, ContactInfo
} from '../types/models'
import type {
  MessageAlertRecord, MessageAlertSessionFacet, MessageAlertKeywordFacet
} from '../types/electron'
import { MessageSupervisionRules } from '../components/MessageSupervisionRules'
import './MessageMonitorPage.scss'

type SessionMode = 'all' | 'whitelist' | 'blacklist'

interface SessionOption {
  username: string
  displayName: string
  avatarUrl?: string
}

function formatTime(ms: number): string {
  if (!ms) return ''
  const date = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function MessageMonitorPage() {
  // 规则配置
  const [enabled, setEnabled] = useState(false)
  const [keywordsInput, setKeywordsInput] = useState('')
  const [regex, setRegex] = useState('')
  const [regexError, setRegexError] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [includeRevoke, setIncludeRevoke] = useState(true)
  const [notify, setNotify] = useState(true)
  const [sound, setSound] = useState(true)
  const [sendersInput, setSendersInput] = useState('')
  const [sessionMode, setSessionMode] = useState<SessionMode>('all')
  const [sessionList, setSessionList] = useState<string[]>([])

  // AI 智能筛选
  const [aiEnabled, setAiEnabled] = useState(false)
  const [aiCriteria, setAiCriteria] = useState('')
  const [aiPrefilterInput, setAiPrefilterInput] = useState('')
  const [aiTesting, setAiTesting] = useState(false)
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  // 会话选择
  const [sessionOptions, setSessionOptions] = useState<SessionOption[]>([])
  const [sessionSearch, setSessionSearch] = useState('')

  // 命中记录
  const [records, setRecords] = useState<MessageAlertRecord[]>([])
  const [total, setTotal] = useState(0)
  const [todayCount, setTodayCount] = useState(0)
  const [sessionFacets, setSessionFacets] = useState<MessageAlertSessionFacet[]>([])
  const [keywordFacets, setKeywordFacets] = useState<MessageAlertKeywordFacet[]>([])
  const [recordSearch, setRecordSearch] = useState('')
  const [loadingRecords, setLoadingRecords] = useState(false)
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null)

  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const showToast = useCallback((text: string, ok = true) => {
    setToast({ text, ok })
    window.setTimeout(() => setToast(null), 1800)
  }, [])

  const scheduleSave = useCallback((key: string, fn: () => Promise<void> | void, delay = 500) => {
    const timers = saveTimersRef.current
    if (timers[key]) clearTimeout(timers[key])
    timers[key] = setTimeout(() => {
      delete timers[key]
      void fn()
    }, delay)
  }, [])

  const parseList = useCallback((value: string) => {
    return Array.from(new Set(
      value.split(/[,，\n]/).map(item => item.trim()).filter(Boolean)
    ))
  }, [])

  const loadRecords = useCallback(async () => {
    setLoadingRecords(true)
    try {
      const result = await window.electronAPI.messageAlert.listRecords({
        keyword: recordSearch.trim() || undefined,
        limit: 300
      })
      if (result.success) {
        setRecords(result.records)
        setTotal(result.total)
        setTodayCount(result.todayCount)
        setSessionFacets(result.sessions)
        setKeywordFacets(result.keywords)
      }
    } catch (e) {
      console.error('加载命中记录失败:', e)
    } finally {
      setLoadingRecords(false)
    }
  }, [recordSearch])

  // 初始化配置与会话选项
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      try {
        const [
          savedEnabled, savedKeywords, savedRegex, savedCase, savedRevoke,
          savedNotify, savedSound, savedSenders, savedSessionMode, savedSessionList,
          savedAiEnabled, savedAiCriteria, savedAiPrefilter
        ] = await Promise.all([
          configService.getMessageAlertEnabled(),
          configService.getMessageAlertKeywords(),
          configService.getMessageAlertRegex(),
          configService.getMessageAlertCaseSensitive(),
          configService.getMessageAlertIncludeRevoke(),
          configService.getMessageAlertNotify(),
          configService.getMessageAlertSound(),
          configService.getMessageAlertSenders(),
          configService.getMessageAlertSessionMode(),
          configService.getMessageAlertSessionList(),
          configService.getMessageAlertAiEnabled(),
          configService.getMessageAlertAiCriteria(),
          configService.getMessageAlertAiPrefilter()
        ])
        if (cancelled) return
        setEnabled(savedEnabled)
        setKeywordsInput(savedKeywords.join('，'))
        setRegex(savedRegex)
        setCaseSensitive(savedCase)
        setIncludeRevoke(savedRevoke)
        setNotify(savedNotify)
        setSound(savedSound)
        setSendersInput(savedSenders.join('，'))
        setSessionMode(savedSessionMode)
        setSessionList(savedSessionList)
        setAiEnabled(savedAiEnabled)
        setAiCriteria(savedAiCriteria)
        setAiPrefilterInput(savedAiPrefilter.join('，'))
      } catch (e) {
        console.error('加载消息监控配置失败:', e)
      }

      // 会话选项：会话列表 + 联系人
      try {
        const optionMap = new Map<string, SessionOption>()
        const sessionsResult = await window.electronAPI.chat.getSessions()
        if (sessionsResult?.success && Array.isArray(sessionsResult.sessions)) {
          for (const s of sessionsResult.sessions as ChatSession[]) {
            if (!s.username) continue
            optionMap.set(s.username, {
              username: s.username,
              displayName: displayNameOrFallback(s.username, s.displayName),
              avatarUrl: s.avatarUrl
            })
          }
        }
        const contactsResult = await window.electronAPI.chat.getContacts({ lite: true })
        if (contactsResult?.success && Array.isArray(contactsResult.contacts)) {
          for (const c of contactsResult.contacts as ContactInfo[]) {
            if (!c.username || optionMap.has(c.username)) continue
            optionMap.set(c.username, {
              username: c.username,
              displayName: displayNameOrFallback(c.username, c.displayName),
              avatarUrl: c.avatarUrl
            })
          }
        }
        if (!cancelled) setSessionOptions(Array.from(optionMap.values()))
      } catch (e) {
        console.error('加载会话选项失败:', e)
      }
    }
    void init()
    return () => {
      cancelled = true
      Object.values(saveTimersRef.current).forEach(clearTimeout)
    }
  }, [])

  useEffect(() => {
    void loadRecords()
  }, [loadRecords])

  // 实时命中推送
  useEffect(() => {
    const remove = window.electronAPI.messageAlert.onHit((record: MessageAlertRecord) => {
      setRecords(prev => {
        if (prev.some(item => item.id === record.id)) return prev
        return [record, ...prev].slice(0, 500)
      })
      setTotal(prev => prev + 1)
      setTodayCount(prev => prev + 1)
      setSessionFacets(prev => {
        const next = [...prev]
        const idx = next.findIndex(item => item.sessionId === record.sessionId)
        if (idx >= 0) {
          next[idx] = { ...next[idx], count: next[idx].count + 1 }
        } else {
          next.push({
            sessionId: record.sessionId,
            displayName: record.groupName || record.sourceName || record.sessionId,
            avatarUrl: record.avatarUrl,
            count: 1
          })
        }
        return next.sort((a, b) => b.count - a.count)
      })
      setKeywordFacets(prev => {
        const map = new Map(prev.map(item => [item.keyword, item.count]))
        for (const kw of record.matchedKeywords || []) {
          map.set(kw, (map.get(kw) || 0) + 1)
        }
        return Array.from(map.entries())
          .map(([keyword, count]) => ({ keyword, count }))
          .sort((a, b) => b.count - a.count)
      })
    })
    return () => { remove?.() }
  }, [])

  // 校验正则
  useEffect(() => {
    if (!regex.trim()) {
      setRegexError('')
      return
    }
    try {
      // eslint-disable-next-line no-new
      new RegExp(regex, caseSensitive ? '' : 'i')
      setRegexError('')
    } catch {
      setRegexError('格式不正确，请检查括号、转义符和重复符号')
    }
  }, [regex, caseSensitive])

  const handleToggleEnabled = async (value: boolean) => {
    setEnabled(value)
    await configService.setMessageAlertEnabled(value)
    showToast(value ? '已开启消息监控' : '已关闭消息监控')
  }

  const handleKeywordsChange = (value: string) => {
    setKeywordsInput(value)
    scheduleSave('keywords', () => configService.setMessageAlertKeywords(parseList(value)))
  }

  const handleRegexChange = (value: string) => {
    setRegex(value)
    scheduleSave('regex', () => configService.setMessageAlertRegex(value))
  }

  const handleSendersChange = (value: string) => {
    setSendersInput(value)
    scheduleSave('senders', () => configService.setMessageAlertSenders(parseList(value)))
  }

  const handleSessionMode = async (mode: SessionMode) => {
    setSessionMode(mode)
    await configService.setMessageAlertSessionMode(mode)
  }

  const addSession = async (username: string) => {
    if (sessionList.includes(username)) return
    const next = [...sessionList, username]
    setSessionList(next)
    await configService.setMessageAlertSessionList(next)
  }

  const removeSession = async (username: string) => {
    const next = sessionList.filter(item => item !== username)
    setSessionList(next)
    await configService.setMessageAlertSessionList(next)
  }

  const handleToggleAi = async (value: boolean) => {
    setAiEnabled(value)
    await configService.setMessageAlertAiEnabled(value)
    showToast(value ? '已开启 AI 智能筛选' : '已关闭 AI 智能筛选')
  }

  const handleAiCriteriaChange = (value: string) => {
    setAiCriteria(value)
    scheduleSave('aiCriteria', () => configService.setMessageAlertAiCriteria(value))
  }

  const handleAiPrefilterChange = (value: string) => {
    setAiPrefilterInput(value)
    scheduleSave('aiPrefilter', () => configService.setMessageAlertAiPrefilter(parseList(value)))
  }

  const handleTestAi = async () => {
    setAiTesting(true)
    setAiTestResult(null)
    try {
      const result = await window.electronAPI.insight.testConnection()
      setAiTestResult({ ok: result.success, msg: result.message })
    } catch (e) {
      setAiTestResult({ ok: false, msg: (e as Error).message })
    } finally {
      setAiTesting(false)
    }
  }

  const handleClearRecords = async () => {
    try {
      const result = await window.electronAPI.messageAlert.clearRecords({})
      if (result.success) {
        setRecords([])
        setTotal(0)
        setTodayCount(0)
        setSessionFacets([])
        setKeywordFacets([])
        showToast(`已清空 ${result.removed} 条命中记录`)
      }
    } catch (e) {
      showToast('清空失败', false)
    }
  }

  const availableSessionOptions = useMemo(() => {
    const keyword = sessionSearch.trim().toLowerCase()
    return sessionOptions
      .filter(opt => !sessionList.includes(opt.username))
      .filter(opt => !keyword || opt.displayName.toLowerCase().includes(keyword) || opt.username.toLowerCase().includes(keyword))
      .slice(0, 50)
  }, [sessionOptions, sessionList, sessionSearch])

  const getSessionOptionInfo = useCallback((username: string): SessionOption => {
    return sessionOptions.find(opt => opt.username === username) || {
      username,
      displayName: displayNameOrFallback(username, ''),
    }
  }, [sessionOptions])

  const filteredRecords = useMemo(() => {
    const keyword = recordSearch.trim().toLowerCase()
    if (!keyword) return records
    return records.filter(record => {
      const haystack = [
        record.sourceName, record.groupName, record.sessionId, record.content,
        (record.matchedKeywords || []).join(' ')
      ].join('\n').toLowerCase()
      return haystack.includes(keyword)
    })
  }, [records, recordSearch])

  const ruleConfigured = keywordsInput.trim().length > 0 || regex.trim().length > 0
  const aiConfigured = aiEnabled && aiCriteria.trim().length > 0
  const rulesConfigured = ruleConfigured || aiConfigured

  return (
    <div className="message-monitor-page">
      <header className="mm-header">
        <div className="mm-header-title">
          <span className="mm-header-icon"><Radar size={22} /></span>
          <div>
            <h1>消息监控</h1>
            <p>实时监听新消息，命中筛选规则时提醒你</p>
          </div>
        </div>
        <div className="mm-header-actions">
          <div className={`mm-status ${enabled ? 'on' : 'off'}`}>
            <span className="dot" />
            {enabled ? '监控中' : '已停止'}
          </div>
          <label className="switch" title="开启/关闭监控">
            <input
              type="checkbox"
              className="switch-input"
              checked={enabled}
              onChange={(e) => { void handleToggleEnabled(e.target.checked) }}
            />
            <span className="switch-slider" />
          </label>
        </div>
      </header>

      {enabled && !rulesConfigured && (
        <div className="mm-warning">
          监控已开启，但还没有配置任何筛选条件（关键词/正则，或 AI 智能筛选），暂时不会触发提醒。
        </div>
      )}

      <div className="mm-body">
        <div className="mm-left">
        <MessageSupervisionRules />
        {/* AI 智能筛选 */}
        <section className="mm-panel mm-ai">
          <div className="mm-panel-title">
            <Sparkles size={16} /> AI 智能筛选
            <label className="switch mm-title-switch">
              <input
                type="checkbox"
                className="switch-input"
                checked={aiEnabled}
                onChange={(e) => { void handleToggleAi(e.target.checked) }}
              />
              <span className="switch-slider" />
            </label>
          </div>
          <span className="mm-hint mm-ai-hint">
            用大白话写筛选条件，AI 会读懂每条消息并判断是否符合（比关键词/正则更能理解“时薪100以上”“线上”等语义）。需先在「设置 → AI 基础配置」填好模型 API。
          </span>

          <div className="mm-field">
            <div className="mm-field-label-row">
              <label>筛选条件（自然语言）</label>
              <button
                type="button"
                className="mm-mini-btn"
                onClick={() => handleAiCriteriaChange('我在找家教信息，需要同时满足：1) 科目是数学，且学段是小学、初中、高一或高二；2) 时薪 100 元以上；3) 授课形式是线上。三个条件必须全部满足才算符合。')}
                title="填入家教示例"
              >
                <Wand2 size={12} /> 填入示例
              </button>
            </div>
            <textarea
              value={aiCriteria}
              placeholder="例如：数学（小学/初中/高一/高二），时薪100以上，线上授课，三个条件都要满足"
              rows={4}
              onChange={(e) => handleAiCriteriaChange(e.target.value)}
            />
          </div>

          <div className="mm-field">
            <label>预筛关键词 <span className="opt">强烈建议填</span></label>
            <span className="mm-hint">只有包含这些词的消息才会送给 AI 判断，用来省钱省算力。例如：家教，数学，辅导</span>
            <input
              type="text"
              value={aiPrefilterInput}
              placeholder="家教，数学，辅导"
              onChange={(e) => handleAiPrefilterChange(e.target.value)}
            />
          </div>

          <div className="mm-ai-test">
            <button className="mm-btn" onClick={() => { void handleTestAi() }} disabled={aiTesting}>
              {aiTesting ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
              {aiTesting ? '测试中...' : '测试 AI 连接'}
            </button>
            {aiTestResult && (
              <span className={`mm-ai-test-result ${aiTestResult.ok ? 'ok' : 'err'}`}>
                {aiTestResult.ok ? <Check size={13} /> : <X size={13} />} {aiTestResult.msg}
              </span>
            )}
          </div>
        </section>

        {/* 左侧：规则配置 */}
        <section className="mm-panel mm-rules">
          <div className="mm-panel-title"><Filter size={16} /> 关键词 / 正则规则</div>

          <div className="mm-field">
            <label>关键词</label>
            <span className="mm-hint">多个关键词用逗号或换行分隔，命中任意一个即提醒</span>
            <textarea
              value={keywordsInput}
              placeholder="付款，合同，紧急"
              rows={3}
              onChange={(e) => handleKeywordsChange(e.target.value)}
            />
          </div>

          <div className="mm-field">
            <label>正则表达式 <span className="opt">可选</span></label>
            <span className="mm-hint">用于更复杂匹配，例如 <code>(异常|失败|报错)</code></span>
            <input
              type="text"
              className={regexError ? 'has-error' : ''}
              value={regex}
              placeholder="(异常|失败|报错)"
              onChange={(e) => handleRegexChange(e.target.value)}
            />
            {regexError && <span className="mm-error">正则无效：{regexError}</span>}
          </div>

          <div className="mm-field">
            <label>发送人过滤 <span className="opt">可选</span></label>
            <span className="mm-hint">只提醒指定发送人（按昵称/备注包含匹配），多个用逗号分隔</span>
            <input
              type="text"
              value={sendersInput}
              placeholder="张三，李四"
              onChange={(e) => handleSendersChange(e.target.value)}
            />
          </div>

          <div className="mm-toggles">
            <label className="mm-toggle-row">
              <span>区分大小写</span>
              <label className="switch">
                <input type="checkbox" className="switch-input" checked={caseSensitive}
                  onChange={async (e) => { setCaseSensitive(e.target.checked); await configService.setMessageAlertCaseSensitive(e.target.checked) }} />
                <span className="switch-slider" />
              </label>
            </label>
            <label className="mm-toggle-row">
              <span>匹配撤回消息</span>
              <label className="switch">
                <input type="checkbox" className="switch-input" checked={includeRevoke}
                  onChange={async (e) => { setIncludeRevoke(e.target.checked); await configService.setMessageAlertIncludeRevoke(e.target.checked) }} />
                <span className="switch-slider" />
              </label>
            </label>
            <label className="mm-toggle-row">
              <span><BellRing size={14} /> 命中桌面弹窗</span>
              <label className="switch">
                <input type="checkbox" className="switch-input" checked={notify}
                  onChange={async (e) => { setNotify(e.target.checked); await configService.setMessageAlertNotify(e.target.checked) }} />
                <span className="switch-slider" />
              </label>
            </label>
            <label className="mm-toggle-row">
              <span><Volume2 size={14} /> 命中声音提醒</span>
              <label className="switch">
                <input type="checkbox" className="switch-input" checked={sound}
                  onChange={async (e) => { setSound(e.target.checked); await configService.setMessageAlertSound(e.target.checked) }} />
                <span className="switch-slider" />
              </label>
            </label>
          </div>

          <div className="mm-field">
            <label>会话范围</label>
            <div className="mm-mode-tabs">
              {([
                { value: 'all', label: '全部会话' },
                { value: 'whitelist', label: '仅白名单' },
                { value: 'blacklist', label: '屏蔽黑名单' }
              ] as Array<{ value: SessionMode; label: string }>).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  className={`mm-mode-tab ${sessionMode === opt.value ? 'active' : ''}`}
                  onClick={() => { void handleSessionMode(opt.value) }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {sessionMode !== 'all' && (
              <div className="mm-session-picker">
                <div className="mm-session-search">
                  <Search size={14} />
                  <input
                    type="text"
                    placeholder="搜索会话添加到列表..."
                    value={sessionSearch}
                    onChange={(e) => setSessionSearch(e.target.value)}
                  />
                </div>
                {sessionSearch.trim() && (
                  <div className="mm-session-options">
                    {availableSessionOptions.length > 0 ? availableSessionOptions.map(opt => (
                      <div key={opt.username} className="mm-session-option" onClick={() => { void addSession(opt.username) }}>
                        <Avatar src={opt.avatarUrl} name={opt.displayName} size={24} />
                        <span className="name">{opt.displayName}</span>
                        <span className="add">+</span>
                      </div>
                    )) : <div className="mm-session-empty">没有匹配的会话</div>}
                  </div>
                )}
                <div className="mm-session-chips">
                  {sessionList.length > 0 ? sessionList.map(username => {
                    const info = getSessionOptionInfo(username)
                    return (
                      <span key={username} className="mm-chip" onClick={() => { void removeSession(username) }}>
                        <Avatar src={info.avatarUrl} name={info.displayName} size={18} />
                        {info.displayName}
                        <X size={12} />
                      </span>
                    )
                  }) : <span className="mm-session-empty">
                    {sessionMode === 'whitelist' ? '未添加会话时不会有任何命中' : '未添加会话，暂不屏蔽任何会话'}
                  </span>}
                </div>
              </div>
            )}
          </div>
        </section>
        </div>

        {/* 右侧：命中记录 + 统计 */}
        <section className="mm-panel mm-hits">
          <div className="mm-stats">
            <div className="mm-stat">
              <span className="value">{total}</span>
              <span className="label">累计命中</span>
            </div>
            <div className="mm-stat">
              <span className="value">{todayCount}</span>
              <span className="label">今日命中</span>
            </div>
            <div className="mm-stat">
              <span className="value">{sessionFacets.length}</span>
              <span className="label">涉及会话</span>
            </div>
          </div>

          {(keywordFacets.length > 0 || sessionFacets.length > 0) && (
            <div className="mm-facets">
              {keywordFacets.length > 0 && (
                <div className="mm-facet-group">
                  <div className="mm-facet-title"><Hash size={13} /> 高频命中关键词</div>
                  <div className="mm-facet-tags">
                    {keywordFacets.slice(0, 8).map(f => (
                      <span key={f.keyword} className="mm-facet-tag">{f.keyword}<b>{f.count}</b></span>
                    ))}
                  </div>
                </div>
              )}
              {sessionFacets.length > 0 && (
                <div className="mm-facet-group">
                  <div className="mm-facet-title"><Users size={13} /> 高频命中会话</div>
                  <div className="mm-facet-tags">
                    {sessionFacets.slice(0, 6).map(f => (
                      <span key={f.sessionId} className="mm-facet-tag">{f.displayName}<b>{f.count}</b></span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mm-hits-toolbar">
            <div className="mm-session-search grow">
              <Search size={14} />
              <input
                type="text"
                placeholder="搜索命中记录..."
                value={recordSearch}
                onChange={(e) => setRecordSearch(e.target.value)}
              />
            </div>
            <button className="mm-btn" onClick={() => { void loadRecords() }} title="刷新">
              <RotateCcw size={14} /> 刷新
            </button>
            <button className="mm-btn danger" onClick={() => { void handleClearRecords() }} disabled={total === 0} title="清空记录">
              <Trash2 size={14} /> 清空
            </button>
          </div>

          <div className="mm-hits-list">
            {loadingRecords && filteredRecords.length === 0 ? (
              <div className="mm-hits-empty">加载中...</div>
            ) : filteredRecords.length === 0 ? (
              <div className="mm-hits-empty">
                {total === 0 ? '暂无命中记录，配置规则后收到的匹配消息会出现在这里' : '没有匹配的记录'}
              </div>
            ) : filteredRecords.map(record => (
              <div key={record.id} className={`mm-hit ${record.event === 'message.revoke' ? 'revoke' : ''}`}>
                <Avatar src={record.avatarUrl} name={record.groupName || record.sourceName} size={38} />
                <div className="mm-hit-main">
                  <div className="mm-hit-top">
                    <span className="mm-hit-name">
                      {record.sessionType === 'group' && record.groupName
                        ? `${record.groupName} · ${record.sourceName}`
                        : record.sourceName || record.sessionId}
                    </span>
                    {record.matchType === 'ai' && <span className="mm-tag-ai"><Sparkles size={10} /> AI</span>}
                    {record.event === 'message.revoke' && <span className="mm-tag-revoke">撤回</span>}
                    <span className="mm-hit-time">{formatTime(record.createdAt)}</span>
                  </div>
                  <div className="mm-hit-content">{record.content || '[无内容]'}</div>
                  {record.matchType === 'ai' && record.aiSummary && (
                    <div className="mm-hit-ai-reason">AI 总结：{record.aiSummary}</div>
                  )}
                  {record.matchType === 'ai' && record.aiReason && (
                    <div className="mm-hit-ai-reason">{record.aiReason}</div>
                  )}
                  {(record.matchedKeywords.length > 0 || record.matchedRegex) && (
                    <div className="mm-hit-matches">
                      {record.matchedKeywords.map(kw => (
                        <span key={kw} className="mm-match-tag">{kw}</span>
                      ))}
                      {record.matchedRegex && <span className="mm-match-tag regex">正则</span>}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {toast && (
        <div className={`mm-toast ${toast.ok ? 'ok' : 'err'}`}>
          {toast.ok ? <Check size={14} /> : <X size={14} />} {toast.text}
        </div>
      )}
    </div>
  )
}

export default MessageMonitorPage
