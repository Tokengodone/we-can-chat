import { useCallback, useEffect, useMemo, useState } from 'react'
import { BellRing, Check, Edit3, Plus, ShieldCheck, Sparkles, Trash2, Volume2, X } from 'lucide-react'
import * as configService from '../services/config'
import type { MessageAlertRule } from '../services/config'
import type { ChatSession, ContactInfo } from '../types/models'
import { Avatar } from './Avatar'
import { displayNameOrFallback } from '../utils/displayName'

interface SessionOption {
  username: string
  displayName: string
  avatarUrl?: string
  type: 'group' | 'contact' | 'other'
}

interface GroupMemberOption {
  username: string
  displayName: string
  avatarUrl?: string
}

const emptyDraft = (): MessageAlertRule => ({
  id: '',
  name: '',
  enabled: true,
  targetType: 'session',
  sessionId: '',
  sessionName: '',
  sessionType: 'private',
  senderIds: [],
  senderNames: [],
  criteria: '',
  prefilter: [],
  notify: true,
  sound: true,
  batchWindowSeconds: 3,
  createdAt: Date.now(),
  updatedAt: Date.now()
})

function ruleTargetText(rule: MessageAlertRule): string {
  const target = rule.sessionName || rule.sessionId
  if (rule.targetType === 'group' && rule.senderNames.length > 0) {
    return `${target} · ${rule.senderNames.slice(0, 3).join('、')}${rule.senderNames.length > 3 ? ' 等' : ''}`
  }
  if (rule.targetType === 'group') return `${target} · 全体成员`
  return `${target} · 私聊消息`
}

export function MessageSupervisionRules() {
  const [rules, setRules] = useState<MessageAlertRule[]>([])
  const [sessions, setSessions] = useState<SessionOption[]>([])
  const [members, setMembers] = useState<GroupMemberOption[]>([])
  const [draft, setDraft] = useState<MessageAlertRule | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [error, setError] = useState('')
  const [memberSearch, setMemberSearch] = useState('')

  const loadSessions = useCallback(async () => {
    const map = new Map<string, SessionOption>()
    try {
      const sessionsResult = await window.electronAPI.chat.getSessions()
      if (sessionsResult?.success && Array.isArray(sessionsResult.sessions)) {
        for (const session of sessionsResult.sessions as ChatSession[]) {
          if (!session.username) continue
          const isGroup = session.username.endsWith('@chatroom') || Number(session.type) === 2
          map.set(session.username, {
            username: session.username,
            displayName: displayNameOrFallback(session.username, session.displayName),
            avatarUrl: session.avatarUrl,
            type: isGroup ? 'group' : 'contact'
          })
        }
      }
      const contactsResult = await window.electronAPI.chat.getContacts({ lite: true })
      if (contactsResult?.success && Array.isArray(contactsResult.contacts)) {
        for (const contact of contactsResult.contacts as ContactInfo[]) {
          if (!contact.username || map.has(contact.username)) continue
          map.set(contact.username, {
            username: contact.username,
            displayName: displayNameOrFallback(contact.username, contact.displayName),
            avatarUrl: contact.avatarUrl,
            type: contact.type === 'group' ? 'group' : 'contact'
          })
        }
      }
      setSessions(Array.from(map.values()).sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN')))
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const loadRules = useCallback(async () => {
    setLoading(true)
    try {
      setRules(await configService.getMessageAlertRules())
      await loadSessions()
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [loadSessions])

  useEffect(() => { void loadRules() }, [loadRules])

  const loadMembers = useCallback(async (sessionId: string) => {
    if (!sessionId) { setMembers([]); return }
    setLoadingMembers(true)
    try {
      const result = await window.electronAPI.groupAnalytics.getGroupMembers(sessionId)
      setMembers(result.success && Array.isArray(result.data) ? result.data : [])
    } catch {
      setMembers([])
    } finally {
      setLoadingMembers(false)
    }
  }, [])

  const startNew = () => {
    setError('')
    setMemberSearch('')
    setMembers([])
    setDraft(emptyDraft())
  }

  const startEdit = (rule: MessageAlertRule) => {
    setError('')
    setMemberSearch('')
    setDraft({ ...rule, senderIds: [...rule.senderIds], senderNames: [...rule.senderNames] })
    const selected = sessions.find(item => item.username === rule.sessionId)
    if (selected?.type === 'group' || rule.targetType === 'group') void loadMembers(rule.sessionId)
  }

  const updateDraft = (patch: Partial<MessageAlertRule>) => setDraft(current => current ? { ...current, ...patch } : current)

  const chooseSession = (sessionId: string) => {
    const selected = sessions.find(item => item.username === sessionId)
    const isGroup = selected?.type === 'group' || sessionId.endsWith('@chatroom')
    updateDraft({
      sessionId,
      sessionName: selected?.displayName || sessionId,
      sessionType: isGroup ? 'group' : 'private',
      targetType: isGroup ? 'group' : 'contact',
      senderIds: [],
      senderNames: []
    })
    setMemberSearch('')
    if (isGroup) void loadMembers(sessionId)
    else setMembers([])
  }

  const toggleMember = (member: GroupMemberOption) => {
    if (!draft) return
    const included = draft.senderIds.includes(member.username)
    updateDraft({
      senderIds: included ? draft.senderIds.filter(id => id !== member.username) : [...draft.senderIds, member.username],
      senderNames: included ? draft.senderNames.filter(name => name !== member.displayName) : [...draft.senderNames, member.displayName]
    })
  }

  const saveDraft = async () => {
    if (!draft) return
    if (!draft.sessionId) { setError('请选择要监督的群聊或联系人'); return }
    if (!draft.criteria.trim()) { setError('请填写 AI 判断要求'); return }
    if (!draft.id) draft.id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const next = rules.some(rule => rule.id === draft.id)
      ? rules.map(rule => rule.id === draft.id ? { ...draft, updatedAt: Date.now() } : rule)
      : [...rules, { ...draft, createdAt: Date.now(), updatedAt: Date.now() }]
    try {
      await configService.setMessageAlertRules(next)
      await configService.setMessageAlertEnabled(true)
      setRules(next)
      setDraft(null)
      setError('')
    } catch (e) {
      setError(String(e))
    }
  }

  const toggleRule = async (rule: MessageAlertRule) => {
    const next = rules.map(item => item.id === rule.id ? { ...item, enabled: !item.enabled } : item)
    await configService.setMessageAlertRules(next)
    setRules(next)
  }

  const removeRule = async (rule: MessageAlertRule) => {
    const next = rules.filter(item => item.id !== rule.id)
    await configService.setMessageAlertRules(next)
    setRules(next)
    if (draft?.id === rule.id) setDraft(null)
  }

  const selectedSession = sessions.find(item => item.username === draft?.sessionId)
  const visibleMembers = useMemo(() => {
    const keyword = memberSearch.trim().toLowerCase()
    return members.filter(member => !keyword || member.displayName.toLowerCase().includes(keyword) || member.username.toLowerCase().includes(keyword))
  }, [memberSearch, members])

  return (
    <section className="mm-panel mm-supervision">
      <div className="mm-panel-title mm-supervision-title">
        <span className="mm-supervision-heading"><ShieldCheck size={16} /> AI 监督规则</span>
        <button type="button" className="mm-btn primary" onClick={startNew}><Plus size={14} /> 新增规则</button>
      </div>
      <div className="mm-supervision-disclosure">
        <Sparkles size={14} /> 只会把你选中的消息发送到已配置的 AI 模型；AI 先总结，再按规则判断，命中后才提醒。
      </div>

      {error && <div className="mm-supervision-error" role="alert"><X size={14} /> {error}</div>}

      {draft && (
        <div className="mm-supervision-editor">
          <div className="mm-supervision-editor-head">
            <strong>{draft.id ? '编辑监督规则' : '新增监督规则'}</strong>
            <button type="button" className="mm-icon-btn" onClick={() => setDraft(null)} aria-label="关闭编辑"><X size={15} /></button>
          </div>
          <label className="mm-field"><span>规则名称</span><input type="text" value={draft.name} placeholder="例如：项目群风险提醒" onChange={e => updateDraft({ name: e.target.value })} /></label>
          <label className="mm-field"><span>监督对象</span>
            <select value={draft.sessionId} onChange={e => chooseSession(e.target.value)}>
              <option value="">选择群聊或联系人</option>
              {sessions.map(session => <option key={session.username} value={session.username}>{session.type === 'group' ? '群聊 · ' : '联系人 · '}{session.displayName}</option>)}
            </select>
          </label>

          {selectedSession?.type === 'group' && (
            <div className="mm-field">
              <span>群成员（可选）</span>
              <small>不选择成员时，监督该群所有新消息。</small>
              <input type="search" value={memberSearch} placeholder="搜索群成员" onChange={e => setMemberSearch(e.target.value)} />
              <div className="mm-member-picker">
                {loadingMembers ? <span className="mm-picker-empty">正在读取群成员…</span> : visibleMembers.slice(0, 80).map(member => {
                  const checked = draft.senderIds.includes(member.username)
                  return <button type="button" key={member.username} className={`mm-member-option ${checked ? 'selected' : ''}`} onClick={() => toggleMember(member)}>
                    <Avatar src={member.avatarUrl} name={member.displayName} size={24} /><span>{member.displayName}</span>{checked ? <Check size={14} /> : null}
                  </button>
                })}
                {!loadingMembers && visibleMembers.length === 0 && <span className="mm-picker-empty">暂无匹配成员</span>}
              </div>
              {draft.senderNames.length > 0 && <small className="mm-selected-note">已选择：{draft.senderNames.join('、')}</small>}
            </div>
          )}

          <label className="mm-field"><span>AI 判断要求</span><small>用自然语言描述什么情况需要提醒你。</small><textarea rows={4} value={draft.criteria} placeholder="例如：发现付款风险、合同变更或客户投诉时提醒我" onChange={e => updateDraft({ criteria: e.target.value })} /></label>
          <label className="mm-field"><span>预筛关键词 <em>可选</em></span><small>只有包含这些词的消息才会发送给 AI，节省调用次数。</small><input type="text" value={draft.prefilter.join('、')} placeholder="付款、合同、投诉" onChange={e => updateDraft({ prefilter: e.target.value.split(/[,，、\n]/).map(item => item.trim()).filter(Boolean) })} /></label>
          <label className="mm-field"><span>合并等待时间</span><small>同一时间段的消息会合并后交给 AI 总结。</small><select value={draft.batchWindowSeconds} onChange={e => updateDraft({ batchWindowSeconds: Number(e.target.value) })}><option value={1}>1 秒</option><option value={3}>3 秒</option><option value={5}>5 秒</option><option value={10}>10 秒</option><option value={30}>30 秒</option></select></label>
          <div className="mm-supervision-toggles">
            <label><span><BellRing size={14} /> 桌面提醒</span><input type="checkbox" checked={draft.notify} onChange={e => updateDraft({ notify: e.target.checked })} /></label>
            <label><span><Volume2 size={14} /> 声音提醒</span><input type="checkbox" checked={draft.sound} onChange={e => updateDraft({ sound: e.target.checked })} /></label>
          </div>
          <div className="mm-supervision-actions"><button type="button" className="mm-btn" onClick={() => setDraft(null)}>取消</button><button type="button" className="mm-btn primary" onClick={() => { void saveDraft() }}><Check size={14} /> 保存规则</button></div>
        </div>
      )}

      <div className="mm-supervision-list">
        {loading ? <div className="mm-picker-empty">正在加载规则…</div> : rules.length === 0 && !draft ? <div className="mm-supervision-empty"><ShieldCheck size={28} /><strong>还没有监督规则</strong><span>新增一条规则，选择群聊或联系人，再告诉 AI 什么情况需要提醒你。</span><button type="button" className="mm-btn primary" onClick={startNew}><Plus size={14} /> 新增第一条规则</button></div> : rules.map(rule => (
          <div key={rule.id} className={`mm-supervision-rule ${rule.enabled ? '' : 'disabled'}`}>
            <div className="mm-rule-status"><span className="dot" /></div>
            <div className="mm-rule-main"><div className="mm-rule-name">{rule.name || '未命名规则'} {!rule.enabled && <em>已停用</em>}</div><div className="mm-rule-target">{ruleTargetText(rule)}</div><div className="mm-rule-criteria">{rule.criteria}</div></div>
            <div className="mm-rule-actions"><button type="button" className="mm-icon-btn" onClick={() => { void toggleRule(rule) }} aria-label={rule.enabled ? '停用规则' : '启用规则'}><span className={`mm-rule-switch ${rule.enabled ? 'on' : ''}`} /></button><button type="button" className="mm-icon-btn" onClick={() => startEdit(rule)} aria-label="编辑规则"><Edit3 size={15} /></button><button type="button" className="mm-icon-btn danger" onClick={() => { void removeRule(rule) }} aria-label="删除规则"><Trash2 size={15} /></button></div>
          </div>
        ))}
      </div>
    </section>
  )
}
