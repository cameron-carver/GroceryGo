import { describe, it, expect } from 'vitest'
import { recommendPickupDay } from '@/services/pickupOptimizer'
import type { DayScore } from '@/types/calendar'

function makeDayScore(dateStr: string, finalScore: number, tier: 'quick' | 'standard' | 'exploratory' = 'standard'): DayScore {
  return { date: new Date(dateStr), finalScore, tier, signalBreakdown: [] }
}

function makeGroceryItem(name: string, category: string) {
  return { item_name: name, category }
}

describe('recommendPickupDay', () => {
  const weekScores: DayScore[] = [
    makeDayScore('2025-02-17', 80, 'quick'),
    makeDayScore('2025-02-18', 50, 'standard'),
    makeDayScore('2025-02-19', 20, 'exploratory'),
    makeDayScore('2025-02-20', 60, 'standard'),
    makeDayScore('2025-02-21', 30, 'exploratory'),
    makeDayScore('2025-02-22', 10, 'exploratory'),
    makeDayScore('2025-02-23', 15, 'exploratory'),
  ]

  it('picks the least busy day when no perishables', () => {
    const groceries = [makeGroceryItem('Rice', 'Pantry'), makeGroceryItem('Canned beans', 'Canned Goods')]
    const result = recommendPickupDay(weekScores, groceries, [])
    expect(result.day).toBeDefined()
    expect(result.reasoning).toBeDefined()
  })

  it('shifts pickup later when perishables are needed late in the week', () => {
    const groceries = [makeGroceryItem('Salmon', 'Seafood'), makeGroceryItem('Rice', 'Pantry')]
    const mealDates = [{ category: 'Seafood', plannedDate: new Date('2025-02-21') }]
    const result = recommendPickupDay(weekScores, groceries, mealDates)
    expect(result.day.getTime()).toBeGreaterThanOrEqual(new Date('2025-02-19').getTime())
  })

  it('returns reasoning string', () => {
    const groceries = [makeGroceryItem('Chicken', 'Poultry')]
    const result = recommendPickupDay(weekScores, groceries, [])
    expect(typeof result.reasoning).toBe('string')
    expect(result.reasoning.length).toBeGreaterThan(0)
  })

  it('handles empty grocery list gracefully', () => {
    const result = recommendPickupDay(weekScores, [], [])
    expect(result.day).toBeDefined()
  })
})
