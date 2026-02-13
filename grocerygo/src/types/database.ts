type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type SurveyResponse = Record<string, JsonValue>

// User types
export interface User {
  id: number
  created_at: string
  email: string
  survey_response: SurveyResponse | null
  user_id: string
}

export interface UserInsert {
  email: string
  user_id: string
  survey_response?: SurveyResponse | null
}

// Recipe types
export interface Recipe {
  id: string
  created_at: string
  name: string
  description?: string
  prep_time_minutes?: number
  cook_time_minutes?: number
  servings?: number
  difficulty?: 'beginner' | 'intermediate' | 'advanced'
  
  ingredients: Array<{
    item: string
    quantity: string
    unit?: string
  }>
  steps: string[]
  
  cuisine_type?: string[]
  meal_type?: string[]
  dietary_tags?: string[]
  flavor_profile?: string[]
  
  estimated_cost?: number
  nutrition_info?: {
    calories?: number
    protein?: number
    carbs?: number
    fat?: number
  }
  
  times_used?: number
  avg_rating?: number
  cooking_notes?: string[] // AI-generated cooking tips and notes
}

export interface RecipeInsert {
  name: string
  description?: string
  prep_time_minutes?: number
  cook_time_minutes?: number
  servings?: number
  difficulty?: 'beginner' | 'intermediate' | 'advanced'
  
  ingredients: Array<{
    item: string
    quantity: string
    unit?: string
  }>
  steps: string[]
  
  cuisine_type?: string[]
  meal_type?: string
  dietary_tags?: string[]
  flavor_profile?: string[]
  
  estimated_cost?: number
  nutrition_info?: {
    calories?: number
    protein?: number
    carbs?: number
    fat?: number
  }
  cooking_notes?: string[]
}

// Meal Plan types
export interface MealPlan {
  id: string
  user_id: string
  created_at: string
  week_of: string
  status: 'completed' | 'in-progress' | 'pending' | 'generating'
  total_meals: number
  total_budget?: number
  
  survey_snapshot?: SurveyResponse
  generation_method?: 'ai-generated' | 'template' | 'manual'
  template_id?: string
  ai_model?: string
  
  // Instacart caching fields
  instacart_link?: string
  instacart_link_expires_at?: string

  week_score_id?: string
}

export interface MealPlanInsert {
  user_id: string
  week_of: string
  status: 'completed' | 'in-progress' | 'pending' | 'generating'
  total_meals: number
  total_budget?: number
  
  survey_snapshot?: SurveyResponse
  generation_method?: 'ai-generated' | 'template' | 'manual'
  template_id?: string
  ai_model?: string
  
  // Instacart caching fields (optional on insert)
  instacart_link?: string
  instacart_link_expires_at?: string

  week_score_id?: string
}

// Meal Plan Recipe junction
export interface MealPlanRecipe {
  id: string
  meal_plan_id: string
  recipe_id: string
  planned_for_date?: string
  meal_type?: 'breakfast' | 'lunch' | 'dinner'
  notes?: string
  portion_multiplier?: number
  slot_label?: string
  complexity_tier?: 'quick' | 'standard' | 'exploratory'
  recipe?: Recipe // For joins
}

export interface MealPlanRecipeInsert {
  meal_plan_id: string
  recipe_id: string
  planned_for_date?: string
  meal_type?: 'breakfast' | 'lunch' | 'dinner'
  notes?: string
  portion_multiplier?: number
  slot_label?: string
  complexity_tier?: 'quick' | 'standard' | 'exploratory'
}

// Grocery Item types
export interface GroceryItem {
  id: string
  meal_plan_id: string
  item_name: string
  quantity?: number
  unit?: string
  category?: string
  estimated_price?: number
  purchased: boolean
  purchased_at?: string
}

export interface GroceryItemInsert {
  meal_plan_id: string
  item_name: string
  quantity?: number
  unit?: string
  category?: string
  estimated_price?: number
  purchased?: boolean
}

// Meal Plan Template types
export interface MealPlanTemplate {
  id: string
  created_at: string
  name: string
  description?: string
  created_by_user_id?: string
  is_public: boolean
  
  target_meals_per_week?: string
  target_budget_range?: string
  dietary_restrictions?: string[]
  skill_level?: string
  
  recipe_ids: string[]
  times_used: number
  avg_rating?: number
}

export interface MealPlanTemplateInsert {
  name: string
  description?: string
  created_by_user_id?: string
  is_public?: boolean
  
  target_meals_per_week?: string
  target_budget_range?: string
  dietary_restrictions?: string[]
  skill_level?: string
  
  recipe_ids: string[]
}

// Meal Plan Feedback types
export interface MealPlanFeedback {
  id: string
  meal_plan_id: string
  user_id: string
  rating: number
  feedback_text?: string
  created_at: string
  
  was_budget_accurate?: boolean
  were_recipes_good?: boolean
  would_make_again?: boolean
}

export interface MealPlanFeedbackInsert {
  meal_plan_id: string
  user_id: string
  rating: number
  feedback_text?: string
  
  was_budget_accurate?: boolean
  were_recipes_good?: boolean
  would_make_again?: boolean
}

// Saved Recipe types
export interface SavedRecipe {
  id: string
  user_id: string
  recipe_id: string
  created_at: string
  notes?: string
}

export interface SavedRecipeInsert {
  user_id: string
  recipe_id: string
  notes?: string
}

// Extended types with relations for queries
export interface MealPlanWithRecipes extends MealPlan {
  meal_plan_recipes: Array<MealPlanRecipe & { recipe: Recipe }>
  grocery_items: GroceryItem[]
}

// AI Response format (matches schema with separate meal type arrays)
export interface AIGeneratedMealPlan {
  recipes: Array<{
    id: string
    name: string
    mealType?: string
    ingredients: Array<{
      item: string
      quantity: string
    }>
    steps: string[]
    servings?: number
  }>
  schedule: Array<{
    slotLabel: string
    day: string
    mealType: string
    recipeId: string
    portionMultiplier: number
  }>
  grocery_list: Array<{
    item: string
    quantity: string
  }>
}

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
