import http from 'http'
import https from 'https'
import { ConfigService } from './config'

export interface MessageAlertAiJudgeResult {
  match: boolean
  reason: string
  summary?: string
  subject?: string
  grade?: string
  rate?: number | null
  format?: string
}

interface ModelConfig {
  apiBaseUrl: string
  apiKey: string
  model: string
  maxTokens: number
}

const REQUEST_TIMEOUT_MS = 25000
const MAX_CONTENT_LENGTH = 2400
const DEFAULT_MAX_TOKENS = 400

function buildApiUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}

/**
 * 消息监控的 AI 判定服务：复用「AI 基础配置」里的模型（aiModelApi*），
 * 对一条群消息判断是否符合用户用自然语言描述的筛选条件，返回结构化 JSON。
 * 使用 Node 原生 http/https，无需第三方 SDK。
 */
class MessageAlertAiService {
  private readonly config = ConfigService.getInstance()
  private readonly maxConcurrency = 2
  private inflight = 0
  private readonly waiters: Array<() => void> = []

  private getModelConfig(): ModelConfig {
    const apiBaseUrl = String(this.config.get('aiModelApiBaseUrl') || '').trim()
    const apiKey = String(this.config.get('aiModelApiKey') || '').trim()
    const model = String(this.config.get('aiModelApiModel') || '').trim() || 'gpt-4o-mini'
    const rawMaxTokens = Number(this.config.get('aiModelApiMaxTokens'))
    const maxTokens = Number.isFinite(rawMaxTokens) && rawMaxTokens > 0
      ? Math.min(4096, Math.max(64, Math.floor(rawMaxTokens)))
      : DEFAULT_MAX_TOKENS
    return { apiBaseUrl, apiKey, model, maxTokens }
  }

  isConfigured(): boolean {
    const { apiBaseUrl, apiKey } = this.getModelConfig()
    return Boolean(apiBaseUrl && apiKey)
  }

  private async acquireSlot(): Promise<void> {
    if (this.inflight < this.maxConcurrency) {
      this.inflight += 1
      return
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    this.inflight += 1
  }

  private releaseSlot(): void {
    this.inflight -= 1
    const next = this.waiters.shift()
    if (next) next()
  }

  async judge(criteria: string, content: string): Promise<MessageAlertAiJudgeResult | null> {
    const trimmedCriteria = String(criteria || '').trim()
    const trimmedContent = String(content || '').trim().slice(0, MAX_CONTENT_LENGTH)
    if (!trimmedCriteria || !trimmedContent) return null
    if (!this.isConfigured()) return null

    await this.acquireSlot()
    try {
      const systemPrompt = [
        'Treat the supplied content as a batch of messages. Summarize the batch first, then judge the criteria. Return JSON with match, reason, and summary.',
        '你是一个信息筛选助手，正在帮用户从群聊消息里筛选符合条件的信息（例如家教/兼职信息）。',
        '用户会给出筛选条件，以及一条群聊消息。请你理解消息语义（消息可能不规范、有错别字、单位写法多样），判断它是否同时满足用户的全部条件。',
        '判断要点：',
        '1. 条件之间是“并且”的关系，必须全部满足才算命中。',
        '2. 涉及金额/时薪等数字时，按语义抽取真实数值再比较（如“130/时”“时薪150”“一小时120元”都表示时薪）。',
        '3. 如果消息里缺少判断某个条件所需的信息，则该条件视为不满足。',
        '只返回一个 JSON 对象，不要输出多余文字，格式：',
        '{"match": true/false, "reason": "简短中文说明为什么命中或不命中", "subject": "科目或空", "grade": "年级或空", "rate": 数字或null, "format": "线上/线下/空"}'
      ].join('\n')

      const userPrompt = [
        'Analyze all messages below as one batch. Return a concise one-sentence summary in the JSON field summary.',
        `【筛选条件】\n${trimmedCriteria}`,
        `【群聊消息】\n${trimmedContent}`
      ].join('\n\n')

      const raw = await this.callModel(systemPrompt, userPrompt)
      return this.parseResult(raw)
    } catch (error) {
      console.warn('[MessageAlertAiService] AI 判定失败:', (error as Error).message)
      return null
    } finally {
      this.releaseSlot()
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const { apiBaseUrl, apiKey } = this.getModelConfig()
    if (!apiBaseUrl || !apiKey) {
      return { success: false, message: '请先在「设置 → AI 基础配置」填写 API 地址与密钥' }
    }
    try {
      const raw = await this.callModel(
        '你是一个测试助手，只返回 JSON。',
        '请返回 {"match": false, "reason": "connection ok"}'
      )
      const parsed = this.parseResult(raw)
      if (parsed) return { success: true, message: 'AI 连接正常' }
      return { success: false, message: '模型返回格式异常，请检查模型是否支持 JSON 输出' }
    } catch (error) {
      return { success: false, message: `连接失败：${(error as Error).message}` }
    }
  }

  private parseResult(raw: string): MessageAlertAiJudgeResult | null {
    const text = String(raw || '').trim()
    if (!text) return null
    let jsonText = text
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fenceMatch) {
      jsonText = fenceMatch[1].trim()
    } else {
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start >= 0 && end > start) jsonText = text.slice(start, end + 1)
    }
    try {
      const parsed = JSON.parse(jsonText)
      const rateValue = parsed?.rate
      return {
        match: parsed?.match === true,
        reason: String(parsed?.reason || '').trim(),
        summary: parsed?.summary ? String(parsed.summary).trim() : undefined,
        subject: parsed?.subject ? String(parsed.subject).trim() : undefined,
        grade: parsed?.grade ? String(parsed.grade).trim() : undefined,
        rate: typeof rateValue === 'number' ? rateValue : (rateValue == null ? null : Number(rateValue) || null),
        format: parsed?.format ? String(parsed.format).trim() : undefined
      }
    } catch {
      return null
    }
  }

  private callModel(systemPrompt: string, userPrompt: string): Promise<string> {
    const { apiBaseUrl, apiKey, model, maxTokens } = this.getModelConfig()
    return new Promise((resolve, reject) => {
      const endpoint = buildApiUrl(apiBaseUrl, '/chat/completions')
      let urlObj: URL
      try {
        urlObj = new URL(endpoint)
      } catch {
        reject(new Error(`无效的 API 地址: ${endpoint}`))
        return
      }

      const payload = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0,
        max_tokens: maxTokens,
        stream: false,
        response_format: { type: 'json_object' }
      }
      const body = JSON.stringify(payload)

      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST' as const,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body).toString(),
          Authorization: `Bearer ${apiKey}`
        }
      }

      const requestFn = urlObj.protocol === 'https:' ? https.request : http.request
      const req = requestFn(requestOptions, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`API 请求失败 (${res.statusCode}): ${data.slice(0, 200)}`))
              return
            }
            const parsed = JSON.parse(data)
            const content = parsed?.choices?.[0]?.message?.content
            if (typeof content === 'string' && content.trim()) {
              resolve(content.trim())
            } else {
              reject(new Error(`API 返回格式异常: ${data.slice(0, 200)}`))
            }
          } catch {
            reject(new Error(`JSON 解析失败: ${data.slice(0, 200)}`))
          }
        })
      })

      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy()
        reject(new Error('API 请求超时'))
      })
      req.on('error', (e) => reject(e))
      req.write(body)
      req.end()
    })
  }
}

export const messageAlertAiService = new MessageAlertAiService()
