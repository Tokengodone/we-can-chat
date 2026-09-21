#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { WeFlowCore, ExportFormat } from './index'

function parseArgs(argv: string[]): { command: string; values: Record<string, string> } {
  const [command = 'help', ...rest] = argv
  const values: Record<string, string> = {}
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!token.startsWith('--')) continue
    values[token.slice(2)] = rest[index + 1] && !rest[index + 1].startsWith('--') ? rest[++index] : 'true'
  }
  return { command, values }
}

function usage(): string {
  return [
    'Usage:',
    '  weflow-core sessions --account-dir <path>',
    '  weflow-core messages --account-dir <path> --session <wxid> [--limit 100] [--offset 0]',
    '  weflow-core export --account-dir <path> --db-path <path> --wxid <wxid> --sessions <id,id> --output <dir> [--format json]',
    '  weflow-core transcribe --wav <file> --model <model.int8.onnx> --tokens <tokens.txt>',
    '',
    'Set WEFLOW_DECRYPT_KEY in the environment instead of placing the key in shell history.'
  ].join('\n')
}

function required(values: Record<string, string>, name: string): string {
  const value = String(values[name] || '').trim()
  if (!value) throw new Error(`Missing --${name}`)
  return value
}

async function main(): Promise<void> {
  const { command, values } = parseArgs(process.argv.slice(2))
  if (command === 'help') {
    console.log(usage())
    return
  }
  if (command !== 'transcribe') required(values, 'account-dir')
  const core = new WeFlowCore({
    accountDir: values['account-dir'],
    decryptKey: values.key || process.env.WEFLOW_DECRYPT_KEY || '',
    dbPath: values['db-path'],
    myWxid: values.wxid,
    imageXorKey: values['image-xor-key'] ? Number(values['image-xor-key']) : undefined,
    imageAesKey: values['image-aes-key'],
    modelDir: values['model-dir'],
    workDir: values['work-dir']
  })
  try {
    if (command === 'transcribe') {
      const text = await core.transcribeWav(readFileSync(resolve(required(values, 'wav'))), {
        modelPath: required(values, 'model'),
        tokensPath: required(values, 'tokens')
      })
      console.log(text)
      return
    }
    await core.open()
    if (command === 'sessions') {
      console.log(JSON.stringify(await core.listSessions(), null, 2))
    } else if (command === 'messages') {
      console.log(JSON.stringify(await core.getMessages(required(values, 'session'), {
        limit: Number(values.limit || 100),
        offset: Number(values.offset || 0)
      }), null, 2))
    } else if (command === 'export') {
      const result = await core.exportSessions({
        sessionIds: String(values.sessions || '').split(',').map((id) => id.trim()).filter(Boolean),
        outputDir: required(values, 'output'),
        options: {
          format: (values.format || 'json') as ExportFormat,
          exportMedia: values.media === 'true',
          exportImages: values.media === 'true',
          exportVoices: values.media === 'true',
          exportVoiceAsText: values.transcribe === 'true'
        },
        onProgress: (progress) => console.error(`[${progress.phase}] ${progress.phaseLabel || ''}`)
      })
      console.log(JSON.stringify(result, null, 2))
    } else {
      throw new Error(`Unknown command: ${command}`)
    }
  } finally {
    await core.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
