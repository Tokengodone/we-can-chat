const $ = (selector) => document.querySelector(selector)
const elements = {
  accountDir: $('#account-dir'),
  dbPath: $('#db-path'),
  wxid: $('#wxid'),
  decryptKey: $('#decrypt-key'),
  imageXorKey: $('#image-xor-key'),
  imageAesKey: $('#image-aes-key'),
  outputDir: $('#output-dir'),
  format: $('#format'),
  exportMedia: $('#export-media'),
  voiceText: $('#voice-text'),
  exportAvatars: $('#export-avatars'),
  loadSessions: $('#load-sessions'),
  search: $('#session-search'),
  selectAll: $('#select-all'),
  sessionList: $('#session-list'),
  sessionCount: $('#session-count'),
  startExport: $('#start-export'),
  openOutput: $('#open-output'),
  statusDot: $('#status-dot'),
  statusTitle: $('#status-title'),
  statusDetail: $('#status-detail'),
  progressWrap: $('#progress-wrap'),
  progressLabel: $('#progress-label'),
  progressValue: $('#progress-value'),
  progressBar: $('#progress-bar'),
  toastRegion: $('#toast-region')
}

const state = { sessions: [], selected: new Set(), outputDir: '', polling: null }

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-WeFlow-UI': '1', ...(options.headers || {}) }
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`)
  return data
}

function toast(message, type = '') {
  const node = document.createElement('div')
  node.className = `toast ${type}`.trim()
  node.textContent = message
  elements.toastRegion.append(node)
  setTimeout(() => node.remove(), 4200)
}

function setStatus(kind, title, detail) {
  elements.statusDot.className = `status-dot ${kind || ''}`.trim()
  elements.statusTitle.textContent = title
  elements.statusDetail.textContent = detail
}

function setBusy(button, busy) {
  button.disabled = busy
  button.classList.toggle('is-loading', busy)
  button.setAttribute('aria-busy', String(busy))
}

function currentConfig() {
  return {
    accountDir: elements.accountDir.value.trim(),
    dbPath: elements.dbPath.value.trim(),
    myWxid: elements.wxid.value.trim(),
    decryptKey: elements.decryptKey.value,
    imageXorKey: elements.imageXorKey.value,
    imageAesKey: elements.imageAesKey.value
  }
}

function persistNonSecretFields() {
  localStorage.setItem('weflow-ui-settings', JSON.stringify({
    accountDir: elements.accountDir.value,
    dbPath: elements.dbPath.value,
    myWxid: elements.wxid.value,
    outputDir: elements.outputDir.value,
    format: elements.format.value,
    exportMedia: elements.exportMedia.checked,
    voiceText: elements.voiceText.checked,
    exportAvatars: elements.exportAvatars.checked
  }))
}

function restoreFields() {
  try {
    const data = JSON.parse(localStorage.getItem('weflow-ui-settings') || '{}')
    for (const key of ['accountDir', 'dbPath', 'wxid', 'outputDir']) if (data[key]) elements[key].value = data[key]
    if (data.format) elements.format.value = data.format
    elements.exportMedia.checked = data.exportMedia === true
    elements.voiceText.checked = data.voiceText === true
    elements.exportAvatars.checked = data.exportAvatars === true
  } catch { /* Ignore damaged local preferences. */ }
}

function inferAccountFields(accountDir) {
  const normalized = accountDir.replace(/[\\/]+$/, '')
  const segments = normalized.split(/[\\/]/)
  const accountName = segments.at(-1) || ''
  if (!elements.wxid.value && accountName.toLowerCase().startsWith('wxid_')) elements.wxid.value = accountName
  if (!elements.dbPath.value && segments.length > 1) elements.dbPath.value = normalized.slice(0, normalized.length - accountName.length).replace(/[\\/]+$/, '')
}

async function chooseFolder(input, title) {
  const result = await api('/api/pick-folder', {
    method: 'POST',
    body: JSON.stringify({ title, initialPath: input.value.trim() })
  })
  if (!result.path) return
  input.value = result.path
  if (input === elements.accountDir) inferAccountFields(result.path)
  persistNonSecretFields()
}

function filteredSessions() {
  const query = elements.search.value.trim().toLocaleLowerCase('zh-CN')
  if (!query) return state.sessions
  return state.sessions.filter((session) => `${session.name} ${session.id} ${session.latest}`.toLocaleLowerCase('zh-CN').includes(query))
}

function renderSessions() {
  const sessions = filteredSessions()
  elements.sessionList.replaceChildren()
  if (!sessions.length) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    const heading = document.createElement('h3')
    heading.textContent = state.sessions.length ? '没有匹配的会话' : '没有读取到会话'
    const copy = document.createElement('p')
    copy.textContent = state.sessions.length ? '尝试更换关键词。' : '请检查账号目录和数据库密钥。'
    empty.append(heading, copy)
    elements.sessionList.append(empty)
    return
  }
  const fragment = document.createDocumentFragment()
  for (const session of sessions) {
    const label = document.createElement('label')
    label.className = `session-item ${state.selected.has(session.id) ? 'is-selected' : ''}`
    label.setAttribute('role', 'option')
    label.setAttribute('aria-selected', String(state.selected.has(session.id)))
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = state.selected.has(session.id)
    checkbox.addEventListener('change', () => {
      checkbox.checked ? state.selected.add(session.id) : state.selected.delete(session.id)
      updateSelectionState()
      renderSessions()
    })
    const avatar = document.createElement('span')
    avatar.className = 'session-avatar'
    avatar.textContent = (session.name || session.id).slice(0, 1).toUpperCase()
    avatar.setAttribute('aria-hidden', 'true')
    const copy = document.createElement('span')
    copy.className = 'session-copy'
    const name = document.createElement('strong')
    name.textContent = session.name
    const detail = document.createElement('span')
    detail.textContent = session.latest || session.id
    copy.append(name, detail)
    label.append(checkbox, avatar, copy)
    fragment.append(label)
  }
  elements.sessionList.append(fragment)
}

function updateSelectionState() {
  const count = state.selected.size
  elements.sessionCount.textContent = `${state.sessions.length} 个会话，已选择 ${count} 个`
  elements.startExport.disabled = count === 0
  elements.selectAll.textContent = count === state.sessions.length && count > 0 ? '取消全选' : '全选'
}

async function loadSessions() {
  setBusy(elements.loadSessions, true)
  elements.startExport.disabled = true
  elements.search.disabled = true
  elements.selectAll.disabled = true
  setStatus('running', '正在连接', '读取并解密本机微信会话')
  try {
    const data = await api('/api/sessions', { method: 'POST', body: JSON.stringify(currentConfig()) })
    state.sessions = data.sessions || []
    state.selected.clear()
    elements.search.disabled = false
    elements.selectAll.disabled = state.sessions.length === 0
    renderSessions()
    updateSelectionState()
    persistNonSecretFields()
    setStatus('complete', '连接成功', `已读取 ${state.sessions.length} 个会话`)
    toast(`已读取 ${state.sessions.length} 个会话`)
  } catch (error) {
    state.sessions = []
    renderSessions()
    setStatus('failed', '连接失败', error.message)
    toast(error.message, 'error')
  } finally {
    setBusy(elements.loadSessions, false)
  }
}

function calculateProgress(progress) {
  const total = Number(progress.total || progress.estimatedTotalMessages || 0)
  const current = Number(progress.current || progress.exportedMessages || 0)
  if (!total) return progress.phase === 'complete' ? 100 : 8
  return Math.max(2, Math.min(100, Math.round(current / total * 100)))
}

async function pollJob(id) {
  const job = await api(`/api/jobs/${id}`)
  const progress = job.progress || {}
  const percent = calculateProgress(progress)
  elements.progressLabel.textContent = progress.phaseLabel || '正在处理聊天数据'
  elements.progressValue.textContent = `${percent}%`
  elements.progressBar.style.width = `${percent}%`
  if (job.status === 'complete') {
    clearInterval(state.polling)
    state.polling = null
    state.outputDir = job.outputDir
    elements.openOutput.hidden = false
    elements.startExport.disabled = false
    elements.startExport.textContent = '再次导出'
    setStatus('complete', '导出完成', job.outputDir)
    toast('聊天记录已导出完成')
  } else if (job.status === 'failed') {
    clearInterval(state.polling)
    state.polling = null
    elements.startExport.disabled = false
    setStatus('failed', '导出失败', job.error || '请检查配置后重试')
    toast(job.error || '导出失败', 'error')
  }
}

async function startExport() {
  elements.startExport.disabled = true
  elements.openOutput.hidden = true
  elements.progressWrap.hidden = false
  elements.progressBar.style.width = '2%'
  setStatus('running', '正在导出', '请保持此页面开启')
  persistNonSecretFields()
  try {
    const data = await api('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        ...currentConfig(),
        outputDir: elements.outputDir.value.trim(),
        sessionIds: [...state.selected],
        options: {
          format: elements.format.value,
          exportMedia: elements.exportMedia.checked,
          exportVoiceAsText: elements.voiceText.checked,
          exportAvatars: elements.exportAvatars.checked
        }
      })
    })
    await pollJob(data.id)
    state.polling = setInterval(() => pollJob(data.id).catch((error) => {
      clearInterval(state.polling)
      state.polling = null
      elements.startExport.disabled = false
      setStatus('failed', '无法获取进度', error.message)
    }), 700)
  } catch (error) {
    elements.startExport.disabled = false
    setStatus('failed', '无法开始导出', error.message)
    toast(error.message, 'error')
  }
}

document.querySelectorAll('[data-picker]').forEach((button) => {
  button.addEventListener('click', () => {
    const id = button.dataset.picker
    const titles = { 'account-dir': '选择微信账号数据目录', 'db-path': '选择微信数据根目录', 'output-dir': '选择导出保存位置' }
    chooseFolder(document.getElementById(id), titles[id]).catch((error) => toast(error.message, 'error'))
  })
})

elements.loadSessions.addEventListener('click', loadSessions)
elements.search.addEventListener('input', renderSessions)
elements.selectAll.addEventListener('click', () => {
  const allSelected = state.selected.size === state.sessions.length
  state.selected = allSelected ? new Set() : new Set(state.sessions.map((session) => session.id))
  renderSessions()
  updateSelectionState()
})
elements.startExport.addEventListener('click', startExport)
elements.openOutput.addEventListener('click', () => api('/api/open-path', { method: 'POST', body: JSON.stringify({ path: state.outputDir }) }).catch((error) => toast(error.message, 'error')))
elements.voiceText.addEventListener('change', () => {
  if (elements.voiceText.checked) elements.exportMedia.checked = true
})

restoreFields()
window.addEventListener('beforeunload', persistNonSecretFields)
