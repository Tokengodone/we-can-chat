import test from 'node:test'
import assert from 'node:assert/strict'
import { buildWechatMemberMemoryContext } from './wechatMemberMemory.ts'

test('builds a grounded member-memory context from public group messages', () => {
  const result = buildWechatMemberMemoryContext([
    { localType: 1, createTime: 1_700_000_000, parsedContent: '可以的' },
    { localType: 1, createTime: 1_700_000_100, parsedContent: '可以的' },
    { localType: 1, createTime: 1_700_000_200, parsedContent: '你明天有时间吗？' },
    { localType: 47, createTime: 1_700_000_300, parsedContent: '[动画表情]' }
  ])
  assert.match(result, /最近 3 条公开文本发言/)
  assert.match(result, /可以的（2 次）/)
  assert.match(result, /你明天有时间吗？/)
  assert.doesNotMatch(result, /动画表情/)
})

test('requires enough evidence before producing memory', () => {
  assert.equal(buildWechatMemberMemoryContext([
    { localType: 1, parsedContent: '第一条' },
    { localType: 1, parsedContent: '第二条' }
  ]), '')
})

test('caps repeated and oversized excerpts', () => {
  const longText = '很长的发言'.repeat(100)
  const result = buildWechatMemberMemoryContext(Array.from({ length: 30 }, (_, index) => ({
    localType: 1,
    parsedContent: index % 2 === 0 ? longText : `不同发言${index}`
  })))
  assert.ok(result.length < 5_500)
  assert.equal((result.match(/^- 很长的发言/gm) || []).length, 1)
})
