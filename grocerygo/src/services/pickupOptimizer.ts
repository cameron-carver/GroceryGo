import { getShelfLife } from '@/data/ingredientShelfLife'
import type { DayScore } from '@/types/calendar'
import type { GroceryItem } from '@/types/database'

const CALENDAR_WEIGHT = 0.6
const FRESHNESS_WEIGHT = 0.4

interface PerishableMealDate {
  category: string
  plannedDate: Date
}

export interface PickupRecommendation {
  day: Date
  dayIndex: number
  reasoning: string
  score: number
}

/**
 * Recommend the best grocery pickup day for the week based on
 * calendar availability (60%) and ingredient freshness needs (40%).
 *
 * Calendar component: inverts the stress score so low-stress days score high.
 * Freshness component: penalises days where perishables would expire before
 * their planned meal date, and rewards picking up close to (but not after)
 * when the ingredient is needed.
 */
export function recommendPickupDay(
  weekScores: DayScore[],
  groceryItems: Pick<GroceryItem, 'item_name' | 'category'>[],
  perishableMealDates: PerishableMealDate[],
): PickupRecommendation {
  if (weekScores.length === 0) {
    throw new Error('weekScores must contain at least one day')
  }

  const scored = weekScores.map((dayScore, index) => {
    // Calendar component: invert so low-stress (low finalScore) = high availability
    const calendarScore = 100 - dayScore.finalScore

    // Freshness component
    const freshnessScore = computeFreshnessScore(dayScore.date, groceryItems, perishableMealDates)

    const combined = CALENDAR_WEIGHT * calendarScore + FRESHNESS_WEIGHT * freshnessScore

    return { dayScore, index, calendarScore, freshnessScore, combined }
  })

  // Pick the day with the highest combined score
  scored.sort((a, b) => b.combined - a.combined)
  const best = scored[0]

  const reasoning = buildReasoning(best.dayScore, best.calendarScore, best.freshnessScore, groceryItems, perishableMealDates)

  return {
    day: best.dayScore.date,
    dayIndex: best.index,
    reasoning,
    score: best.combined,
  }
}

function computeFreshnessScore(
  pickupDate: Date,
  groceryItems: Pick<GroceryItem, 'item_name' | 'category'>[],
  perishableMealDates: PerishableMealDate[],
): number {
  if (perishableMealDates.length === 0) {
    // No perishable constraints -- any day is equally fine for freshness
    return 50
  }

  const scores: number[] = []

  for (const meal of perishableMealDates) {
    const shelfLife = getShelfLife(meal.category)
    const gapMs = meal.plannedDate.getTime() - pickupDate.getTime()
    const gapDays = gapMs / (1000 * 60 * 60 * 24)

    if (gapDays < 0) {
      // Shopping after the item is needed -- score 0
      scores.push(0)
    } else if (gapDays <= shelfLife.maxDays) {
      // Within shelf life window -- closer to use date is fresher
      // Score 100 when gapDays === 0, linearly down to ~50 at maxDays
      const freshness = 100 - (gapDays / shelfLife.maxDays) * 50
      scores.push(Math.max(0, freshness))
    } else {
      // Gap exceeds shelf life -- penalise
      const overshoot = gapDays - shelfLife.maxDays
      const penalty = Math.min(100, overshoot * 20)
      scores.push(Math.max(0, 50 - penalty))
    }
  }

  return scores.reduce((sum, s) => sum + s, 0) / scores.length
}

function buildReasoning(
  dayScore: DayScore,
  calendarScore: number,
  freshnessScore: number,
  groceryItems: Pick<GroceryItem, 'item_name' | 'category'>[],
  perishableMealDates: PerishableMealDate[],
): string {
  const dayName = dayScore.date.toLocaleDateString('en-US', { weekday: 'long' })
  const parts: string[] = []

  parts.push(`${dayName} is recommended for grocery pickup.`)

  if (calendarScore >= 70) {
    parts.push('Your calendar is very open that day.')
  } else if (calendarScore >= 40) {
    parts.push('Your calendar has moderate availability.')
  } else {
    parts.push('Your calendar is busier, but freshness needs make this the best trade-off.')
  }

  const shortLife = perishableMealDates.filter((m) => {
    const sl = getShelfLife(m.category)
    return sl.category === 'short'
  })
  if (shortLife.length > 0) {
    const categories = [...new Set(shortLife.map((m) => m.category))]
    parts.push(`Perishable items (${categories.join(', ')}) stay freshest with this timing.`)
  }

  return parts.join(' ')
}
