'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import RecipeCardSkeleton from '@/components/RecipeCardSkeleton'
import { saveGeneratedRecipes } from '../actions'
import type { SurveyResponse } from '@/types/database'

type SurveySnapshotData = SurveyResponse & {
  meal_selection?: {
    breakfast: number
    lunch: number
    dinner: number
  }
  distinct_recipe_counts?: {
    breakfast: number
    lunch: number
    dinner: number
  }
  selected_slots?: SelectedSlot[]
}

interface GeneratingViewProps {
  mealPlanId: string
  weekOf: string
  totalMeals: number
  surveySnapshot?: SurveySnapshotData
}

interface RecipeData {
  id?: string
  name: string
  mealType?: string
  ingredients: Array<{
    item: string
    quantity: string
  }>
  steps: string[]
  description?: string
  prep_time_minutes?: number
  cook_time_minutes?: number
  servings?: number
  difficulty?: 'beginner' | 'intermediate' | 'advanced'
  cuisine_type?: string[]
  dietary_tags?: string[]
  flavor_profile?: string[]
  estimated_cost?: number
  nutrition_info?: {
    calories?: number
    protein?: number
    carbs?: number
    fat?: number
  }
}

interface SelectedSlot {
  day: string
  mealType: string
}

interface ScheduleEntry {
  slotLabel: string
  day: string
  mealType: string
  recipeId: string
  portionMultiplier: number
}

function getScheduledDay(weekOf: string, index: number) {
  const startDate = new Date(weekOf)
  if (Number.isNaN(startDate.getTime())) {
    return 'Unscheduled'
  }

  const mealDate = new Date(startDate)
  mealDate.setDate(startDate.getDate() + (index % 7))

  return mealDate.toLocaleDateString('en-US', {
    weekday: 'long'
  })
}

export default function GeneratingView({
  mealPlanId,
  weekOf,
  totalMeals,
  surveySnapshot
}: GeneratingViewProps) {
  const router = useRouter()
  const [recipes, setRecipes] = useState<(RecipeData | null)[]>(
    Array(totalMeals).fill(null)
  )
  const [currentRecipeIndex, setCurrentRecipeIndex] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recipeCountRef = useRef(0)
  const hasStartedGenerationRef = useRef(false)

  useEffect(() => {
    if (!hasStartedGenerationRef.current) {
      hasStartedGenerationRef.current = true
      generateMealPlan()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tryParsePartialRecipes = (buffer: string) => {
    try {
      let jsonContent = buffer
      const jsonMatch = buffer.match(/```json\s*([\s\S]*?)(?:```|$)/)
      if (jsonMatch) {
        jsonContent = jsonMatch[1]
      }

      const recipesMatch = jsonContent.match(/"recipes"\s*:\s*\[([\s\S]*)/)
      if (!recipesMatch) return

      const recipesContent = recipesMatch[1]
      let depth = 0
      let inString = false
      let escapeNext = false
      const recipeObjects: string[] = []
      let currentObj = ''
      let inRecipeObject = false

      for (let i = 0; i < recipesContent.length; i++) {
        const char = recipesContent[i]

        if (escapeNext) {
          escapeNext = false
          currentObj += char
          continue
        }

        if (char === '\\') {
          escapeNext = true
          currentObj += char
          continue
        }

        if (char === '"') {
          inString = !inString
          currentObj += char
          continue
        }

        if (inString) {
          currentObj += char
          continue
        }

        if (char === '{') {
          depth += 1
          if (depth === 1) {
            inRecipeObject = true
            currentObj = '{'
          } else {
            currentObj += char
          }
        } else if (char === '}') {
          currentObj += char
          depth -= 1
          if (depth === 0 && inRecipeObject) {
            recipeObjects.push(currentObj)
            currentObj = ''
            inRecipeObject = false
          }
        } else if (inRecipeObject) {
          currentObj += char
        }
      }

      if (recipeObjects.length > recipeCountRef.current) {
        const newRecipeObjects = recipeObjects.slice(recipeCountRef.current)
        const newParsedRecipes: RecipeData[] = []

        for (const recipeStr of newRecipeObjects) {
          try {
            const recipe = JSON.parse(recipeStr) as RecipeData
            if (recipe.name && recipe.ingredients && recipe.steps) {
              newParsedRecipes.push(recipe)
            }
          } catch {
            break
          }
        }

        if (newParsedRecipes.length > 0) {
          const startIndex = recipeCountRef.current
          setRecipes((prev) => {
            const next = [...prev]
            newParsedRecipes.forEach((recipe, idx) => {
              const index = startIndex + idx
              if (index < totalMeals && next[index] === null) {
                next[index] = recipe
              }
            })
            return next
          })

          recipeCountRef.current = startIndex + newParsedRecipes.length
          setCurrentRecipeIndex(recipeCountRef.current)
        }
      }
    } catch {
      // ignore partial parse errors during streaming
    }
  }

  const generateMealPlan = async () => {
    try {
      const mealSelection = surveySnapshot?.meal_selection || {
        breakfast: Math.floor(totalMeals / 3),
        lunch: Math.floor(totalMeals / 3),
        dinner: totalMeals - 2 * Math.floor(totalMeals / 3)
      }

      const distinctRecipeCounts = surveySnapshot?.distinct_recipe_counts || mealSelection

      const selectedSlots: SelectedSlot[] =
        surveySnapshot?.selected_slots ||
        Array.from({ length: mealSelection.breakfast }, (_, idx) => ({
          day: getScheduledDay(weekOf, idx),
          mealType: 'breakfast'
        }))
          .concat(
            Array.from({ length: mealSelection.lunch }, (_, idx) => ({
              day: getScheduledDay(weekOf, mealSelection.breakfast + idx),
              mealType: 'lunch'
            }))
          )
          .concat(
            Array.from({ length: mealSelection.dinner }, (_, idx) => ({
              day: getScheduledDay(
                weekOf,
                mealSelection.breakfast + mealSelection.lunch + idx
              ),
              mealType: 'dinner'
            }))
          )

      const response = await fetch('/api/generate-meal-plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          weekOf,
          mealSelection,
          mealPlanId,
          distinctRecipeCounts,
          selectedSlots
        })
      })

      if (!response.ok) {
        throw new Error('Failed to start meal plan generation')
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error('No response stream available')
      }

      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        buffer += chunk
        tryParsePartialRecipes(buffer)
      }

      await parseCompleteResponse(buffer)
    } catch (err) {
      console.error('Generation error:', err)
      setError(err instanceof Error ? err.message : 'Failed to generate meal plan')
    }
  }

  const parseCompleteResponse = async (buffer: string) => {
    try {
      if (!buffer || buffer.trim().length === 0) {
        setError('No response received from AI')
        return
      }

      const jsonMatch = buffer.match(/```json\n?([\s\S]*?)\n?```/) || buffer.match(/```\n?([\s\S]*?)\n?```/)
      const jsonStr = jsonMatch ? jsonMatch[1] : buffer
      const aiResponse = JSON.parse(jsonStr.trim()) as {
        recipes?: RecipeData[]
        grocery_list?: Array<{ item: string; quantity: string }>
        schedule?: ScheduleEntry[]
      }

      if (!Array.isArray(aiResponse.schedule)) {
        setError('Meal plan generation did not include schedule details. Please try again.')
        return
      }

      if (aiResponse.schedule.length !== totalMeals) {
        setError(`Meal plan schedule mismatch. Expected ${totalMeals} slots, received ${aiResponse.schedule.length}.`)
        return
      }

      const parsedSchedule = aiResponse.schedule as ScheduleEntry[]
      const parsedRecipes = Array.isArray(aiResponse.recipes) ? aiResponse.recipes : []

      if (!parsedRecipes.length) {
        setError('Meal plan generation did not include any recipes. Please try again.')
        return
      }

      if (parsedRecipes.length < parsedSchedule.length) {
        setError(
          `Meal plan generation returned ${parsedRecipes.length} recipes but ${parsedSchedule.length} scheduled meals. Please try again.`
        )
        return
      }

      setRecipes(parsedRecipes)
      setCurrentRecipeIndex(parsedRecipes.length)

      const groceryListItems = Array.isArray(aiResponse.grocery_list) ? aiResponse.grocery_list : []

      await saveRecipes(parsedRecipes, groceryListItems, parsedSchedule)
    } catch (err) {
      console.error('Parse error:', err)
      console.error('Buffer content:', buffer)
      console.error('Buffer length:', buffer.length)
      setError(`Failed to parse AI response: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const saveRecipes = async (
    recipesToSave: RecipeData[],
    groceryListToSave: Array<{ item: string; quantity: string }>,
    schedule: ScheduleEntry[]
  ) => {
    setIsSaving(true)

    try {
      const result = await saveGeneratedRecipes(
        mealPlanId,
        recipesToSave,
        groceryListToSave,
        schedule
      )

      if (result.success) {
        setTimeout(() => {
          router.push(`/meal-plan/${mealPlanId}`)
        }, 1500)
      } else {
        setError(result.error || 'Failed to save recipes')
        setIsSaving(false)
      }
    } catch (err) {
      console.error('Save error:', err)
      setError(err instanceof Error ? err.message : 'Failed to save recipes')
      setIsSaving(false)
    }
  }

  return (
    <div className="gg-bg-page min-h-screen relative">
      <div className="fixed inset-0 bg-white/40 backdrop-blur-[2px] z-40 flex items-center justify-center">
        <div className="text-center">
          <div className="mb-6">
            <div className="inline-flex h-16 w-16 animate-spin rounded-full border-4 border-solid border-[var(--gg-primary)] border-r-transparent"></div>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {isSaving ? 'Saving Your Meal Plan...' : 'Generating Your Personalized Meal Plan'}
          </h2>
          <p className="text-gray-600 mb-4">
            {isSaving
              ? 'Almost done! Finalizing your recipes and grocery list...'
              : `Creating ${currentRecipeIndex} of ${totalMeals} recipes...`}
          </p>

          <div className="w-80 mx-auto bg-gray-200 rounded-full h-2.5 mb-4">
            <div
              className="bg-[var(--gg-primary)] h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${(currentRecipeIndex / totalMeals) * 100}%` }}
            ></div>
          </div>

          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg max-w-md mx-auto">
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}
        </div>
      </div>

      <div className="gg-container">
        <div className="gg-section">
          <div className="mb-8">
            <h1 className="gg-heading-page mb-2">Your Meal Plan</h1>
            <p className="gg-text-subtitle">Week of {new Date(weekOf).toLocaleDateString()}</p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {recipes.map((recipe, index) => (
              <div
                key={index}
                className={`transition-all duration-500 ${
                  recipe ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
                }`}
              >
                {recipe ? (
                  <div className="rounded-xl border-2 border-gray-200 bg-white p-6 hover:border-[var(--gg-primary)] hover:shadow-md transition-all animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="mb-4">
                      <h3 className="gg-heading-card mb-2">{recipe.name}</h3>
                      {recipe.mealType && (
                        <span className="inline-block rounded-full bg-[var(--gg-primary)] bg-opacity-10 px-3 py-1 text-xs font-medium text-[var(--gg-primary)]">
                          {recipe.mealType}
                        </span>
                      )}
                    </div>

                    <div className="mb-4 flex flex-wrap gap-3 text-sm text-gray-600">
                      {recipe.prep_time_minutes && (
                        <span className="flex items-center gap-1">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {recipe.prep_time_minutes}m
                        </span>
                      )}
                      {recipe.servings && (
                        <span className="flex items-center gap-1">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0zM7 10a2 2 0 11-4 0 2 2 0z" />
                          </svg>
                          {recipe.servings} servings
                        </span>
                      )}
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold text-gray-700">Ingredients:</p>
                      <ul className="space-y-1 text-sm text-gray-600">
                        {recipe.ingredients.slice(0, 3).map((ingredient, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="text-[var(--gg-primary)]">•</span>
                            <span className="truncate">{ingredient.item}</span>
                          </li>
                        ))}
                        {recipe.ingredients.length > 3 && (
                          <li className="text-gray-400 text-xs">
                            +{recipe.ingredients.length - 3} more...
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <RecipeCardSkeleton />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

