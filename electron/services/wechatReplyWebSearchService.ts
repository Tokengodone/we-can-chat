import https from 'https'

export interface WechatReplyWebResult {
  title: string
  url: string
  snippet: string
  publishedAt?: string
}

const RESPONSE_LIMIT = 1024 * 1024
const REQUEST_TIMEOUT_MS = 10_000

const decodeXml = (value: string): string => String(value || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&amp;/g, '&')

const cleanText = (value: string): string => decodeXml(value)
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const readTag = (xml: string, name: string): string => {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(xml)
  return match ? cleanText(match[1]) : ''
}

export const parseWechatReplyWebSearchRss = (xml: string, limit: number): WechatReplyWebResult[] => {
  const items = String(xml || '').match(/<item\b[\s\S]*?<\/item>/gi) || []
  const seen = new Set<string>()
  const results: WechatReplyWebResult[] = []
  const resultLimit = Math.max(1, Math.min(8, Math.floor(limit) || 4))
  for (const item of items) {
    const title = readTag(item, 'title')
    const url = readTag(item, 'link')
    const snippet = readTag(item, 'description').slice(0, 700)
    const publishedAt = readTag(item, 'pubDate')
    if (!title || !/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    results.push({ title: title.slice(0, 240), url, snippet, ...(publishedAt ? { publishedAt } : {}) })
    if (results.length >= resultLimit) break
  }
  return results
}

class WechatReplyWebSearchService {
  async search(query: string, limit: number): Promise<WechatReplyWebResult[]> {
    const normalizedQuery = String(query || '')
      .replace(/@[\w\u3400-\u9fff-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300)
    if (!normalizedQuery) return []
    const target = new URL('https://www.bing.com/search')
    target.searchParams.set('q', normalizedQuery)
    target.searchParams.set('format', 'rss')
    target.searchParams.set('setlang', 'zh-Hans')
    const xml = await this.get(target, 0)
    return parseWechatReplyWebSearchRss(xml, limit)
  }

  private get(url: URL, redirects: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: {
          Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WeFlow/5'
        }
      }, response => {
        const status = response.statusCode || 0
        const location = response.headers.location
        if (status >= 300 && status < 400 && location && redirects < 2) {
          response.resume()
          void this.get(new URL(location, url), redirects + 1).then(resolve, reject)
          return
        }
        if (status >= 400) {
          response.resume()
          reject(new Error(`公开网页检索失败 (HTTP ${status})`))
          return
        }
        let data = ''
        response.setEncoding('utf8')
        response.on('data', chunk => {
          data += chunk
          if (data.length > RESPONSE_LIMIT) req.destroy(new Error('公开网页检索响应过大'))
        })
        response.on('end', () => resolve(data))
      })
      req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('公开网页检索超时')))
      req.on('error', reject)
    })
  }
}

export const wechatReplyWebSearchService = new WechatReplyWebSearchService()
