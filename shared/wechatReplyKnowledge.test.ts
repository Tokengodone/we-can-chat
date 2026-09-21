import test from 'node:test'
import assert from 'node:assert/strict'
import { searchWechatKnowledge } from './wechatReplyKnowledge.ts'

test('ranks matching note titles and keeps public links', () => {
  const matches = searchWechatKnowledge([
    { title: '微信支付接入', content: '个人主体接入说明 https://example.com/pay' },
    { title: '旅行清单', content: '雨伞和充电器' }
  ], '个人怎么接入微信支付？', 3)
  assert.equal(matches[0]?.title, '微信支付接入')
  assert.deepEqual(matches[0]?.urls, ['https://example.com/pay'])
})

test('returns no unrelated notes', () => {
  assert.deepEqual(searchWechatKnowledge([{ title: '旅行清单', content: '雨伞和充电器' }], '数据库备份', 3), [])
})
