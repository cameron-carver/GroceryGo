import type { CalendarEvent, SignalResult, ScoreSignal, DayScore } from '@/types/calendar'
import { tierFromScore } from '@/types/calendar'

// Constants
const DINNER_PREP_START = 17
const DINNER_PREP_END = 19
const LUNCH_START = 11
const LUNCH_END = 13
const WAKING_HOURS = 14
const BACK_TO_BACK_GAP_MINUTES = 15

// Max point allocations
const MAX_COMMITTED_HOURS_PTS = 40
const MAX_BACK_TO_BACK_PTS = 25
const MAX_MEAL_CONFLICT_PTS = 20
const MAX_FREE_BLOCK_PTS = 15

/**
 * Extracts the local calendar date (YYYY-MM-DD) from a Date object.
 */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Builds local-time midnight boundaries for a given date.
 * Handles the case where date-only ISO strings (e.g. '2025-02-17') are parsed as UTC.
 */
function localDayBounds(date: Date): { dayStart: Date; dayEnd: Date } {
  // Use UTC fields to get the intended calendar date, since date-only ISO
  // strings are parsed as UTC midnight. If the date was created with a time
  // component it will still work because we normalize to local day.
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const day = date.getUTCDate()
  const dayStart = new Date(year, month, day, 0, 0, 0, 0)
  const dayEnd = new Date(year, month, day, 23, 59, 59, 999)
  return { dayStart, dayEnd }
}

/**
 * Filters events that fall on the given date.
 */
export function eventsOnDate(events: CalendarEvent[], date: Date): CalendarEvent[] {
  const { dayStart, dayEnd } = localDayBounds(date)

  return events.filter((e) => {
    return e.startTime <= dayEnd && e.endTime >= dayStart
  })
}

/**
 * Calculates overlap in hours between two time ranges.
 */
export function hoursOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): number {
  const overlapStart = aStart > bStart ? aStart : bStart
  const overlapEnd = aEnd < bEnd ? aEnd : bEnd
  const diffMs = overlapEnd.getTime() - overlapStart.getTime()
  return diffMs > 0 ? diffMs / (1000 * 60 * 60) : 0
}

/**
 * TimeBlockSignal computes a busyness score (0-100) for a single day
 * based on calendar events.
 *
 * Factors:
 *  - Total committed hours (max 40 pts)
 *  - Back-to-back event density (max 25 pts)
 *  - Meal window conflicts (max 20 pts): dinner prep 2x weight vs lunch
 *  - Largest free block inverted (max 15 pts)
 */
export class TimeBlockSignal implements ScoreSignal {
  name = 'time-block'
  weight = 1

  compute(events: CalendarEvent[], date: Date): SignalResult {
    const dayEvents = eventsOnDate(events, date)

    if (dayEvents.length === 0) {
      return {
        score: 0,
        reasoning: 'Completely free day',
        rawData: {
          totalCommittedHours: 0,
          largestFreeBlockHours: WAKING_HOURS,
          backToBackCount: 0,
        },
      }
    }

    // Sort events by start time
    const sorted = [...dayEvents].sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime()
    )

    // --- Total committed hours ---
    const totalCommittedHours = sorted.reduce((sum, e) => {
      const durationMs = e.endTime.getTime() - e.startTime.getTime()
      return sum + durationMs / (1000 * 60 * 60)
    }, 0)
    const committedPts = Math.min(
      MAX_COMMITTED_HOURS_PTS,
      (totalCommittedHours / WAKING_HOURS) * MAX_COMMITTED_HOURS_PTS
    )

    // --- Back-to-back density ---
    let backToBackCount = 0
    for (let i = 0; i < sorted.length - 1; i++) {
      const gapMs = sorted[i + 1].startTime.getTime() - sorted[i].endTime.getTime()
      const gapMinutes = gapMs / (1000 * 60)
      if (gapMinutes <= BACK_TO_BACK_GAP_MINUTES) {
        backToBackCount++
      }
    }
    const maxPossibleB2B = Math.max(sorted.length - 1, 1)
    const b2bPts = (backToBackCount / maxPossibleB2B) * MAX_BACK_TO_BACK_PTS

    // --- Meal window conflicts ---
    const { dayStart: dayBase } = localDayBounds(date)

    const dinnerStart = new Date(dayBase)
    dinnerStart.setHours(DINNER_PREP_START, 0, 0, 0)
    const dinnerEnd = new Date(dayBase)
    dinnerEnd.setHours(DINNER_PREP_END, 0, 0, 0)

    const lunchStart = new Date(dayBase)
    lunchStart.setHours(LUNCH_START, 0, 0, 0)
    const lunchEnd = new Date(dayBase)
    lunchEnd.setHours(LUNCH_END, 0, 0, 0)

    let dinnerOverlapHours = 0
    let lunchOverlapHours = 0
    for (const e of sorted) {
      dinnerOverlapHours += hoursOverlap(e.startTime, e.endTime, dinnerStart, dinnerEnd)
      lunchOverlapHours += hoursOverlap(e.startTime, e.endTime, lunchStart, lunchEnd)
    }

    const dinnerWindowSize = DINNER_PREP_END - DINNER_PREP_START // 2 hours
    const lunchWindowSize = LUNCH_END - LUNCH_START // 2 hours

    // Dinner prep conflicts weigh 2x vs lunch
    const dinnerConflictRatio = Math.min(dinnerOverlapHours / dinnerWindowSize, 1)
    const lunchConflictRatio = Math.min(lunchOverlapHours / lunchWindowSize, 1)
    const mealPts = (dinnerConflictRatio * 2 + lunchConflictRatio) / 3 * MAX_MEAL_CONFLICT_PTS

    // --- Largest free block (inverted: smaller free block = more points) ---
    const wakingStart = new Date(dayBase)
    wakingStart.setHours(7, 0, 0, 0)
    const wakingEnd = new Date(dayBase)
    wakingEnd.setHours(23, 0, 0, 0)

    const freeBlocks: number[] = []
    let cursor = wakingStart.getTime()
    for (const e of sorted) {
      const eventStart = Math.max(e.startTime.getTime(), wakingStart.getTime())
      if (eventStart > cursor) {
        freeBlocks.push((eventStart - cursor) / (1000 * 60 * 60))
      }
      cursor = Math.max(cursor, Math.min(e.endTime.getTime(), wakingEnd.getTime()))
    }
    // Trailing free block
    if (cursor < wakingEnd.getTime()) {
      freeBlocks.push((wakingEnd.getTime() - cursor) / (1000 * 60 * 60))
    }

    const largestFreeBlockHours = freeBlocks.length > 0 ? Math.max(...freeBlocks) : 0
    // Invert: a full free day (WAKING_HOURS) = 0 pts, no free time = MAX pts
    const freeBlockPts =
      MAX_FREE_BLOCK_PTS * (1 - Math.min(largestFreeBlockHours / WAKING_HOURS, 1))

    // --- Final score ---
    const rawScore = committedPts + b2bPts + mealPts + freeBlockPts
    const score = Math.round(Math.min(100, Math.max(0, rawScore)))

    const parts: string[] = []
    parts.push(`${totalCommittedHours.toFixed(1)}h committed`)
    if (backToBackCount > 0) parts.push(`${backToBackCount} back-to-back`)
    if (dinnerOverlapHours > 0) parts.push('dinner prep conflict')
    if (lunchOverlapHours > 0) parts.push('lunch conflict')
    parts.push(`largest free block ${largestFreeBlockHours.toFixed(1)}h`)

    return {
      score,
      reasoning: parts.join('; '),
      rawData: {
        totalCommittedHours,
        largestFreeBlockHours,
        backToBackCount,
        dinnerOverlapHours,
        lunchOverlapHours,
        committedPts,
        b2bPts,
        mealPts,
        freeBlockPts,
      },
    }
  }
}

/**
 * DayScoreEngine composes signals to produce a DayScore for each day of a week.
 */
export class DayScoreEngine {
  private signals: ScoreSignal[]

  constructor(signals?: ScoreSignal[]) {
    this.signals = signals ?? [new TimeBlockSignal()]
  }

  scoreWeek(events: CalendarEvent[], weekStart: Date): DayScore[] {
    const days: DayScore[] = []

    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart)
      date.setDate(date.getDate() + i)

      const signalResults: SignalResult[] = []
      let totalWeightedScore = 0
      let totalWeight = 0

      for (const signal of this.signals) {
        const result = signal.compute(events, date)
        signalResults.push(result)
        totalWeightedScore += result.score * signal.weight
        totalWeight += signal.weight
      }

      const finalScore = totalWeight > 0
        ? Math.round(totalWeightedScore / totalWeight)
        : 0

      days.push({
        date,
        finalScore,
        tier: tierFromScore(finalScore),
        signalBreakdown: signalResults,
      })
    }

    return days
  }
}
