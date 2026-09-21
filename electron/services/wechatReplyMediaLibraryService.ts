import { app } from 'electron'
import { createHash } from 'crypto'
import { existsSync, readFileSync, statSync } from 'fs'
import { copyFile, mkdir, rm, writeFile } from 'fs/promises'
import path from 'path'
import { imageDecryptService } from './imageDecryptService'
import { selectWechatReplyMedia } from '../../shared/wechatReplyMedia'
import type {
  WechatReplyMediaAsset,
  WechatReplyMediaAssetInput,
  WechatReplyMediaAssetResult,
  WechatReplyMediaListResult,
  WechatReplyMediaScope
} from '../../shared/wechatReply'

type LibraryFile = {
  version: 1
  items: WechatReplyMediaAsset[]
}

const ALLOWED_EXTENSIONS = new Set(['.gif', '.webp', '.png', '.jpg', '.jpeg', '.bmp'])
const MAX_FILE_SIZE = 20 * 1024 * 1024

const normalizeTags = (value: unknown): string[] => {
  const input = Array.isArray(value) ? value : String(value || '').split(/[，,、\s]+/)
  return [...new Set(input.map(item => String(item || '').trim().toLocaleLowerCase('zh-CN')).filter(Boolean))].slice(0, 20)
}

const normalizeScope = (value: unknown): WechatReplyMediaScope => (
  value === 'private' || value === 'group' ? value : 'all'
)

class WechatReplyMediaLibraryService {
  private loaded = false
  private items: WechatReplyMediaAsset[] = []

  list(): WechatReplyMediaListResult {
    this.ensureLoaded()
    return {
      success: true,
      message: `已加载 ${this.items.length} 个回复素材`,
      items: this.items.filter(item => existsSync(item.filePath)).map(item => ({ ...item, tags: [...item.tags], source: { ...item.source } }))
    }
  }

  get(id: unknown): WechatReplyMediaAsset | undefined {
    this.ensureLoaded()
    const key = String(id || '').trim()
    const item = this.items.find(entry => entry.id === key && entry.enabled && existsSync(entry.filePath))
    return item ? { ...item, tags: [...item.tags], source: { ...item.source } } : undefined
  }

  async addFromResource(input: unknown): Promise<WechatReplyMediaAssetResult> {
    const parsed = this.sanitizeInput(input)
    if (!parsed.success || !parsed.input) return { success: false, code: 'INVALID_MEDIA_INPUT', message: parsed.message }
    const value = parsed.input
    const existing = this.findBySourceKey(value.source.sourceKey)

    const decrypted = await imageDecryptService.decryptImage({
      sessionId: value.source.sessionId,
      imageMd5: value.source.imageMd5,
      imageDatName: value.source.imageDatName,
      createTime: value.source.createTime,
      force: true,
      preferFilePath: true,
      hardlinkOnly: true,
      allowCacheIndex: true,
      allowFilesystemScan: true,
      suppressEvents: true
    })
    const sourcePath = String(decrypted.localPath || '').trim()
    if (!decrypted.success || !sourcePath || !existsSync(sourcePath)) {
      return { success: false, code: 'RESOURCE_UNAVAILABLE', message: decrypted.error || '无法取得该图片的本地原图' }
    }

    const extension = path.extname(sourcePath).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return { success: false, code: 'INVALID_FILE_TYPE', message: '该资源不是支持的图片格式' }
    }
    if (value.kind === 'emoji' && extension === '.bmp') {
      return { success: false, code: 'INVALID_FILE_TYPE', message: 'BMP 不能作为表情图片，请选择 PNG、JPG、WebP 或 GIF' }
    }
    const fileStat = statSync(sourcePath)
    if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > MAX_FILE_SIZE) {
      return { success: false, code: 'INVALID_FILE_SIZE', message: '图片为空或超过 20 MB' }
    }

    const now = Date.now()
    const id = existing?.id || `reply-media-${createHash('sha256').update(value.source.sourceKey).digest('hex').slice(0, 20)}`
    const mediaDir = this.getMediaDir()
    await mkdir(mediaDir, { recursive: true })
    const destination = path.join(mediaDir, `${id}${extension}`)
    if (path.resolve(sourcePath).toLocaleLowerCase() !== path.resolve(destination).toLocaleLowerCase()) {
      await copyFile(sourcePath, destination)
    }

    if (existing && existing.filePath !== destination && this.isManagedPath(existing.filePath)) {
      await rm(existing.filePath, { force: true }).catch(() => undefined)
    }

    const item: WechatReplyMediaAsset = {
      id,
      name: value.name || existing?.name || `回复图片 ${new Date(value.source.createTime * 1000).toLocaleString('zh-CN', { hour12: false })}`,
      kind: value.kind,
      tags: value.tags,
      scope: value.scope,
      autoSend: value.autoSend,
      enabled: true,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      filePath: destination,
      source: value.source
    }
    this.items = existing
      ? this.items.map(entry => entry.id === existing.id ? item : entry)
      : [item, ...this.items]
    await this.save()
    return { success: true, message: existing ? '回复素材已更新' : '已复制到回复素材库', item }
  }

  async update(id: unknown, patch: unknown): Promise<WechatReplyMediaAssetResult> {
    this.ensureLoaded()
    const key = String(id || '').trim()
    const current = this.items.find(item => item.id === key)
    if (!current) return { success: false, code: 'MEDIA_NOT_FOUND', message: '回复素材不存在' }
    const raw = patch && typeof patch === 'object' ? patch as Record<string, unknown> : {}
    const nextKind = raw.kind === 'emoji' ? 'emoji' : raw.kind === 'image' ? 'image' : current.kind
    if (nextKind === 'emoji' && path.extname(current.filePath).toLowerCase() === '.bmp') {
      return { success: false, code: 'INVALID_FILE_TYPE', message: 'BMP 不能设置为表情图片' }
    }
    const next: WechatReplyMediaAsset = {
      ...current,
      name: String(raw.name ?? current.name).trim().slice(0, 100) || current.name,
      kind: nextKind,
      tags: raw.tags === undefined ? current.tags : normalizeTags(raw.tags),
      scope: raw.scope === undefined ? current.scope : normalizeScope(raw.scope),
      autoSend: raw.autoSend === undefined ? current.autoSend : raw.autoSend === true,
      enabled: raw.enabled === undefined ? current.enabled : raw.enabled !== false,
      updatedAt: Date.now()
    }
    this.items = this.items.map(item => item.id === key ? next : item)
    await this.save()
    return { success: true, message: '回复素材设置已保存', item: next }
  }

  async remove(id: unknown): Promise<WechatReplyMediaAssetResult> {
    this.ensureLoaded()
    const key = String(id || '').trim()
    const current = this.items.find(item => item.id === key)
    if (!current) return { success: false, code: 'MEDIA_NOT_FOUND', message: '回复素材不存在' }
    this.items = this.items.filter(item => item.id !== key)
    if (this.isManagedPath(current.filePath)) await rm(current.filePath, { force: true }).catch(() => undefined)
    await this.save()
    return { success: true, message: '已移出回复素材库', item: current }
  }

  findAutoMatch(content: string, isGroup: boolean): WechatReplyMediaAsset | undefined {
    this.ensureLoaded()
    return selectWechatReplyMedia(this.items, content, isGroup, filePath => existsSync(filePath))
  }

  private findBySourceKey(sourceKey: string): WechatReplyMediaAsset | undefined {
    this.ensureLoaded()
    return this.items.find(item => item.source.sourceKey === sourceKey)
  }

  private sanitizeInput(input: unknown): { success: boolean; message: string; input?: WechatReplyMediaAssetInput } {
    const raw = input && typeof input === 'object' ? input as Record<string, any> : {}
    const sourceRaw = raw.source && typeof raw.source === 'object' ? raw.source as Record<string, unknown> : {}
    const sourceKey = String(sourceRaw.sourceKey || '').trim().slice(0, 500)
    const sessionId = String(sourceRaw.sessionId || '').trim().slice(0, 300)
    const localId = Number(sourceRaw.localId || 0)
    const createTime = Number(sourceRaw.createTime || 0)
    const imageMd5 = String(sourceRaw.imageMd5 || '').trim().toLowerCase().slice(0, 128) || undefined
    const imageDatName = String(sourceRaw.imageDatName || '').trim().toLowerCase().slice(0, 300) || undefined
    if (!sourceKey || !sessionId || !Number.isFinite(localId) || localId <= 0 || !Number.isFinite(createTime) || createTime <= 0) {
      return { success: false, message: '资源标识不完整' }
    }
    if (!imageMd5 && !imageDatName) return { success: false, message: '资源缺少图片定位信息' }
    return {
      success: true,
      message: '',
      input: {
        name: String(raw.name || '').trim().slice(0, 100),
        kind: raw.kind === 'emoji' ? 'emoji' : 'image',
        tags: normalizeTags(raw.tags),
        scope: normalizeScope(raw.scope),
        autoSend: raw.autoSend === true,
        source: { sourceKey, sessionId, localId, createTime, imageMd5, imageDatName }
      }
    }
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      const filePath = this.getLibraryPath()
      if (!existsSync(filePath)) return
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<LibraryFile>
      this.items = Array.isArray(parsed.items)
        ? parsed.items.filter(item => item && typeof item.id === 'string' && typeof item.filePath === 'string')
        : []
    } catch (error) {
      console.warn('[WechatReplyMediaLibrary] Failed to load:', (error as Error).message)
      this.items = []
    }
  }

  private async save(): Promise<void> {
    const dir = this.getBaseDir()
    await mkdir(dir, { recursive: true })
    await writeFile(this.getLibraryPath(), JSON.stringify({ version: 1, items: this.items } satisfies LibraryFile, null, 2), 'utf8')
  }

  private getBaseDir(): string {
    return path.join(app.getPath('userData'), 'reply-media')
  }

  private getMediaDir(): string {
    return path.join(this.getBaseDir(), 'files')
  }

  private getLibraryPath(): string {
    return path.join(this.getBaseDir(), 'library.json')
  }

  private isManagedPath(filePath: string): boolean {
    const base = `${path.resolve(this.getMediaDir()).toLocaleLowerCase()}${path.sep}`
    const target = path.resolve(String(filePath || '')).toLocaleLowerCase()
    return target.startsWith(base)
  }
}

export const wechatReplyMediaLibraryService = new WechatReplyMediaLibraryService()
