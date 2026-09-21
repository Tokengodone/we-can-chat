import test from 'node:test'
import assert from 'node:assert/strict'
import { parseWechatReplyDraft } from './wechatReplyDraft.ts'

test('extracts only the final reply envelope', () => {
  assert.deepEqual(parseWechatReplyDraft('<final_reply>你先猜～你是mm还是gg呀？</final_reply>', 300), {
    success: true,
    draft: '你先猜～你是mm还是gg呀？'
  })
})

test('rejects analysis outside the final reply envelope', () => {
  const result = parseWechatReplyDraft(
    '<final_reply>你先猜～</final_reply>\n为什么这样回：这样能接住话题。',
    300
  )
  assert.equal(result.success, false)
  assert.match(result.message || '', /解释内容/)
})

test('rejects the leaked format shown in the reported conversation', () => {
  const result = parseWechatReplyDraft(
    '直接发：\n「哈哈先不公布答案」\n\n为什么这样回：这样轻松接住话题。\n\n备注：想直接说也可以。',
    300
  )
  assert.equal(result.success, false)
  assert.match(result.message || '', /未按最终回复格式/)
})

test('rejects explanation labels even when placed inside the envelope', () => {
  const result = parseWechatReplyDraft(
    '<final_reply>直接发：你好\n备注：保持简短</final_reply>',
    300
  )
  assert.equal(result.success, false)
  assert.match(result.message || '', /包含分析或候选格式/)
})

test('rejects multiple candidate envelopes', () => {
  const result = parseWechatReplyDraft(
    '<final_reply>候选一</final_reply><final_reply>候选二</final_reply>',
    300
  )
  assert.equal(result.success, false)
  assert.match(result.message || '', /多个候选回复/)
})

test('limits the extracted reply length', () => {
  assert.deepEqual(parseWechatReplyDraft('<final_reply>123456</final_reply>', 4), {
    success: true,
    draft: '1234'
  })
})

test('accepts one explicit image generation request after the reply', () => {
  assert.deepEqual(parseWechatReplyDraft(
    '<final_reply>好，我画一张。</final_reply>\n<image_prompt>一只戴墨镜的橘猫，扁平插画</image_prompt>',
    300
  ), {
    success: true,
    draft: '好，我画一张。',
    imagePrompt: '一只戴墨镜的橘猫，扁平插画'
  })
})
