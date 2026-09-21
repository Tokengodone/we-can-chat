export interface WechatMemberMemoryMessage {
  localType?: number
  createTime?: number
  parsedContent?: string
}

const compactText = (value: unknown): string => String(value || '')
  .replace(/\s+/g, ' ')
  .trim()

export const buildWechatMemberMemoryContext = (messages: WechatMemberMemoryMessage[]): string => {
  if (!Array.isArray(messages) || messages.length === 0) return ''

  const textMessages = messages
    .filter(message => Number(message.localType) === 1)
    .map(message => ({ ...message, text: compactText(message.parsedContent) }))
    .filter(message => message.text && !/^\[[^\]]+\]$/.test(message.text))

  if (textMessages.length < 3) return ''

  const lengths = textMessages.map(message => Array.from(message.text).length)
  const averageLength = Math.round(lengths.reduce((sum, length) => sum + length, 0) / lengths.length)
  const shortRatio = Math.round(lengths.filter(length => length <= 12).length / lengths.length * 100)
  const questionRatio = Math.round(textMessages.filter(message => /[?？]\s*$/.test(message.text)).length / textMessages.length * 100)

  const hourBuckets = [0, 0, 0, 0]
  for (const message of textMessages) {
    const timestamp = Number(message.createTime || 0)
    if (!timestamp) continue
    const hour = new Date(timestamp * 1000).getHours()
    hourBuckets[Math.floor(hour / 6)] += 1
  }
  const activeLabels = ['凌晨', '上午', '下午', '晚上']
  const activeIndex = hourBuckets.reduce((best, count, index) => count > hourBuckets[best] ? index : best, 0)

  const phraseCounts = new Map<string, number>()
  for (const message of textMessages) {
    const length = Array.from(message.text).length
    if (length > 1 && length <= 20) phraseCounts.set(message.text, (phraseCounts.get(message.text) || 0) + 1)
  }
  const commonPhrases = [...phraseCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([phrase, count]) => `${phrase}（${count} 次）`)

  const snippets: string[] = []
  const seen = new Set<string>()
  let snippetChars = 0
  for (const message of textMessages) {
    const snippet = Array.from(message.text).slice(0, 180).join('')
    if (!snippet || seen.has(snippet)) continue
    seen.add(snippet)
    if (snippetChars + snippet.length > 4_000) break
    snippets.push(snippet)
    snippetChars += snippet.length
    if (snippets.length >= 24) break
  }

  return [
    `样本：该成员最近 ${textMessages.length} 条公开文本发言。`,
    `表达习惯：平均约 ${averageLength} 字；短句占 ${shortRatio}%；问句占 ${questionRatio}%；样本中较常在${activeLabels[activeIndex]}发言。`,
    commonPhrases.length > 0 ? `常用短句：${commonPhrases.join('；')}` : '',
    '最近公开发言摘录（由新到旧，仅作为回复背景，不得逐条复述）：',
    ...snippets.map(text => `- ${text}`)
  ].filter(Boolean).join('\n')
}
