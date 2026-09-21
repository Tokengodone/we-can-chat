export interface WechatKnowledgeDocument {
  title: string
  content: string
}

export interface WechatKnowledgeMatch extends WechatKnowledgeDocument {
  score: number
  excerpt: string
  urls: string[]
}

const STOP_WORDS = new Set(['的', '了', '吗', '呢', '是', '在', '和', '与', '或', '我', '你', '他', '她', '它', '这', '那', '一个', '怎么', '什么', '一下'])

const tokenize = (value: string): string[] => {
  const normalized = String(value || '').toLocaleLowerCase('zh-CN')
  const latin = normalized.match(/[a-z0-9][a-z0-9_-]{1,}/g) || []
  const chinese = (normalized.match(/[\u3400-\u9fff]+/g) || []).flatMap(chunk => {
    if (chunk.length <= 2) return [chunk]
    const grams: string[] = []
    for (let index = 0; index < chunk.length - 1; index += 1) grams.push(chunk.slice(index, index + 2))
    return grams
  })
  return [...new Set([...latin, ...chinese].filter(token => token.length > 1 && !STOP_WORDS.has(token)))]
}

export const searchWechatKnowledge = (
  documents: WechatKnowledgeDocument[],
  query: string,
  limit: number
): WechatKnowledgeMatch[] => {
  const terms = tokenize(query)
  if (terms.length === 0) return []
  return documents.map(document => {
    const title = document.title.toLocaleLowerCase('zh-CN')
    const content = document.content.toLocaleLowerCase('zh-CN')
    let score = 0
    let firstMatch = -1
    for (const term of terms) {
      if (title.includes(term)) score += 8
      let cursor = content.indexOf(term)
      let occurrences = 0
      if (cursor >= 0 && firstMatch < 0) firstMatch = cursor
      while (cursor >= 0 && occurrences < 5) {
        occurrences += 1
        cursor = content.indexOf(term, cursor + term.length)
      }
      score += occurrences
    }
    const start = Math.max(0, firstMatch < 0 ? 0 : firstMatch - 180)
    const excerpt = document.content.slice(start, start + 900).replace(/\s+/g, ' ').trim()
    const urls = [...new Set((document.content.match(/https?:\/\/[^\s<>"')]+/gi) || []))].slice(0, 5)
    return { ...document, score, excerpt, urls }
  }).filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh-CN'))
    .slice(0, Math.max(1, Math.min(10, Math.floor(limit) || 3)))
}
