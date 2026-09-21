export interface GroupSummaryJsonRepairResult {
  text: string
  changed: boolean
  reasons: string[]
}

function removeTrailingCommas(input: string): { text: string; changed: boolean } {
  let output = ''
  let inString = false
  let escaped = false
  let changed = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (inString) {
      output += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
      output += char
      continue
    }

    if (char === ',') {
      let nextIndex = index + 1
      while (nextIndex < input.length && /\s/.test(input[nextIndex])) nextIndex += 1
      if (input[nextIndex] === '}' || input[nextIndex] === ']') {
        changed = true
        continue
      }
    }
    output += char
  }

  return { text: output, changed }
}

function mergeOrphanStringsAfterValue(input: string): { text: string; changed: boolean } {
  const jsonStringContent = '(?:\\\\.|[^"\\\\])*'
  const pattern = new RegExp(`("value"\\s*:\\s*")(${jsonStringContent})("\\s*),\\s*"(${jsonStringContent})"(?=\\s*[}\\]])`, 'g')
  let text = input
  let changed = false

  for (let pass = 0; pass < 8; pass += 1) {
    let changedThisPass = false
    text = text.replace(pattern, (_match, prefix: string, value: string, closing: string, orphan: string) => {
      changed = true
      changedThisPass = true
      return `${prefix}${value}；${orphan}${closing}`
    })
    if (!changedThisPass) break
  }

  return { text, changed }
}

export function repairGroupSummaryJson(input: string): GroupSummaryJsonRepairResult {
  let text = String(input || '').replace(/^\uFEFF/, '')
  const reasons: string[] = []

  const orphanRepair = mergeOrphanStringsAfterValue(text)
  text = orphanRepair.text
  if (orphanRepair.changed) reasons.push('merged_orphan_value_strings')

  const trailingCommaRepair = removeTrailingCommas(text)
  text = trailingCommaRepair.text
  if (trailingCommaRepair.changed) reasons.push('removed_trailing_commas')

  return { text, changed: reasons.length > 0, reasons }
}
