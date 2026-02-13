'use server'

import { createClient } from '@/utils/supabase/server'
import { fetchAllEvents, getConnectedProviders } from '@/services/calendarService'
import { DayScoreEngine } from '@/services/scoringEngine'
import { recommendPickupDay } from '@/services/pickupOptimizer'
import type { DayScore, DayComplexityMap, ComplexityTier } from '@/types/calendar'
import type { WeekScoreInsert } from '@/types/database'
import { getNextWeekStart } from '@/utils/mealPlanDates'

export async function getWeekPreviewData() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { error: 'Not authenticated' }

  const connected = await getConnectedProviders(user.id)
  if (connected.length === 0) return { error: 'No calendar connected', needsCalendar: true }

  const weekOf = getNextWeekStart('Monday')
  const startDate = new Date(weekOf)
  const endDate = new Date(startDate)
  endDate.setDate(startDate.getDate() + 7)

  let events
  try {
    events = await fetchAllEvents(startDate, endDate)
  } catch {
    return { error: 'Failed to fetch calendar events. Please try reconnecting your calendar.' }
  }

  const engine = new DayScoreEngine()
  const scores = engine.scoreWeek(events, startDate)

  const pickupResult = recommendPickupDay(scores, [], [])

  return {
    weekOf,
    dayScores: scores.map((s) => ({
      date: s.date.toISOString(),
      finalScore: s.finalScore,
      tier: s.tier,
      reasoning: s.signalBreakdown[0]?.reasoning ?? '',
    })),
    connectedProviders: connected,
    pickupRecommendation: {
      dayIndex: pickupResult.dayIndex,
      reasoning: pickupResult.reasoning,
    },
  }
}

export async function saveWeekScoresAndGenerate(
  weekOf: string,
  dayScores: DayScore[],
  userAdjustments: Record<string, ComplexityTier>,
  pickupDay: string | null,
  pickupReasoning: string | null
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const weekScoreData: WeekScoreInsert = {
    user_id: user.id,
    week_of: weekOf,
    day_scores: dayScores.map((s) => ({
      date: s.date instanceof Date ? s.date.toISOString() : String(s.date),
      finalScore: s.finalScore,
      tier: s.tier,
      signalBreakdown: s.signalBreakdown,
    })),
    user_adjustments: Object.keys(userAdjustments).length > 0 ? userAdjustments : undefined,
    provider_version: 'v1-time-block',
    recommended_pickup_day: pickupDay ?? undefined,
    pickup_reasoning: pickupReasoning ?? undefined,
  }

  const { data: weekScore, error } = await supabase
    .from('week_scores')
    .insert(weekScoreData)
    .select()
    .single()

  if (error) return { error: 'Failed to save week scores' }

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const complexityMap: DayComplexityMap = {}
  dayScores.forEach((score, i) => {
    const dayName = dayNames[i]
    complexityMap[dayName] = userAdjustments[dayName] ?? score.tier
  })

  return { success: true, weekScoreId: weekScore.id, complexityMap }
}
