import { z } from 'zod'

// Ingredient schema
export const IngredientSchema = z.object({
  item: z.string().min(1).describe('The ingredient name'),
  quantity: z.string().min(1).describe('Quantity with unit (e.g., "2 cups", "1 lb")')
})

// Recipe schema
export const RecipeSchema = z.object({
  name: z.string().min(1).describe('The recipe name'),
  mealType: z.enum(['Breakfast', 'Lunch', 'Dinner']).describe('Type of meal'),
  ingredients: z.array(IngredientSchema).min(1).describe('List of ingredients'),
  steps: z.array(z.string().min(1)).min(1).describe('Cooking steps in order'),
  description: z.string().min(1).describe('A brief description of the recipe'),
  prep_time_minutes: z.number().int().positive().describe('Preparation time in minutes'),
  cook_time_minutes: z.number().int().positive().describe('Cooking time in minutes'),
  servings: z.number().int().positive().describe('Number of servings'),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).describe('Recipe difficulty level')
})

// Grocery item schema
export const GroceryItemSchema = z.object({
  item: z.string().min(1).describe('Ingredient name'),
  quantity: z.string().min(1).describe('Total quantity with unit'),
  category: z.string().optional().describe('Grocery category for shelf life tracking'),
})

/**
 * Dynamic schema generator that enforces exact recipe counts
 * Separates recipes by meal type for guaranteed count enforcement
 */
export function createMealPlanSchema(
  breakfastCount: number,
  lunchCount: number,
  dinnerCount: number
) {
  return z.object({
    breakfast: z.array(RecipeSchema)
      .length(breakfastCount)
      .describe(`Exactly ${breakfastCount} breakfast recipes`),
    lunch: z.array(RecipeSchema)
      .length(lunchCount)
      .describe(`Exactly ${lunchCount} lunch recipes`),
    dinner: z.array(RecipeSchema)
      .length(dinnerCount)
      .describe(`Exactly ${dinnerCount} dinner recipes`),
    grocery_list: z.array(GroceryItemSchema)
      .min(1)
      .describe('Consolidated grocery list from all recipes')
  })
}

// Single recipe replacement schema
export const ReplaceRecipeSchema = z.object({
  recipe: RecipeSchema,
  additional_grocery_items: z.array(GroceryItemSchema)
})

// Recipe simplification schema
export const SimplifyRecipeSchema = z.object({
  simplified_recipe: RecipeSchema,
  time_saved: z.string(),
  changes_made: z.string()
})

// Export types
export type Recipe = z.infer<typeof RecipeSchema>
export type Ingredient = z.infer<typeof IngredientSchema>
export type GroceryItem = z.infer<typeof GroceryItemSchema>
export type ReplaceRecipeResponse = z.infer<typeof ReplaceRecipeSchema>
export type SimplifyRecipeResponse = z.infer<typeof SimplifyRecipeSchema>

