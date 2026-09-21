import test from 'node:test'
import assert from 'node:assert/strict'
import { hasVisibleWechatMention, isWechatGroupMessageMentioningSelf } from './wechatMention.ts'

test('accepts reliable atuserlist metadata', () => {
  assert.equal(isWechatGroupMessageMentioningSelf(true, '没有可见艾特', []), true)
})

test('recognizes the WeChat U+2005 mention separator', () => {
  assert.equal(hasVisibleWechatMention('@小亮\u2005 在吗？', ['小亮']), true)
})

test('recognizes a group nickname containing regex characters and spaces', () => {
  assert.equal(hasVisibleWechatMention('请问 @A.I 小亮？', ['A.I 小亮']), true)
})

test('does not trigger when another group member is mentioned', () => {
  assert.equal(hasVisibleWechatMention('@小明\u2005 在吗？', ['小亮']), false)
})

test('does not match a longer nickname that only shares a prefix', () => {
  assert.equal(hasVisibleWechatMention('@小亮同学\u2005 在吗？', ['小亮']), false)
})

test('does not treat an email address as a mention', () => {
  assert.equal(hasVisibleWechatMention('发到 test@example.com', ['example.com']), false)
})
