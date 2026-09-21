import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const appRoot = resolve(__dirname, '..')
const documents = join(homedir(), 'Documents')

export const app = {
  isPackaged: false,
  getPath(name: string): string {
    if (name === 'documents') return documents
    if (name === 'temp') return tmpdir()
    if (name === 'userData') return process.env.WEFLOW_USER_DATA_PATH || join(homedir(), '.weflow-portable-core')
    return homedir()
  },
  getAppPath: () => appRoot,
  getName: () => 'WeFlow Portable Core',
  getVersion: () => '0.1.0',
  on: () => app,
  once: () => app,
  off: () => app
}

export const BrowserWindow = { getAllWindows: () => [], getFocusedWindow: () => null }
export const dialog = { showMessageBox: async () => ({ response: 0 }) }
export const shell = { openExternal: async () => false, showItemInFolder: () => undefined }
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (value: string) => Buffer.from(value, 'utf8'),
  decryptString: (value: Buffer) => value.toString('utf8')
}
export const ipcMain = { on: () => undefined, handle: () => undefined, removeHandler: () => undefined }
export default { app, BrowserWindow, dialog, shell, safeStorage, ipcMain }
