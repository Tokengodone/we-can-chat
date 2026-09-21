import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const upstream = resolve(here, '..')
const dist = join(here, 'dist')
const shim = join(here, 'src', 'electron-shim.ts')

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

const electronShim = {
  name: 'electron-shim',
  setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: shim }))
  }
}

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  plugins: [electronShim],
  external: ['koffi', 'silk-wasm', 'sherpa-onnx-node', 'ffmpeg-static', 'wechat-emojis']
}

await build({ ...common, entryPoints: [join(here, 'src', 'index.ts')], outfile: join(dist, 'index.js') })
await build({ ...common, entryPoints: [join(here, 'src', 'cli.ts')], outfile: join(dist, 'cli.js') })
await build({ ...common, entryPoints: [join(upstream, 'electron', 'wcdbWorker.ts')], outfile: join(dist, 'wcdbWorker.js') })
await build({ ...common, entryPoints: [join(here, 'src', 'export-entry.ts')], outfile: join(dist, 'exportWorker.js') })
await build({ ...common, entryPoints: [join(upstream, 'electron', 'transcribeWorker.ts')], outfile: join(dist, 'transcribeWorker.js') })
await build({ ...common, entryPoints: [join(here, 'src', 'image-entry.ts')], outfile: join(dist, 'imageDecryptWorker.js') })

execFileSync(process.execPath, [join(upstream, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(here, 'tsconfig.json')], { stdio: 'inherit' })

for (const name of ['wcdb', 'wedecrypt', 'runtime']) {
  cpSync(join(upstream, 'resources', name), join(here, 'resources', name), { recursive: true })
}
cpSync(join(upstream, 'LICENSE'), join(here, 'LICENSE.upstream.txt'))
console.log(`Built portable core at ${dist}`)
