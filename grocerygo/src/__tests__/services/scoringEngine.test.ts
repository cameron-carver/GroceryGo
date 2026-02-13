import { describe, it, expect } from 'vitest'
import { TimeBlockSignal, DayScoreEngine } from '@/services/scoringEngine'
import type { CalendarEvent } from '@/types/calendar'

function makeEvent(
  start: string,
  end: string,
  title = 'Meeting'
): CalendarEvent {
  return {
    id: `evt-${start}`,
    title,
    startTime: new Date(start),
    endTime: new Date(end),
    isAllDay: false,
    source: 'google',
    metadata: {},
  }
}

const baseDate = new Date('2025-02-17') // Monday

describe('TimeBlockSignal', () => {
  const signal = new TimeBlockSignal()

  it('scores an empty day as 0 (no stress)', () => {
    const result = signal.compute([], baseDate)
    expect(result.score).toBe(0)
    expect(result.reasoning).toContain('free')
  })

  it('scores a lightly booked day low', () => {
    const events = [
      makeEvent('2025-02-17T10:00:00', '2025-02-17T11:00:00'),
    ]
    const result = signal.compute(events, baseDate)
    expect(result.score).toBeLessThan(36) // exploratory tier
  })

  it('scores a packed day high', () => {
    const events = [
      makeEvent('2025-02-17T08:00:00', '2025-02-17T10:00:00'),
      makeEvent('2025-02-17T10:00:00', '2025-02-17T12:00:00'),
      makeEvent('2025-02-17T12:30:00', '2025-02-17T14:00:00'),
      makeEvent('2025-02-17T14:00:00', '2025-02-17T16:00:00'),
      makeEvent('2025-02-17T16:00:00', '2025-02-17T18:00:00'),
      makeEvent('2025-02-17T19:00:00', '2025-02-17T20:00:00'),
    ]
    const result = signal.compute(events, baseDate)
    expect(result.score).toBeGreaterThan(65) // quick tier
  })

  it('considers back-to-back events as more stressful', () => {
    const backToBack = [
      makeEvent('2025-02-17T09:00:00', '2025-02-17T10:00:00'),
      makeEvent('2025-02-17T10:00:00', '2025-02-17T11:00:00'),
      makeEvent('2025-02-17T11:00:00', '2025-02-17T12:00:00'),
    ]
    const spreadOut = [
      makeEvent('2025-02-17T09:00:00', '2025-02-17T10:00:00'),
      makeEvent('2025-02-17T13:00:00', '2025-02-17T14:00:00'),
      makeEvent('2025-02-17T17:00:00', '2025-02-17T18:00:00'),
    ]
    const b2bScore = signal.compute(backToBack, baseDate).score
    const spreadScore = signal.compute(spreadOut, baseDate).score
    expect(b2bScore).toBeGreaterThan(spreadScore)
  })

  it('penalizes events during dinner prep window (17:00-19:00)', () => {
    const dinnerBlocked = [
      makeEvent('2025-02-17T17:00:00', '2025-02-17T19:00:00'),
    ]
    const morningOnly = [
      makeEvent('2025-02-17T09:00:00', '2025-02-17T11:00:00'),
    ]
    const dinnerScore = signal.compute(dinnerBlocked, baseDate).score
    const morningScore = signal.compute(morningOnly, baseDate).score
    expect(dinnerScore).toBeGreaterThan(morningScore)
  })

  it('includes rawData for backtesting', () => {
    const events = [
      makeEvent('2025-02-17T09:00:00', '2025-02-17T10:00:00'),
    ]
    const result = signal.compute(events, baseDate)
    expect(result.rawData).toHaveProperty('totalCommittedHours')
    expect(result.rawData).toHaveProperty('largestFreeBlockHours')
    expect(result.rawData).toHaveProperty('backToBackCount')
  })
})

describe('DayScoreEngine', () => {
  const engine = new DayScoreEngine()

  it('scores a week of 7 days', () => {
    const mondayEvents = [
      makeEvent('2025-02-17T09:00:00', '2025-02-17T17:00:00'),
    ]
    const scores = engine.scoreWeek(mondayEvents, baseDate)
    expect(scores).toHaveLength(7)
    expect(scores[0].tier).toBeDefined()
    expect(scores[0].signalBreakdown.length).toBeGreaterThan(0)
  })

  it('maps scores to correct tiers', () => {
    const scores = engine.scoreWeek([], baseDate)
    scores.forEach((day) => {
      expect(day.tier).toBe('exploratory')
      expect(day.finalScore).toBe(0)
    })
  })
})
