import test from 'node:test'
import assert from 'node:assert/strict'
import { selectWechatReplyMedia } from './wechatReplyMedia.ts'
import type { WechatReplyMediaAsset } from './wechatReply.ts'

const asset = (patch: Partial<WechatReplyMediaAsset> = {}): WechatReplyMediaAsset => ({
  id: 'asset-1',
  name: '微信二维码',
  kind: 'image',
  tags: ['二维码', '联系方式'],
  scope: 'all',
  autoSend: true,
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
  filePath: 'C:\\reply-media\\asset.png',
  source: { sourceKey: 's|1', sessionId: 's', localId: 1, createTime: 1, imageMd5: 'a'.repeat(32) },
  ...patch
})

test('requires an explicit request before selecting a normal image', () => {
  assert.equal(selectWechatReplyMedia([asset()], '你的二维码挺好看的', false), undefined)
  assert.equal(selectWechatReplyMedia([asset()], '把二维码发我一下', false)?.id, 'asset-1')
})

test('respects conversation scope and auto-send permission', () => {
  assert.equal(selectWechatReplyMedia([asset({ scope: 'private' })], '把二维码发一下', true), undefined)
  assert.equal(selectWechatReplyMedia([asset({ autoSend: false })], '把二维码发一下', false), undefined)
})

test('allows a tagged emoji reaction but never an unavailable file', () => {
  const emoji = asset({ kind: 'emoji', name: '开心', tags: ['哈哈'], filePath: 'emoji.gif' })
  assert.equal(selectWechatReplyMedia([emoji], '哈哈，确实', false)?.id, 'asset-1')
  assert.equal(selectWechatReplyMedia([emoji], '哈哈，确实', false, () => false), undefined)
})

test('prefers the candidate with more matching tags', () => {
  const generic = asset({ id: 'generic', name: '联系图', tags: ['联系'], updatedAt: 10 })
  const exact = asset({ id: 'exact', name: '微信二维码', tags: ['联系', '二维码'], updatedAt: 1 })
  assert.equal(selectWechatReplyMedia([generic, exact], '把联系二维码发我', false)?.id, 'exact')
})
