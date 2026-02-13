'use server'

import {
  createMealPlanContext,
  deleteMealPlanForUser,
  fetchUserSurveyResponse,
  findExistingMealPlanByWeek,
  getMealPlanForUser,
  insertGeneratingMealPlan
} from '@/services/mealPlanService'

type MealPlanContextType = Awaited<ReturnType<typeof createMealPlanContext>>

interface MealSelection {
  breakfast: number
  lunch: number
  dinner: number
}

type MealSlot = {
  day: string
  mealType: 'breakfast' | 'lunch' | 'dinner'
}

export type GenerateMealPlanSuccess = {
  success: true
  mealPlanId: string
  totalMeals: number
  mealSelection: MealSelection
  distinctRecipeCounts: MealSelection
  selectedSlots: MealSlot[]
  replaced?: boolean
}

export type GenerateMealPlanConflict = {
  conflict: true
  existingPlanId: string
  weekOf: string
  error: string
}

export type GenerateMealPlanError = {
  success?: false
  error: string
  needsSurvey?: boolean
}

export type GenerateMealPlanResponse =
  | GenerateMealPlanSuccess
  | GenerateMealPlanConflict
  | GenerateMealPlanError

export async function generateMealPlanFromPreferences(
  weekOf: string,
  mealSelection: MealSelection,
  distinctCounts: MealSelection,
  selectedSlots: MealSlot[],
  complexityMap?: Record<string, string>
): Promise<GenerateMealPlanResponse> {
  try {
    const context = await createMealPlanContext()
    return await internalGenerateMealPlan(
      context,
      weekOf,
      mealSelection,
      distinctCounts,
      selectedSlots,
      complexityMap
    )
  } catch (error: unknown) {
    console.error('Meal plan generation error:', error)
    return {
      error: error instanceof Error ? error.message : 'Failed to generate meal plan'
    }
  }
}

export async function replaceExistingMealPlan(
  existingPlanId: string,
  weekOf: string,
  mealSelection: MealSelection,
  distinctCounts: MealSelection,
  selectedSlots: MealSlot[],
  complexityMap?: Record<string, string>
): Promise<GenerateMealPlanResponse> {
  try {
    const context = await createMealPlanContext()

    const mealPlan = await getMealPlanForUser(context, existingPlanId)
    if (!mealPlan) {
      return { error: 'Meal plan not found or does not belong to you' }
    }

    await deleteMealPlanForUser(context, existingPlanId)

    const result = await internalGenerateMealPlan(
      context,
      weekOf,
      mealSelection,
      distinctCounts,
      selectedSlots,
      complexityMap
    )

    // 'replaced' is not a property of the response; just return the result as-is
    return result
  } catch (error: unknown) {
    console.error('Meal plan replacement error:', error)
    return {
      error: error instanceof Error ? error.message : 'Failed to replace meal plan'
    }
  }
}

async function internalGenerateMealPlan(
  context: MealPlanContextType,
  weekOf: string,
  mealSelection: MealSelection,
  distinctCounts: MealSelection,
  selectedSlots: MealSlot[],
  complexityMap?: Record<string, string>
): Promise<GenerateMealPlanResponse> {
  try {
    const existingPlan = await findExistingMealPlanByWeek(context, weekOf)

    if (existingPlan) {
      return {
        conflict: true,
        existingPlanId: existingPlan.id,
        weekOf,
        error: 'A meal plan already exists for this week.'
      }
    }

    const surveyResponse = await fetchUserSurveyResponse(context)

    if (!surveyResponse) {
      return {
        error: 'Please complete the onboarding survey first',
        needsSurvey: true
      }
    }

    const totalMeals =
      mealSelection.breakfast + mealSelection.lunch + mealSelection.dinner

    const extendedSnapshot = {
      ...surveyResponse,
      meal_selection: mealSelection,
      distinct_recipe_counts: distinctCounts,
      selected_slots: selectedSlots,
      ...(complexityMap ? { complexity_map: complexityMap } : {}),
    }

    const mealPlan = await insertGeneratingMealPlan(context, 
      {
        week_of: weekOf,
        status: 'generating',
        total_meals: totalMeals,
        survey_snapshot: extendedSnapshot,
        generation_method: 'ai-generated',
        ai_model: 'gpt-4o'
      }
    )

    return {
      success: true,
      mealPlanId: mealPlan.id,
      totalMeals,
      mealSelection,
      distinctRecipeCounts: distinctCounts,
      selectedSlots
    }
  } catch (error: unknown) {
    console.error('Error creating meal plan:', error)
    return {
      error: error instanceof Error ? error.message : 'Failed to create meal plan'
    }
  }
}

