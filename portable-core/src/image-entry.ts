import { resolve } from 'node:path'

const resourcesRoot = process.env.WEFLOW_CORE_RESOURCES_PATH || resolve(__dirname, '..', 'resources')
try {
  Object.defineProperty(process, 'resourcesPath', { value: resolve(resourcesRoot, '..'), configurable: true })
} catch {
  ;(process as any).resourcesPath = resolve(resourcesRoot, '..')
}
require('../../electron/imageDecryptWorker')
