import http from 'http'
import https from 'https'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import sharp from 'sharp'
import { ConfigService } from './config'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_SOURCE_IMAGE_BYTES = 60 * 1024 * 1024
// Base64 expands binary data by roughly 4/3. Keep JSON overhead separate from
// the decoded image limit so a valid image is not rejected while downloading.
const MAX_API_RESPONSE_CHARS = Math.ceil(MAX_SOURCE_IMAGE_BYTES * 4 / 3) + 1024 * 1024
const TIMEOUT_MS = 120_000

const buildImagesUrl = (baseUrl: string): URL => {
  const url = new URL(baseUrl)
  const pathname = url.pathname.replace(/\/+$/, '')
    .replace(/\/(?:chat\/completions|responses)$/i, '')
  url.pathname = `${pathname}/images/generations`.replace(/\/{2,}/g, '/')
  url.search = ''
  return url
}

const extensionForImage = (buffer: Buffer): string => {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return '.jpg'
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp'
  throw new Error('图片接口返回的内容不是支持的图片格式')
}

class WechatReplyImageGenerationService {
  private readonly config = ConfigService.getInstance()

  async generate(prompt: string, model: string, size: string): Promise<{ filePath: string; fileName: string }> {
    const apiBaseUrl = String(this.config.get('aiModelApiBaseUrl') || '').trim()
    const apiKey = String(this.config.get('aiModelApiKey') || '').trim()
    if (!apiBaseUrl || !apiKey) throw new Error('AI 基础配置不完整')
    const endpoint = buildImagesUrl(apiBaseUrl)
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('图片接口仅支持 HTTP/HTTPS')
    const configuredModel = String(model || 'gpt-image-1.5').trim()
    const requestPayload = {
      model: configuredModel,
      prompt: String(prompt || '').trim().slice(0, 2000),
      size,
      n: 1
    }
    let response: any
    try {
      response = await this.requestJson(endpoint, apiKey, requestPayload)
    } catch (error) {
      const message = String((error as Error).message || error)
      const providerOffers15 = /gpt-image-1\.5/i.test(message)
      const unsupportedConfiguredModel = /not supported|unsupported|不支持/i.test(message)
      if (configuredModel === 'gpt-image-1' && providerOffers15 && unsupportedConfiguredModel) {
        response = await this.requestJson(endpoint, apiKey, { ...requestPayload, model: 'gpt-image-1.5' })
      } else {
        throw error
      }
    }
    const item = response?.data?.[0]
    let imageReference: string
    if (typeof item?.b64_json === 'string' && item.b64_json) {
      imageReference = item.b64_json
    } else if (typeof item?.url === 'string' && item.url) {
      imageReference = item.url
    } else {
      throw new Error('图片接口没有返回 b64_json 或 url')
    }
    return this.saveImageReference(imageReference)
  }

  async saveImageReference(reference: string): Promise<{ filePath: string; fileName: string }> {
    const value = String(reference || '').trim()
    let image: Buffer
    const dataUrlMatch = /^data:image\/[a-zA-Z0-9.+-]+;base64,([a-zA-Z0-9+/=\r\n]+)$/i.exec(value)
    if (dataUrlMatch) {
      image = Buffer.from(dataUrlMatch[1], 'base64')
    } else if (/^https?:\/\//i.test(value)) {
      image = await this.downloadImage(new URL(value))
    } else if (/^[a-zA-Z0-9+/=\r\n]+$/.test(value) && value.length > 1000) {
      image = Buffer.from(value, 'base64')
    } else {
      throw new Error('模型返回的图片数据格式不受支持')
    }
    if (image.length === 0 || image.length > MAX_SOURCE_IMAGE_BYTES) throw new Error('生成图片为空或源文件超过 60 MB')
    if (image.length > MAX_IMAGE_BYTES) image = await this.compressForWechat(image)
    if (image.length > MAX_IMAGE_BYTES) throw new Error('生成图片压缩后仍超过 20 MB')
    const extension = extensionForImage(image)
    const directory = path.join(this.config.getCacheBasePath(), 'wechat-reply-generated')
    await fs.mkdir(directory, { recursive: true })
    const fileName = `generated-${Date.now()}-${randomUUID().slice(0, 8)}${extension}`
    const filePath = path.join(directory, fileName)
    await fs.writeFile(filePath, image, { flag: 'wx' })
    return { filePath, fileName }
  }

  private async compressForWechat(source: Buffer): Promise<Buffer> {
    for (const quality of [88, 76, 64, 52]) {
      const output = await sharp(source, { limitInputPixels: 100_000_000 })
        .rotate()
        .webp({ quality, effort: 4 })
        .toBuffer()
      if (output.length <= MAX_IMAGE_BYTES) return output
    }
    return source
  }

  private requestJson(url: URL, apiKey: string, payload: Record<string, unknown>): Promise<any> {
    const body = JSON.stringify(payload)
    return new Promise((resolve, reject) => {
      const requestFn = url.protocol === 'https:' ? https.request : http.request
      const req = requestFn({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${apiKey}`
        }
      }, response => {
        let data = ''
        response.setEncoding('utf8')
        response.on('data', chunk => {
          data += chunk
          if (data.length > MAX_API_RESPONSE_CHARS) req.destroy(new Error('图片接口响应超过安全上限'))
        })
        response.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            if ((response.statusCode || 500) >= 400) throw new Error(String(parsed?.error?.message || `HTTP ${response.statusCode}`))
            resolve(parsed)
          } catch (error) {
            reject(error)
          }
        })
      })
      req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('图片生成超时')))
      req.on('error', reject)
      req.end(body)
    })
  }

  private downloadImage(url: URL): Promise<Buffer> {
    if (!['http:', 'https:'].includes(url.protocol)) return Promise.reject(new Error('图片下载地址不安全'))
    return new Promise((resolve, reject) => {
      const requestFn = url.protocol === 'https:' ? https.get : http.get
      const req = requestFn(url, response => {
        if ((response.statusCode || 500) >= 400) {
          reject(new Error(`图片下载失败 (HTTP ${response.statusCode})`))
          response.resume()
          return
        }
        const chunks: Buffer[] = []
        let total = 0
        response.on('data', chunk => {
          const buffer = Buffer.from(chunk)
          total += buffer.length
          if (total > MAX_SOURCE_IMAGE_BYTES) req.destroy(new Error('生成图片源文件超过 60 MB'))
          else chunks.push(buffer)
        })
        response.on('end', () => resolve(Buffer.concat(chunks)))
      })
      req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('图片下载超时')))
      req.on('error', reject)
    })
  }
}

export const wechatReplyImageGenerationService = new WechatReplyImageGenerationService()
