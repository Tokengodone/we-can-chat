import { useEffect, useMemo, useState } from 'react'
import { Bold, Bot, ChevronDown, ChevronUp, Eye, EyeOff, Link, List, Plus, Plug, Quote, Save, Search, Trash2 } from 'lucide-react'
import * as configService from '../services/config'
import type { ChatSession } from '../types/models'
import { Avatar } from '../components/Avatar'
import {
  isNextDayGroupSummaryPeriod,
  normalizeGroupSummaryTimePeriods,
  validateGroupSummaryTimePeriods,
  type GroupSummaryTimePeriod
} from '../../shared/groupSummarySchedule'
import './RobotPage.scss'

type RobotScope = 'all' | 'selected'
type RobotMode = 'manual' | 'auto' | 'both'
type RobotScheduleMode = 'global' | 'custom'
type FrequencyUnit = 'minute' | 'hour' | 'day'
type RobotPushFormat = 'text' | 'markdown' | 'markdown_v2' | 'image' | 'news' | 'file' | 'voice' | 'template_card'
type ActiveRobotPushFormat = 'text' | 'markdown' | 'markdown_v2' | 'image'

const PUSH_FORMAT_OPTIONS: Array<{ value: RobotPushFormat; label: string; hint: string; disabled?: boolean }> = [
  { value: 'text', label: '\u6587\u672c', hint: '\u7eaf\u6587\u5b57\uff0c\u4e0d\u89e3\u6790 Markdown' },
  { value: 'markdown', label: 'Markdown', hint: '\u6807\u9898\u3001\u7c97\u4f53\u3001\u94fe\u63a5\u548c\u5f15\u7528' },
  { value: 'markdown_v2', label: 'Markdown V2', hint: '\u652f\u6301\u5217\u8868\u3001\u8868\u683c\u3001\u4ee3\u7801\u5757' },
  { value: 'image', label: '\u56fe\u7247', hint: '\u6309\u9884\u89c8\u6837\u5f0f\u751f\u6210\u5206\u9875\u957f\u56fe\u5e76\u53d1\u9001' },
  { value: 'news', label: '\u56fe\u6587', hint: '\u9700\u56fe\u6587\u94fe\u63a5\u548c\u56fe\u7247\u7d20\u6750', disabled: true },
  { value: 'file', label: '\u6587\u4ef6', hint: '\u9700\u5df2\u4e0a\u4f20\u7684 media_id', disabled: true },
  { value: 'voice', label: '\u8bed\u97f3', hint: '\u9700\u5df2\u4e0a\u4f20\u7684 AMR media_id', disabled: true },
  { value: 'template_card', label: '\u6a21\u677f\u5361\u7247', hint: '\u9700\u5361\u7247\u8df3\u8f6c\u548c\u5361\u7247\u5b57\u6bb5', disabled: true }
]

const normalizePushFormat = (value: unknown): ActiveRobotPushFormat => {
  return value === 'text' || value === 'markdown_v2' || value === 'image' ? value : 'markdown'
}

type Robot = {
  id: string
  name: string
  webhook: string
  frequencyHours: number
  frequencyValue: number
  frequencyUnit: FrequencyUnit
  scope: RobotScope
  scopeIds: string[]
  prompt: string
  mode: RobotMode
  scheduleMode: RobotScheduleMode
  timePeriods: GroupSummaryTimePeriod[]
  format: ActiveRobotPushFormat
  enabled: boolean
  mentionAll: boolean
  aiApiBaseUrl: string
  aiApiKey: string
  aiModel: string
  titleColor: 'info' | 'comment' | 'warning'
  titleBold: boolean
  sectionTitleBold: boolean
  groupOverrides: Record<string, { title: string; badge: string; badgeColor: 'info' | 'comment' | 'warning' }>
}

const DEFAULT_PROMPT = '请根据群聊记录生成自然、清晰、可直接阅读的总结报告，重点突出行动项、风险、未解决问题和“选题雷达”。选题雷达从群友的链接、经历、反常识观点、争议、共同痛点与高频追问中，挑选有爆款潜力且可回溯原始发言的内容选题。只输出报告正文。'
const REPORT_FORMAT_LABELS = {
  style: '\u62a5\u544a\u6837\u5f0f',
  description: '\u4f01\u4e1a\u5fae\u4fe1\u53ea\u652f\u6301\u8fd9\u4e9b\u53ef\u9760\u7684 Markdown \u8868\u73b0\uff0c\u53f3\u4fa7\u4f1a\u5b9e\u65f6\u9884\u89c8\u3002',
  titleColor: '\u6807\u9898\u989c\u8272',
  titleBold: '\u6807\u9898\u52a0\u7c97',
  sectionBold: '\u5206\u680f\u6807\u9898\u52a0\u7c97',
  textGroup: '\u6587\u5b57\u683c\u5f0f',
  paragraphGroup: '\u6bb5\u843d\u8bbe\u7f6e',
  insertGroup: '\u63d2\u5165',
  bold: '\u52a0\u7c97',
  quote: '\u5f15\u7528',
  list: '\u5217\u8868',
  link: '\u94fe\u63a5',
  preview: '\u5b9e\u65f6\u9884\u89c8',
  supported: '\u53ef\u6b63\u786e\u663e\u793a\uff1a\u6807\u9898\u3001\u7c97\u4f53\u3001\u5f15\u7528\u3001\u5217\u8868\u3001\u989c\u8272\u6807\u7b7e\u3001\u94fe\u63a5\u3001\u63d0\u9192'
}

const normalizeFrequency = (item: any): { frequencyHours: number; frequencyValue: number; frequencyUnit: FrequencyUnit } => {
  const hours = Math.max(1 / 60, Number(item?.frequencyHours) || 4)
  if (item?.frequencyUnit === 'minute' || item?.frequencyUnit === 'hour' || item?.frequencyUnit === 'day') {
    const value = Math.max(1, Number(item?.frequencyValue) || 1)
    return { frequencyHours: item.frequencyUnit === 'minute' ? value / 60 : item.frequencyUnit === 'day' ? value * 24 : value, frequencyValue: value, frequencyUnit: item.frequencyUnit }
  }
  if (hours < 1) return { frequencyHours: hours, frequencyValue: Math.max(1, Math.round(hours * 60)), frequencyUnit: 'minute' }
  if (hours >= 24 && hours % 24 === 0) return { frequencyHours: hours, frequencyValue: hours / 24, frequencyUnit: 'day' }
  return { frequencyHours: hours, frequencyValue: hours, frequencyUnit: 'hour' }
}

function parseRobots(raw: string): Robot[] {
  try {
    const value = JSON.parse(raw || '[]')
    if (!Array.isArray(value)) return []
    return value.map((item: any, index) => ({
      ...normalizeFrequency(item),
      id: String(item?.id || `${Date.now()}-${index}`),
      name: String(item?.name || `机器人 ${index + 1}`),
      webhook: String(item?.webhook || ''),
      scope: item?.scope === 'selected' ? 'selected' : 'all',
      scopeIds: Array.isArray(item?.scopeIds) ? item.scopeIds.map(String).filter(Boolean) : [],
      prompt: String(item?.prompt || ''),
      mode: item?.mode === 'auto' || item?.mode === 'both' ? item.mode : 'manual',
      scheduleMode: item?.scheduleMode === 'custom' ? 'custom' : 'global',
      timePeriods: normalizeGroupSummaryTimePeriods(item?.timePeriods),
      format: normalizePushFormat(item?.format),
      enabled: item?.enabled !== false,
      mentionAll: item?.mentionAll === true,
      aiApiBaseUrl: String(item?.aiApiBaseUrl || ''),
      aiApiKey: String(item?.aiApiKey || ''),
      aiModel: String(item?.aiModel || ''),
      titleColor: item?.titleColor === 'comment' || item?.titleColor === 'warning' ? item.titleColor : 'info',
      titleBold: item?.titleBold !== false,
      sectionTitleBold: item?.sectionTitleBold !== false,
      groupOverrides: Object.fromEntries(Object.entries(item?.groupOverrides && typeof item.groupOverrides === 'object' ? item.groupOverrides : {}).map(([id, value]: [string, any]) => [id, { title: String(value?.title || ''), badge: String(value?.badge || ''), badgeColor: value?.badgeColor === 'comment' || value?.badgeColor === 'warning' ? value.badgeColor : 'warning' }]))
    }))
  } catch {
    return []
  }
}

function RobotPage() {
  const [robots, setRobots] = useState<Robot[]>([])
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ success: boolean; text: string } | null>(null)
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set())
  const [visibleAiKeyIds, setVisibleAiKeyIds] = useState<Set<string>>(new Set())
  const [previewFocus, setPreviewFocus] = useState<string | null>(null)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [sessionSearch, setSessionSearch] = useState<Record<string, string>>({})
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [globalTimePeriods, setGlobalTimePeriods] = useState<GroupSummaryTimePeriod[]>([])

  useEffect(() => {
    void configService.getAiGroupSummaryWeComBots().then((value) => {
      const loadedRobots = parseRobots(value)
      setRobots(loadedRobots)
      setCollapsedIds(new Set(loadedRobots.map((robot) => robot.id)))
      setReady(true)
    })
    void window.electronAPI.chat.getSessions().then((result) => {
      if (result.success && Array.isArray(result.sessions)) setSessions(result.sessions)
    })
    void configService.getAiGroupSummaryTimePeriods().then(setGlobalTimePeriods)
  }, [])

  const activeCount = useMemo(() => robots.filter((robot) => robot.enabled && robot.webhook.trim()).length, [robots])

  const save = async (next: Robot[], message = '机器人配置已保存') => {
    const invalidRobot = next.find((robot) => {
      if (robot.mode === 'manual' || robot.scheduleMode !== 'custom') return false
      return robot.timePeriods.length === 0 || !validateGroupSummaryTimePeriods(robot.timePeriods).valid
    })
    if (invalidRobot) {
      setNotice({ success: false, text: `${invalidRobot.name || '机器人'}的独立推送时段为空、无效或存在重叠，请检查后再保存。` })
      return
    }
    setRobots(next)
    setSaving(true)
    try {
      await configService.setAiGroupSummaryWeComBots(JSON.stringify(next))
      setNotice({ success: true, text: message })
    } catch (error) {
      setNotice({ success: false, text: `保存失败：${(error as Error).message || String(error)}` })
    } finally {
      setSaving(false)
    }
  }

  const update = (id: string, patch: Partial<Robot>) => {
    setRobots((current) => current.map((robot) => robot.id === id ? { ...robot, ...patch } : robot))
  }

  const addRobot = () => {
    const next: Robot = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: `机器人 ${robots.length + 1}`,
      webhook: '',
      frequencyHours: 4,
      frequencyValue: 4,
      frequencyUnit: 'hour',
      scope: 'all',
      scopeIds: [],
      prompt: '',
      mode: 'manual',
      scheduleMode: 'global',
      timePeriods: [],
      format: 'markdown',
      enabled: true,
      mentionAll: false,
      aiApiBaseUrl: '',
      aiApiKey: '',
      aiModel: '',
      titleColor: 'info',
      titleBold: true,
      sectionTitleBold: true,
      groupOverrides: {}
    }
    setRobots((current) => [...current, next])
  }

  const testRobot = async (robot: Robot) => {
    if (!robot.webhook.trim()) {
      setNotice({ success: false, text: '请先填写 Webhook 地址' })
      return
    }
    try {
      const result = await window.electronAPI.groupSummary.testWeComWebhook(robot.webhook.trim(), robot.format === 'image' ? 'markdown' : robot.format)
      setNotice({ success: result.success, text: `${robot.name}：${result.message}` })
    } catch (error) {
      setNotice({ success: false, text: `${robot.name}：测试失败` })
    }
  }

  const sessionLabel = (session: ChatSession) => String(session.displayName || session.username || '未命名会话')
  const filteredSessions = (robot: Robot) => {
    const keyword = String(sessionSearch[robot.id] || '').trim().toLowerCase()
    return sessions
      .filter((session) => session.username.endsWith('@chatroom') && !robot.scopeIds.includes(session.username))
      .filter((session) => !keyword || sessionLabel(session).toLowerCase().includes(keyword) || session.username.toLowerCase().includes(keyword))
      .slice(0, 100)
  }

  const addAllFilteredSessions = (robot: Robot) => {
    const next = Array.from(new Set([...robot.scopeIds, ...filteredSessions(robot).map((session) => session.username)]))
    update(robot.id, { scopeIds: next })
  }

  if (!ready) return <div className="robot-page robot-page-loading">正在加载机器人配置…</div>

  return (
    <div className="robot-page">
      <header className="robot-page-header">
        <div>
          <div className="robot-eyebrow"><Bot size={15} /> 推送自动化</div>
          <h1>机器人</h1>
          <p>管理企业微信群机器人，让每个机器人负责不同的群聊总结。</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={addRobot}><Plus size={16} /> 添加机器人</button>
      </header>

      <div className="robot-summary-bar">
        <span><strong>{robots.length}</strong> 个机器人</span>
        <span className="robot-summary-dot" />
        <span><strong>{activeCount}</strong> 个已启用并完成地址配置</span>
        <span className="robot-summary-spacer" />
        <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => void save(robots, '所有机器人配置已保存')}><Save size={14} /> {saving ? '保存中…' : '保存全部'}</button>
      </div>

      {notice && <div className={`robot-notice ${notice.success ? 'success' : 'error'}`} role="status">{notice.text}</div>}

      {robots.length === 0 ? (
        <div className="robot-empty">
          <div className="robot-empty-icon"><Bot size={25} /></div>
          <h2>还没有机器人</h2>
          <p>添加一个企业微信机器人，配置它的作用域、总结方式和自动推送时段。</p>
          <button type="button" className="btn btn-primary" onClick={addRobot}><Plus size={16} /> 添加第一个机器人</button>
        </div>
      ) : (
        <div className="robot-list">
          {robots.map((robot, index) => {
            const visible = visibleIds.has(robot.id)
            const collapsed = collapsedIds.has(robot.id)
            return (
              <article className={`robot-card ${robot.enabled ? '' : 'is-disabled'} ${collapsed ? 'is-collapsed' : ''}`} key={robot.id}>
                <div className="robot-card-header">
                  <div className="robot-card-title-wrap"><span className="robot-index">{String(index + 1).padStart(2, '0')}</span><div><h2>{robot.name || `机器人 ${index + 1}`}</h2><span>{robot.enabled ? '已启用' : '已停用'} · {robot.mode === 'manual' ? '手动预览后推送' : robot.mode === 'auto' ? '自动总结后推送' : '自动 + 手动'}{robot.mode !== 'manual' ? ` · ${robot.scheduleMode === 'custom' ? `独立时段 ${robot.timePeriods.length} 个` : '全局时段'}` : ''}</span></div></div>
                  <div className="robot-card-actions"><button type="button" className="robot-collapse-button" aria-expanded={!collapsed} aria-controls={`robot-body-${robot.id}`} title={collapsed ? '展开机器人配置' : '收起机器人配置'} onClick={() => setCollapsedIds((current) => { const next = new Set(current); if (next.has(robot.id)) next.delete(robot.id); else next.add(robot.id); return next })}>{collapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}</button><label className="robot-switch"><input type="checkbox" checked={robot.enabled} onChange={(event) => update(robot.id, { enabled: event.target.checked })} /><span /></label><button type="button" className="icon-button" title="删除机器人" aria-label={`删除${robot.name}`} onClick={() => void save(robots.filter((item) => item.id !== robot.id), '机器人已删除')}><Trash2 size={16} /></button></div>
                </div>

                {!collapsed && <div id={`robot-body-${robot.id}`} className="robot-card-body">
                <section className="robot-ai-config" aria-labelledby={`robot-ai-config-${robot.id}`}>
                  <div className="robot-ai-config-heading">
                    <div>
                      <h3 id={`robot-ai-config-${robot.id}`}>AI 连接配置</h3>
                      <p>为此机器人单独指定 API 地址、Key 和模型；留空的字段会使用全局默认配置。</p>
                    </div>
                    <span className="robot-ai-config-badge">独立配置</span>
                  </div>
                  <div className="robot-fields robot-ai-fields">
                    <label>API 地址<input className="field-input" value={robot.aiApiBaseUrl} onChange={(event) => update(robot.id, { aiApiBaseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></label>
                    <label>模型名称<input className="field-input" value={robot.aiModel} onChange={(event) => update(robot.id, { aiModel: event.target.value })} placeholder="例如：gpt-4o-mini" /></label>
                    <label>API Key<div className="robot-secret-input"><input className="field-input" type={visibleAiKeyIds.has(robot.id) ? 'text' : 'password'} value={robot.aiApiKey} onChange={(event) => update(robot.id, { aiApiKey: event.target.value })} placeholder="留空则使用全局 Key" autoComplete="off" /><button type="button" onClick={() => setVisibleAiKeyIds((current) => { const next = new Set(current); if (next.has(robot.id)) next.delete(robot.id); else next.add(robot.id); return next })} aria-label={visibleAiKeyIds.has(robot.id) ? '隐藏 AI Key' : '显示 AI Key'}>{visibleAiKeyIds.has(robot.id) ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
                  </div>
                </section>
                <section className="robot-report-style" aria-labelledby={`robot-report-style-${robot.id}`}>
                  <div className="robot-ai-config-heading">
                    <div>
                      <h3 id={`robot-report-style-${robot.id}`}>{REPORT_FORMAT_LABELS.style}</h3>
                      <p>{REPORT_FORMAT_LABELS.description}</p>
                    </div>
                  </div>
                  <div className="robot-style-workspace">
                  <div className="robot-format-toolbar" role="toolbar" aria-label={REPORT_FORMAT_LABELS.style}>
                    <div className="robot-format-group"><span>{REPORT_FORMAT_LABELS.textGroup}</span><button type="button" className={robot.titleBold ? 'is-active' : ''} aria-pressed={robot.titleBold} onClick={() => update(robot.id, { titleBold: !robot.titleBold })} title={REPORT_FORMAT_LABELS.bold}><Bold size={15} /> <span>{REPORT_FORMAT_LABELS.bold}</span></button></div>
                    <div className="robot-format-group"><span>{REPORT_FORMAT_LABELS.paragraphGroup}</span><button type="button" className={previewFocus === 'quote' ? 'is-active' : 'is-supported'} aria-pressed={previewFocus === 'quote'} onClick={() => setPreviewFocus('quote')} title={REPORT_FORMAT_LABELS.quote}><Quote size={15} /> <span>{REPORT_FORMAT_LABELS.quote}</span></button><button type="button" className={previewFocus === 'list' ? 'is-active' : 'is-supported'} aria-pressed={previewFocus === 'list'} onClick={() => setPreviewFocus('list')} title={REPORT_FORMAT_LABELS.list}><List size={15} /> <span>{REPORT_FORMAT_LABELS.list}</span></button></div>
                    <div className="robot-format-group"><span>{REPORT_FORMAT_LABELS.insertGroup}</span><button type="button" className={previewFocus === 'link' ? 'is-active' : 'is-supported'} aria-pressed={previewFocus === 'link'} onClick={() => setPreviewFocus('link')} title={REPORT_FORMAT_LABELS.link}><Link size={15} /> <span>{REPORT_FORMAT_LABELS.link}</span></button></div>
                    <label className="robot-format-color">{REPORT_FORMAT_LABELS.titleColor}<select className="field-input" value={robot.titleColor} onChange={(event) => update(robot.id, { titleColor: event.target.value as Robot['titleColor'] })}><option value="info">{`\u84dd\u8272\uff08\u4fe1\u606f\uff09`}</option><option value="comment">{`\u7070\u8272\uff08\u8865\u5145\uff09`}</option><option value="warning">{`\u6a59\u8272\uff08\u8b66\u793a\uff09`}</option></select></label>
                    <label className="robot-checkbox-field"><input type="checkbox" checked={robot.sectionTitleBold} onChange={(event) => update(robot.id, { sectionTitleBold: event.target.checked })} /> {REPORT_FORMAT_LABELS.sectionBold}</label>
                  </div>
                  <div className="robot-format-guide">
                    <span>{REPORT_FORMAT_LABELS.supported}</span>
                  </div>
                  <div className={`robot-markdown-preview ${robot.format === 'text' ? 'is-text' : ''}`} aria-label={REPORT_FORMAT_LABELS.preview}>
                    <div className="robot-markdown-preview-header"><span>{REPORT_FORMAT_LABELS.preview}</span><span>{robot.format === 'text' ? 'TEXT' : robot.format === 'markdown_v2' ? 'MARKDOWN V2' : 'MARKDOWN'}</span></div>
                    <div className={`robot-preview-title tone-${robot.titleColor}`}>{robot.titleBold ? <strong>西门聪明蛋的朋友们（1群）群聊报告</strong> : '西门聪明蛋的朋友们（1群）群聊报告'}</div>
                    <div className={`robot-preview-meta ${previewFocus === 'quote' ? 'is-focus' : ''}`}>&gt; 时段：2026-07-18 21:56 至 2026-07-19 01:56</div>
                    <div className="robot-preview-overview">群聊主要围绕产品讨论、路线规划和经验分享展开。</div>
                    <div className="robot-preview-section">{robot.sectionTitleBold ? <strong>1. 重点话题</strong> : '1. 重点话题'}</div>
                    <div className={`robot-preview-list ${previewFocus === 'list' ? 'is-focus' : ''}`}><div>- <strong>关键结论</strong>：用列表呈现重点内容</div><div>- 负责人：张三　截止时间：今天</div></div>
                    <div className={`robot-preview-link ${previewFocus === 'link' ? 'is-focus' : ''}`}>查看原文：<a href="#preview" onClick={(event) => event.preventDefault()}>https://example.com</a></div>
                  </div>
                  </div>
                </section>
                <div className="robot-fields">
                  <label>机器人名称<input className="field-input" value={robot.name} onChange={(event) => update(robot.id, { name: event.target.value })} placeholder="例如：研发群日报" /></label>
                  <label>Webhook 地址<div className="robot-secret-input"><input className="field-input" type={visible ? 'text' : 'password'} value={robot.webhook} onChange={(event) => update(robot.id, { webhook: event.target.value })} placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…" /><button type="button" onClick={() => setVisibleIds((current) => { const next = new Set(current); if (next.has(robot.id)) next.delete(robot.id); else next.add(robot.id); return next })} aria-label={visible ? '隐藏地址' : '显示地址'}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
                  <label>推送方式<select className="field-input" value={robot.mode} onChange={(event) => update(robot.id, { mode: event.target.value as RobotMode })}><option value="manual">手动预览后推送</option><option value="auto">自动总结后推送</option><option value="both">自动 + 手动</option></select><span className="robot-frequency-hint">{robot.mode === 'manual' ? '生成总结后由你确认并推送。' : '每个时段结束后自动总结该时段消息并推送。'}</span></label>
                  <label>推送格式<select className="field-input" value={robot.format} onChange={(event) => update(robot.id, { format: normalizePushFormat(event.target.value) })}>{PUSH_FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}{option.disabled ? `（${option.hint}）` : ''}</option>)}</select><span className="robot-format-hint">{PUSH_FORMAT_OPTIONS.find((option) => option.value === robot.format)?.hint}</span></label>
                  {robot.mode !== 'manual' && <section className="robot-schedule" aria-labelledby={`robot-schedule-${robot.id}`}>
                    <div className="robot-schedule-heading">
                      <div>
                        <h3 id={`robot-schedule-${robot.id}`}>自动推送时段</h3>
                        <p>时段结束时，自动总结这个区间内的群聊消息并推送。</p>
                      </div>
                      <label className="robot-schedule-mode">时段来源
                        <select className="field-input" value={robot.scheduleMode} onChange={(event) => update(robot.id, {
                          scheduleMode: event.target.value as RobotScheduleMode,
                          timePeriods: event.target.value === 'custom' && robot.timePeriods.length === 0 ? [{ start: '09:00', end: '12:00' }] : robot.timePeriods
                        })}>
                          <option value="global">使用全局时段</option>
                          <option value="custom">为此机器人单独设置</option>
                        </select>
                      </label>
                    </div>
                    {robot.scheduleMode === 'global' ? (
                      <div className="robot-schedule-global">
                        当前使用“设置 → 群聊总结”中的 {globalTimePeriods.length} 个时段。
                      </div>
                    ) : (
                      <div className="robot-schedule-custom">
                        <div className="robot-schedule-list" role="list" aria-label={`${robot.name}的自动推送时段`}>
                          {robot.timePeriods.map((period, periodIndex) => (
                            <div className="robot-schedule-row" role="listitem" key={`${robot.id}-${periodIndex}`}>
                              <span className="robot-schedule-number">{periodIndex + 1}</span>
                              <label>开始
                                <input className="field-input" type="time" value={period.start} onChange={(event) => update(robot.id, { timePeriods: robot.timePeriods.map((item, index) => index === periodIndex ? { ...item, start: event.target.value } : item) })} />
                              </label>
                              <span className="robot-schedule-separator">至</span>
                              <label>结束
                                <input className="field-input" type="time" value={period.end} onChange={(event) => update(robot.id, { timePeriods: robot.timePeriods.map((item, index) => index === periodIndex ? { ...item, end: event.target.value } : item) })} />
                              </label>
                              {isNextDayGroupSummaryPeriod(period) && <span className="robot-schedule-next-day">次日</span>}
                              <button type="button" className="icon-button robot-schedule-remove" title="删除这个时段" aria-label={`删除时段 ${periodIndex + 1}`} onClick={() => update(robot.id, { timePeriods: robot.timePeriods.filter((_, index) => index !== periodIndex) })}><Trash2 size={15} /></button>
                            </div>
                          ))}
                        </div>
                        {robot.timePeriods.length === 0 && <div className="robot-schedule-empty">尚未添加时段。没有时段时不会自动推送。</div>}
                        {!validateGroupSummaryTimePeriods(robot.timePeriods).valid && robot.timePeriods.length > 0 && <div className="robot-schedule-error" role="alert">时段存在重叠或时间无效，请调整。</div>}
                        <button type="button" className="btn btn-secondary btn-sm robot-schedule-add" onClick={() => update(robot.id, { timePeriods: [...robot.timePeriods, { start: '09:00', end: '12:00' }] })}><Plus size={14} /> 添加时段</button>
                      </div>
                    )}
                  </section>}
                  <label>消息作用域<select className="field-input" value={robot.scope} onChange={(event) => update(robot.id, { scope: event.target.value as RobotScope })}><option value="all">所有已启用的群聊</option><option value="selected">指定群聊</option></select></label>
                  {robot.scope === 'selected' && <div className="robot-session-picker">
                    <label>选择作用域群聊</label>
                    <div className="robot-scope-panels">
                      <div className="robot-scope-panel">
                        <div className="robot-scope-panel-header"><strong>可选群聊</strong><button type="button" className="robot-scope-select-all" onClick={() => addAllFilteredSessions(robot)}>全选当前</button><div className="robot-scope-search"><Search size={14} /><input value={sessionSearch[robot.id] || ''} onChange={(event) => setSessionSearch((current) => ({ ...current, [robot.id]: event.target.value }))} placeholder="搜索群聊…" /></div></div>
                        <div className="robot-scope-list">{filteredSessions(robot).length > 0 ? filteredSessions(robot).map((session) => <button type="button" className="robot-scope-item" key={session.username} onClick={() => update(robot.id, { scopeIds: [...robot.scopeIds, session.username] })}><Avatar src={session.avatarUrl} name={sessionLabel(session)} size={28} /><span className="robot-scope-item-name">{sessionLabel(session)}</span><span className="robot-scope-item-type">群聊</span><span className="robot-scope-item-action">+</span></button>) : <div className="robot-scope-empty">{sessionSearch[robot.id] ? '没有匹配的群聊' : '暂无可添加的群聊'}</div>}</div>
                      </div>
                      <div className="robot-scope-panel">
                        <div className="robot-scope-panel-header"><strong>作用域群聊</strong>{robot.scopeIds.length > 0 && <span className="robot-scope-count">{robot.scopeIds.length}</span>}{robot.scopeIds.length > 0 && <button type="button" className="robot-scope-select-all" onClick={() => update(robot.id, { scopeIds: [] })}>全不选</button>}</div>
                        <div className="robot-scope-list">{robot.scopeIds.length > 0 ? robot.scopeIds.map((id) => { const session = sessions.find((item) => item.username === id); return <button type="button" className="robot-scope-item selected" key={id} onClick={() => update(robot.id, { scopeIds: robot.scopeIds.filter((item) => item !== id) })}><Avatar src={session?.avatarUrl} name={session ? sessionLabel(session) : id} size={28} /><span className="robot-scope-item-name">{session ? sessionLabel(session) : id}</span><span className="robot-scope-item-type">群聊</span><span className="robot-scope-item-action">×</span></button> }) : <div className="robot-scope-empty">尚未添加任何群聊</div>}</div>
                      </div>
                    </div>
                    <div className="robot-group-overrides">
                      <strong>群聊个性化（仅对已选群生效）</strong>
                      {robot.scopeIds.length === 0 ? <p>请先在右侧选择群聊。</p> : robot.scopeIds.map((id) => {
                        const override = robot.groupOverrides[id] || { title: '', badge: '', badgeColor: 'warning' as const }
                        const session = sessions.find((item) => item.username === id)
                        const patchOverride = (patch: Partial<typeof override>) => update(robot.id, { groupOverrides: { ...robot.groupOverrides, [id]: { ...override, ...patch } } })
                        return <div className="robot-group-override" key={id}>
                          <span className="robot-group-override-name">{session ? sessionLabel(session) : id}</span>
                          <input className="field-input" value={override.title} onChange={(event) => patchOverride({ title: event.target.value })} placeholder="标题，留空使用默认" />
                          <input className="field-input" value={override.badge} onChange={(event) => patchOverride({ badge: event.target.value })} placeholder="第一名称号，留空不显示" />
                          <select className="field-input" value={override.badgeColor} onChange={(event) => patchOverride({ badgeColor: event.target.value as typeof override.badgeColor })}><option value="warning">橙色</option><option value="info">蓝色</option><option value="comment">绿色</option></select>
                        </div>
                      })}
                    </div>
                  </div>}
                </div>
                <label className="robot-prompt-field">如何总结聊天消息<textarea className="field-input" rows={3} value={robot.prompt} onChange={(event) => update(robot.id, { prompt: event.target.value })} placeholder={DEFAULT_PROMPT} /></label>
                <div className="robot-card-footer"><label><input type="checkbox" checked={robot.mentionAll} onChange={(event) => update(robot.id, { mentionAll: event.target.checked })} /> @所有人</label><button type="button" className="btn btn-secondary btn-sm" onClick={() => void testRobot(robot)}><Plug size={14} /> 发送测试消息</button><button type="button" className="btn btn-primary btn-sm" onClick={() => void save(robots, `${robot.name || '机器人'} 已保存`)}><Save size={14} /> 保存机器人</button></div>
                </div>}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default RobotPage
