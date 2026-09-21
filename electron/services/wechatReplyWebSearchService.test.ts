import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWechatReplyWebSearchRss } from './wechatReplyWebSearchService.ts'

test('parses, cleans, deduplicates and limits Bing RSS results', () => {
  const xml = `<?xml version="1.0"?>
    <rss><channel>
      <item><title><![CDATA[第一条 &amp; 更新]]></title><link>https://example.com/a</link><description><![CDATA[<b>摘要</b> 内容]]></description><pubDate>Sun, 20 Sep 2026 08:00:00 GMT</pubDate></item>
      <item><title>重复地址</title><link>https://example.com/a</link><description>忽略</description></item>
      <item><title>第二条</title><link>https://example.com/b</link><description>另一个摘要</description></item>
      <item><title>无效链接</title><link>javascript:alert(1)</link><description>忽略</description></item>
    </channel></rss>`

  const results = parseWechatReplyWebSearchRss(xml, 2)
  assert.deepEqual(results, [
    {
      title: '第一条 & 更新',
      url: 'https://example.com/a',
      snippet: '摘要 内容',
      publishedAt: 'Sun, 20 Sep 2026 08:00:00 GMT'
    },
    {
      title: '第二条',
      url: 'https://example.com/b',
      snippet: '另一个摘要'
    }
  ])
})
