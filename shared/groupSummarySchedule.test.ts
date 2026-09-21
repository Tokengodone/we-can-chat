import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGroupSummaryTimePeriodsFromInterval,
  isNextDayGroupSummaryPeriod,
  normalizeGroupSummaryTimePeriods,
  validateGroupSummaryTimePeriods
} from './groupSummarySchedule.ts'

test('migrates a legacy interval into a full day of time periods', () => {
  assert.deepEqual(buildGroupSummaryTimePeriodsFromInterval(8), [
    { start: '00:00', end: '08:00' },
    { start: '08:00', end: '16:00' },
    { start: '16:00', end: '00:00' }
  ])
  assert.deepEqual(buildGroupSummaryTimePeriodsFromInterval(24), [
    { start: '00:00', end: '00:00' }
  ])
})

test('normalizes valid periods and removes exact duplicates', () => {
  assert.deepEqual(normalizeGroupSummaryTimePeriods([
    { start: '09:00', end: '12:00' },
    { start: '09:00', end: '12:00' },
    { start: '25:00', end: '26:00' }
  ]), [
    { start: '09:00', end: '12:00' }
  ])
})

test('accepts adjacent same-day periods', () => {
  const result = validateGroupSummaryTimePeriods([
    { start: '09:00', end: '12:00' },
    { start: '12:00', end: '18:00' }
  ])
  assert.equal(result.valid, true)
  assert.deepEqual(result.errors, [null, null])
})

test('detects overlap across midnight and on the following day', () => {
  const result = validateGroupSummaryTimePeriods([
    { start: '20:00', end: '01:00' },
    { start: '00:30', end: '02:00' }
  ])
  assert.equal(result.valid, false)
  assert.deepEqual(result.errors, ['与时段 2 重叠', '与时段 1 重叠'])
})

test('treats equal start and end as a 24-hour next-day period', () => {
  assert.equal(isNextDayGroupSummaryPeriod({ start: '00:00', end: '00:00' }), true)
  const result = validateGroupSummaryTimePeriods([
    { start: '00:00', end: '00:00' },
    { start: '09:00', end: '10:00' }
  ])
  assert.equal(result.valid, false)
})
