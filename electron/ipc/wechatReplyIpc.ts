import { dialog, ipcMain } from 'electron'
import { wechatReplyService } from '../services/wechatReplyService'
import { wechatReplyAiService } from '../services/wechatReplyAiService'
import { wechatReplyAutoService } from '../services/wechatReplyAutoService'
import { messagePushService } from '../services/messagePushService'
import { wechatReplyMediaLibraryService } from '../services/wechatReplyMediaLibraryService'
import { wechatReplyKnowledgeService } from '../services/wechatReplyKnowledgeService'

export const registerWechatReplyIpc = (): void => {
  ipcMain.handle('wechatReply:getSettings', () => wechatReplyService.getSettings())
  ipcMain.handle('wechatReply:saveSettings', async (_event, settings: unknown) => {
    const result = wechatReplyService.saveSettings(settings)
    if (result.success) await messagePushService.handleConfigChanged('wechatReplySettings')
    return result
  })
  ipcMain.handle('wechatReply:getStatus', () => wechatReplyService.getStatus())
  ipcMain.handle('wechatReply:checkEnvironment', () => wechatReplyService.checkEnvironment())
  ipcMain.handle('wechatReply:sendTest', (_event, bindingId: unknown, content: unknown) =>
    wechatReplyService.sendTest(bindingId, content)
  )
  ipcMain.handle('wechatReply:sendMediaTest', (_event, bindingId: unknown, mediaKind: unknown) =>
    wechatReplyService.sendMediaTest(bindingId, mediaKind)
  )
  ipcMain.handle('wechatReply:listMediaLibrary', () => wechatReplyMediaLibraryService.list())
  ipcMain.handle('wechatReply:addMediaLibraryItem', (_event, input: unknown) => wechatReplyMediaLibraryService.addFromResource(input))
  ipcMain.handle('wechatReply:updateMediaLibraryItem', (_event, id: unknown, patch: unknown) => wechatReplyMediaLibraryService.update(id, patch))
  ipcMain.handle('wechatReply:removeMediaLibraryItem', (_event, id: unknown) => wechatReplyMediaLibraryService.remove(id))
  ipcMain.handle('wechatReply:sendLibraryAsset', (_event, bindingId: unknown, assetId: unknown) =>
    wechatReplyService.sendLibraryAsset(bindingId, assetId)
  )
  ipcMain.handle('wechatReply:getAiStatus', () => wechatReplyAiService.getStatus())
  ipcMain.handle('wechatReply:testAi', () => wechatReplyAiService.testConnection())
  ipcMain.handle('wechatReply:generateDraft', (_event, bindingId: unknown) => wechatReplyAiService.generateDraft(bindingId))
  ipcMain.handle('wechatReply:getAutomationStatus', () => wechatReplyAutoService.getStatus())
  ipcMain.handle('wechatReply:cancelPending', (_event, id: unknown) => wechatReplyAutoService.cancelPending(id))
  ipcMain.handle('wechatReply:selectKnowledgeBase', async () => {
    const result = await dialog.showOpenDialog({ title: '选择 Obsidian 知识库文件夹', properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return { success: false, code: 'CANCELLED', message: '已取消选择' }
    return { success: true, message: '已选择知识库', path: result.filePaths[0] }
  })
  ipcMain.handle('wechatReply:inspectKnowledgeBase', (_event, vaultPath: unknown) =>
    wechatReplyKnowledgeService.inspect(String(vaultPath || ''))
  )
}
