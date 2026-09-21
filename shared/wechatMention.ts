const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const normalizeMentionName = (value: unknown): string => String(value || '')
  .trim()
  .replace(/^@+/, '')
  .trim()

/**
 * Detects a real visible WeChat @mention. Recent WeChat database cursors do not
 * always expose source.atuserlist, so group auto-reply needs this conservative
 * text fallback based on the current account's nickname in that group.
 */
export const hasVisibleWechatMention = (content: unknown, names: unknown[]): boolean => {
  const text = String(content || '')
  if (!text || !Array.isArray(names) || names.length === 0) return false

  const uniqueNames = Array.from(new Set(names.map(normalizeMentionName).filter(Boolean)))
    .sort((left, right) => right.length - left.length)

  return uniqueNames.some((name) => {
    const escapedName = escapeRegExp(name).replace(/\s+/g, '[\\s\\u2000-\\u200b\\u202f\\u205f\\u3000]*')
    // WeChat normally terminates mentions with a four-per-em space (U+2005).
    // Accept common spaces and punctuation, but not a longer nickname prefix.
    const pattern = new RegExp(`(^|[^A-Za-z0-9._%+\\-])@${escapedName}(?=$|[\\s\\u2000-\\u200b\\u202f\\u205f\\u3000，,。.!！?？:：;；、])`, 'iu')
    return pattern.test(text)
  })
}

export const isWechatGroupMessageMentioningSelf = (
  metadataMentioned: unknown,
  content: unknown,
  selfNames: unknown[]
): boolean => metadataMentioned === true || hasVisibleWechatMention(content, selfNames)
