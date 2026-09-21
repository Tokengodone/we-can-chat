export interface GroupSummaryTimePeriod {
  start: string
  end: string
}

export interface GroupSummaryTimePeriodValidation {
  valid: boolean
  errors: Array<string | null>
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export function timeToMinutes(value: string): number | null {
  const match = TIME_PATTERN.exec(String(value || '').trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

export function minutesToTime(value: number): string {
  const normalized = ((Math.floor(value) % 1440) + 1440) % 1440
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

export function normalizeGroupSummaryTimePeriods(value: unknown): GroupSummaryTimePeriod[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const periods: GroupSummaryTimePeriod[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const start = String((item as Record<string, unknown>).start || '').trim()
    const end = String((item as Record<string, unknown>).end || '').trim()
    if (timeToMinutes(start) === null || timeToMinutes(end) === null) continue
    const key = `${start}-${end}`
    if (seen.has(key)) continue
    seen.add(key)
    periods.push({ start, end })
  }
  return periods
}

export function buildGroupSummaryTimePeriodsFromInterval(intervalHours: unknown): GroupSummaryTimePeriod[] {
  const allowed = new Set([1, 2, 4, 8, 12, 24])
  const numeric = Math.floor(Number(intervalHours) || 4)
  const hours = allowed.has(numeric) ? numeric : 4
  const intervalMinutes = hours * 60
  const periods: GroupSummaryTimePeriod[] = []
  for (let start = 0; start < 1440; start += intervalMinutes) {
    periods.push({
      start: minutesToTime(start),
      end: minutesToTime(start + intervalMinutes)
    })
  }
  return periods
}

function periodsOverlap(first: GroupSummaryTimePeriod, second: GroupSummaryTimePeriod): boolean {
  const firstStart = timeToMinutes(first.start)
  const firstEndValue = timeToMinutes(first.end)
  const secondStart = timeToMinutes(second.start)
  const secondEndValue = timeToMinutes(second.end)
  if (firstStart === null || firstEndValue === null || secondStart === null || secondEndValue === null) return false
  const firstEnd = firstEndValue <= firstStart ? firstEndValue + 1440 : firstEndValue
  const secondEnd = secondEndValue <= secondStart ? secondEndValue + 1440 : secondEndValue
  return [-1440, 0, 1440].some((shift) => {
    const shiftedStart = secondStart + shift
    const shiftedEnd = secondEnd + shift
    return firstStart < shiftedEnd && shiftedStart < firstEnd
  })
}

export function validateGroupSummaryTimePeriods(value: unknown): GroupSummaryTimePeriodValidation {
  if (!Array.isArray(value)) return { valid: false, errors: [] }
  const periods = value as GroupSummaryTimePeriod[]
  const errors: Array<string | null> = periods.map((period) => {
    if (timeToMinutes(period?.start) === null || timeToMinutes(period?.end) === null) return '请选择有效的开始和结束时间'
    return null
  })

  for (let firstIndex = 0; firstIndex < periods.length; firstIndex += 1) {
    if (errors[firstIndex]) continue
    for (let secondIndex = firstIndex + 1; secondIndex < periods.length; secondIndex += 1) {
      if (errors[secondIndex] || !periodsOverlap(periods[firstIndex], periods[secondIndex])) continue
      errors[firstIndex] = errors[firstIndex] || `与时段 ${secondIndex + 1} 重叠`
      errors[secondIndex] = errors[secondIndex] || `与时段 ${firstIndex + 1} 重叠`
    }
  }

  return { valid: errors.every((error) => error === null), errors }
}

export function isNextDayGroupSummaryPeriod(period: GroupSummaryTimePeriod): boolean {
  const start = timeToMinutes(period.start)
  const end = timeToMinutes(period.end)
  return start !== null && end !== null && end <= start
}
