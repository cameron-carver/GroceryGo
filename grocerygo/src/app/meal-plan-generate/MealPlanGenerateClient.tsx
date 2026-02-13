'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  generateMealPlanFromPreferences,
  replaceExistingMealPlan,
  type GenerateMealPlanResponse,
  type GenerateMealPlanConflict,
  type GenerateMealPlanError
} from '@/app/meal-plan-generate/actions'
import { getNextWeekStart } from '@/utils/mealPlanDates'
import type { SurveyResponse } from '@/types/database'

const daysOfWeek = [
  { short: 'Mon', full: 'Monday' },
  { short: 'Tue', full: 'Tuesday' },
  { short: 'Wed', full: 'Wednesday' },
  { short: 'Thu', full: 'Thursday' },
  { short: 'Fri', full: 'Friday' },
  { short: 'Sat', full: 'Saturday' },
  { short: 'Sun', full: 'Sunday' },
]

type MealType = 'breakfast' | 'lunch' | 'dinner'

interface MealSelections {
  [key: string]: {
    breakfast: boolean
    lunch: boolean
    dinner: boolean
  }
}

interface DistinctCounts {
  breakfast: number
  lunch: number
  dinner: number
}

interface MealPlanGenerateClientProps {
  surveyResponse: SurveyResponse
  complexityMap?: Record<string, string>
  weekScoreId?: string
}

function isErrorResponse(response: GenerateMealPlanResponse): response is GenerateMealPlanError {
  return 'error' in response && !('conflict' in response) && !('success' in response && response.success)
}

function parseLunchPreference(preference?: string, totalSlots?: number) {
  if (!preference || !totalSlots || totalSlots === 0) return undefined

  const numberMatch = preference.match(/\d+/)
  if (!numberMatch) return undefined

  const parsed = parseInt(numberMatch[0], 10)
  if (Number.isNaN(parsed) || parsed <= 0) return undefined

  return Math.min(parsed, totalSlots)
}

function deriveBaseDistinct(totalSlots: number, leftoverPreference?: string) {
  if (totalSlots === 0) return 0

  switch (leftoverPreference) {
    case 'Prefer unique meals every time':
      return totalSlots
    case 'Happy to eat leftovers once more':
      return Math.max(1, Math.ceil(totalSlots / 2))
    case 'Comfortable repeating meals multiple times':
      return Math.max(1, Math.ceil(totalSlots / 3))
    default:
      return Math.max(1, Math.ceil(totalSlots / 2))
  }
}

function clampDistinctCounts(
  counts: DistinctCounts,
  totals: { breakfast: number; lunch: number; dinner: number }
): DistinctCounts {
  return {
    breakfast: Math.min(Math.max(counts.breakfast, totals.breakfast === 0 ? 0 : 1), Math.max(totals.breakfast, 0)),
    lunch: Math.min(Math.max(counts.lunch, totals.lunch === 0 ? 0 : 1), Math.max(totals.lunch, 0)),
    dinner: Math.min(Math.max(counts.dinner, totals.dinner === 0 ? 0 : 1), Math.max(totals.dinner, 0))
  }
}

export default function MealPlanGenerateClient({ surveyResponse, complexityMap, weekScoreId }: MealPlanGenerateClientProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [showReplaceDialog, setShowReplaceDialog] = useState(false)
  const [conflictData, setConflictData] = useState<Pick<GenerateMealPlanConflict, 'existingPlanId' | 'weekOf'> | null>(null)

  // Initialize with all meals selected
  const [selections, setSelections] = useState<MealSelections>(
    daysOfWeek.reduce((acc, day) => ({
      ...acc,
      [day.full]: { breakfast: true, lunch: true, dinner: true }
    }), {})
  )

  const leftoverPreference = (surveyResponse?.['12'] ?? surveyResponse?.[12]) as string | undefined
  const lunchPreference = (surveyResponse?.['13'] ?? surveyResponse?.[13]) as string | undefined

  const initialTotals = useMemo(
    () => ({
      breakfast: daysOfWeek.length,
      lunch: daysOfWeek.length,
      dinner: daysOfWeek.length
    }),
    []
  )

  const [distinctCounts, setDistinctCounts] = useState<DistinctCounts>(() => {
    const baseCounts: DistinctCounts = {
      breakfast: deriveBaseDistinct(initialTotals.breakfast, leftoverPreference),
      lunch: deriveBaseDistinct(initialTotals.lunch, leftoverPreference),
      dinner: deriveBaseDistinct(initialTotals.dinner, leftoverPreference)
    }

    const parsedLunch = parseLunchPreference(lunchPreference, initialTotals.lunch)
    if (parsedLunch !== undefined) {
      baseCounts.lunch = Math.max(1, parsedLunch)
    }

    return clampDistinctCounts(baseCounts, initialTotals)
  })

  const toggleMeal = (day: string, mealType: MealType) => {
    setSelections(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [mealType]: !prev[day][mealType]
      }
    }))
  }

  const toggleAllForDay = (day: string) => {
    const allSelected = selections[day].breakfast && selections[day].lunch && selections[day].dinner
    setSelections(prev => ({
      ...prev,
      [day]: {
        breakfast: !allSelected,
        lunch: !allSelected,
        dinner: !allSelected
      }
    }))
  }

  const toggleAllForMealType = (mealType: MealType) => {
    const allSelected = daysOfWeek.every(day => selections[day.full][mealType])
    setSelections(prev => {
      const newSelections = { ...prev }
      daysOfWeek.forEach(day => {
        newSelections[day.full] = {
          ...newSelections[day.full],
          [mealType]: !allSelected
        }
      })
      return newSelections
    })
  }

  const totals = useMemo(() => {
    let breakfast = 0
    let lunch = 0
    let dinner = 0

    Object.values(selections).forEach(day => {
      if (day.breakfast) breakfast += 1
      if (day.lunch) lunch += 1
      if (day.dinner) dinner += 1
    })

    return {
      breakfast,
      lunch,
      dinner,
      total: breakfast + lunch + dinner
    }
  }, [selections])

  const selectedSlots = useMemo(
    () =>
      daysOfWeek.flatMap((day) =>
        (['breakfast', 'lunch', 'dinner'] as MealType[]).reduce<Array<{ day: string; mealType: MealType }>>(
          (acc, mealType) => {
            if (selections[day.full][mealType]) {
              acc.push({ day: day.full, mealType })
            }
            return acc
          },
          []
        )
      ),
    [selections]
  )

  useEffect(() => {
    setDistinctCounts(prev =>
      clampDistinctCounts(prev, {
        breakfast: totals.breakfast,
        lunch: totals.lunch,
        dinner: totals.dinner
      })
    )
  }, [totals.breakfast, totals.lunch, totals.dinner])

  const updateDistinctCount = (mealType: MealType, value: number) => {
    setDistinctCounts(prev => {
      const updated = { ...prev, [mealType]: value }
      return clampDistinctCounts(updated, {
        breakfast: totals.breakfast,
        lunch: totals.lunch,
        dinner: totals.dinner
      })
    })
  }

  const handleGenerate = async () => {
    if (totals.total === 0) {
      setError('Please select at least one meal to generate')
      return
    }

    setLoading(true)
    setError('')
    setSuccess(false)

    try {
      // Get next Monday as the week start
      // TODO: Make this configurable via user settings in the future
      const weekOf = getNextWeekStart('Monday')

      const result = await generateMealPlanFromPreferences(
        weekOf,
        {
          breakfast: totals.breakfast,
          lunch: totals.lunch,
          dinner: totals.dinner
        },
        distinctCounts,
        selectedSlots,
        complexityMap
      )

      // Check if there's a conflict (existing meal plan)
      if ('conflict' in result && result.conflict) {
        setConflictData({
          existingPlanId: result.existingPlanId,
          weekOf: result.weekOf
        })
        setShowReplaceDialog(true)
        setLoading(false)
        return
      }

      if (isErrorResponse(result)) {
        const { error: message, needsSurvey } = result
        setError(message)
        if (needsSurvey) {
          setTimeout(() => router.push('/onboarding'), 2000)
        }
        setLoading(false)
      } else if ('success' in result && result.success) {
        // Redirect to streaming generation page
        router.push(`/meal-plan/generating/${result.mealPlanId}`)
      } else {
        setError('Failed to create meal plan. Please try again.')
        setLoading(false)
      }
    } catch (err) {
      console.error('Generation error:', err)
      setError('An unexpected error occurred. Please try again.')
      setLoading(false)
    }
  }

  const handleReplace = async () => {
    if (!conflictData) return

    setLoading(true)
    setError('')
    setSuccess(false)
    setShowReplaceDialog(false)

    try {
      const result = await replaceExistingMealPlan(
        conflictData.existingPlanId,
        conflictData.weekOf,
        {
          breakfast: totals.breakfast,
          lunch: totals.lunch,
          dinner: totals.dinner
        },
        distinctCounts,
        selectedSlots,
        complexityMap
      )

      if (isErrorResponse(result)) {
        const { error: message, needsSurvey } = result
        setError(message)
        if (needsSurvey) {
          setTimeout(() => router.push('/onboarding'), 2000)
        }
        setLoading(false)
      } else if ('success' in result && result.success) {
        // Redirect to streaming generation page
        router.push(`/meal-plan/generating/${result.mealPlanId}`)
      } else {
        setError('Failed to create meal plan. Please try again.')
        setLoading(false)
      }
    } catch (err) {
      console.error('Replacement error:', err)
      setError('An unexpected error occurred. Please try again.')
      setLoading(false)
    }
  }

  const handleCancelReplace = () => {
    setShowReplaceDialog(false)
    setConflictData(null)
  }

  return (
    <div className="gg-bg-page min-h-screen">
      <div className="gg-container">
        <div className="gg-section">
          
          {/* Header */}
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
            <h1 className="gg-heading-page mb-2">Generate Meal Plan</h1>
            <p className="gg-text-subtitle">
              Select the meals you&apos;d like us to plan for you this week
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            
            {/* Main Content - Meal Selector */}
            <div className="lg:col-span-2">
              <div className="gg-card">
                <h2 className="gg-heading-section mb-6">Select Your Meals</h2>

                {/* Meal Type Headers */}
                <div className="flex items-center gap-4 mb-3 px-3">
                  <div className="w-24"></div>
                  <div className="flex items-center gap-6 flex-1">
                    <button
                      onClick={() => toggleAllForMealType('breakfast')}
                      className="text-center text-sm font-semibold text-gray-700 hover:text-[var(--gg-primary)] transition-colors flex-1"
                    >
                      🍳 Breakfast
                    </button>
                    <button
                      onClick={() => toggleAllForMealType('lunch')}
                      className="text-center text-sm font-semibold text-gray-700 hover:text-[var(--gg-primary)] transition-colors flex-1"
                    >
                      🥗 Lunch
                    </button>
                    <button
                      onClick={() => toggleAllForMealType('dinner')}
                      className="text-center text-sm font-semibold text-gray-700 hover:text-[var(--gg-primary)] transition-colors flex-1"
                    >
                      🍽️ Dinner
                    </button>
                  </div>
                </div>

                {/* Day Rows */}
                <div className="space-y-2">
                  {daysOfWeek.map((day) => (
                    <div 
                      key={day.full}
                      className="flex items-center gap-4 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <button
                        onClick={() => toggleAllForDay(day.full)}
                        className="text-sm font-medium text-gray-900 text-left hover:text-[var(--gg-primary)] transition-colors w-24"
                      >
                        {day.full}
                      </button>
                      
                      <div className="flex items-center gap-6 flex-1">
                        {(['breakfast', 'lunch', 'dinner'] as MealType[]).map((mealType) => (
                          <label
                            key={mealType}
                            className="flex items-center justify-center cursor-pointer flex-1"
                          >
                            <input
                              type="checkbox"
                              checked={selections[day.full][mealType]}
                              onChange={() => toggleMeal(day.full, mealType)}
                              className="gg-checkbox"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Quick Actions */}
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <p className="text-sm text-gray-600 mb-3">Quick actions:</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        const allSelected = Object.values(selections).every(
                          day => day.breakfast && day.lunch && day.dinner
                        )
                        setSelections(
                          daysOfWeek.reduce((acc, day) => ({
                            ...acc,
                            [day.full]: { breakfast: !allSelected, lunch: !allSelected, dinner: !allSelected }
                          }), {})
                        )
                      }}
                      className="gg-btn-outline text-sm py-2 px-4"
                    >
                      Toggle All
                    </button>
                    <button
                      onClick={() => {
                        setSelections(
                          daysOfWeek.reduce((acc, day) => ({
                            ...acc,
                            [day.full]: { 
                              breakfast: false, 
                              lunch: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(day.full), 
                              dinner: false 
                            }
                          }), {})
                        )
                      }}
                      className="gg-btn-outline text-sm py-2 px-4"
                    >
                      Weekday Lunches Only
                    </button>
                    <button
                      onClick={() => {
                        setSelections(
                          daysOfWeek.reduce((acc, day) => ({
                            ...acc,
                            [day.full]: { breakfast: false, lunch: false, dinner: true }
                          }), {})
                        )
                      }}
                      className="gg-btn-outline text-sm py-2 px-4"
                    >
                      Dinners Only
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Sidebar - Summary & Generate */}
            <div className="space-y-6">
              
              {/* Summary Card */}
              <div className="gg-card">
                <h2 className="gg-heading-section mb-6">Meal Summary</h2>
                <div className="space-y-4">
                  <div className="flex items-center justify-between py-3 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">🍳</span>
                      <span className="gg-text-body">Breakfasts</span>
                    </div>
                    <span className="text-2xl font-bold text-[var(--gg-primary)]">
                      {totals.breakfast}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-3 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">🥗</span>
                      <span className="gg-text-body">Lunches</span>
                    </div>
                    <span className="text-2xl font-bold text-[var(--gg-primary)]">
                      {totals.lunch}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-3 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">🍽️</span>
                      <span className="gg-text-body">Dinners</span>
                    </div>
                    <span className="text-2xl font-bold text-[var(--gg-primary)]">
                      {totals.dinner}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-3 bg-opacity-10 rounded-lg px-4">
                    <span className="font-semibold text-gray-900 text-2xl">Total Meals</span>
                    <span className="text-3xl font-bold text-[var(--gg-primary)]">
                      {totals.total}
                    </span>
                  </div>
                </div>
              </div>

              {/* Distinct Recipe Controls */}
              <div className="gg-card">
                <h2 className="gg-heading-section mb-4">Unique Recipe Targets</h2>
                <p className="text-sm text-gray-600 mb-4">
                  Prefer to cook once and eat twice? Set the number of different recipes you want to cook for each meal type. We&apos;ll duplicate recipes across the selected slots when this number is lower.
                </p>
                <div className="space-y-4">
                  {(['breakfast', 'lunch', 'dinner'] as MealType[]).map((mealType) => (
                    <div key={mealType} className="flex flex-col gap-2 border border-gray-100 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">
                            {mealType === 'breakfast' ? '🍳' : mealType === 'lunch' ? '🥗' : '🍽️'}
                          </span>
                          <span className="gg-text-body capitalize">{mealType}</span>
                        </div>
                        <span className="text-sm text-gray-500">
                          {totals[mealType]} selected slot{totals[mealType] === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-gray-600 flex-1">
                          Unique recipes
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => updateDistinctCount(mealType, distinctCounts[mealType] - 1)}
                            disabled={distinctCounts[mealType] <= (totals[mealType] === 0 ? 0 : 1)}
                            className="h-9 w-9 flex items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min={totals[mealType] === 0 ? 0 : 1}
                            max={Math.max(totals[mealType], totals[mealType] === 0 ? 0 : 1)}
                            value={distinctCounts[mealType]}
                            onChange={(event) => {
                              const nextValue = parseInt(event.target.value, 10)
                              if (Number.isNaN(nextValue)) return
                              updateDistinctCount(mealType, nextValue)
                            }}
                            className="w-16 rounded-lg border border-gray-200 px-2 py-2 text-center text-sm focus:border-[var(--gg-primary)] focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => updateDistinctCount(mealType, distinctCounts[mealType] + 1)}
                            disabled={distinctCounts[mealType] >= totals[mealType]}
                            className="h-9 w-9 flex items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Generate Button */}
              <button
                onClick={handleGenerate}
                disabled={loading || totals.total === 0}
                className={`gg-btn-primary w-full flex items-center justify-center gap-2 ${
                  (loading || totals.total === 0) ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                {loading ? (
                  <>
                    <svg 
                      className="animate-spin h-5 w-5" 
                      xmlns="http://www.w3.org/2000/svg" 
                      fill="none" 
                      viewBox="0 0 24 24"
                    >
                      <circle 
                        className="opacity-25" 
                        cx="12" 
                        cy="12" 
                        r="10" 
                        stroke="currentColor" 
                        strokeWidth="4"
                      />
                      <path 
                        className="opacity-75" 
                        fill="currentColor" 
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Generating Your Meal Plan...
                  </>
                ) : (
                  <>
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Generate Meal Plan
                  </>
                )}
              </button>

              {/* Info Card */}
              <div className="gg-card bg-blue-50 border-blue-200">
                <div className="flex gap-3">
                  <svg className="h-6 w-6 text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold text-blue-900 mb-1">
                      Personalized for You
                    </p>
                    <p className="text-sm text-blue-800">
                      We&apos;ll use your survey preferences to create a customized meal plan that fits your dietary needs, budget, and cooking style.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800">
                <span className="font-semibold">Error: </span>
                {error}
              </p>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="mt-6 p-6 bg-green-50 border border-green-200 rounded-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                    <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-green-900 font-semibold text-lg">
                      Meal Plan Created Successfully!
                    </p>
                    <p className="text-green-800 text-sm mt-1">
                      Your {totals.total} meals are ready to view with recipes and shopping list.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => router.push('/dashboard')}
                  className="gg-btn-primary"
                >
                  View Dashboard
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Replace Meal Plan Dialog */}
      {showReplaceDialog && (
        <>
          <div className="fixed inset-0 z-50 bg-black opacity-30" onClick={handleCancelReplace} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 pointer-events-auto">
              <h3 className="text-xl font-bold text-gray-900 mb-4">
                Meal Plan Already Exists
              </h3>
              <p className="text-gray-600 mb-6">
                You already have a meal plan for this week. Would you like to replace it with a new one?
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={handleCancelReplace}
                  disabled={loading}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReplace}
                  disabled={loading}
                  className="gg-btn-primary disabled:opacity-50"
                >
                  {loading ? 'Replacing...' : 'Replace Meal Plan'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

