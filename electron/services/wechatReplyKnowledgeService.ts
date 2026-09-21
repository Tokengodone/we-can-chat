import { promises as fs } from 'fs'
import path from 'path'
import { searchWechatKnowledge, type WechatKnowledgeDocument, type WechatKnowledgeMatch } from '../../shared/wechatReplyKnowledge'

const MAX_FILES = 5000
const MAX_FILE_BYTES = 512 * 1024
const CACHE_TTL_MS = 60_000

class WechatReplyKnowledgeService {
  private cache = new Map<string, { expiresAt: number; documents: WechatKnowledgeDocument[] }>()

  async search(vaultPath: string, query: string, limit: number): Promise<WechatKnowledgeMatch[]> {
    const configuredPath = String(vaultPath || '').trim()
    if (!configuredPath) return []
    const root = path.resolve(configuredPath)
    const documents = await this.loadDocuments(root)
    return searchWechatKnowledge(documents, query, limit)
  }

  async inspect(vaultPath: string): Promise<{ success: boolean; message: string; fileCount?: number }> {
    try {
      const configuredPath = String(vaultPath || '').trim()
      if (!configuredPath) throw new Error('尚未选择知识库文件夹')
      const root = path.resolve(configuredPath)
      const documents = await this.loadDocuments(root, true)
      return { success: true, message: `知识库可用，共索引 ${documents.length} 篇笔记`, fileCount: documents.length }
    } catch (error) {
      return { success: false, message: `知识库读取失败：${(error as Error).message}` }
    }
  }

  clear(): void {
    this.cache.clear()
  }

  private async loadDocuments(root: string, force = false): Promise<WechatKnowledgeDocument[]> {
    const cached = this.cache.get(root)
    if (!force && cached && cached.expiresAt > Date.now()) return cached.documents
    const stat = await fs.stat(root)
    if (!stat.isDirectory()) throw new Error('所选路径不是文件夹')
    const files: string[] = []
    const visit = async (directory: string): Promise<void> => {
      if (files.length >= MAX_FILES) return
      const entries = await fs.readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        if (files.length >= MAX_FILES) break
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        const fullPath = path.join(directory, entry.name)
        if (entry.isDirectory()) await visit(fullPath)
        else if (entry.isFile() && /\.(?:md|markdown|txt)$/i.test(entry.name)) files.push(fullPath)
      }
    }
    await visit(root)
    const documents: WechatKnowledgeDocument[] = []
    for (const filePath of files) {
      try {
        const info = await fs.stat(filePath)
        if (info.size <= 0 || info.size > MAX_FILE_BYTES) continue
        const content = await fs.readFile(filePath, 'utf8')
        documents.push({
          title: path.relative(root, filePath).replace(/\\/g, '/').replace(/\.(?:md|markdown|txt)$/i, ''),
          content
        })
      } catch {
        // A single unreadable note must not break the whole vault search.
      }
    }
    this.cache.set(root, { expiresAt: Date.now() + CACHE_TTL_MS, documents })
    return documents
  }
}

export const wechatReplyKnowledgeService = new WechatReplyKnowledgeService()
