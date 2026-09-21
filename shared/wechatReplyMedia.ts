import type { WechatReplyMediaAsset } from './wechatReply'

const EXPLICIT_IMAGE_REQUEST = /(?:发(?:我|来|一下|一份)?|给我|给一下|看看|看下|瞅瞅|来一张|来个|有没有.{0,8}(?:图|二维码|海报|菜单|报价)|能否.{0,8}(?:发|给|看)|可以.{0,8}(?:发|给|看)|求.{0,8}(?:图|二维码|海报|菜单|报价))/i

const normalizeTerms = (values: string[]): string[] => (
  [...new Set(values.map(value => String(value || '').trim().toLocaleLowerCase('zh-CN')).filter(Boolean))]
)

export const selectWechatReplyMedia = (
  assets: WechatReplyMediaAsset[],
  content: string,
  isGroup: boolean,
  fileAvailable: (filePath: string) => boolean = () => true
): WechatReplyMediaAsset | undefined => {
  const text = String(content || '').trim().toLocaleLowerCase('zh-CN')
  if (!text) return undefined
  const scope = isGroup ? 'group' : 'private'
  return assets
    .filter(item => item.enabled && item.autoSend && fileAvailable(item.filePath))
    .filter(item => item.scope === 'all' || item.scope === scope)
    .map(item => {
      const matches = normalizeTerms([item.name, ...item.tags]).filter(term => text.includes(term))
      const explicit = item.kind === 'emoji' || EXPLICIT_IMAGE_REQUEST.test(text)
      return { item, score: explicit ? matches.length : 0 }
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)[0]?.item
}
