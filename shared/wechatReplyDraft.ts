export interface WechatReplyDraftParseResult {
  success: boolean
  draft?: string
  imagePrompt?: string
  message?: string
}

const FINAL_REPLY_PATTERN = /<final_reply>([\s\S]*?)<\/final_reply>/gi
const IMAGE_PROMPT_PATTERN = /<image_prompt>([\s\S]*?)<\/image_prompt>/gi
const EXPLANATION_PATTERN = /^\s*(?:直接发|建议回复|推荐回复|候选回复|最终回复|为什么这样回|回复理由|理由|分析|思考过程|备注)\s*[：:]/im
const REASONING_TAG_PATTERN = /<\/?(?:think|thinking|analysis|reasoning)\b[^>]*>/i

/**
 * Fail closed: automated replies must use the explicit final_reply envelope and
 * must not contain common answer-analysis sections. This is intentionally
 * stricter than a display-only cleanup because the result may be sent without
 * a human reviewing it first.
 */
export const parseWechatReplyDraft = (value: unknown, maxChars: number): WechatReplyDraftParseResult => {
  const raw = String(value || '').trim()
  if (!raw) return { success: false, message: '模型没有生成可用草稿' }

  const matches = [...raw.matchAll(FINAL_REPLY_PATTERN)]
  if (matches.length !== 1) {
    return {
      success: false,
      message: matches.length > 1
        ? '模型返回了多个候选回复，已拦截自动发送'
        : '模型未按最终回复格式返回，已拦截自动发送以避免误发分析内容'
    }
  }

  const imageMatches = [...raw.matchAll(IMAGE_PROMPT_PATTERN)]
  if (imageMatches.length > 1) {
    return { success: false, message: '模型返回了多个图片生成指令，已拦截自动发送' }
  }
  const outsideEnvelope = raw.replace(FINAL_REPLY_PATTERN, '').replace(IMAGE_PROMPT_PATTERN, '').trim()
  if (outsideEnvelope && !/^```(?:text|xml|markdown)?\s*```$/i.test(outsideEnvelope)) {
    return { success: false, message: '模型在最终回复之外附带了解释内容，已拦截自动发送' }
  }

  const draft = String(matches[0][1] || '')
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  if (!draft) return { success: false, message: '模型返回的最终回复为空' }
  if (EXPLANATION_PATTERN.test(draft) || REASONING_TAG_PATTERN.test(draft) || /<\/?final_reply>/i.test(draft)) {
    return { success: false, message: '模型回复中包含分析或候选格式，已拦截自动发送' }
  }

  const safeMaxChars = Number.isFinite(maxChars) ? Math.max(1, Math.floor(maxChars)) : 300
  const imagePrompt = String(imageMatches[0]?.[1] || '').trim().slice(0, 2000)
  return { success: true, draft: draft.slice(0, safeMaxChars), ...(imagePrompt ? { imagePrompt } : {}) }
}
