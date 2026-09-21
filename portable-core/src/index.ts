import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'

export type ExportFormat =
  | 'chatlab'
  | 'chatlab-jsonl'
  | 'json'
  | 'arkme-json'
  | 'html'
  | 'markdown'
  | 'txt'
  | 'excel'
  | 'weclone'
  | 'sql'

export interface CoreOptions {
  /** The account directory containing db_storage. */
  accountDir?: string
  /** The 64-character database key already obtained by the user. */
  decryptKey?: string
  /** Parent WeChat data directory. Required by the rich export engine. */
  dbPath?: string
  /** Current account wxid. Required by the rich export engine. */
  myWxid?: string
  imageXorKey?: number
  imageAesKey?: string
  /** Directory containing model.int8.onnx and tokens.txt for exportVoiceAsText. */
  modelDir?: string
  resourcesPath?: string
  workDir?: string
  logEnabled?: boolean
}

export interface ReadMessagesOptions {
  limit?: number
  offset?: number
}

export interface ExportOptions {
  format: ExportFormat
  dateRange?: { start: number; end: number } | null
  senderUsername?: string
  exportMedia?: boolean
  exportAvatars?: boolean
  exportImages?: boolean
  exportVoices?: boolean
  exportVideos?: boolean
  exportEmojis?: boolean
  exportFiles?: boolean
  exportVoiceAsText?: boolean
  maxFileSizeMb?: number
  exportConcurrency?: number
  [key: string]: unknown
}

export interface ExportProgress {
  current: number
  total: number
  phase: string
  phaseLabel?: string
  currentSession?: string
  exportedMessages?: number
  estimatedTotalMessages?: number
  [key: string]: unknown
}

export interface ExportRequest {
  sessionIds: string[]
  outputDir: string
  options: ExportOptions
  onProgress?: (progress: ExportProgress) => void
}

export interface TranscribeOptions {
  modelPath: string
  tokensPath: string
  languages?: Array<'zh' | 'yue' | 'en' | 'ja' | 'ko'>
  sampleRate?: number
}

type PendingCall = {
  resolve: (value: any) => void
  reject: (error: Error) => void
}

const packageRoot = resolve(__dirname, '..')

function assertNonEmpty(name: string, value: string): string {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`${name} cannot be empty`)
  return normalized
}

function createWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

export class WeFlowCore {
  private readonly options: CoreOptions & { accountDir: string; decryptKey: string; resourcesPath: string; workDir: string }
  private dbWorker: Worker | null = null
  private callId = 0
  private readonly pending = new Map<number, PendingCall>()

  constructor(options: CoreOptions) {
    const resourcesPath = resolve(options.resourcesPath || join(packageRoot, 'resources'))
    const workDir = resolve(options.workDir || join(homedir(), '.weflow-portable-core'))
    mkdirSync(workDir, { recursive: true })
    this.options = {
      ...options,
      accountDir: options.accountDir ? resolve(options.accountDir) : '',
      decryptKey: String(options.decryptKey || '').trim(),
      resourcesPath,
      workDir
    }
  }

  private ensureDbWorker(): Worker {
    if (this.dbWorker) return this.dbWorker
    const workerPath = join(__dirname, 'wcdbWorker.js')
    if (!existsSync(workerPath)) throw new Error(`WCDB worker is missing: ${workerPath}`)
    const worker = new Worker(workerPath, {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        WEFLOW_WORKER: '1',
        WEFLOW_CORE_RESOURCES_PATH: this.options.resourcesPath,
        WCDB_RESOURCES_PATH: this.options.resourcesPath,
        WEFLOW_MODEL_DIR: this.options.modelDir ? resolve(this.options.modelDir) : ''
      }
    })
    worker.on('message', (message: any) => {
      if (message?.type === 'monitor') return
      const pending = this.pending.get(Number(message?.id))
      if (!pending) return
      this.pending.delete(Number(message.id))
      if (message.error) pending.reject(new Error(String(message.error)))
      else pending.resolve(message.result)
    })
    worker.on('error', (error) => this.rejectAll(error))
    worker.on('exit', (code) => {
      if (code !== 0) this.rejectAll(new Error(`WCDB worker exited with code ${code}`))
      this.dbWorker = null
    })
    this.dbWorker = worker
    return worker
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  private call<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    const worker = this.ensureDbWorker()
    const id = ++this.callId
    return new Promise<T>((resolveCall, reject) => {
      this.pending.set(id, { resolve: resolveCall, reject })
      worker.postMessage({ id, type, payload })
    })
  }

  async open(): Promise<void> {
    const accountDir = resolve(assertNonEmpty('accountDir', this.options.accountDir))
    const decryptKey = assertNonEmpty('decryptKey', this.options.decryptKey)
    await this.call('setPaths', {
      resourcesPath: this.options.resourcesPath,
      userDataPath: this.options.workDir
    })
    await this.call('setLogEnabled', { enabled: this.options.logEnabled === true })
    const opened = await this.call<boolean>('open', {
      accountDir,
      hexKey: decryptKey
    })
    if (!opened) {
      const reason = await this.call<string | null>('getLastInitError')
      throw new Error(reason || 'Unable to open the WeChat database')
    }
  }

  async listSessions(): Promise<any[]> {
    const result = await this.call<{ success: boolean; sessions?: any[]; error?: string }>('getSessions')
    if (!result.success) throw new Error(result.error || 'Unable to list sessions')
    return result.sessions || []
  }

  async getMessages(sessionId: string, options: ReadMessagesOptions = {}): Promise<any[]> {
    const result = await this.call<{ success: boolean; messages?: any[]; error?: string }>('getMessages', {
      sessionId: assertNonEmpty('sessionId', sessionId),
      limit: Math.max(1, options.limit || 100),
      offset: Math.max(0, options.offset || 0)
    })
    if (!result.success) throw new Error(result.error || 'Unable to read messages')
    return result.messages || []
  }

  async exportSessions(request: ExportRequest): Promise<any> {
    if (!this.options.dbPath || !this.options.myWxid) {
      throw new Error('dbPath and myWxid are required for rich export')
    }
    assertNonEmpty('accountDir', this.options.accountDir)
    assertNonEmpty('decryptKey', this.options.decryptKey)
    const outputDir = resolve(assertNonEmpty('outputDir', request.outputDir))
    mkdirSync(outputDir, { recursive: true })
    const workerPath = join(__dirname, 'exportWorker.js')
    const workerData = {
      mode: 'sessions',
      sessionIds: request.sessionIds.map((id) => assertNonEmpty('sessionId', id)),
      outputDir,
      options: request.options,
      dbPath: resolve(this.options.dbPath),
      accountDir: this.options.accountDir,
      decryptKey: this.options.decryptKey,
      myWxid: this.options.myWxid,
      imageXorKey: this.options.imageXorKey,
      imageAesKey: this.options.imageAesKey,
      resourcesPath: this.options.resourcesPath,
      userDataPath: this.options.workDir,
      cachePath: this.options.workDir,
      logEnabled: this.options.logEnabled === true,
      isPackaged: false
    }
    return new Promise((resolveExport, reject) => {
      const worker = new Worker(workerPath, {
        workerData,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          WEFLOW_WORKER: '1',
          WEFLOW_CORE_RESOURCES_PATH: this.options.resourcesPath,
          WCDB_RESOURCES_PATH: this.options.resourcesPath,
          WEFLOW_MODEL_DIR: this.options.modelDir ? resolve(this.options.modelDir) : ''
        }
      })
      let settled = false
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        callback()
        void worker.terminate()
      }
      worker.on('message', (message: any) => {
        if (message?.type === 'export:progress') request.onProgress?.(message.data)
        if (message?.type === 'export:result') finish(() => resolveExport(message.data))
        if (message?.type === 'export:error') finish(() => reject(new Error(String(message.error))))
      })
      worker.on('error', (error) => finish(() => reject(error)))
      worker.on('exit', (code) => {
        if (!settled && code !== 0) finish(() => reject(new Error(`Export worker exited with code ${code}`)))
      })
    })
  }

  async transcribeWav(wavData: Buffer, options: TranscribeOptions): Promise<string> {
    if (!existsSync(options.modelPath) || !existsSync(options.tokensPath)) {
      throw new Error('SenseVoice model or tokens file does not exist')
    }
    const workerPath = join(__dirname, 'transcribeWorker.js')
    return new Promise((resolveText, reject) => {
      const worker = new Worker(workerPath, {
        workerData: {
          modelPath: resolve(options.modelPath),
          tokensPath: resolve(options.tokensPath),
          wavData,
          sampleRate: options.sampleRate || 16000,
          languages: options.languages || ['zh', 'yue']
        }
      })
      let settled = false
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        callback()
        void worker.terminate()
      }
      worker.on('message', (message: any) => {
        if (message?.type === 'final') finish(() => resolveText(String(message.text || '')))
        if (message?.type === 'error') finish(() => reject(new Error(String(message.error))))
      })
      worker.on('error', (error) => finish(() => reject(error)))
      worker.on('exit', (code) => {
        if (!settled && code !== 0) finish(() => reject(new Error(`Transcribe worker exited with code ${code}`)))
      })
    })
  }

  async transcribeSilk(silkData: Buffer, options: TranscribeOptions): Promise<string> {
    // silk-wasm is external so its .wasm file remains relocatable with node_modules.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const silk = require('silk-wasm') as { decode: (data: Buffer, rate: number) => Promise<{ data: Uint8Array }> }
    const sampleRate = options.sampleRate || 24000
    const decoded = await silk.decode(silkData, sampleRate)
    return this.transcribeWav(createWav(Buffer.from(decoded.data), sampleRate), { ...options, sampleRate })
  }

  async close(): Promise<void> {
    if (!this.dbWorker) return
    try {
      await this.call('close')
    } finally {
      await this.dbWorker?.terminate()
      this.dbWorker = null
    }
  }
}
