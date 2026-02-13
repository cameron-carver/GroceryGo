'use server'

import { revalidateTag } from 'next/cache'
import {
  createMealPlanContext,
  getMealPlanForUser,
  persistGeneratedMealPlan,
  type GroceryItemInput,
  type RecipeInput,
  type ScheduleInput
} from '@/services/mealPlanService'

interface SavedRecipe {
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

interface GroceryListItem {
  item: string
  quantity: string
}

interface ScheduleEntry {
  slotLabel: string
  day: string
  mealType: string
  recipeId: string
  portionMultiplier: number
}

export async function saveGeneratedRecipes(
  mealPlanId: string,
  recipes: SavedRecipe[],
  groceryList: GroceryListItem[],
  schedule: ScheduleEntry[] = []
) {
  try {
    const context = await createMealPlanContext()
    const mealPlan = await getMealPlanForUser(context, mealPlanId)

    if (!mealPlan) {
      return {
        success: false,
        error: 'Meal plan not found or does not belong to you'
      }
    }

    await persistGeneratedMealPlan(context, {
      mealPlan,
      recipes: recipes as RecipeInput[],
      groceryList: groceryList as GroceryItemInput[],
      schedule: schedule as ScheduleInput[]
    })

    revalidateTag('dashboard')

    return {
      success: true,
      mealPlanId
    }
  } catch (error: unknown) {
    console.error('Error in saveGeneratedRecipes:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'An unexpected error occurred'
    }
  }
}

