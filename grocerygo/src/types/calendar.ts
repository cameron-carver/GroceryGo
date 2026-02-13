export type CalendarSource = 'google' | 'apple'
export type ComplexityTier = 'quick' | 'standard' | 'exploratory'

export interface CalendarEvent {
  id: string
  title: string
  startTime: Date
  endTime: Date
  isAllDay: boolean
  source: CalendarSource
  metadata: {
    location?: string
    description?: string
    recurrence?: string
  }
}

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
}

export const TIER_THRESHOLDS = {
  exploratory: { min: 0, max: 35 },
  standard: { min: 36, max: 65 },
  quick: { min: 66, max: 100 },
} as const

export function tierFromScore(score: number): ComplexityTier {
  if (score <= TIER_THRESHOLDS.exploratory.max) return 'exploratory'
  if (score <= TIER_THRESHOLDS.standard.max) return 'standard'
  return 'quick'
}

export interface SignalResult {
  score: number
  reasoning: string
  rawData: Record<string, unknown>
}

export interface ScoreSignal {
  name: string
  weight: number
  compute(events: CalendarEvent[], date: Date): SignalResult
}

export interface DayScore {
  date: Date
  finalScore: number
  tier: ComplexityTier
  signalBreakdown: SignalResult[]
}

export interface CalendarProvider {
  authenticate(userId: string): Promise<OAuthTokens>
  fetchEvents(startDate: Date, endDate: Date): Promise<CalendarEvent[]>
  revokeAccess(userId: string): Promise<void>
}

export type DayComplexityMap = Record<string, ComplexityTier>
