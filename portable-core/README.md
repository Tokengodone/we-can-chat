# WeFlow Portable Core

This directory turns the database reader, exporter, and voice recognizer in WeFlow into a UI-independent Node.js SDK. The generated `dist` directory can be embedded in Electron, Tauri sidecars, Node services, desktop utilities, or called from another language through the CLI.

## Graphical interface

On Windows, double-click the desktop shortcut **WeFlow 聊天导出**. The local interface opens in the default browser and communicates only with `127.0.0.1` on this computer. The database key stays in memory and is not saved by the interface.

You can also start it from this directory:

```powershell
npm run ui
```

## Scope

- Open a local WeChat 4.x account database with a caller-supplied key.
- List sessions and read decrypted message rows.
- Export selected sessions as JSON, HTML, Markdown, TXT, Excel, SQL, ChatLab, or WeClone.
- Export media and optionally convert voice messages to text.
- Transcribe standalone WAV or Silk buffers with a local SenseVoice model.

Credential discovery is deliberately outside this portable boundary. The host application should ask the owner for an existing database key or integrate its own authorized key provider.

## Build

Run from this directory:

```powershell
npm install
npm run build
npm run smoke
```

The build bundles the required WeFlow TypeScript into worker files and copies the native runtime resources. Runtime dependencies that contain native binaries remain normal npm dependencies so they resolve correctly after migration.

## SDK example

```ts
import { WeFlowCore } from '@local/weflow-portable-core'

const core = new WeFlowCore({
  accountDir: 'D:/WeChat/xwechat_files/wxid_xxx',
  dbPath: 'D:/WeChat/xwechat_files',
  myWxid: 'wxid_xxx',
  decryptKey: process.env.WEFLOW_DECRYPT_KEY!,
  modelDir: 'D:/models/sensevoice'
})

await core.open()
const sessions = await core.listSessions()
const messages = await core.getMessages(sessions[0].username, { limit: 100 })

await core.exportSessions({
  sessionIds: [sessions[0].username],
  outputDir: 'D:/exports',
  options: {
    format: 'json',
    exportMedia: true,
    exportImages: true,
    exportVoices: true,
    exportVoiceAsText: true
  },
  onProgress: console.log
})

await core.close()
```

Voice-to-text uses the local SenseVoice model. Place `model.int8.onnx` and `tokens.txt` anywhere the host application controls, then call `transcribeWav` or `transcribeSilk` with their paths.
Standalone transcription does not require database options.

## CLI example

```powershell
$env:WEFLOW_DECRYPT_KEY = '<your own database key>'
weflow-core sessions --account-dir 'D:/WeChat/xwechat_files/wxid_xxx'
weflow-core export --account-dir 'D:/WeChat/xwechat_files/wxid_xxx' --db-path 'D:/WeChat/xwechat_files' --wxid 'wxid_xxx' --sessions 'friend_wxid' --output 'D:/exports' --format json --media true --transcribe true --model-dir 'D:/models/sensevoice'
```

Avoid putting the database key directly on the command line because shell history and process viewers may retain it.
