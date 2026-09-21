const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFile, spawn } = require('node:child_process')
const { WeFlowCore } = require('../dist')

const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.WEFLOW_UI_PORT || 47831)
const HOST = '127.0.0.1'
const jobs = new Map()
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.ico', ['icon.ico', 'image/x-icon']]
])

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1024 * 1024) {
        reject(new Error('请求内容过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(new Error('请求格式不正确'))
      }
    })
    req.on('error', reject)
  })
}

function requireLocalUi(req) {
  const host = String(req.headers.host || '')
  const localHost = host.startsWith('127.0.0.1:') || host.startsWith('localhost:')
  return localHost && req.headers['x-weflow-ui'] === '1'
}

function normalizeConfig(body) {
  return {
    accountDir: String(body.accountDir || '').trim(),
    dbPath: String(body.dbPath || '').trim(),
    myWxid: String(body.myWxid || '').trim(),
    decryptKey: String(body.decryptKey || '').trim(),
    imageXorKey: body.imageXorKey === '' || body.imageXorKey == null ? undefined : Number(body.imageXorKey),
    imageAesKey: String(body.imageAesKey || '').trim() || undefined,
    modelDir: path.join(ROOT, 'models', 'sensevoice'),
    workDir: path.join(ROOT, 'data')
  }
}

function validateConfig(config, richExport = false) {
  if (!config.accountDir) throw new Error('请选择微信账号数据目录')
  if (!path.isAbsolute(config.accountDir) || !fs.existsSync(config.accountDir)) throw new Error('微信账号目录不存在')
  if (!config.decryptKey) throw new Error('请输入数据库密钥')
  if (richExport && !config.dbPath) throw new Error('请填写微信数据根目录')
  if (richExport && !config.myWxid) throw new Error('请填写当前账号微信 ID')
}

function normalizeSession(session) {
  const id = String(session.username || session.session_id || session.sessionId || session.userName || '').trim()
  const name = String(
    session.display_name || session.displayName || session.remark || session.nickname || session.nick_name || id
  ).trim()
  const latest = String(session.summary || session.last_message || session.lastMessage || '').trim()
  return { id, name: name || id, latest, raw: session }
}

function pickFolder(title, initialPath) {
  const script = [
    'param([string]$DialogTitle,[string]$InitialPath)',
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$dialog.Description = $DialogTitle',
    '$dialog.ShowNewFolderButton = $true',
    'if ($InitialPath -and (Test-Path -LiteralPath $InitialPath)) { $dialog.SelectedPath = $InitialPath }',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $dialog.SelectedPath }'
  ].join('; ')
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script, String(title || '选择文件夹'), String(initialPath || '')], {
      windowsHide: true,
      encoding: 'utf8'
    }, (error, stdout) => {
      if (error) return reject(error)
      resolve(String(stdout || '').trim())
    })
  })
}

function openPath(targetPath) {
  return new Promise((resolve, reject) => {
    const normalized = path.resolve(String(targetPath || ''))
    if (!fs.existsSync(normalized)) return reject(new Error('目录不存在'))
    const child = spawn('explorer.exe', [normalized], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
    resolve()
  })
}

async function startExportJob(body) {
  const config = normalizeConfig(body)
  validateConfig(config, true)
  const outputDir = path.resolve(String(body.outputDir || '').trim())
  if (!body.outputDir) throw new Error('请选择导出目录')
  const sessionIds = Array.isArray(body.sessionIds) ? body.sessionIds.map(String).filter(Boolean) : []
  if (!sessionIds.length) throw new Error('至少选择一个会话')
  const id = crypto.randomUUID()
  const job = {
    id,
    status: 'queued',
    progress: { phase: 'preparing', phaseLabel: '准备读取聊天数据', current: 0, total: sessionIds.length },
    outputDir,
    result: null,
    error: null,
    createdAt: Date.now()
  }
  jobs.set(id, job)

  setImmediate(async () => {
    const core = new WeFlowCore(config)
    job.status = 'running'
    try {
      const options = body.options || {}
      job.result = await core.exportSessions({
        sessionIds,
        outputDir,
        options: {
          format: String(options.format || 'html'),
          exportMedia: options.exportMedia === true,
          exportImages: options.exportMedia === true,
          exportVoices: options.exportMedia === true,
          exportVideos: options.exportMedia === true,
          exportEmojis: options.exportMedia === true,
          exportFiles: options.exportMedia === true,
          exportVoiceAsText: options.exportVoiceAsText === true,
          exportAvatars: options.exportAvatars === true,
          exportConflictStrategy: 'rename',
          exportConcurrency: 2
        },
        onProgress(progress) {
          job.progress = progress
        }
      })
      job.status = job.result && job.result.success === false ? 'failed' : 'complete'
      if (job.status === 'failed') job.error = String(job.result.error || '导出失败')
    } catch (error) {
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : String(error)
    } finally {
      await core.close().catch(() => undefined)
    }
  })
  return job
}

function cleanJobs() {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000
  for (const [id, job] of jobs) if (job.createdAt < cutoff) jobs.delete(id)
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`)
    if (req.method === 'GET' && staticFiles.has(url.pathname)) {
      const [fileName, contentType] = staticFiles.get(url.pathname)
      const content = fs.readFileSync(path.join(__dirname, fileName))
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': content.length,
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
      })
      res.end(content)
      return
    }
    if (url.pathname.startsWith('/api/') && !requireLocalUi(req)) {
      sendJson(res, 403, { error: '仅允许本机界面访问' })
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/pick-folder') {
      const body = await readJson(req)
      sendJson(res, 200, { path: await pickFolder(body.title, body.initialPath) })
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/sessions') {
      const body = await readJson(req)
      const config = normalizeConfig(body)
      validateConfig(config)
      const core = new WeFlowCore(config)
      try {
        await core.open()
        const sessions = (await core.listSessions()).map(normalizeSession).filter((item) => item.id)
        sendJson(res, 200, { sessions })
      } finally {
        await core.close().catch(() => undefined)
      }
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      cleanJobs()
      const job = await startExportJob(await readJson(req))
      sendJson(res, 202, { id: job.id })
      return
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
      const id = url.pathname.split('/').pop()
      const job = jobs.get(id)
      if (!job) return sendJson(res, 404, { error: '任务不存在或已过期' })
      sendJson(res, 200, job)
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/open-path') {
      const body = await readJson(req)
      await openPath(body.path)
      sendJson(res, 200, { success: true })
      return
    }
    sendJson(res, 404, { error: '页面不存在' })
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
  }
})

function openBrowser() {
  const child = spawn('cmd.exe', ['/c', 'start', '', `http://${HOST}:${PORT}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.unref()
}

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    if (process.env.WEFLOW_UI_NO_OPEN !== '1') openBrowser()
    process.exit(0)
  }
  console.error(error)
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  console.log(`WeFlow UI: http://${HOST}:${PORT}`)
  if (process.env.WEFLOW_UI_NO_OPEN !== '1') openBrowser()
})
