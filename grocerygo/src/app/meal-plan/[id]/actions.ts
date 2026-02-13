'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidateTag } from 'next/cache'
import type {
  GroceryItem,
  RecipeInsert,
  GroceryItemInsert,
  AIGeneratedMealPlan
} from '@/types/database'
import type { ShoppingListData, InstacartResponse, LineItem } from '@/types/instacart'
import { callOpenAI } from '@/app/actions/aiHelper'
import { trackMealPlanAction } from '@/app/actions/feedbackHelper'
import {
  replaceRecipePrompt, 
  bulkAdjustmentPrompt, 
  simplifyRecipePrompt 
} from './prompts'

const INSTACART_API_URL = 'https://connect.dev.instacart.tools/idp/v1/products/products_link'
const INSTACART_API_KEY = process.env.INSTACART_API_KEY

type AdditionalGroceryItem = {
  item: string
  quantity: string
}

type ReplacementRecipePayload = {
  recipe: {
    name: string
    ingredients: RecipeInsert['ingredients']
    steps: string[]
  }
  additional_grocery_items?: AdditionalGroceryItem[]
}

type RecipeIngredient = {
  item: string
  quantity: string
  unit?: string
  [key: string]: unknown
}

type SimplifiedRecipe = {
  name: string
  ingredients: RecipeInsert['ingredients']
  steps: string[]
}

export async function createInstacartOrder(
  groceryItems: GroceryItem[],
  mealPlanTitle: string,
  mealPlanUrl: string
): Promise<{ success: boolean; link?: string; error?: string }> {
  try {
    if (!INSTACART_API_KEY) {
      throw new Error('Instacart API key is not configured')
    }

    // Convert grocery items to Instacart line items
    const lineItems: LineItem[] = groceryItems.map((item) => {
      const quantity = item.quantity || 1
      const unit = item.unit || 'count'
      
      return {
        name: item.item_name,
        quantity: quantity,
        unit: unit,
        display_text: `${quantity} ${unit} ${item.item_name}`,
        line_item_measurements: [
          {
            quantity: quantity,
            unit: unit
          }
        ],
        filters: {
          brand_filters: [],
          health_filters: []
        }
      }
    })

    // Create shopping list data
    const shoppingListData: ShoppingListData = {
      title: mealPlanTitle,
      link_type: 'shopping_list',
      expires_in: 1, // 1 day (Instacart expects days, not seconds)
      instructions: [
        'These ingredients are for your weekly meal plan from GroceryGo',
        'Feel free to adjust quantities based on your preferences'
      ],
      line_items: lineItems,
      landing_page_configuration: {
        partner_linkback_url: mealPlanUrl,
        enable_pantry_items: true
      }
    }

    // Make API call to Instacart
    const response = await fetch(INSTACART_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${INSTACART_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(shoppingListData)
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Instacart API error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText
      })
      throw new Error(`Instacart API returned ${response.status}: ${response.statusText}`)
    }

    const data: InstacartResponse = await response.json()
    
    return {
      success: true,
      link: data.products_link_url
    }
  } catch (error) {
    console.error('Error creating Instacart order:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create Instacart order'
    }
  }
}

/**
 * Feature 1: Replace individual recipe
 */
export async function replaceRecipe(
  mealPlanId: string,
  recipeId: string,
  mealType: string
): Promise<{ success: boolean; error?: string; newRecipeId?: string }> {
  try {
    const supabase = await createClient()

    // Get authenticated user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return { success: false, error: 'User not authenticated' }
    }

    // Get meal plan with survey snapshot
    const { data: mealPlan } = await supabase
      .from('meal_plans')
      .select('*, meal_plan_recipes(*, recipe:recipes(*)), grocery_items(*)')
      .eq('id', mealPlanId)
      .eq('user_id', user.id)
      .single()

    if (!mealPlan) {
      return { success: false, error: 'Meal plan not found' }
    }

    // Get the recipe being replaced
    const { data: oldRecipe } = await supabase
      .from('recipes')
      .select('*')
      .eq('id', recipeId)
      .single()

    if (!oldRecipe) {
      return { success: false, error: 'Recipe not found' }
    }

    // Get existing ingredients to maximize reuse
    const existingIngredients = mealPlan.grocery_items.map((item: GroceryItem) => item.item_name)

    // Call AI to generate replacement recipe
    const prompt = replaceRecipePrompt(
      mealPlan.survey_snapshot || {},
      mealType,
      existingIngredients,
      oldRecipe.name
    )

    const result = await callOpenAI<ReplacementRecipePayload>(
      'You are an expert meal planner for GroceryGo. Generate a single replacement recipe in JSON format following all guidelines.',
      prompt,
      (response) => {
        const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/) || response.match(/```\n?([\s\S]*?)\n?```/)
        const jsonStr = jsonMatch ? jsonMatch[1] : response
        return JSON.parse(jsonStr)
      }
    )

    if (!result.success || !result.data) {
      return { success: false, error: result.error || 'Failed to generate replacement recipe' }
    }

    const { recipe: newRecipeData, additional_grocery_items } = result.data

    // Create new recipe in database
    const { data: newRecipe, error: recipeError } = await supabase
      .from('recipes')
      .insert({
        name: newRecipeData.name,
        ingredients: newRecipeData.ingredients,
        steps: newRecipeData.steps,
        meal_type: mealType,
        times_used: 1
      } as RecipeInsert)
      .select()
      .single()

    if (recipeError || !newRecipe) {
      return { success: false, error: 'Failed to create new recipe' }
    }

    // Update meal_plan_recipes junction table
    await supabase
      .from('meal_plan_recipes')
      .update({ recipe_id: newRecipe.id })
      .eq('meal_plan_id', mealPlanId)
      .eq('recipe_id', recipeId)

    // Add new grocery items
    if (additional_grocery_items && additional_grocery_items.length > 0) {
      const newGroceryItems: GroceryItemInsert[] = additional_grocery_items.map((item) => ({
        meal_plan_id: mealPlanId,
        item_name: item.item,
        quantity: parseQuantity(item.quantity),
        unit: parseUnit(item.quantity),
        purchased: false
      }))

      await supabase
        .from('grocery_items')
        .insert(newGroceryItems)
    }

    // Track action
    await trackMealPlanAction(
      mealPlanId,
      user.id,
      `User replaced recipe '${oldRecipe.name}' with a new ${mealType} recipe`
    )

    revalidateTag('meal-plan')
    revalidateTag('dashboard')

    return { success: true, newRecipeId: newRecipe.id }
  } catch (error) {
    console.error('Error replacing recipe:', error)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

/**
 * Feature 2: Regenerate with bulk adjustments
 */
export async function regenerateWithAdjustments(
  mealPlanId: string,
  adjustments: {
    reduceTime?: boolean
    lowerBudget?: boolean
    minimizeIngredients?: boolean
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient()

    // Get authenticated user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return { success: false, error: 'User not authenticated' }
    }

    // Get meal plan
    const { data: mealPlan } = await supabase
      .from('meal_plans')
      .select('*, meal_plan_recipes(*)')
      .eq('id', mealPlanId)
      .eq('user_id', user.id)
      .single()

    if (!mealPlan) {
      return { success: false, error: 'Meal plan not found' }
    }

    // Calculate meal breakdown
    const totalMeals = mealPlan.total_meals
    const mealBreakdown = {
      breakfast: Math.floor(totalMeals / 3),
      lunch: Math.floor(totalMeals / 3),
      dinner: totalMeals - (2 * Math.floor(totalMeals / 3))
    }

    // Generate prompt with adjustments
    const prompt = bulkAdjustmentPrompt(
      mealPlan.survey_snapshot || {},
      adjustments,
      totalMeals,
      mealBreakdown
    )

    const result = await callOpenAI<AIGeneratedMealPlan>(
      'You are an expert meal planner for GroceryGo. Generate a complete meal plan with optimizations in JSON format.',
      prompt,
      (response) => {
        const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/) || response.match(/```\n?([\s\S]*?)\n?```/)
        const jsonStr = jsonMatch ? jsonMatch[1] : response
        return JSON.parse(jsonStr)
      }
    )

    if (!result.success || !result.data) {
      return { success: false, error: result.error || 'Failed to generate meal plan' }
    }

    const aiMealPlan = result.data

    // Delete existing recipes and grocery items
    await supabase
      .from('meal_plan_recipes')
      .delete()
      .eq('meal_plan_id', mealPlanId)

    await supabase
      .from('grocery_items')
      .delete()
      .eq('meal_plan_id', mealPlanId)

    // Create new recipes
    const recipeIds: string[] = []
    const recipeIdMap: Record<string, string> = {}
    for (const aiRecipe of aiMealPlan.recipes) {
      const { data: newRecipe } = await supabase
        .from('recipes')
        .insert({
          name: aiRecipe.name,
          ingredients: aiRecipe.ingredients,
          steps: aiRecipe.steps,
          meal_type: aiRecipe.mealType ? aiRecipe.mealType : null,
          times_used: 1
        } as RecipeInsert)
        .select()
        .single()

      if (newRecipe) {
        recipeIds.push(newRecipe.id)
        if (aiRecipe.id) {
          recipeIdMap[aiRecipe.id] = newRecipe.id
        }
      }
    }

    const scheduleEntries = aiMealPlan.schedule && Array.isArray(aiMealPlan.schedule)
      ? aiMealPlan.schedule
      : []

    const mealPlanRecipes = scheduleEntries.length > 0
      ? scheduleEntries.reduce<{
          inserts: {
            meal_plan_id: string
            recipe_id: string
            planned_for_date?: string
            meal_type?: 'breakfast' | 'lunch' | 'dinner'
            portion_multiplier?: number
            slot_label?: string
          }[]
          missingRecipeRefs: string[]
        }>((acc, entry) => {
          const linkedRecipeId = recipeIdMap[entry.recipeId]
          if (!linkedRecipeId) {
            acc.missingRecipeRefs.push(entry.recipeId)
            return acc
          }

          const mealType = entry.mealType?.toLowerCase() as 'breakfast' | 'lunch' | 'dinner' | undefined
          acc.inserts.push({
            meal_plan_id: mealPlanId,
            recipe_id: linkedRecipeId,
            planned_for_date: getDateForDayName(mealPlan.week_of, entry.day),
            meal_type: mealType,
            portion_multiplier: entry.portionMultiplier || 1,
            slot_label: entry.slotLabel || `${entry.day} ${entry.mealType}`
          })
          return acc
        }, { inserts: [], missingRecipeRefs: [] }).inserts
      : recipeIds.map((recipeId, index) => ({
          meal_plan_id: mealPlanId,
          recipe_id: recipeId,
          planned_for_date: getDateForMealIndex(mealPlan.week_of, index),
          portion_multiplier: 1
        }))

    await supabase
      .from('meal_plan_recipes')
      .insert(mealPlanRecipes)

    // Create grocery list
    const groceryItems: GroceryItemInsert[] = aiMealPlan.grocery_list.map(item => ({
      meal_plan_id: mealPlanId,
      item_name: item.item,
      quantity: parseQuantity(item.quantity),
      unit: parseUnit(item.quantity),
      purchased: false
    }))

    await supabase
      .from('grocery_items')
      .insert(groceryItems)

    // Track which adjustments were applied
    const appliedAdjustments: string[] = []
    if (adjustments.reduceTime) appliedAdjustments.push('reduceTime')
    if (adjustments.lowerBudget) appliedAdjustments.push('lowerBudget')
    if (adjustments.minimizeIngredients) appliedAdjustments.push('minimizeIngredients')

    // Update meal plan with applied adjustments
    const updatedSnapshot = {
      ...mealPlan.survey_snapshot,
      applied_adjustments: [
        ...(mealPlan.survey_snapshot?.applied_adjustments || []),
        ...appliedAdjustments
      ]
    }

    await supabase
      .from('meal_plans')
      .update({
        survey_snapshot: updatedSnapshot,
        total_meals: scheduleEntries.length > 0 ? scheduleEntries.length : recipeIds.length
      })
      .eq('id', mealPlanId)

    // Track action for feedback
    const adjustmentsList = []
    if (adjustments.reduceTime) adjustmentsList.push('reduce time')
    if (adjustments.lowerBudget) adjustmentsList.push('lower budget')
    if (adjustments.minimizeIngredients) adjustmentsList.push('minimize ingredients')

    await trackMealPlanAction(
      mealPlanId,
      user.id,
      `User applied optimizations: ${adjustmentsList.join(', ')}`
    )

    revalidateTag('meal-plan')
    revalidateTag('dashboard')

    return { success: true }
  } catch (error) {
    console.error('Error regenerating meal plan:', error)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

/**
 * Feature 4: Scale recipe servings
 */
export async function scaleRecipeServings(
  mealPlanId: string,
  recipeId: string,
  multiplier: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient()

    // Get authenticated user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return { success: false, error: 'User not authenticated' }
    }

    // Get recipe
    const { data: recipe } = await supabase
      .from('recipes')
      .select('*')
      .eq('id', recipeId)
      .single()

    if (!recipe) {
      return { success: false, error: 'Recipe not found' }
    }

    // Scale ingredients
    const ingredients = (recipe.ingredients ?? []) as RecipeIngredient[]
    const scaledIngredients = ingredients.map((ingredient) => {
      const quantity = parseFloat(String(ingredient.quantity)) || 1
      const scaledQuantity = quantity * multiplier
      return {
        ...ingredient,
        quantity: scaledQuantity.toString()
      }
    })

    // Update recipe
    await supabase
      .from('recipes')
      .update({
        ingredients: scaledIngredients,
        servings: (recipe.servings || 4) * multiplier
      })
      .eq('id', recipeId)

    // Track action
    await trackMealPlanAction(
      mealPlanId,
      user.id,
      `User scaled recipe '${recipe.name}' to ${multiplier}x servings`
    )

    revalidateTag('meal-plan')

    return { success: true }
  } catch (error) {
    console.error('Error scaling recipe:', error)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

/**
 * Feature 5: Swap ingredient
 */
export async function swapIngredient(
  mealPlanId: string,
  recipeId: string,
  oldIngredient: string,
  newIngredient: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient()

    // Get authenticated user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return { success: false, error: 'User not authenticated' }
    }

    // Get recipe
    const { data: recipe } = await supabase
      .from('recipes')
      .select('*')
      .eq('id', recipeId)
      .single()

    if (!recipe) {
      return { success: false, error: 'Recipe not found' }
    }

    // Update ingredients
    const ingredients = (recipe.ingredients ?? []) as RecipeIngredient[]
    const updatedIngredients = ingredients.map((ingredient) => {
      if (ingredient.item.toLowerCase().includes(oldIngredient.toLowerCase())) {
        return {
          ...ingredient,
          item: newIngredient
        }
      }
      return ingredient
    })

    await supabase
      .from('recipes')
      .update({ ingredients: updatedIngredients })
      .eq('id', recipeId)

    // Track action
    await trackMealPlanAction(
      mealPlanId,
      user.id,
      `User swapped '${oldIngredient}' with '${newIngredient}' in recipe '${recipe.name}'`
    )

    revalidateTag('meal-plan')

    return { success: true }
  } catch (error) {
    console.error('Error swapping ingredient:', error)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

/**
 * Feature 6: Simplify recipe
 */
export async function simplifyRecipe(
  mealPlanId: string,
  recipeId: string
): Promise<{ success: boolean; error?: string; simplifiedRecipe?: SimplifiedRecipe }> {
  try {
    const supabase = await createClient()

    // Get authenticated user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return { success: false, error: 'User not authenticated' }
    }

    // Get recipe
    const { data: recipe } = await supabase
      .from('recipes')
      .select('*')
      .eq('id', recipeId)
      .single()

    if (!recipe) {
      return { success: false, error: 'Recipe not found' }
    }

    // Call AI to simplify
    const prompt = simplifyRecipePrompt(
      recipe.name,
      recipe.ingredients,
      recipe.steps
    )

    const result = await callOpenAI<{ simplified_recipe: SimplifiedRecipe }>(
      'You are a culinary expert helping busy people simplify recipes. Provide simplified versions in JSON format.',
      prompt,
      (response) => {
        const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/) || response.match(/```\n?([\s\S]*?)\n?```/)
        const jsonStr = jsonMatch ? jsonMatch[1] : response
        return JSON.parse(jsonStr)
      }
    )

    if (!result.success || !result.data) {
      return { success: false, error: result.error || 'Failed to simplify recipe' }
    }

    const { simplified_recipe } = result.data

    // Update recipe with simplified version
    const simplifiedIngredients = (simplified_recipe.ingredients ?? []) as RecipeIngredient[]
    await supabase
      .from('recipes')
      .update({
        name: simplified_recipe.name,
        ingredients: simplifiedIngredients,
        steps: simplified_recipe.steps
      })
      .eq('id', recipeId)

    // Track action
    await trackMealPlanAction(
      mealPlanId,
      user.id,
      `User requested simplified version of '${recipe.name}'`
    )

    revalidateTag('meal-plan')

    return { success: true, simplifiedRecipe: simplified_recipe }
  } catch (error) {
    console.error('Error simplifying recipe:', error)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

// Helper functions
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

  const startDayIndex = dayMap[startDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()] ?? 1
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

/**
 * Save a cooking note to a recipe
 * This adds AI-generated cooking tips to the recipe's cooking_notes array
 */
export async function saveCookingNote(
  recipeId: string,
  note: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient()

    // Validate input
    if (!note || note.trim().length === 0) {
      return { success: false, error: 'Note cannot be empty' }
    }

    if (note.length > 500) {
      return { success: false, error: 'Note is too long' }
    }

    // Get current recipe to append to cooking_notes
    const { data: recipe, error: fetchError } = await supabase
      .from('recipes')
      .select('cooking_notes')
      .eq('id', recipeId)
      .single()

    if (fetchError) {
      console.error('Error fetching recipe:', fetchError)
      return { success: false, error: 'Recipe not found' }
    }

    // Append note to existing notes (or create new array)
    const existingNotes = recipe.cooking_notes || []
    const updatedNotes = [...existingNotes, note.trim()]

    // Update recipe with new notes
    const { error: updateError } = await supabase
      .from('recipes')
      .update({ cooking_notes: updatedNotes })
      .eq('id', recipeId)

    if (updateError) {
      console.error('Error updating recipe notes:', updateError)
      return { success: false, error: 'Failed to save note' }
    }

    // Revalidate to refresh the UI
    revalidateTag('meal-plans')

    return { success: true }
  } catch (error) {
    console.error('Error saving cooking note:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to save note' 
    }
  }
}

