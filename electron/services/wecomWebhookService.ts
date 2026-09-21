import https from 'https'
import { createHash } from 'crypto'
import { URL } from 'url'

const WECOM_HOST = 'qyapi.weixin.qq.com'
const WECOM_PATH = '/cgi-bin/webhook/send'
const REQUEST_TIMEOUT_MS = 15_000
const MAX_TEXT_BYTES = 1800
const MAX_MARKDOWN_BYTES = 3500

export type WeComPushFormat = 'text' | 'markdown' | 'markdown_v2'

export interface WeComWebhookResult {
  success: boolean
  message: string
  errcode?: number
  partsSent?: number
}

interface WeComResponse {
  errcode?: number
  errmsg?: string
}

function validateWebhook(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(String(rawUrl || '').trim())
  } catch {
    throw new Error('Webhook 地址格式无效')
  }
  if (url.protocol !== 'https:' || url.hostname !== WECOM_HOST || url.pathname !== WECOM_PATH) {
    throw new Error('仅支持企业微信官方群机器人 Webhook')
  }
  if (!String(url.searchParams.get('key') || '').trim()) {
    throw new Error('Webhook 缺少 key 参数')
  }
  return url
}

function splitContent(content: string, maxBytes: number): string[] {
  const normalized = String(content || '').replace(/\uFFFD/g, '').trim()
  if (!normalized) return []
  if (Buffer.byteLength(normalized, 'utf8') <= maxBytes) return [normalized]

  // Keep headings, bullets, conclusions and their surrounding text together.
  // A paragraph boundary is a much better page break than an arbitrary line.
  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const parts: string[] = []
  let current = ''
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (Buffer.byteLength(candidate, 'utf8') <= maxBytes) {
      current = candidate
      continue
    }
    if (current) parts.push(current)
    let remainder = paragraph
    while (Buffer.byteLength(remainder, 'utf8') > maxBytes) {
      let end = Math.min(remainder.length, maxBytes)
      while (end > 0 && Buffer.byteLength(remainder.slice(0, end), 'utf8') > maxBytes) end -= 1
      // Avoid splitting a surrogate pair when the boundary falls in the middle.
      if (end > 0 && end < remainder.length && /[\uDC00-\uDFFF]/.test(remainder[end])) end -= 1
      parts.push(remainder.slice(0, end).trim())
      remainder = remainder.slice(end)
    }
    current = remainder.trim()
  }
  if (current) parts.push(current)
  return parts
}

function postMessage(url: URL, format: WeComPushFormat, content: string): Promise<WeComResponse> {
  return new Promise((resolve, reject) => {
    const body = format === 'text'
      ? JSON.stringify({ msgtype: 'text', text: { content } })
      : JSON.stringify({ msgtype: format, [format]: { content } })
    const req = https.request({
      protocol: 'https:',
      hostname: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if ((res.statusCode || 0) >= 400) {
          reject(new Error(`企业微信请求失败 (${res.statusCode})`))
          return
        }
        try {
          resolve(JSON.parse(data) as WeComResponse)
        } catch {
          reject(new Error('企业微信返回了无法解析的响应'))
        }
      })
    })
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('企业微信请求超时')))
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function postImage(url: URL, image: Buffer): Promise<WeComResponse> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      msgtype: 'image',
      image: {
        base64: image.toString('base64'),
        md5: createHash('md5').update(image).digest('hex')
      }
    })
    const req = https.request({
      protocol: 'https:',
      hostname: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if ((res.statusCode || 0) >= 400) return reject(new Error(`企业微信请求失败 (${res.statusCode})`))
        try { resolve(JSON.parse(data) as WeComResponse) } catch { reject(new Error('企业微信返回了无法解析的响应')) }
      })
    })
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('企业微信请求超时')))
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export class WeComWebhookService {
  async test(webhookUrl: string, format: WeComPushFormat = 'markdown'): Promise<WeComWebhookResult> {
    try {
      const url = validateWebhook(webhookUrl)
      const markdown = `**MYfollow 连接测试**\n> ${new Date().toLocaleString('zh-CN')}\n\n企业微信群机器人连接成功。`
      const content = format === 'text'
        ? markdown.replace(/\*\*/g, '').replace(/^>\s?/gm, '')
        : markdown
      const response = await postMessage(url, format, content)
      if (response.errcode !== 0) {
        return { success: false, errcode: response.errcode, message: response.errmsg || '企业微信拒绝了测试消息' }
      }
      return { success: true, errcode: 0, partsSent: 1, message: '测试消息已发送' }
    } catch (error) {
      return { success: false, message: (error as Error).message || String(error) }
    }
  }

  async send(webhookUrl: string, content: string, format: WeComPushFormat = 'markdown'): Promise<WeComWebhookResult> {
    try {
      const url = validateWebhook(webhookUrl)
      const normalizedContent = format === 'text'
        ? content
          .replace(/^#{1,6}\s+/gm, '')
          .replace(/\*\*(.*?)\*\*/g, '$1')
          .replace(/\*([^*]+)\*/g, '$1')
          .replace(/^>\s?/gm, '')
          .replace(/^-\s+/gm, '• ')
          .replace(/`([^`]+)`/g, '$1')
          .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
          .replace(/<font[^>]*>(.*?)<\/font>/gi, '$1')
        : content
      const parts = splitContent(normalizedContent, format === 'text' ? MAX_TEXT_BYTES : MAX_MARKDOWN_BYTES)
      if (parts.length === 0) return { success: false, message: '报告内容为空' }

      for (let index = 0; index < parts.length; index += 1) {
        const heading = parts.length > 1 ? `**报告 ${index + 1}/${parts.length}**\n` : ''
        let lastError: Error | null = null
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const partContent = format === 'text' ? parts[index] : `${heading}${parts[index]}`
            const response = await postMessage(url, format, partContent)
            if (response.errcode !== 0) throw new Error(response.errmsg || `企业微信错误 ${response.errcode}`)
            lastError = null
            break
          } catch (error) {
            lastError = error as Error
            if (attempt < 2) await delay(800 * (attempt + 1))
          }
        }
        if (lastError) {
          return { success: false, partsSent: index, message: `第 ${index + 1} 段发送失败：${lastError.message}` }
        }
        if (index < parts.length - 1) await delay(1_000)
      }
      return { success: true, errcode: 0, partsSent: parts.length, message: `报告已发送（${parts.length} 段）` }
    } catch (error) {
      return { success: false, message: (error as Error).message || String(error) }
    }
  }

  async sendImages(webhookUrl: string, images: Buffer[]): Promise<WeComWebhookResult> {
    try {
      const url = validateWebhook(webhookUrl)
      if (images.length === 0) return { success: false, message: '报告图片为空' }
      for (let index = 0; index < images.length; index += 1) {
        if (images[index].length > 2 * 1024 * 1024) {
          return { success: false, partsSent: index, message: `第 ${index + 1} 张图片超过企业微信 2MB 限制` }
        }
        const response = await postImage(url, images[index])
        if (response.errcode !== 0) {
          return { success: false, errcode: response.errcode, partsSent: index, message: response.errmsg || `第 ${index + 1} 张图片发送失败` }
        }
        if (index < images.length - 1) await delay(1_000)
      }
      return { success: true, errcode: 0, partsSent: images.length, message: `图片报告已发送（${images.length} 张）` }
    } catch (error) {
      return { success: false, message: (error as Error).message || String(error) }
    }
  }

  async sendMarkdown(webhookUrl: string, markdown: string): Promise<WeComWebhookResult> {
    return this.send(webhookUrl, markdown, 'markdown')
  }
}

export const wecomWebhookService = new WeComWebhookService()
