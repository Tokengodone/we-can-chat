import { BrowserWindow, nativeImage } from 'electron'
import sharp from 'sharp'
import type {
  GroupSummaryCustomSection,
  GroupSummaryCustomSectionItem,
  GroupSummaryDigest,
  GroupSummaryTopic
} from './groupSummaryRecordService'
import { avatarFileCache } from './avatarFileCacheService'

const PAGE_WIDTH = 1080
const PAGE_HEIGHT = 1920
const CAPTURE_TILE_HEIGHT = 640
const MAX_IMAGE_BYTES = 2 * 1024 * 1024

type ReportSide = 'front' | 'back'

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function htmlDataUrl(html: string): string {
  return `data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf8').toString('base64')}`
}

function clampText(value: unknown, maxLength: number): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`
}

function avatarInitial(name: string): string {
  return Array.from(String(name || '').trim())[0] || '?'
}

function renderAvatar(name: string, avatarDataUrls: Record<string, string>, className = ''): string {
  const src = avatarDataUrls[name]
  const classes = ['avatar', className].filter(Boolean).join(' ')
  return src
    ? `<span class="${classes}"><img src="${src}" alt=""></span>`
    : `<span class="${classes} avatar-fallback">${escapeHtml(avatarInitial(name))}</span>`
}

function sectionMatches(section: GroupSummaryCustomSection, patterns: RegExp[]): boolean {
  const title = String(section.title || '')
  return patterns.some((pattern) => pattern.test(title))
}

function pickSections(sections: GroupSummaryCustomSection[] | undefined, patterns: RegExp[], limit = 2): GroupSummaryCustomSection[] {
  return (sections || []).filter((section) => sectionMatches(section, patterns)).slice(0, limit)
}

function flattenItems(sections: GroupSummaryCustomSection[], limit: number): Array<string | GroupSummaryCustomSectionItem> {
  return sections.flatMap((section) => section.items || []).slice(0, limit)
}

function itemTitle(item: string | GroupSummaryCustomSectionItem): string {
  return typeof item === 'string' ? item : item.title
}

function itemFields(item: string | GroupSummaryCustomSectionItem): Array<{ label: string; value: string }> {
  return typeof item === 'string' ? [] : item.fields
}

function fieldValue(item: string | GroupSummaryCustomSectionItem, patterns: RegExp[]): string {
  return itemFields(item).find((field) => patterns.some((pattern) => pattern.test(field.label)))?.value || ''
}

function firstQuote(topics: GroupSummaryTopic[]): { speaker: string; text: string } | undefined {
  return topics.flatMap((topic) => topic.quotes || []).find((quote) => quote.speaker && quote.text)
}

function renderQuote(quote: { speaker: string; text: string } | undefined, avatarDataUrls: Record<string, string>): string {
  if (!quote) return ''
  return `<blockquote class="quote-card">
    ${renderAvatar(quote.speaker, avatarDataUrls)}
    <p>“${escapeHtml(clampText(quote.text, 92))}”</p>
    <cite>${escapeHtml(quote.speaker)}</cite>
  </blockquote>`
}

function renderTopicRows(topics: GroupSummaryTopic[], limit: number): string {
  return topics.slice(0, limit).map((topic, index) => {
    const signal = topic.timeRange || topic.conclusion || topic.keyPoints[0] || ''
    return `<article class="topic-row">
      <b>${String(index + 1).padStart(2, '0')}</b>
      <div>
        <h3>${escapeHtml(clampText(topic.title, 28))}</h3>
        <p>${escapeHtml(clampText(signal, 58))}</p>
      </div>
    </article>`
  }).join('')
}

function renderNeedItems(items: Array<string | GroupSummaryCustomSectionItem>, avatarDataUrls: Record<string, string>): string {
  return items.slice(0, 4).map((item) => {
    const speaker = fieldValue(item, [/提出|发言|来源|speaker|source/i])
    const quote = fieldValue(item, [/原话|引用|quote/i])
    const level = fieldValue(item, [/等级|强度|潜力|level/i])
    return `<article class="need-item">
      <div class="need-top">
        <strong>${escapeHtml(clampText(itemTitle(item), 34))}</strong>
        ${level ? `<span>${escapeHtml(clampText(level, 8))}</span>` : ''}
      </div>
      ${quote ? `<p>“${escapeHtml(clampText(quote, 66))}”</p>` : ''}
      ${speaker ? `<div class="need-speaker">${renderAvatar(speaker, avatarDataUrls, 'avatar-small')}<em>${escapeHtml(clampText(speaker, 12))}</em></div>` : ''}
    </article>`
  }).join('')
}

function renderSectionList(title: string, items: Array<string | GroupSummaryCustomSectionItem>, limit: number): string {
  if (items.length === 0) return ''
  return `<section class="paper-section">
    <h2>${escapeHtml(title)}</h2>
    <div class="section-list">${items.slice(0, limit).map((item) => {
      const fields = itemFields(item).slice(0, 2)
      return `<article>
        <h3>${escapeHtml(clampText(itemTitle(item), 36))}</h3>
        ${fields.length > 0 ? `<p>${fields.map((field) => `${escapeHtml(field.label)}：${escapeHtml(clampText(field.value, 42))}`).join(' · ')}</p>` : ''}
      </article>`
    }).join('')}</div>
  </section>`
}

function renderContributors(digest: GroupSummaryDigest, avatarDataUrls: Record<string, string>): string {
  const highlights = digest.memberHighlights.slice(0, 3)
  if (highlights.length > 0) {
    return highlights.map((member) => `<article class="contributor">
      ${renderAvatar(member.name, avatarDataUrls)}
      <div><strong>${escapeHtml(member.name)}</strong><span>${escapeHtml(member.role || '贡献者')}</span><p>${escapeHtml(clampText(member.observations[0] || '', 46))}</p></div>
    </article>`).join('')
  }
  return digest.leaderboard.slice(0, 3).map((member) => `<article class="contributor">
    ${renderAvatar(member.name, avatarDataUrls)}
    <div><strong>${escapeHtml(member.name)}</strong><span>活跃贡献</span><p>${member.count} 条消息，推动了本期讨论密度。</p></div>
  </article>`).join('')
}

function renderStats(params: { messageCount: number; digest: GroupSummaryDigest }): string {
  const keywordSection = pickSections(params.digest.customSections, [/关键词|关键字|keyword/i], 1)[0]
  const keywords = keywordSection
    ? flattenItems([keywordSection], 6).map(itemTitle).slice(0, 6)
    : params.digest.leaderboard.slice(0, 4).map((item) => item.name)
  return `<section class="stats">
    <div><b>${params.messageCount}</b><span>消息数</span></div>
    <div><b>${params.digest.leaderboard.length}</b><span>参与者</span></div>
    <div><b>${params.digest.customSections?.length || 0}</b><span>情报栏目</span></div>
    <p>${keywords.map((keyword) => `<em>${escapeHtml(clampText(keyword, 10))}</em>`).join('')}</p>
  </section>`
}

function renderFront(params: RenderDocumentParams): string {
  const headline = params.topics[0]
  const quote = firstQuote(params.topics)
  const businessItems = flattenItems(pickSections(params.digest.customSections, [/商机|需求|雷达|opportunity|need/i], 2), 4)
  const observation = headline?.conclusion || params.digest.overview
  return `${renderHeader(params, 'FRONT PAGE')}
    <section class="headline">
      <div class="headline-label">今日头条</div>
      <h1>${escapeHtml(clampText(headline?.title || params.title || '蛋仔日报', 34))}</h1>
      <p>${escapeHtml(clampText(params.digest.overview || headline?.keyPoints[0] || headline?.conclusion || '', 150))}</p>
      ${renderQuote(quote, params.avatarDataUrls)}
    </section>
    <section class="front-grid">
      <div class="main-column">
        <section class="paper-section hot-topics">
          <h2>今日热点 TOP5</h2>
          ${renderTopicRows(params.topics, 5)}
        </section>
        <section class="paper-section observation">
          <h2>今日观察</h2>
          <p>${escapeHtml(clampText(observation, 92))}</p>
        </section>
      </div>
      <aside class="side-column">
        <section class="paper-section business">
          <h2>商机雷达</h2>
          ${businessItems.length > 0 ? renderNeedItems(businessItems, params.avatarDataUrls) : '<p class="empty">本期暂无明确商机信号。</p>'}
        </section>
        ${renderStats(params)}
      </aside>
    </section>`
}

function renderBack(params: RenderDocumentParams): string {
  const infoItems = flattenItems(pickSections(params.digest.customSections, [/信息差|线索|验证|gap/i], 2), 4)
  const trendItems = flattenItems(pickSections(params.digest.customSections, [/趋势|动向|trend/i], 2), 4)
  const funItems = flattenItems(pickSections(params.digest.customSections, [/趣闻|有趣|收藏|内容|fun|notable/i], 2), 3)
  const watchItems = [
    ...params.digest.unresolvedIssues.map((item) => ({ title: item.problem, fields: [{ label: item.status, value: item.solution }] })),
    ...params.digest.actionItems.map((item) => ({ title: item.task, fields: [{ label: '负责人', value: item.owner || '待定' }] }))
  ]
  return `${renderHeader(params, 'DEEP BRIEF')}
    <section class="back-grid">
      <div class="main-column">
        ${renderSectionList('信息差地图', infoItems, 4)}
        ${renderSectionList('趋势观察', trendItems, 4)}
        ${renderSectionList('未解决问题 / 明日关注', watchItems, 5)}
      </div>
      <aside class="side-column">
        <section class="paper-section fun">
          <h2>蛋仔趣闻</h2>
          ${funItems.length > 0 ? funItems.map((item) => {
            const speaker = fieldValue(item, [/发言|来源|speaker/i])
            const quote = fieldValue(item, [/原话|quote/i]) || itemTitle(item)
            return `<article class="fun-card">${speaker ? renderAvatar(speaker, params.avatarDataUrls) : ''}<p>“${escapeHtml(clampText(quote, 78))}”</p>${speaker ? `<span>${escapeHtml(speaker)}</span>` : ''}</article>`
          }).join('') : '<p class="empty">本期趣闻信号不明显。</p>'}
        </section>
        <section class="paper-section contributors">
          <h2>今日贡献者</h2>
          ${renderContributors(params.digest, params.avatarDataUrls)}
        </section>
      </aside>
    </section>
    <footer class="back-note">${escapeHtml(clampText(params.topics[0]?.conclusion || params.digest.overview || '值得继续关注的是，群聊信号正在沉淀成可复用的行动线索。', 96))}</footer>`
}

interface RenderDocumentParams {
  title: string
  period: string
  messageCount: number
  topics: GroupSummaryTopic[]
  digest: GroupSummaryDigest
  badge?: string
  badgeColor?: 'info' | 'comment' | 'warning'
  avatarDataUrls: Record<string, string>
  side: ReportSide
}

function renderHeader(params: RenderDocumentParams, sideLabel: string): string {
  const dateText = params.period.split(' 至 ')[0] || params.period
  const dayNo = params.badge || `DAY${new Date().getDate().toString().padStart(3, '0')}`
  return `<header>
    <div>
      <span class="kicker">${escapeHtml(sideLabel)} · 群聊有价值，情报看得懂</span>
      <h1>${escapeHtml(params.title || '蛋仔日报')}</h1>
    </div>
    <div class="dateline"><b>${escapeHtml(dayNo)}</b><span>${escapeHtml(dateText)}</span></div>
  </header>`
}

function renderDocument(params: RenderDocumentParams): string {
  const content = params.side === 'front' ? renderFront(params) : renderBack(params)
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;width:${PAGE_WIDTH}px;min-height:${PAGE_HEIGHT}px;overflow:hidden;background:#211c18;color:#201b17;font-family:"Noto Serif SC","Source Han Serif SC","Songti SC","SimSun",serif;font-size:25px}
    ::-webkit-scrollbar{display:none}
    .canvas{width:${PAGE_WIDTH}px;height:${PAGE_HEIGHT}px;padding:24px;background:#231d18}
    .report{position:relative;height:100%;overflow:hidden;background:#f2ead8;border:3px solid #211a15;padding:42px 46px 34px}
    .report::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.28;background:radial-gradient(circle at 22% 18%,rgba(91,61,34,.18),transparent 24%),radial-gradient(circle at 78% 66%,rgba(113,23,18,.12),transparent 20%),linear-gradient(90deg,rgba(32,27,23,.05) 1px,transparent 1px),linear-gradient(rgba(32,27,23,.04) 1px,transparent 1px);background-size:auto,auto,36px 36px,36px 36px}
    .report-scale{position:relative;z-index:1;transform-origin:top left}
    header{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:22px;align-items:end;border-bottom:8px solid #201b17;padding-bottom:22px;margin-bottom:22px}
    .kicker{display:block;margin-bottom:10px;color:#8f2f23;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;font-size:22px;font-weight:800}
    header h1{margin:0;color:#17120f;font-size:78px;line-height:1;font-weight:950;letter-spacing:0}
    .dateline{justify-self:end;text-align:right;border:2px solid #211a15;padding:12px 14px;min-width:196px;background:#efe2c9}
    .dateline b{display:block;color:#8f2f23;font-family:"Arial Black","Microsoft YaHei",sans-serif;font-size:34px;line-height:1}.dateline span{display:block;margin-top:6px;font-size:18px;line-height:1.35}
    .headline{border-bottom:3px solid #211a15;padding-bottom:22px;margin-bottom:22px}.headline-label,.paper-section>h2{display:inline-flex;background:#8f2f23;color:#fff;padding:6px 12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;font-size:22px;font-weight:850;line-height:1.2}
    .headline h1{margin:16px 0 12px;color:#16120f;font-size:62px;line-height:1.12;font-weight:950;letter-spacing:0;text-wrap:balance}
    .headline>p{margin:0;color:#2b251f;font-size:29px;line-height:1.58;font-weight:650}
    .quote-card{display:grid;grid-template-columns:54px minmax(0,1fr);gap:8px 14px;margin:18px 0 0;padding:14px 16px;background:#e6d8bf;border:2px solid #211a15}
    .quote-card p{margin:0;color:#2b251f;font-size:23px;line-height:1.45;font-style:italic}.quote-card cite{grid-column:2;display:block;color:#7a2b20;font-size:19px;font-style:normal;font-weight:800}
    .front-grid,.back-grid{display:grid;grid-template-columns:minmax(0,1.05fr) 350px;gap:22px}.main-column,.side-column{display:grid;align-content:start;gap:18px}
    .paper-section{border-top:3px solid #211a15;padding-top:14px}.paper-section>h2{margin:0 0 12px}.paper-section h3{margin:0;color:#1c1713;font-size:25px;line-height:1.28;font-weight:850}
    .paper-section p{margin:6px 0 0;color:#3a3129;font-size:20px;line-height:1.48}
    .topic-row{display:grid;grid-template-columns:54px minmax(0,1fr);gap:12px;padding:12px 0;border-bottom:1px solid rgba(32,27,23,.35)}.topic-row b{display:grid;place-items:center;width:48px;height:48px;background:#211a15;color:#f2ead8;font-family:Arial,sans-serif;font-size:23px}.topic-row:last-child{border-bottom:0}
    .business{background:#ead9ba;border:2px solid #211a15;padding:14px}.need-item{padding:11px 0;border-bottom:1px solid rgba(32,27,23,.35)}.need-item:last-child{border-bottom:0}.need-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.need-top strong{font-size:22px;line-height:1.3}.need-top span{flex:none;background:#211a15;color:#f2ead8;padding:3px 8px;font-family:Arial,sans-serif;font-size:15px;font-weight:800}.need-speaker{display:flex;align-items:center;gap:8px;margin-top:8px}.need-speaker em{color:#7a2b20;font-size:17px;font-style:normal;font-weight:800}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;border:2px solid #211a15;background:#211a15;color:#f2ead8;padding:12px}.stats div{border-right:1px solid rgba(242,234,216,.35);padding-right:8px}.stats div:last-of-type{border-right:0}.stats b{display:block;font-family:Arial,sans-serif;font-size:34px;line-height:1}.stats span{display:block;margin-top:5px;font-size:15px}.stats p{grid-column:1/-1;margin:8px 0 0;display:flex;flex-wrap:wrap;gap:6px}.stats em{border:1px solid rgba(242,234,216,.5);padding:4px 7px;font-size:15px;font-style:normal}
    .observation{background:#8f2f23;color:#fff;padding:14px;border:0}.observation h2{background:#f2ead8;color:#8f2f23}.observation p{color:#fff;font-size:24px;font-weight:800}
    .section-list article{padding:12px 0;border-bottom:1px solid rgba(32,27,23,.35)}.section-list article:last-child{border-bottom:0}
    .fun-card{padding:14px;border:2px solid #211a15;background:#e8d7b9;margin-bottom:12px}.fun-card p{font-size:22px;font-style:italic}.fun-card span{display:block;margin-top:8px;color:#7a2b20;font-size:18px;font-weight:800}
    .contributor{display:grid;grid-template-columns:58px minmax(0,1fr);gap:12px;padding:11px 0;border-bottom:1px solid rgba(32,27,23,.35)}.contributor:last-child{border-bottom:0}.contributor strong{display:block;font-size:23px}.contributor span{display:block;color:#8f2f23;font-size:17px;font-weight:800}.contributor p{font-size:18px}
    .avatar{width:54px;height:54px;border-radius:50%;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;flex:none;background:#211a15;color:#f2ead8;border:2px solid #211a15;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;font-size:20px;font-weight:850}.avatar img{width:100%;height:100%;object-fit:cover}.avatar-small{width:30px;height:30px;font-size:13px;border-width:1px}
    .empty{color:#67594d!important;font-size:20px!important}.back-note{position:absolute;left:46px;right:46px;bottom:34px;border-top:3px solid #211a15;padding-top:12px;color:#211a15;font-size:22px;line-height:1.42;font-weight:850}
  </style></head><body><div class="canvas"><main class="report ${params.side}"><div class="report-scale">${content}</div></main></div></body></html>`
}

async function captureHtml(html: string): Promise<Buffer> {
  const win = new BrowserWindow({
    width: PAGE_WIDTH,
    height: CAPTURE_TILE_HEIGHT,
    useContentSize: true,
    show: false,
    frame: false,
    webPreferences: { offscreen: true, sandbox: true }
  })
  try {
    await win.loadURL(htmlDataUrl(html))
    await win.webContents.executeJavaScript(`
      (() => {
        const report = document.querySelector('.report')
        const content = document.querySelector('.report-scale')
        if (!report || !content) return 1
        const style = getComputedStyle(report)
        const available = report.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
        let scale = 1
        for (let index = 0; index < 5; index += 1) {
          content.style.width = (100 / scale) + '%'
          content.style.transform = 'none'
          const next = Math.min(1, available / content.scrollHeight)
          if (Math.abs(next - scale) < 0.002) { scale = next; break }
          scale = next
        }
        content.style.width = (100 / scale) + '%'
        content.style.transform = 'scale(' + scale + ')'
        return scale
      })()
    `)
    await new Promise((resolve) => setTimeout(resolve, 80))
    const tiles: Array<{ input: Buffer; top: number; left: number }> = []
    for (let top = 0; top < PAGE_HEIGHT; top += CAPTURE_TILE_HEIGHT) {
      await win.webContents.executeJavaScript(`window.scrollTo(0, ${top})`)
      await new Promise((resolve) => setTimeout(resolve, 40))
      const image = await win.webContents.capturePage({
        x: 0,
        y: 0,
        width: PAGE_WIDTH,
        height: CAPTURE_TILE_HEIGHT
      })
      const sourceSize = image.getSize()
      const sourceRatio = sourceSize.width / Math.max(1, sourceSize.height)
      const tileRatio = PAGE_WIDTH / CAPTURE_TILE_HEIGHT
      if (Math.abs(sourceRatio - tileRatio) > 0.002) {
        throw new Error(`报告分段截图比例异常：${sourceSize.width}×${sourceSize.height}`)
      }
      const tile = await sharp(image.toPNG())
        .resize(PAGE_WIDTH, CAPTURE_TILE_HEIGHT, { fit: 'fill' })
        .png()
        .toBuffer()
      tiles.push({ input: tile, left: 0, top })
    }

    const pngBuffer = await sharp({
      create: {
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT,
        channels: 4,
        background: '#231d18'
      }
    }).composite(tiles).png().toBuffer()
    if (pngBuffer.length <= MAX_IMAGE_BYTES) return pngBuffer
    for (const quality of [95, 92, 88, 82, 75]) {
      const buffer = await sharp(pngBuffer).jpeg({ quality, chromaSubsampling: '4:4:4' }).toBuffer()
      if (buffer.length <= MAX_IMAGE_BYTES) return buffer
    }
    throw new Error('报告图片超过企业微信 2MB 限制，请缩短总结时段')
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

export async function renderGroupSummaryImages(params: {
  title: string
  period: string
  messageCount: number
  topics: GroupSummaryTopic[]
  digest: GroupSummaryDigest
  badge?: string
  badgeColor?: 'info' | 'comment' | 'warning'
  avatarUrls?: Record<string, string>
}): Promise<Buffer[]> {
  const avatarDataUrls: Record<string, string> = {}
  await Promise.all(Object.entries(params.avatarUrls || {}).map(async ([name, url]) => {
    try {
      const localPath = await avatarFileCache.getAvatarPath(url)
      if (!localPath) return
      const image = nativeImage.createFromPath(localPath)
      if (image.isEmpty()) return
      avatarDataUrls[name] = `data:image/png;base64,${image.resize({ width: 72, height: 72, quality: 'good' }).toPNG().toString('base64')}`
    } catch {
      // Keep the initial-based fallback when an avatar cannot be loaded.
    }
  }))

  const baseParams = {
    ...params,
    title: params.title || '蛋仔日报',
    avatarDataUrls
  }
  return [
    await captureHtml(renderDocument({ ...baseParams, side: 'front' })),
    await captureHtml(renderDocument({ ...baseParams, side: 'back' }))
  ]
}
