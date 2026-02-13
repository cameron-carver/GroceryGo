'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { saveWeekScoresAndGenerate } from './actions'
import type { ComplexityTier, DayScore } from '@/types/calendar'

interface DayScoreData {
  date: string
  finalScore: number
  tier: ComplexityTier
  reasoning: string
}

interface WeekPreviewData {
  weekOf: string
  dayScores: DayScoreData[]
  connectedProviders: string[]
  pickupRecommendation: {
    dayIndex: number
    reasoning: string
  }
}

interface WeekPreviewClientProps {
  initialData: WeekPreviewData
}

const tierConfig: Record<ComplexityTier, { label: string; color: string; bgColor: string; ringColor: string }> = {
  quick: {
    label: 'Quick',
    color: 'text-orange-700',
    bgColor: 'bg-orange-50 border-orange-200',
    ringColor: 'ring-orange-400',
  },
  standard: {
    label: 'Standard',
    color: 'text-blue-700',
    bgColor: 'bg-blue-50 border-blue-200',
    ringColor: 'ring-blue-400',
  },
  exploratory: {
    label: 'Exploratory',
    color: 'text-green-700',
    bgColor: 'bg-green-50 border-green-200',
    ringColor: 'ring-green-400',
  },
}

const tierCycle: ComplexityTier[] = ['quick', 'standard', 'exploratory']

const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function formatDate(isoDate: string): string {
  const date = new Date(isoDate)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function WeekPreviewClient({ initialData }: WeekPreviewClientProps) {
  const router = useRouter()
  const [overrides, setOverrides] = useState<Record<string, ComplexityTier>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleDayClick = (dayName: string, currentTier: ComplexityTier) => {
    const currentIndex = tierCycle.indexOf(currentTier)
    const nextTier = tierCycle[(currentIndex + 1) % tierCycle.length]

    setOverrides((prev) => {
      const originalTier = initialData.dayScores[dayNames.indexOf(dayName)]?.tier
      // If cycling back to original, remove the override
      if (nextTier === originalTier) {
        const updated = { ...prev }
        delete updated[dayName]
        return updated
      }
      return { ...prev, [dayName]: nextTier }
    })
  }

  const resetOverrides = () => {
    setOverrides({})
  }

  const getEffectiveTier = (dayIndex: number): ComplexityTier => {
    const dayName = dayNames[dayIndex]
    return overrides[dayName] ?? initialData.dayScores[dayIndex]?.tier ?? 'standard'
  }

  const hasOverrides = Object.keys(overrides).length > 0

  const handleGenerate = async () => {
    setLoading(true)
    setError('')

    try {
      const dayScores: DayScore[] = initialData.dayScores.map((ds) => ({
        date: new Date(ds.date),
        finalScore: ds.finalScore,
        tier: ds.tier,
        signalBreakdown: [{ score: ds.finalScore, reasoning: ds.reasoning, rawData: {} }],
      }))

      const pickupDayName = dayNames[initialData.pickupRecommendation.dayIndex] ?? null

      const result = await saveWeekScoresAndGenerate(
        initialData.weekOf,
        dayScores,
        overrides,
        pickupDayName,
        initialData.pickupRecommendation.reasoning
      )

      if ('error' in result && result.error) {
        setError(result.error)
        setLoading(false)
        return
      }

      if ('success' in result && result.success) {
        const params = new URLSearchParams()
        if (result.weekScoreId) params.set('weekScoreId', result.weekScoreId)
        if (result.complexityMap) params.set('complexityMap', JSON.stringify(result.complexityMap))
        router.push(`/meal-plan-generate?${params.toString()}`)
      }
    } catch (err) {
      console.error('Generation error:', err)
      setError('An unexpected error occurred. Please try again.')
      setLoading(false)
    }
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
            <h1 className="gg-heading-page mb-2">Week Preview</h1>
            <p className="gg-text-subtitle">
              Based on your calendar, here is the recommended meal complexity for each day. Click a day to adjust.
            </p>
          </div>

          {/* Day Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 mb-8">
            {initialData.dayScores.map((dayScore, index) => {
              const dayName = dayNames[index]
              const effectiveTier = getEffectiveTier(index)
              const isOverridden = dayName in overrides
              const config = tierConfig[effectiveTier]

              return (
                <button
                  key={dayName}
                  onClick={() => handleDayClick(dayName, effectiveTier)}
                  className={`gg-card border text-left transition-all cursor-pointer hover:shadow-md ${config.bgColor} ${
                    isOverridden ? `ring-2 ${config.ringColor}` : ''
                  }`}
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold text-gray-900">{dayName}</span>
                    <span className="text-xs text-gray-500">{formatDate(dayScore.date)}</span>
                    <span className={`text-sm font-bold mt-1 ${config.color}`}>
                      {config.label}
                    </span>
                    <span className="text-xs text-gray-600 line-clamp-2 mt-1">
                      {dayScore.reasoning}
                    </span>
                    {isOverridden && (
                      <span className="text-xs font-medium text-gray-500 mt-1 italic">
                        adjusted
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Reset Overrides */}
          {hasOverrides && (
            <div className="mb-6 flex justify-center">
              <button
                onClick={resetOverrides}
                className="gg-btn-outline text-sm"
              >
                Reset all adjustments
              </button>
            </div>
          )}

          {/* Pickup Recommendation */}
          <div className="gg-card mb-8 bg-blue-50 border-blue-200">
            <div className="flex gap-3">
              <svg className="h-6 w-6 text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-blue-900 mb-1">
                  Recommended Pickup Day: {dayNames[initialData.pickupRecommendation.dayIndex] ?? 'N/A'}
                </p>
                <p className="text-sm text-blue-800">
                  {initialData.pickupRecommendation.reasoning}
                </p>
              </div>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800">
                <span className="font-semibold">Error: </span>
                {error}
              </p>
            </div>
          )}

          {/* Generate Button */}
          <div className="flex justify-center">
            <button
              onClick={handleGenerate}
              disabled={loading}
              className={`gg-btn-primary flex items-center justify-center gap-2 px-8 py-3 ${
                loading ? 'opacity-50 cursor-not-allowed' : ''
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
                  Saving &amp; Generating...
                </>
              ) : (
                <>
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Looks good, generate plan
                </>
              )}
            </button>
          </div>

          {/* Connected Providers Info */}
          <div className="mt-8 text-center">
            <p className="text-xs text-gray-400">
              Connected calendars: {initialData.connectedProviders.join(', ')}
            </p>
          </div>

        </div>
      </div>
    </div>
  )
}
