const CHINESE_NUMBERS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
}

const WEEKDAY_MAP: Record<string, number> = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 0,
}

function toNumber(value: string): number | null {
  const text = value.trim()
  if (!text) return null

  const asNumber = Number(text)
  if (Number.isFinite(asNumber)) return asNumber

  if (text.length === 1 && text in CHINESE_NUMBERS) return CHINESE_NUMBERS[text]
  if (text === '十一') return 11
  if (text === '十二') return 12
  if (text.startsWith('十')) {
    const tail = text.slice(1)
    return 10 + (CHINESE_NUMBERS[tail] ?? 0)
  }
  if (text.endsWith('十')) {
    const head = text.slice(0, -1)
    return (CHINESE_NUMBERS[head] ?? 1) * 10
  }
  if (text.includes('十')) {
    const [head, tail] = text.split('十')
    return (CHINESE_NUMBERS[head] ?? 1) * 10 + (CHINESE_NUMBERS[tail] ?? 0)
  }

  return null
}

function normalizeInput(value?: string) {
  return (value || '')
    .replace(/[，。；、]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildLocalDate(
  base: Date,
  dayOffset: number,
  hour: number,
  minute: number,
) {
  const date = new Date(base)
  date.setDate(date.getDate() + dayOffset)
  date.setHours(hour, minute, 0, 0)
  return date.getTime()
}

function normalizeMeridiem(hour: number, meridiem?: string) {
  const label = meridiem || ''
  if (/下午|晚上|傍晚|中午|pm/i.test(label) && hour < 12) return hour + 12
  if (/凌晨|上午|早上|am/i.test(label) && hour === 12) return 0
  return hour
}

function parseChineseRelative(input: string, now: number) {
  if (/半小时后|半个小时后/.test(input)) return now + 30 * 60 * 1000
  if (/一会儿|一会|稍后|待会儿|待会/.test(input)) return now + 10 * 60 * 1000

  const relativeMatch = input.match(/([0-9]+|[零一二两三四五六七八九十]+)\s*(分钟|分|小时|个小时|天|周|星期|月)\s*(后|以后|之后)/)
  if (!relativeMatch) return null

  const amount = toNumber(relativeMatch[1])
  if (amount === null || amount < 0) return null

  const unit = relativeMatch[2]
  if (unit === '分钟' || unit === '分') return now + amount * 60 * 1000
  if (unit === '小时' || unit === '个小时') return now + amount * 60 * 60 * 1000
  if (unit === '天') return now + amount * 24 * 60 * 60 * 1000
  if (unit === '周' || unit === '星期') return now + amount * 7 * 24 * 60 * 60 * 1000
  if (unit === '月') {
    const date = new Date(now)
    date.setMonth(date.getMonth() + amount)
    return date.getTime()
  }

  return null
}

function parseEnglishRelative(input: string, now: number) {
  const match = input.match(/\bin\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\b/i)
  if (!match) return null

  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount < 0) return null

  const unit = match[2].toLowerCase()
  if (unit.startsWith('min')) return now + amount * 60 * 1000
  if (unit.startsWith('hour') || unit.startsWith('hr')) return now + amount * 60 * 60 * 1000
  if (unit.startsWith('day')) return now + amount * 24 * 60 * 60 * 1000
  if (unit.startsWith('week')) return now + amount * 7 * 24 * 60 * 60 * 1000
  if (unit.startsWith('month')) {
    const date = new Date(now)
    date.setMonth(date.getMonth() + amount)
    return date.getTime()
  }

  return null
}

function parseChineseAbsolute(input: string, now: number) {
  const base = new Date(now)
  const dayOffset = input.includes('后天') ? 2 : input.includes('明天') ? 1 : 0

  const timeMatch = input.match(/(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*([0-9]{1,2}|[零一二两三四五六七八九十]{1,3})\s*(?:点|:|：|时)\s*([0-9]{1,2}|[零一二两三四五六七八九十]{1,3})?\s*(?:分)?/)
  if (!timeMatch) return null

  const hourValue = toNumber(timeMatch[2])
  const minuteValue = timeMatch[3] ? toNumber(timeMatch[3]) : 0
  if (hourValue === null || minuteValue === null) return null

  const hour = normalizeMeridiem(hourValue, timeMatch[1])
  if (hour > 23 || minuteValue > 59) return null

  let timestamp = buildLocalDate(base, dayOffset, hour, minuteValue)
  if (!/今天|明天|后天/.test(input) && timestamp <= now) {
    timestamp = buildLocalDate(base, 1, hour, minuteValue)
  }

  return timestamp
}

function parseEnglishAbsolute(input: string, now: number) {
  const base = new Date(now)
  const dayOffset = /\bday after tomorrow\b/i.test(input)
    ? 2
    : /\btomorrow\b/i.test(input)
      ? 1
      : 0

  const timeMatch = input.match(/\b(?:today|tomorrow|day after tomorrow)?\s*(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i)
  if (!timeMatch || !/\btoday\b|\btomorrow\b|\bday after tomorrow\b|\bat\s*\d/i.test(input)) {
    return null
  }

  let hour = Number(timeMatch[1])
  const minute = timeMatch[2] ? Number(timeMatch[2]) : 0
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null

  hour = normalizeMeridiem(hour, timeMatch[3])
  let timestamp = buildLocalDate(base, dayOffset, hour, minute)
  if (!/\btoday\b|\btomorrow\b|\bday after tomorrow\b/i.test(input) && timestamp <= now) {
    timestamp = buildLocalDate(base, 1, hour, minute)
  }

  return timestamp
}

function parseNextWeekday(input: string, now: number) {
  const match = input.match(/(?:下周|下星期|周|星期)([一二三四五六日天1-7]).*?(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*([0-9]{1,2}|[零一二两三四五六七八九十]{1,3})\s*(?:点|:|：|时)\s*([0-9]{1,2}|[零一二两三四五六七八九十]{1,3})?/)
  if (!match) return null

  const weekday = WEEKDAY_MAP[match[1]]
  const hourValue = toNumber(match[3])
  const minuteValue = match[4] ? toNumber(match[4]) : 0
  if (weekday === undefined || hourValue === null || minuteValue === null) return null

  const base = new Date(now)
  const currentWeekday = base.getDay()
  const isExplicitNextWeek = /下周|下星期/.test(input)
  let dayOffset = (weekday - currentWeekday + 7) % 7
  if (dayOffset === 0 || isExplicitNextWeek) dayOffset += 7

  const hour = normalizeMeridiem(hourValue, match[2])
  if (hour > 23 || minuteValue > 59) return null

  return buildLocalDate(base, dayOffset, hour, minuteValue)
}

export function parseReminderTimeText(value?: string, now = Date.now()): number | undefined {
  const input = normalizeInput(value)
  if (!input) return undefined

  const parsed = Date.parse(input)
  if (Number.isFinite(parsed)) return parsed

  const timestamp =
    parseChineseRelative(input, now) ??
    parseEnglishRelative(input, now) ??
    parseNextWeekday(input, now) ??
    parseChineseAbsolute(input, now) ??
    parseEnglishAbsolute(input, now)

  return timestamp === null || timestamp === undefined ? undefined : timestamp
}
