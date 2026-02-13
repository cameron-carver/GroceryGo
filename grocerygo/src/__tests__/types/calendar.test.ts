import { describe, it, expect } from 'vitest'
import type { CalendarEvent, CalendarProvider, OAuthTokens } from '@/types/calendar'

describe('calendar types', () => {
  it('CalendarEvent shape is valid', () => {
    const event: CalendarEvent = {
      id: 'evt-1',
      title: 'Team standup',
      startTime: new Date('2025-02-17T09:00:00'),
      endTime: new Date('2025-02-17T09:30:00'),
      isAllDay: false,
      source: 'google',
      metadata: {},
    }
    expect(event.source).toBe('google')
    expect(event.isAllDay).toBe(false)
  })

  it('ComplexityTier values are correct', async () => {
    const { TIER_THRESHOLDS } = await import('@/types/calendar')
    expect(TIER_THRESHOLDS.exploratory.max).toBe(35)
    expect(TIER_THRESHOLDS.standard.max).toBe(65)
    expect(TIER_THRESHOLDS.quick.max).toBe(100)
  })
})
