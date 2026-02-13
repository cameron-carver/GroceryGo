# Calendar-Aware Meal Planning — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add calendar integration that analyzes day busyness to recommend meal complexity tiers and optimal grocery pickup timing.

**Architecture:** Calendar-first pipeline — a new stage before meal plan generation. Calendar providers (Google, Apple) feed events into a pluggable scoring engine, which produces per-day stress scores mapped to complexity tiers (Quick/Standard/Exploratory). An interactive week preview lets users adjust tiers before generation. A pickup optimizer recommends the best grocery shopping day.

**Tech Stack:** Next.js 15 (App Router), TypeScript 5, Supabase (PostgreSQL), Zod 4, Tailwind CSS 4, Google Calendar API v3, CalDAV (Apple Calendar), Vitest (new — unit tests for pure logic)

**Root directory:** `/Users/cameron/GroceryGo/GroceryGo/grocerygo`

---

## Task 1: Set Up Vitest for Unit Testing

The project has no unit test infrastructure (only Playwright e2e). We need Vitest for testing the scoring engine, pickup optimizer, and calendar service logic.

**Files:**
- Create: `vitest.config.ts`
- Create: `src/__tests__/setup.ts`
- Modify: `package.json` (add vitest dep + test script)

**Step 1: Install vitest**

```bash
cd /Users/cameron/GroceryGo/GroceryGo/grocerygo
npm install --save-dev vitest
```

**Step 2: Create vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

**Step 3: Add test script to package.json**

Add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 4: Create a smoke test to verify setup**

Create `src/__tests__/setup.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

describe('vitest setup', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2)
  })
})
```

**Step 5: Run tests**

```bash
npm test
```

Expected: 1 test passes.

**Step 6: Commit**

```bash
git add vitest.config.ts src/__tests__/setup.test.ts package.json package-lock.json
git commit -m "chore: add vitest for unit testing"
```

---

## Task 2: Calendar Types & Provider Interface

Define the shared types and abstract interface for calendar providers.

**Files:**
- Create: `src/types/calendar.ts`

**Step 1: Write the failing test**

Create `src/__tests__/types/calendar.test.ts`:

```typescript
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
```

**Step 2: Run test — verify it fails**

```bash
npm test -- src/__tests__/types/calendar.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement types**

Create `src/types/calendar.ts`:

```typescript
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
```

**Step 4: Run test — verify it passes**

```bash
npm test -- src/__tests__/types/calendar.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/types/calendar.ts src/__tests__/types/calendar.test.ts
git commit -m "feat: add calendar types and provider interface"
```

---

## Task 3: Scoring Engine — Time-Block Analysis Signal

The core scoring logic. Pure functions, no I/O — ideal for TDD.

**Files:**
- Create: `src/services/scoringEngine.ts`
- Create: `src/__tests__/services/scoringEngine.test.ts`

**Step 1: Write failing tests**

Create `src/__tests__/services/scoringEngine.test.ts`:

```typescript
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
    // 3 hours of meetings, all back-to-back
    const backToBack = [
      makeEvent('2025-02-17T09:00:00', '2025-02-17T10:00:00'),
      makeEvent('2025-02-17T10:00:00', '2025-02-17T11:00:00'),
      makeEvent('2025-02-17T11:00:00', '2025-02-17T12:00:00'),
    ]
    // 3 hours of meetings, spread out
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
    // Empty week = all exploratory
    const scores = engine.scoreWeek([], baseDate)
    scores.forEach((day) => {
      expect(day.tier).toBe('exploratory')
      expect(day.finalScore).toBe(0)
    })
  })
})
```

**Step 2: Run tests — verify they fail**

```bash
npm test -- src/__tests__/services/scoringEngine.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement the scoring engine**

Create `src/services/scoringEngine.ts`:

```typescript
import type { CalendarEvent, ScoreSignal, SignalResult, DayScore } from '@/types/calendar'
import { tierFromScore } from '@/types/calendar'

const DINNER_PREP_START = 17 // 5 PM
const DINNER_PREP_END = 19   // 7 PM
const LUNCH_WINDOW_START = 11
const LUNCH_WINDOW_END = 13
const WAKING_HOURS = 16 // assume 7AM-11PM

function eventsOnDate(events: CalendarEvent[], date: Date): CalendarEvent[] {
  const dayStart = new Date(date)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(date)
  dayEnd.setHours(23, 59, 59, 999)

  return events.filter((e) => {
    if (e.isAllDay) {
      const eventDate = new Date(e.startTime)
      eventDate.setHours(0, 0, 0, 0)
      return eventDate.getTime() === dayStart.getTime()
    }
    return e.startTime < dayEnd && e.endTime > dayStart
  })
}

function hoursOverlap(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date
): number {
  const overlapStart = Math.max(startA.getTime(), startB.getTime())
  const overlapEnd = Math.min(endA.getTime(), endB.getTime())
  return Math.max(0, (overlapEnd - overlapStart) / (1000 * 60 * 60))
}

export class TimeBlockSignal implements ScoreSignal {
  name = 'time-block-analysis'
  weight = 1.0

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
          mealWindowConflicts: 0,
        },
      }
    }

    // 1. Total committed hours (max contribution: 40 points)
    const totalHours = dayEvents.reduce((sum, e) => {
      const hours = (e.endTime.getTime() - e.startTime.getTime()) / (1000 * 60 * 60)
      return sum + Math.max(0, hours)
    }, 0)
    const committedScore = Math.min(40, (totalHours / WAKING_HOURS) * 40)

    // 2. Back-to-back density (max contribution: 25 points)
    const sorted = [...dayEvents].sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime()
    )
    let backToBackCount = 0
    for (let i = 1; i < sorted.length; i++) {
      const gap =
        (sorted[i].startTime.getTime() - sorted[i - 1].endTime.getTime()) /
        (1000 * 60)
      if (gap <= 15) backToBackCount++
    }
    const b2bScore = Math.min(25, (backToBackCount / Math.max(1, sorted.length - 1)) * 25)

    // 3. Meal window conflicts (max contribution: 20 points)
    const dayDate = new Date(date)
    const dinnerStart = new Date(dayDate)
    dinnerStart.setHours(DINNER_PREP_START, 0, 0, 0)
    const dinnerEnd = new Date(dayDate)
    dinnerEnd.setHours(DINNER_PREP_END, 0, 0, 0)
    const lunchStart = new Date(dayDate)
    lunchStart.setHours(LUNCH_WINDOW_START, 0, 0, 0)
    const lunchEnd = new Date(dayDate)
    lunchEnd.setHours(LUNCH_WINDOW_END, 0, 0, 0)

    let mealConflicts = 0
    for (const e of dayEvents) {
      if (hoursOverlap(e.startTime, e.endTime, dinnerStart, dinnerEnd) > 0) {
        mealConflicts += 2 // dinner prep conflict weighs more
      }
      if (hoursOverlap(e.startTime, e.endTime, lunchStart, lunchEnd) > 0) {
        mealConflicts += 1
      }
    }
    const mealScore = Math.min(20, mealConflicts * 5)

    // 4. Largest free block (max contribution: 15 points — inverted)
    const freeBlocks: number[] = []
    const wakingStart = new Date(dayDate)
    wakingStart.setHours(7, 0, 0, 0)
    const wakingEnd = new Date(dayDate)
    wakingEnd.setHours(23, 0, 0, 0)

    let cursor = wakingStart.getTime()
    for (const e of sorted) {
      const eventStart = Math.max(e.startTime.getTime(), wakingStart.getTime())
      if (eventStart > cursor) {
        freeBlocks.push((eventStart - cursor) / (1000 * 60 * 60))
      }
      cursor = Math.max(cursor, Math.min(e.endTime.getTime(), wakingEnd.getTime()))
    }
    if (cursor < wakingEnd.getTime()) {
      freeBlocks.push((wakingEnd.getTime() - cursor) / (1000 * 60 * 60))
    }

    const largestFreeBlock = freeBlocks.length > 0 ? Math.max(...freeBlocks) : WAKING_HOURS
    // Less free time = higher score (more stress)
    const freeBlockScore = Math.min(15, Math.max(0, 15 - (largestFreeBlock / WAKING_HOURS) * 15))

    const totalScore = Math.round(
      Math.min(100, committedScore + b2bScore + mealScore + freeBlockScore)
    )

    const parts: string[] = []
    if (totalHours > 0) parts.push(`${totalHours.toFixed(1)}hrs committed`)
    if (backToBackCount > 0) parts.push(`${backToBackCount} back-to-back`)
    if (largestFreeBlock < WAKING_HOURS) parts.push(`${largestFreeBlock.toFixed(1)}hr free block`)
    if (mealConflicts > 0) parts.push('meal window conflict')

    return {
      score: totalScore,
      reasoning: parts.length > 0 ? parts.join(', ') : 'Light day',
      rawData: {
        totalCommittedHours: totalHours,
        largestFreeBlockHours: largestFreeBlock,
        backToBackCount,
        mealWindowConflicts: mealConflicts,
      },
    }
  }
}

export class DayScoreEngine {
  private signals: ScoreSignal[]

  constructor(signals?: ScoreSignal[]) {
    this.signals = signals ?? [new TimeBlockSignal()]
  }

  scoreDay(events: CalendarEvent[], date: Date): DayScore {
    const results = this.signals.map((signal) => signal.compute(events, date))
    const totalWeight = this.signals.reduce((sum, s) => sum + s.weight, 0)

    const weightedScore =
      totalWeight > 0
        ? Math.round(
            this.signals.reduce(
              (sum, signal, i) => sum + results[i].score * signal.weight,
              0
            ) / totalWeight
          )
        : 0

    const finalScore = Math.min(100, Math.max(0, weightedScore))

    return {
      date,
      finalScore,
      tier: tierFromScore(finalScore),
      signalBreakdown: results,
    }
  }

  scoreWeek(events: CalendarEvent[], weekStart: Date): DayScore[] {
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(weekStart)
      date.setDate(weekStart.getDate() + i)
      return this.scoreDay(events, date)
    })
  }
}
```

**Step 4: Run tests — verify they pass**

```bash
npm test -- src/__tests__/services/scoringEngine.test.ts
```

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/services/scoringEngine.ts src/__tests__/services/scoringEngine.test.ts
git commit -m "feat: add pluggable scoring engine with time-block analysis"
```

---

## Task 4: Ingredient Shelf Life Data & Pickup Optimizer

**Files:**
- Create: `src/data/ingredientShelfLife.ts`
- Create: `src/services/pickupOptimizer.ts`
- Create: `src/__tests__/services/pickupOptimizer.test.ts`

**Step 1: Create the shelf life reference data**

Create `src/data/ingredientShelfLife.ts`:

```typescript
export type ShelfLifeCategory = 'short' | 'medium' | 'long'

export interface ShelfLifeEntry {
  category: ShelfLifeCategory
  minDays: number
  maxDays: number
}

// Maps grocery_items.category to shelf life info.
// Categories here must match the normalized categories used in AI generation.
const SHELF_LIFE: Record<string, ShelfLifeEntry> = {
  'Fresh Herbs': { category: 'short', minDays: 1, maxDays: 3 },
  'Berries': { category: 'short', minDays: 1, maxDays: 3 },
  'Seafood': { category: 'short', minDays: 1, maxDays: 2 },
  'Fish': { category: 'short', minDays: 1, maxDays: 2 },
  'Leafy Greens': { category: 'short', minDays: 2, maxDays: 4 },
  'Fresh Produce': { category: 'medium', minDays: 4, maxDays: 6 },
  'Produce': { category: 'medium', minDays: 4, maxDays: 6 },
  'Fruits': { category: 'medium', minDays: 3, maxDays: 5 },
  'Vegetables': { category: 'medium', minDays: 4, maxDays: 6 },
  'Dairy': { category: 'medium', minDays: 5, maxDays: 7 },
  'Eggs': { category: 'medium', minDays: 7, maxDays: 14 },
  'Poultry': { category: 'medium', minDays: 1, maxDays: 3 },
  'Meat': { category: 'medium', minDays: 2, maxDays: 4 },
  'Deli': { category: 'medium', minDays: 3, maxDays: 5 },
  'Bakery': { category: 'medium', minDays: 3, maxDays: 5 },
  'Bread': { category: 'medium', minDays: 3, maxDays: 5 },
  'Pantry': { category: 'long', minDays: 30, maxDays: 365 },
  'Canned Goods': { category: 'long', minDays: 30, maxDays: 365 },
  'Grains': { category: 'long', minDays: 30, maxDays: 180 },
  'Pasta': { category: 'long', minDays: 30, maxDays: 365 },
  'Rice': { category: 'long', minDays: 30, maxDays: 365 },
  'Spices': { category: 'long', minDays: 90, maxDays: 365 },
  'Condiments': { category: 'long', minDays: 30, maxDays: 180 },
  'Oils': { category: 'long', minDays: 30, maxDays: 180 },
  'Frozen': { category: 'long', minDays: 30, maxDays: 180 },
  'Snacks': { category: 'long', minDays: 14, maxDays: 90 },
  'Beverages': { category: 'long', minDays: 14, maxDays: 90 },
  'Nuts': { category: 'long', minDays: 14, maxDays: 60 },
  'Baking': { category: 'long', minDays: 30, maxDays: 365 },
}

const DEFAULT_SHELF_LIFE: ShelfLifeEntry = {
  category: 'medium',
  minDays: 4,
  maxDays: 6,
}

export function getShelfLife(category: string): ShelfLifeEntry {
  return SHELF_LIFE[category] ?? DEFAULT_SHELF_LIFE
}

export const GROCERY_CATEGORIES = Object.keys(SHELF_LIFE)
```

**Step 2: Write failing tests for pickup optimizer**

Create `src/__tests__/services/pickupOptimizer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { recommendPickupDay } from '@/services/pickupOptimizer'
import type { DayScore } from '@/types/calendar'
import type { GroceryItem } from '@/types/database'

function makeDayScore(
  dateStr: string,
  finalScore: number,
  tier: 'quick' | 'standard' | 'exploratory' = 'standard'
): DayScore {
  return {
    date: new Date(dateStr),
    finalScore,
    tier,
    signalBreakdown: [],
  }
}

function makeGroceryItem(
  name: string,
  category: string
): Pick<GroceryItem, 'item_name' | 'category'> {
  return { item_name: name, category }
}

describe('recommendPickupDay', () => {
  const weekScores: DayScore[] = [
    makeDayScore('2025-02-17', 80, 'quick'),    // Monday - busy
    makeDayScore('2025-02-18', 50, 'standard'),  // Tuesday
    makeDayScore('2025-02-19', 20, 'exploratory'), // Wednesday - free
    makeDayScore('2025-02-20', 60, 'standard'),  // Thursday
    makeDayScore('2025-02-21', 30, 'exploratory'), // Friday - free
    makeDayScore('2025-02-22', 10, 'exploratory'), // Saturday - free
    makeDayScore('2025-02-23', 15, 'exploratory'), // Sunday - free
  ]

  it('picks the least busy day when no perishables', () => {
    const groceries = [
      makeGroceryItem('Rice', 'Pantry'),
      makeGroceryItem('Canned beans', 'Canned Goods'),
    ]
    const result = recommendPickupDay(weekScores, groceries, [])
    expect(result.day).toBeDefined()
    expect(result.reasoning).toBeDefined()
  })

  it('shifts pickup later when perishables are needed late in the week', () => {
    const groceries = [
      makeGroceryItem('Salmon', 'Seafood'),
      makeGroceryItem('Rice', 'Pantry'),
    ]
    // Salmon needed on Friday
    const mealDates = [
      { category: 'Seafood', plannedDate: new Date('2025-02-21') },
    ]
    const result = recommendPickupDay(weekScores, groceries, mealDates)
    // Should not pick Monday — salmon wouldn't last until Friday
    const pickupDate = result.day
    expect(pickupDate.getTime()).toBeGreaterThanOrEqual(
      new Date('2025-02-19').getTime()
    )
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
```

**Step 3: Run tests — verify they fail**

```bash
npm test -- src/__tests__/services/pickupOptimizer.test.ts
```

Expected: FAIL.

**Step 4: Implement the pickup optimizer**

Create `src/services/pickupOptimizer.ts`:

```typescript
import type { DayScore } from '@/types/calendar'
import type { GroceryItem } from '@/types/database'
import { getShelfLife } from '@/data/ingredientShelfLife'

interface PerishableMealDate {
  category: string
  plannedDate: Date
}

interface PickupRecommendation {
  day: Date
  dayIndex: number
  reasoning: string
  score: number
}

const CALENDAR_WEIGHT = 0.6
const FRESHNESS_WEIGHT = 0.4

export function recommendPickupDay(
  weekScores: DayScore[],
  groceryItems: Pick<GroceryItem, 'item_name' | 'category'>[],
  perishableMealDates: PerishableMealDate[]
): PickupRecommendation {
  if (weekScores.length === 0) {
    return {
      day: new Date(),
      dayIndex: 0,
      reasoning: 'No calendar data available',
      score: 0,
    }
  }

  // Find the shortest shelf life across all perishable items
  const shortestShelfDays = getShortestShelfLife(groceryItems)

  // Find the latest date a perishable item is needed
  const latestPerishableDate = getLatestPerishableDate(perishableMealDates)

  const candidates = weekScores.map((dayScore, index) => {
    // Calendar score: invert stress so low-stress days score high (0-100)
    const calendarScore = 100 - dayScore.finalScore

    // Freshness score: how well does this day work for perishable timing?
    let freshnessScore = 50 // default neutral

    if (latestPerishableDate && shortestShelfDays < 30) {
      const daysBetween = Math.floor(
        (latestPerishableDate.getTime() - dayScore.date.getTime()) /
          (1000 * 60 * 60 * 24)
      )

      if (daysBetween < 0) {
        // Shopping after the item is needed — bad
        freshnessScore = 0
      } else if (daysBetween <= shortestShelfDays) {
        // Item will last — good. Closer to need = fresher = better
        freshnessScore = 100 - (daysBetween / shortestShelfDays) * 50
      } else {
        // Item might not last — penalize
        freshnessScore = Math.max(0, 50 - (daysBetween - shortestShelfDays) * 20)
      }
    }

    const combinedScore =
      calendarScore * CALENDAR_WEIGHT + freshnessScore * FRESHNESS_WEIGHT

    return { dayScore, index, calendarScore, freshnessScore, combinedScore }
  })

  const best = candidates.reduce((a, b) =>
    b.combinedScore > a.combinedScore ? b : a
  )

  const dayName = best.dayScore.date.toLocaleDateString('en-US', {
    weekday: 'long',
  })

  const parts: string[] = []
  if (best.calendarScore > 70) parts.push(`your ${dayName} is relatively free`)
  else if (best.calendarScore > 40) parts.push(`${dayName} has moderate availability`)
  else parts.push(`${dayName} is the best available option`)

  if (shortestShelfDays < 7 && latestPerishableDate) {
    parts.push('keeps perishable ingredients fresh')
  }

  return {
    day: best.dayScore.date,
    dayIndex: best.index,
    reasoning: parts.join(' and '),
    score: best.combinedScore,
  }
}

function getShortestShelfLife(
  items: Pick<GroceryItem, 'item_name' | 'category'>[]
): number {
  if (items.length === 0) return 30 // default: long shelf life

  let shortest = Infinity
  for (const item of items) {
    if (item.category) {
      const shelfLife = getShelfLife(item.category)
      shortest = Math.min(shortest, shelfLife.minDays)
    }
  }

  return shortest === Infinity ? 30 : shortest
}

function getLatestPerishableDate(
  mealDates: PerishableMealDate[]
): Date | null {
  if (mealDates.length === 0) return null

  const perishableDates = mealDates.filter((md) => {
    const shelf = getShelfLife(md.category)
    return shelf.category === 'short' || shelf.category === 'medium'
  })

  if (perishableDates.length === 0) return null

  return perishableDates.reduce((latest, md) =>
    md.plannedDate > latest ? md.plannedDate : latest,
    perishableDates[0].plannedDate
  )
}
```

**Step 5: Run tests — verify they pass**

```bash
npm test -- src/__tests__/services/pickupOptimizer.test.ts
```

Expected: All PASS.

**Step 6: Commit**

```bash
git add src/data/ingredientShelfLife.ts src/services/pickupOptimizer.ts src/__tests__/services/pickupOptimizer.test.ts
git commit -m "feat: add ingredient shelf life data and pickup optimizer"
```

---

## Task 5: Database Migrations

New tables and column additions for Supabase.

**Files:**
- Create: `migrations/20250213_add_calendar_connections.sql`
- Create: `migrations/20250213_add_week_scores.sql`
- Create: `migrations/20250213_add_complexity_tier_columns.sql`

**Step 1: Create calendar_connections migration**

Create `migrations/20250213_add_calendar_connections.sql`:

```sql
-- Calendar OAuth connections
CREATE TABLE IF NOT EXISTS calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_fetched_at TIMESTAMPTZ,
  UNIQUE(user_id, provider)
);

-- RLS policies
ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own calendar connections"
  ON calendar_connections
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

**Step 2: Create week_scores migration**

Create `migrations/20250213_add_week_scores.sql`:

```sql
-- Weekly stress scores and pickup recommendations
CREATE TABLE IF NOT EXISTS week_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_of DATE NOT NULL,
  day_scores JSONB NOT NULL,
  user_adjustments JSONB,
  provider_version TEXT NOT NULL DEFAULT 'v1-time-block',
  recommended_pickup_day TEXT,
  pickup_reasoning TEXT,
  meal_plan_id UUID REFERENCES meal_plans(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS policies
ALTER TABLE week_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own week scores"
  ON week_scores
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for quick lookups
CREATE INDEX idx_week_scores_user_week ON week_scores(user_id, week_of);
```

**Step 3: Create column additions migration**

Create `migrations/20250213_add_complexity_tier_columns.sql`:

```sql
-- Link meal plans to the week score that informed them
ALTER TABLE meal_plans
  ADD COLUMN IF NOT EXISTS week_score_id UUID REFERENCES week_scores(id) ON DELETE SET NULL;

-- Track what complexity tier each recipe was selected for
ALTER TABLE meal_plan_recipes
  ADD COLUMN IF NOT EXISTS complexity_tier TEXT
  CHECK (complexity_tier IS NULL OR complexity_tier IN ('quick', 'standard', 'exploratory'));
```

**Step 4: Commit**

```bash
git add migrations/20250213_add_calendar_connections.sql migrations/20250213_add_week_scores.sql migrations/20250213_add_complexity_tier_columns.sql
git commit -m "feat: add database migrations for calendar integration"
```

---

## Task 6: Update TypeScript Types for New Schema

**Files:**
- Modify: `src/types/database.ts`

**Step 1: Add new types to database.ts**

Add the following types to the end of `src/types/database.ts` (before closing):

```typescript
// Calendar Connection types
export interface CalendarConnection {
  id: string
  user_id: string
  provider: 'google' | 'apple'
  access_token: string
  refresh_token?: string
  token_expires_at?: string
  connected_at: string
  last_fetched_at?: string
}

export interface CalendarConnectionInsert {
  user_id: string
  provider: 'google' | 'apple'
  access_token: string
  refresh_token?: string
  token_expires_at?: string
}

// Week Score types
export interface WeekScore {
  id: string
  user_id: string
  week_of: string
  day_scores: Array<{
    date: string
    finalScore: number
    tier: 'quick' | 'standard' | 'exploratory'
    signalBreakdown: Array<{
      score: number
      reasoning: string
      rawData: Record<string, unknown>
    }>
  }>
  user_adjustments?: Record<string, 'quick' | 'standard' | 'exploratory'>
  provider_version: string
  recommended_pickup_day?: string
  pickup_reasoning?: string
  meal_plan_id?: string
  created_at: string
}

export interface WeekScoreInsert {
  user_id: string
  week_of: string
  day_scores: WeekScore['day_scores']
  user_adjustments?: WeekScore['user_adjustments']
  provider_version?: string
  recommended_pickup_day?: string
  pickup_reasoning?: string
  meal_plan_id?: string
}
```

Also add `week_score_id` to `MealPlan` and `MealPlanInsert`:

In the `MealPlan` interface, add:
```typescript
  week_score_id?: string
```

In the `MealPlanInsert` interface, add:
```typescript
  week_score_id?: string
```

In the `MealPlanRecipe` interface, add:
```typescript
  complexity_tier?: 'quick' | 'standard' | 'exploratory'
```

In the `MealPlanRecipeInsert` interface, add:
```typescript
  complexity_tier?: 'quick' | 'standard' | 'exploratory'
```

**Step 2: Commit**

```bash
git add src/types/database.ts
git commit -m "feat: add TypeScript types for calendar connections and week scores"
```

---

## Task 7: Google Calendar Provider

**Files:**
- Create: `src/services/calendarProviders/google.ts`
- Create: `src/app/api/auth/google-calendar/route.ts` (OAuth callback)
- Create: `src/app/api/auth/google-calendar/callback/route.ts`

**Step 1: Install googleapis**

```bash
cd /Users/cameron/GroceryGo/GroceryGo/grocerygo
npm install googleapis
```

**Step 2: Create Google Calendar provider**

Create `src/services/calendarProviders/google.ts`:

```typescript
import { google } from 'googleapis'
import type { CalendarProvider, CalendarEvent, OAuthTokens } from '@/types/calendar'
import { createClient } from '@/utils/supabase/server'

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly']

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )
}

export class GoogleCalendarProvider implements CalendarProvider {
  async authenticate(userId: string): Promise<OAuthTokens> {
    // Returns existing tokens from DB or throws if not connected
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('calendar_connections')
      .select('access_token, refresh_token, token_expires_at')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .single()

    if (error || !data) {
      throw new Error('Google Calendar not connected')
    }

    // Refresh if expired
    if (data.token_expires_at && new Date(data.token_expires_at) < new Date()) {
      return this.refreshTokens(userId, data.refresh_token)
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? undefined,
      expiresAt: data.token_expires_at ? new Date(data.token_expires_at) : undefined,
    }
  }

  async fetchEvents(startDate: Date, endDate: Date): Promise<CalendarEvent[]> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const tokens = await this.authenticate(user.id)
    const oauth2Client = getOAuth2Client()
    oauth2Client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    })

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    })

    const events = response.data.items ?? []

    return events.map((event): CalendarEvent => ({
      id: event.id ?? '',
      title: event.summary ?? 'Untitled',
      startTime: new Date(event.start?.dateTime ?? event.start?.date ?? ''),
      endTime: new Date(event.end?.dateTime ?? event.end?.date ?? ''),
      isAllDay: !event.start?.dateTime,
      source: 'google',
      metadata: {
        location: event.location ?? undefined,
        description: event.description ?? undefined,
        recurrence: event.recurrence?.join(', ') ?? undefined,
      },
    }))
  }

  async revokeAccess(userId: string): Promise<void> {
    const supabase = await createClient()
    await supabase
      .from('calendar_connections')
      .delete()
      .eq('user_id', userId)
      .eq('provider', 'google')
  }

  getAuthUrl(state: string): string {
    const oauth2Client = getOAuth2Client()
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      state,
      prompt: 'consent',
    })
  }

  private async refreshTokens(userId: string, refreshToken?: string): Promise<OAuthTokens> {
    if (!refreshToken) throw new Error('No refresh token available')

    const oauth2Client = getOAuth2Client()
    oauth2Client.setCredentials({ refresh_token: refreshToken })

    const { credentials } = await oauth2Client.refreshAccessToken()

    const supabase = await createClient()
    await supabase
      .from('calendar_connections')
      .update({
        access_token: credentials.access_token,
        token_expires_at: credentials.expiry_date
          ? new Date(credentials.expiry_date).toISOString()
          : null,
      })
      .eq('user_id', userId)
      .eq('provider', 'google')

    return {
      accessToken: credentials.access_token ?? '',
      refreshToken,
      expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : undefined,
    }
  }
}
```

**Step 3: Create OAuth initiation route**

Create `src/app/api/auth/google-calendar/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { GoogleCalendarProvider } from '@/services/calendarProviders/google'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const provider = new GoogleCalendarProvider()
  const authUrl = provider.getAuthUrl(user.id)

  return NextResponse.redirect(authUrl)
}
```

**Step 4: Create OAuth callback route**

Create `src/app/api/auth/google-calendar/callback/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state') // user_id

  if (!code || !state) {
    return NextResponse.redirect(new URL('/dashboard?error=calendar_auth_failed', request.url))
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )

  try {
    const { tokens } = await oauth2Client.getToken(code)

    const supabase = await createClient()

    await supabase.from('calendar_connections').upsert(
      {
        user_id: state,
        provider: 'google',
        access_token: tokens.access_token ?? '',
        refresh_token: tokens.refresh_token ?? null,
        token_expires_at: tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : null,
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' }
    )

    return NextResponse.redirect(new URL('/week-preview', request.url))
  } catch {
    return NextResponse.redirect(
      new URL('/dashboard?error=calendar_auth_failed', request.url)
    )
  }
}
```

**Step 5: Commit**

```bash
git add src/services/calendarProviders/google.ts src/app/api/auth/google-calendar/route.ts src/app/api/auth/google-calendar/callback/route.ts
git commit -m "feat: add Google Calendar OAuth provider"
```

---

## Task 8: Apple Calendar Provider (CalDAV)

**Files:**
- Create: `src/services/calendarProviders/apple.ts`

**Step 1: Install tsdav (CalDAV client)**

```bash
cd /Users/cameron/GroceryGo/GroceryGo/grocerygo
npm install tsdav
```

**Step 2: Create Apple Calendar provider**

Create `src/services/calendarProviders/apple.ts`:

```typescript
import { createDAVClient } from 'tsdav'
import type { CalendarProvider, CalendarEvent, OAuthTokens } from '@/types/calendar'
import { createClient } from '@/utils/supabase/server'

export class AppleCalendarProvider implements CalendarProvider {
  async authenticate(userId: string): Promise<OAuthTokens> {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('calendar_connections')
      .select('access_token, refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'apple')
      .single()

    if (error || !data) {
      throw new Error('Apple Calendar not connected')
    }

    return {
      accessToken: data.access_token, // app-specific password
      refreshToken: data.refresh_token ?? undefined,
    }
  }

  async fetchEvents(startDate: Date, endDate: Date): Promise<CalendarEvent[]> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data: connection } = await supabase
      .from('calendar_connections')
      .select('access_token, refresh_token')
      .eq('user_id', user.id)
      .eq('provider', 'apple')
      .single()

    if (!connection) throw new Error('Apple Calendar not connected')

    // refresh_token stores the Apple ID email for CalDAV auth
    const appleId = connection.refresh_token ?? ''
    const appPassword = connection.access_token

    const client = await createDAVClient({
      serverUrl: 'https://caldav.icloud.com',
      credentials: {
        username: appleId,
        password: appPassword,
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    })

    const calendars = await client.fetchCalendars()
    const allEvents: CalendarEvent[] = []

    for (const calendar of calendars) {
      const objects = await client.fetchCalendarObjects({
        calendar,
        timeRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        },
      })

      for (const obj of objects) {
        const parsed = parseICSEvent(obj.data, obj.url)
        if (parsed) allEvents.push(parsed)
      }
    }

    return allEvents
  }

  async revokeAccess(userId: string): Promise<void> {
    const supabase = await createClient()
    await supabase
      .from('calendar_connections')
      .delete()
      .eq('user_id', userId)
      .eq('provider', 'apple')
  }
}

function parseICSEvent(icsData: string, url: string): CalendarEvent | null {
  const getValue = (key: string): string | undefined => {
    const regex = new RegExp(`^${key}[^:]*:(.+)$`, 'm')
    const match = icsData.match(regex)
    return match?.[1]?.trim()
  }

  const summary = getValue('SUMMARY')
  const dtstart = getValue('DTSTART')
  const dtend = getValue('DTEND')

  if (!dtstart) return null

  const isAllDay = dtstart.length === 8 // YYYYMMDD format (no time)

  return {
    id: url,
    title: summary ?? 'Untitled',
    startTime: parseICSDate(dtstart),
    endTime: dtend ? parseICSDate(dtend) : parseICSDate(dtstart),
    isAllDay,
    source: 'apple',
    metadata: {
      location: getValue('LOCATION'),
      description: getValue('DESCRIPTION'),
    },
  }
}

function parseICSDate(dateStr: string): Date {
  // Handle YYYYMMDD format
  if (dateStr.length === 8) {
    return new Date(
      `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
    )
  }
  // Handle YYYYMMDDTHHmmssZ format
  const cleaned = dateStr
    .replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6')
  return new Date(cleaned)
}
```

**Step 3: Commit**

```bash
git add src/services/calendarProviders/apple.ts
git commit -m "feat: add Apple Calendar CalDAV provider"
```

---

## Task 9: Calendar Service Facade

Unified entry point that manages both providers.

**Files:**
- Create: `src/services/calendarService.ts`

**Step 1: Create the service**

Create `src/services/calendarService.ts`:

```typescript
import type { CalendarEvent, CalendarSource } from '@/types/calendar'
import { GoogleCalendarProvider } from '@/services/calendarProviders/google'
import { AppleCalendarProvider } from '@/services/calendarProviders/apple'
import { createClient } from '@/utils/supabase/server'

const providers: Record<CalendarSource, GoogleCalendarProvider | AppleCalendarProvider> = {
  google: new GoogleCalendarProvider(),
  apple: new AppleCalendarProvider(),
}

export async function getConnectedProviders(userId: string): Promise<CalendarSource[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('calendar_connections')
    .select('provider')
    .eq('user_id', userId)

  return (data ?? []).map((row) => row.provider as CalendarSource)
}

export async function fetchAllEvents(
  startDate: Date,
  endDate: Date
): Promise<CalendarEvent[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const connected = await getConnectedProviders(user.id)

  if (connected.length === 0) {
    return []
  }

  const eventArrays = await Promise.allSettled(
    connected.map((source) => providers[source].fetchEvents(startDate, endDate))
  )

  const allEvents: CalendarEvent[] = []
  for (const result of eventArrays) {
    if (result.status === 'fulfilled') {
      allEvents.push(...result.value)
    }
  }

  // Update last_fetched_at
  await supabase
    .from('calendar_connections')
    .update({ last_fetched_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .in('provider', connected)

  return allEvents.sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime()
  )
}

export async function disconnectCalendar(
  userId: string,
  source: CalendarSource
): Promise<void> {
  await providers[source].revokeAccess(userId)
}
```

**Step 2: Commit**

```bash
git add src/services/calendarService.ts
git commit -m "feat: add unified calendar service facade"
```

---

## Task 10: Week Preview Server Actions

Server actions for saving/loading week scores.

**Files:**
- Create: `src/app/week-preview/actions.ts`

**Step 1: Create actions**

Create `src/app/week-preview/actions.ts`:

```typescript
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

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const connected = await getConnectedProviders(user.id)
  if (connected.length === 0) {
    return { error: 'No calendar connected', needsCalendar: true }
  }

  const weekOf = getNextWeekStart('Monday')
  const startDate = new Date(weekOf)
  const endDate = new Date(startDate)
  endDate.setDate(startDate.getDate() + 7)

  const events = await fetchAllEvents(startDate, endDate)

  const engine = new DayScoreEngine()
  const scores = engine.scoreWeek(events, startDate)

  return {
    weekOf,
    dayScores: scores.map((s) => ({
      date: s.date.toISOString(),
      finalScore: s.finalScore,
      tier: s.tier,
      reasoning: s.signalBreakdown[0]?.reasoning ?? '',
    })),
    connectedProviders: connected,
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

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const weekScoreData: WeekScoreInsert = {
    user_id: user.id,
    week_of: weekOf,
    day_scores: dayScores.map((s) => ({
      date: s.date.toISOString ? s.date.toISOString() : String(s.date),
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

  if (error) {
    return { error: 'Failed to save week scores' }
  }

  // Build the day complexity map (with user overrides applied)
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const complexityMap: DayComplexityMap = {}
  dayScores.forEach((score, i) => {
    const dayName = dayNames[i]
    complexityMap[dayName] = userAdjustments[dayName] ?? score.tier
  })

  return {
    success: true,
    weekScoreId: weekScore.id,
    complexityMap,
  }
}
```

**Step 2: Commit**

```bash
git add src/app/week-preview/actions.ts
git commit -m "feat: add week preview server actions"
```

---

## Task 11: Week Preview UI

The interactive week preview page.

**Files:**
- Create: `src/app/week-preview/page.tsx`
- Create: `src/app/week-preview/WeekPreviewClient.tsx`

**Step 1: Create server page**

Create `src/app/week-preview/page.tsx`:

```typescript
import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import WeekPreviewClient from './WeekPreviewClient'
import { getWeekPreviewData } from './actions'

export default async function WeekPreviewPage() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  const previewData = await getWeekPreviewData()

  if ('error' in previewData && previewData.needsCalendar) {
    // Show calendar connection prompt
    return (
      <div className="gg-bg-page min-h-screen">
        <div className="gg-container">
          <div className="gg-section text-center py-16">
            <h1 className="gg-heading-page mb-4">Connect Your Calendar</h1>
            <p className="gg-text-subtitle mb-8 max-w-lg mx-auto">
              Connect your calendar so we can tailor meal complexity to your schedule — quick meals on busy days, exploratory cooking when you have time.
            </p>
            <div className="flex justify-center gap-4">
              <a
                href="/api/auth/google-calendar"
                className="gg-btn-primary flex items-center gap-2"
              >
                Connect Google Calendar
              </a>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if ('error' in previewData) {
    redirect('/dashboard')
  }

  return <WeekPreviewClient initialData={previewData} />
}
```

**Step 2: Create client component**

Create `src/app/week-preview/WeekPreviewClient.tsx`:

```typescript
'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { saveWeekScoresAndGenerate } from './actions'
import type { ComplexityTier, DayScore } from '@/types/calendar'

interface DayPreview {
  date: string
  finalScore: number
  tier: ComplexityTier
  reasoning: string
}

interface WeekPreviewData {
  weekOf: string
  dayScores: DayPreview[]
  connectedProviders: string[]
}

const TIER_CONFIG: Record<ComplexityTier, { label: string; color: string; bg: string; description: string }> = {
  quick: {
    label: 'Quick',
    color: 'text-orange-700',
    bg: 'bg-orange-50 border-orange-200',
    description: '< 20 min, minimal effort',
  },
  standard: {
    label: 'Standard',
    color: 'text-blue-700',
    bg: 'bg-blue-50 border-blue-200',
    description: '30-45 min, normal cooking',
  },
  exploratory: {
    label: 'Exploratory',
    color: 'text-green-700',
    bg: 'bg-green-50 border-green-200',
    description: '60+ min, new cuisines & techniques',
  },
}

const TIERS: ComplexityTier[] = ['quick', 'standard', 'exploratory']
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export default function WeekPreviewClient({ initialData }: { initialData: WeekPreviewData }) {
  const router = useRouter()
  const [overrides, setOverrides] = useState<Record<string, ComplexityTier>>({})
  const [loading, setLoading] = useState(false)
  const [expandedDay, setExpandedDay] = useState<number | null>(null)

  const dayScores = initialData.dayScores

  const effectiveTiers = useMemo(() => {
    return dayScores.map((day, i) => ({
      ...day,
      effectiveTier: overrides[DAY_NAMES[i]] ?? day.tier,
      isOverridden: !!overrides[DAY_NAMES[i]],
    }))
  }, [dayScores, overrides])

  const cycleTier = (dayIndex: number) => {
    const dayName = DAY_NAMES[dayIndex]
    const currentTier = effectiveTiers[dayIndex].effectiveTier
    const nextIndex = (TIERS.indexOf(currentTier) + 1) % TIERS.length
    const nextTier = TIERS[nextIndex]

    // If cycling back to original, remove override
    if (nextTier === dayScores[dayIndex].tier) {
      setOverrides((prev) => {
        const next = { ...prev }
        delete next[dayName]
        return next
      })
    } else {
      setOverrides((prev) => ({ ...prev, [dayName]: nextTier }))
    }
  }

  const handleGenerate = async () => {
    setLoading(true)

    const dayScoreObjects: DayScore[] = dayScores.map((d) => ({
      date: new Date(d.date),
      finalScore: d.finalScore,
      tier: d.tier,
      signalBreakdown: [{ score: d.finalScore, reasoning: d.reasoning, rawData: {} }],
    }))

    const result = await saveWeekScoresAndGenerate(
      initialData.weekOf,
      dayScoreObjects,
      overrides,
      null, // pickup day computed later after meal plan exists
      null
    )

    if (result.error) {
      setLoading(false)
      return
    }

    // Navigate to meal plan generation with complexity map
    const params = new URLSearchParams({
      weekScoreId: result.weekScoreId!,
      complexityMap: JSON.stringify(result.complexityMap),
    })
    router.push(`/meal-plan-generate?${params.toString()}`)
  }

  const weekOfDate = new Date(initialData.weekOf)
  const weekLabel = weekOfDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div className="gg-bg-page min-h-screen">
      <div className="gg-container">
        <div className="gg-section">
          <div className="mb-8">
            <Link
              href="/dashboard"
              className="gg-text-body text-sm mb-4 inline-flex items-center gap-2 hover:text-[var(--gg-primary)] transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Dashboard
            </Link>
            <h1 className="gg-heading-page mb-2">Your Week at a Glance</h1>
            <p className="gg-text-subtitle">
              Week of {weekLabel} — click a day to adjust meal complexity
            </p>
          </div>

          {/* Tier Legend */}
          <div className="flex gap-4 mb-6 flex-wrap">
            {TIERS.map((tier) => (
              <div key={tier} className={`px-3 py-1.5 rounded-lg border text-sm ${TIER_CONFIG[tier].bg} ${TIER_CONFIG[tier].color}`}>
                <span className="font-semibold">{TIER_CONFIG[tier].label}</span>
                <span className="ml-1 opacity-75">— {TIER_CONFIG[tier].description}</span>
              </div>
            ))}
          </div>

          {/* Day Cards */}
          <div className="grid grid-cols-1 md:grid-cols-7 gap-3 mb-8">
            {effectiveTiers.map((day, i) => {
              const tierConfig = TIER_CONFIG[day.effectiveTier]
              const isExpanded = expandedDay === i

              return (
                <div
                  key={i}
                  className={`gg-card cursor-pointer transition-all border-2 ${tierConfig.bg} ${
                    day.isOverridden ? 'ring-2 ring-offset-1 ring-[var(--gg-primary)]' : ''
                  }`}
                  onClick={() => cycleTier(i)}
                >
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-600">{DAY_NAMES[i]}</p>
                    <p className="text-xs text-gray-400 mb-2">
                      {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                    <div className={`text-lg font-bold ${tierConfig.color} mb-1`}>
                      {tierConfig.label}
                    </div>
                    <p className="text-xs text-gray-500">{day.reasoning}</p>
                    {day.isOverridden && (
                      <p className="text-xs text-[var(--gg-primary)] mt-1 font-medium">
                        adjusted
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Actions */}
          <div className="flex justify-between items-center">
            <div className="text-sm text-gray-500">
              {Object.keys(overrides).length > 0 && (
                <button
                  onClick={() => setOverrides({})}
                  className="text-[var(--gg-primary)] hover:underline"
                >
                  Reset all adjustments
                </button>
              )}
            </div>
            <button
              onClick={handleGenerate}
              disabled={loading}
              className={`gg-btn-primary flex items-center gap-2 ${
                loading ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Saving...
                </>
              ) : (
                <>
                  Looks Good, Generate Plan
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add src/app/week-preview/page.tsx src/app/week-preview/WeekPreviewClient.tsx
git commit -m "feat: add interactive week preview page"
```

---

## Task 12: Extend Meal Plan Generation with Complexity Tiers

Wire the complexity map into the existing AI generation prompt so recipes match day tiers.

**Files:**
- Modify: `src/app/api/generate-meal-plan/route.ts`
- Modify: `src/app/meal-plan-generate/prompts.ts`
- Modify: `src/app/meal-plan-generate/MealPlanGenerateClient.tsx`
- Modify: `src/app/meal-plan-generate/actions.ts`

**Step 1: Add complexity tier instructions to the prompt**

In `src/app/meal-plan-generate/prompts.ts`, add a new exported function at the end of the file:

```typescript
export function complexityTierPrompt(
  complexityMap: Record<string, string>
): string {
  const entries = Object.entries(complexityMap)
  if (entries.length === 0) return ''

  const dayLines = entries
    .map(([day, tier]) => {
      switch (tier) {
        case 'quick':
          return `- ${day}: QUICK meal — under 20 minutes total, minimal ingredients, simple preparation (e.g., salads, wraps, one-pan meals)`
        case 'exploratory':
          return `- ${day}: EXPLORATORY meal — 60+ minutes OK, try new cuisines or techniques, elaborate recipes encouraged`
        default:
          return `- ${day}: STANDARD meal — 30-45 minutes, normal home cooking`
      }
    })
    .join('\n')

  return `

### Day-Specific Meal Complexity (MANDATORY):
The user's calendar has been analyzed. You MUST match recipe complexity to the specified tier for each day:

${dayLines}

RULES:
- QUICK days: prep_time_minutes + cook_time_minutes MUST be under 20. Use 5 or fewer ingredients. Simple techniques only.
- STANDARD days: prep_time_minutes + cook_time_minutes between 20-45. Normal ingredient counts.
- EXPLORATORY days: prep_time_minutes + cook_time_minutes can be 45+. Use interesting ingredients, new cuisines, or advanced techniques.
- This applies to ALL meals on that day (breakfast, lunch, and dinner).`
}
```

**Step 2: Update the API route to accept and use complexityMap**

In `src/app/api/generate-meal-plan/route.ts`, after the line that destructures `body`:

Add `complexityMap` to the destructured body:
```typescript
const { mealSelection, mealPlanId, distinctRecipeCounts, selectedSlots, complexityMap } = body as {
  mealSelection: MealSelection
  mealPlanId: string
  distinctRecipeCounts?: MealSelection
  selectedSlots?: Array<{ day: string; mealType: string }>
  complexityMap?: Record<string, string>
}
```

Import the new function:
```typescript
import { mealPlanFromSurveyPrompt, complexityTierPrompt } from '@/app/meal-plan-generate/prompts'
```

Add the complexity prompt to `enhancedPrompt`, before the closing backtick of the template literal (right before the final `\``):

```typescript
${complexityMap ? complexityTierPrompt(complexityMap) : ''}
```

**Step 3: Update MealPlanGenerateClient to read complexity map from URL params**

In `src/app/meal-plan-generate/MealPlanGenerateClient.tsx`:

Add to the component props interface:
```typescript
interface MealPlanGenerateClientProps {
  surveyResponse: SurveyResponse
  complexityMap?: Record<string, string>
  weekScoreId?: string
}
```

Update the `handleGenerate` function to pass `complexityMap` through to the action, and the action to forward it to the API. The `complexityMap` and `weekScoreId` should be passed from the page.tsx after reading search params.

**Step 4: Update meal-plan-generate/page.tsx to read search params**

Modify `src/app/meal-plan-generate/page.tsx` to accept `searchParams` and pass them through:

```typescript
import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import MealPlanGenerateClient from './MealPlanGenerateClient'

export default async function MealPlanGeneratePage({
  searchParams,
}: {
  searchParams: Promise<{ complexityMap?: string; weekScoreId?: string }>
}) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  const { data: userData } = await supabase
    .from('users')
    .select('survey_response')
    .eq('user_id', user.id)
    .single()

  if (!userData?.survey_response) {
    redirect('/onboarding')
  }

  const params = await searchParams
  const complexityMap = params.complexityMap
    ? JSON.parse(params.complexityMap)
    : undefined

  return (
    <MealPlanGenerateClient
      surveyResponse={userData.survey_response}
      complexityMap={complexityMap}
      weekScoreId={params.weekScoreId}
    />
  )
}
```

**Step 5: Update actions.ts to forward complexityMap to the API**

In `src/app/meal-plan-generate/actions.ts`, add `complexityMap` as an optional parameter to `generateMealPlanFromPreferences` and include it in the API request body.

**Step 6: Run the app to verify no build errors**

```bash
cd /Users/cameron/GroceryGo/GroceryGo/grocerygo
npm run build
```

Expected: Build succeeds.

**Step 7: Commit**

```bash
git add src/app/api/generate-meal-plan/route.ts src/app/meal-plan-generate/prompts.ts src/app/meal-plan-generate/MealPlanGenerateClient.tsx src/app/meal-plan-generate/page.tsx src/app/meal-plan-generate/actions.ts
git commit -m "feat: wire complexity tiers into meal plan generation"
```

---

## Task 13: Grocery Category Normalization

Add the category enum to the AI prompt and Zod validation so `grocery_items.category` is consistent with the shelf life data.

**Files:**
- Modify: `src/app/meal-plan-generate/prompts.ts`
- Modify: `src/app/schemas/mealPlanSchemas.ts`

**Step 1: Add categories to prompt**

In `src/app/meal-plan-generate/prompts.ts`, import the categories:

```typescript
import { GROCERY_CATEGORIES } from '@/data/ingredientShelfLife'
```

Add to `mealPlanFromSurveyPrompt`, in the Output Format section, after the grocery_list description:

```
12. **Grocery Categories**: Each grocery item MUST include a "category" field from this list: ${GROCERY_CATEGORIES.join(', ')}. Choose the most appropriate category for each item. If unsure, use "Pantry".
```

Update the grocery_list output format example to include category:
```json
"grocery_list": [
  { "item": "Ingredient Name", "quantity": "Total Amount + Unit", "category": "Produce" }
]
```

**Step 2: Update Zod schema**

In `src/app/schemas/mealPlanSchemas.ts`, update `GroceryItemSchema`:

```typescript
import { GROCERY_CATEGORIES } from '@/data/ingredientShelfLife'

export const GroceryItemSchema = z.object({
  item: z.string().min(1).describe('Ingredient name'),
  quantity: z.string().min(1).describe('Total quantity with unit'),
  category: z.string().optional().describe('Grocery category for shelf life tracking'),
})
```

**Step 3: Commit**

```bash
git add src/app/meal-plan-generate/prompts.ts src/app/schemas/mealPlanSchemas.ts
git commit -m "feat: add grocery category normalization for shelf life tracking"
```

---

## Task 14: Pickup Optimizer Integration

Wire the pickup optimizer into the week preview flow so users see a shopping day recommendation.

**Files:**
- Modify: `src/app/week-preview/WeekPreviewClient.tsx`
- Modify: `src/app/week-preview/actions.ts`

**Step 1: Add pickup computation to getWeekPreviewData**

In `src/app/week-preview/actions.ts`, import `recommendPickupDay` and call it after scoring:

```typescript
import { recommendPickupDay } from '@/services/pickupOptimizer'
```

Add to the return value of `getWeekPreviewData`:

```typescript
// Compute initial pickup recommendation (without meal plan data yet)
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
```

**Step 2: Show pickup recommendation in WeekPreviewClient**

Add a section below the day cards in `WeekPreviewClient.tsx` that displays the shopping day recommendation, highlighting which day card is suggested.

**Step 3: Commit**

```bash
git add src/app/week-preview/actions.ts src/app/week-preview/WeekPreviewClient.tsx
git commit -m "feat: integrate pickup optimizer into week preview"
```

---

## Task 15: Instacart Flow Regression Tests

Verify the existing Instacart integration still works with the new pickup day data.

**Files:**
- Create: `src/__tests__/services/instacartFlow.test.ts`

**Step 1: Write tests**

Create `src/__tests__/services/instacartFlow.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { GroceryItem } from '@/types/database'
import type { LineItem } from '@/types/instacart'

// Test that grocery items with the new category field still convert correctly
// to Instacart line items (the category field should be ignored by Instacart conversion)
describe('Instacart flow compatibility', () => {
  it('grocery items with category field convert to valid Instacart line items', () => {
    const groceryItem: GroceryItem = {
      id: 'gi-1',
      meal_plan_id: 'mp-1',
      item_name: 'Salmon fillet',
      quantity: 1,
      unit: 'lb',
      category: 'Seafood', // new field
      estimated_price: 12.99,
      purchased: false,
    }

    // Simulate the conversion that happens in the Instacart integration
    const lineItem: LineItem = {
      name: groceryItem.item_name,
      quantity: groceryItem.quantity ?? 1,
      unit: groceryItem.unit ?? 'each',
      display_text: `${groceryItem.quantity ?? 1} ${groceryItem.unit ?? 'each'} ${groceryItem.item_name}`,
      line_item_measurements: [
        { quantity: groceryItem.quantity ?? 1, unit: groceryItem.unit ?? 'each' },
      ],
      filters: { brand_filters: [], health_filters: [] },
    }

    expect(lineItem.name).toBe('Salmon fillet')
    expect(lineItem.quantity).toBe(1)
    expect(lineItem.unit).toBe('lb')
  })

  it('grocery items without category still work', () => {
    const groceryItem: GroceryItem = {
      id: 'gi-2',
      meal_plan_id: 'mp-1',
      item_name: 'Rice',
      quantity: 2,
      unit: 'cups',
      purchased: false,
    }

    const lineItem: LineItem = {
      name: groceryItem.item_name,
      quantity: groceryItem.quantity ?? 1,
      unit: groceryItem.unit ?? 'each',
      display_text: `${groceryItem.quantity ?? 1} ${groceryItem.unit ?? 'each'} ${groceryItem.item_name}`,
      line_item_measurements: [
        { quantity: groceryItem.quantity ?? 1, unit: groceryItem.unit ?? 'each' },
      ],
      filters: { brand_filters: [], health_filters: [] },
    }

    expect(lineItem.name).toBe('Rice')
  })
})
```

**Step 2: Run tests**

```bash
npm test -- src/__tests__/services/instacartFlow.test.ts
```

Expected: All PASS.

**Step 3: Commit**

```bash
git add src/__tests__/services/instacartFlow.test.ts
git commit -m "test: add Instacart flow regression tests for category compatibility"
```

---

## Task 16: Dashboard Navigation Update

Add a "Plan with Calendar" entry point from the dashboard.

**Files:**
- Modify: `src/app/dashboard/DashboardClient.tsx`

**Step 1: Add calendar-aware generation button**

In `DashboardClient.tsx`, alongside the existing "Generate Meal Plan" button/link, add a second option:

```tsx
<Link
  href="/week-preview"
  className="gg-btn-outline flex items-center gap-2"
>
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
  Plan with Calendar
</Link>
```

**Step 2: Commit**

```bash
git add src/app/dashboard/DashboardClient.tsx
git commit -m "feat: add calendar-aware plan button to dashboard"
```

---

## Task 17: Run Full Test Suite and Verify Build

**Step 1: Run all unit tests**

```bash
cd /Users/cameron/GroceryGo/GroceryGo/grocerygo
npm test
```

Expected: All tests pass.

**Step 2: Run build**

```bash
npm run build
```

Expected: Build succeeds with no type errors.

**Step 3: Fix any issues found**

If tests or build fail, fix issues and re-run.

**Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve build/test issues from calendar integration"
```
