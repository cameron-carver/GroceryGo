import { createClient } from '@/utils/supabase/server'
import type { MealPlan, MealPlanInsert, MealPlanRecipeInsert, RecipeInsert, GroceryItemInsert } from '@/types/database'

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

export interface MealPlanContext {
  supabase: SupabaseClient
  user: NonNullable<Awaited<ReturnType<SupabaseClient['auth']['getUser']>>['data']['user']>
}

export interface RecipeInput {
  id?: string
  name: string
  mealType?: string
  description?: string
  ingredients: Array<{ item: string; quantity: string }>
  steps: string[]
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

export interface GroceryItemInput {
  item: string
  quantity: string
}

export interface ScheduleInput {
  slotLabel: string
  day: string
  mealType: string
  recipeId: string
  portionMultiplier: number
}

export async function createMealPlanContext(): Promise<MealPlanContext> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser()

  if (authError || !user) {
    throw new Error('User not authenticated')
  }

  return { supabase, user }
}

export async function fetchUserSurveyResponse(context: MealPlanContext) {
  const { supabase, user } = context
  const { data } = await supabase
    .from('users')
    .select('survey_response')
    .eq('user_id', user.id)
    .single()

  return data?.survey_response
}

export async function findExistingMealPlanByWeek(
  context: MealPlanContext,
  weekOf: string
) {
  const { supabase, user } = context
  const { data } = await supabase
    .from('meal_plans')
    .select('id')
    .eq('user_id', user.id)
    .eq('week_of', weekOf)
    .single()

  return data
}

export async function insertGeneratingMealPlan(
  context: MealPlanContext,
  payload: Omit<MealPlanInsert, 'user_id'> & {
    survey_snapshot?: Record<string, unknown>
  }
): Promise<MealPlan> {
  const { supabase, user } = context
  const { data, error } = await supabase
    .from('meal_plans')
    .insert({
      ...payload,
      user_id: user.id
    })
    .select()
    .single()

  if (error || !data) {
    throw new Error(error?.message || 'Failed to create meal plan')
  }

  return data
}

export async function getMealPlanForUser(
  context: MealPlanContext,
  mealPlanId: string
): Promise<MealPlan | null> {
  const { supabase, user } = context

  const { data, error } = await supabase
    .from('meal_plans')
    .select('*')
    .eq('id', mealPlanId)
    .eq('user_id', user.id)
    .single()

  if (error) {
    return null
  }

  return data
}

export async function deleteMealPlanForUser(
  context: MealPlanContext,
  mealPlanId: string
) {
  const { supabase, user } = context
  const { error } = await supabase
    .from('meal_plans')
    .delete()
    .eq('id', mealPlanId)
    .eq('user_id', user.id)

  if (error) {
    throw new Error(error.message || 'Failed to delete existing meal plan')
  }
}

export interface PersistMealPlanParams {
  mealPlan: MealPlan
  recipes: RecipeInput[]
  groceryList: GroceryItemInput[]
  schedule?: ScheduleInput[]
}

export async function persistGeneratedMealPlan(
  context: MealPlanContext,
  params: PersistMealPlanParams
) {
  const { supabase } = context
  const { mealPlan, recipes, groceryList, schedule = [] } = params

  if (!recipes.length) {
    throw new Error('No recipes provided to persist')
  }

  const recipePayload: RecipeInsert[] = recipes.map<RecipeInsert>((recipe) => ({
    name: recipe.name,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    meal_type: recipe.mealType ?? undefined,
    description: recipe.description,
    prep_time_minutes: recipe.prep_time_minutes,
    cook_time_minutes: recipe.cook_time_minutes,
    servings: recipe.servings,
    difficulty: recipe.difficulty,
    cuisine_type: recipe.cuisine_type,
    dietary_tags: recipe.dietary_tags,
    flavor_profile: recipe.flavor_profile,
    estimated_cost: recipe.estimated_cost,
    nutrition_info: recipe.nutrition_info,
    times_used: 1
  }))

  const {
    data: insertedRecipes,
    error: recipeError
  } = await supabase.from('recipes').insert(recipePayload).select()

  if (recipeError || !insertedRecipes?.length) {
    throw new Error(
      recipeError?.message || 'Failed to create recipes for meal plan'
    )
  }

  const typedInsertedRecipes = insertedRecipes as Array<{ id: string; name: string }>
  const recipeIdMap = buildRecipeIdMap(recipes, typedInsertedRecipes)

  const mealPlanRecipes: MealPlanRecipeInsert[] =
    schedule.length > 0
      ? schedule.reduce<MealPlanRecipeInsert[]>((acc, slot, index) => {
          const linkedRecipeId = resolveRecipeId(recipeIdMap, slot)
          if (!linkedRecipeId) {
            console.warn(
              `Schedule entry ${index} references missing recipe id ${slot.recipeId}`
            )
            return acc
          }

          acc.push({
            meal_plan_id: mealPlan.id,
            recipe_id: linkedRecipeId,
            planned_for_date: getDateForDayName(mealPlan.week_of, slot.day),
            meal_type: normalizeMealType(slot.mealType),
            portion_multiplier: slot.portionMultiplier || 1,
            slot_label: slot.slotLabel || `${slot.day} ${slot.mealType}`
          })

          return acc
        }, [])
      : typedInsertedRecipes.map((recipe, index) => ({
          meal_plan_id: mealPlan.id,
          recipe_id: recipe.id,
          planned_for_date: getDateForMealIndex(mealPlan.week_of, index),
          portion_multiplier: 1
        }))

  if (mealPlanRecipes.length) {
    const { error: linkError } = await supabase
      .from('meal_plan_recipes')
      .insert(mealPlanRecipes)

    if (linkError) {
      throw new Error(linkError.message || 'Failed to link recipes to meal plan')
    }
  }

  if (groceryList.length) {
    const groceryItems: GroceryItemInsert[] = groceryList.map((item) => ({
      meal_plan_id: mealPlan.id,
      item_name: item.item,
      quantity: parseQuantity(item.quantity),
      unit: parseUnit(item.quantity),
      purchased: false
    }))

    const { error: groceryError } = await supabase
      .from('grocery_items')
      .insert(groceryItems)

    if (groceryError) {
      throw new Error(
        groceryError.message || 'Failed to create grocery list items'
      )
    }
  }

  const { error: updateError } = await supabase
    .from('meal_plans')
    .update({
      status: 'pending',
      total_meals: schedule.length > 0 ? schedule.length : insertedRecipes.length
    })
    .eq('id', mealPlan.id)

  if (updateError) {
    throw new Error(
      updateError.message || 'Failed to update meal plan status after generation'
    )
  }
}

function buildRecipeIdMap(
  sourceRecipes: RecipeInput[],
  insertedRecipes: Array<{ id: string; name: string }>
) {
  const map = new Map<string, string>()

  insertedRecipes.forEach((inserted, index) => {
    const source = sourceRecipes[index]
    if (!source) {
      return
    }

    const slug = toSlug(inserted.name)

    map.set(slug, inserted.id)

    if (source.mealType) {
      map.set(`${source.mealType.toLowerCase()}-${slug}`, inserted.id)
    }

    if (source.id) {
      map.set(source.id, inserted.id)
    }
  })

  return map
}

function resolveRecipeId(map: Map<string, string>, slot: ScheduleInput) {
  if (map.has(slot.recipeId)) {
    return map.get(slot.recipeId)
  }

  const normalizedMealType = slot.mealType?.toLowerCase()
  const slugKey = toSlug(slot.recipeId)

  if (map.has(slugKey)) {
    return map.get(slugKey)
  }

  if (normalizedMealType && map.has(`${normalizedMealType}-${slugKey}`)) {
    return map.get(`${normalizedMealType}-${slugKey}`)
  }

  return undefined
}

function normalizeMealType(mealType?: string) {
  return mealType
    ? (mealType.toLowerCase() as 'breakfast' | 'lunch' | 'dinner' | undefined)
    : undefined
}

function getDateForMealIndex(weekOf: string, index: number): string {
  const startDate = new Date(weekOf)
  const dayOffset = index % 7
  const mealDate = new Date(startDate)
  mealDate.setDate(startDate.getDate() + dayOffset)
  return mealDate.toISOString().split('T')[0]
}

function getDateForDayName(weekOf: string, dayName?: string): string | undefined {
  if (!dayName) return undefined

  const normalizedDay = dayName.trim().toLowerCase()
  const dayMap: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6
  }

  const targetOffset = dayMap[normalizedDay]

  if (targetOffset === undefined) {
    return undefined
  }

  const startDate = new Date(weekOf)
  if (Number.isNaN(startDate.getTime())) {
    return undefined
  }

  const startDayIndex =
    dayMap[
      startDate.toLocaleDateString('en-US', {
        weekday: 'long'
      }).toLowerCase()
    ] ?? 1

  const offset = targetOffset - startDayIndex

  const mealDate = new Date(startDate)
  mealDate.setDate(startDate.getDate() + offset)

  return mealDate.toISOString().split('T')[0]
}

function parseQuantity(quantityStr: string): number | undefined {
  const match = quantityStr.match(/^([\d.]+)/)
  return match ? parseFloat(match[1]) : undefined
}

function parseUnit(quantityStr: string): string | undefined {
  const match = quantityStr.match(/^[\d.]+\s*(.+)/)
  return match ? match[1].trim() : undefined
}

function toSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}


