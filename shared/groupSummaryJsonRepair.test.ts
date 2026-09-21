import test from 'node:test'
import assert from 'node:assert/strict'
import { repairGroupSummaryJson } from './groupSummaryJsonRepair.ts'

test('merges an orphan string emitted after a custom-section value', () => {
  const malformed = '{"custom_sections":[{"title":"需求","items":[{"title":"办执照","fields":[{"label":"相关讨论","value":"我受限于执照","淘宝、我真在看"}]}]}],"topics":[{"title":"主题","key_points":["内容"],"conclusion":"结论"}]}'
  const repaired = repairGroupSummaryJson(malformed)

  assert.equal(repaired.changed, true)
  assert.deepEqual(repaired.reasons, ['merged_orphan_value_strings'])
  const parsed = JSON.parse(repaired.text)
  assert.equal(parsed.custom_sections[0].items[0].fields[0].value, '我受限于执照；淘宝、我真在看')
})

test('removes trailing commas without changing commas inside strings', () => {
  const malformed = '{"overview":"保留,}","topics":[{"title":"主题","key_points":["内容"],"conclusion":"结论",}],}'
  const repaired = repairGroupSummaryJson(malformed)

  assert.equal(repaired.changed, true)
  assert.deepEqual(JSON.parse(repaired.text), {
    overview: '保留,}',
    topics: [{ title: '主题', key_points: ['内容'], conclusion: '结论' }]
  })
})

test('leaves valid JSON unchanged', () => {
  const valid = '{"topics":[{"title":"主题","key_points":["内容"],"conclusion":"结论"}]}'
  assert.deepEqual(repairGroupSummaryJson(valid), { text: valid, changed: false, reasons: [] })
})
