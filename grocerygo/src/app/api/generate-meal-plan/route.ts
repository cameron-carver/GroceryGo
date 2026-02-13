import { NextRequest, NextResponse } from 'next/server'
import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { mealPlanFromSurveyPrompt, complexityTierPrompt } from '@/app/meal-plan-generate/prompts'
import {
  createMealPlanContext,
  fetchUserSurveyResponse,
  getMealPlanForUser
} from '@/services/mealPlanService'

interface MealSelection {
  breakfast: number
  lunch: number
  dinner: number
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { mealSelection, mealPlanId, distinctRecipeCounts, selectedSlots, complexityMap } = body as {
      mealSelection: MealSelection
      mealPlanId: string
      distinctRecipeCounts?: MealSelection
      selectedSlots?: Array<{ day: string; mealType: string }>
      complexityMap?: Record<string, string>
    }

    const context = await createMealPlanContext()
    const mealPlan = await getMealPlanForUser(context, mealPlanId)

    if (!mealPlan) {
      return NextResponse.json({ error: 'Meal plan not found' }, { status: 404 })
    }

    const surveyData =
      mealPlan.survey_snapshot || (await fetchUserSurveyResponse(context))

    if (!surveyData) {
      return NextResponse.json(
        { error: 'Please complete the onboarding survey first' },
        { status: 400 }
      )
    }

    // Calculate total meals
    const totalMeals = mealSelection.breakfast + mealSelection.lunch + mealSelection.dinner

    // Determine distinct recipe counts (fallback to no-duplicate scenario)
    const distinctCounts = distinctRecipeCounts
      ?? (mealPlan.survey_snapshot?.distinct_recipe_counts as MealSelection | undefined)
      ?? {
        breakfast: mealSelection.breakfast,
        lunch: mealSelection.lunch,
        dinner: mealSelection.dinner
      }

    const slots = (selectedSlots?.length ? selectedSlots : mealPlan.survey_snapshot?.selected_slots) as Array<{
      day: string
      mealType: string
    }> | undefined

    const toTitleCase = (value: string) =>
      value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()

    const resolvedSlots =
      slots && slots.length > 0
        ? slots.map((slot) => ({
            day: slot.day,
            mealType: toTitleCase(slot.mealType)
          }))
        : Array.from({ length: totalMeals }).map((_, index) => ({
            day: 'Unscheduled',
            mealType:
              index < mealSelection.breakfast
                ? 'Breakfast'
                : index < mealSelection.breakfast + mealSelection.lunch
                  ? 'Lunch'
                  : 'Dinner'
          }))

    const slotListText = resolvedSlots
      .map((slot, index) => {
        const label = `${slot.day} ${slot.mealType}`
        return `- Slot ${index + 1}: ${label}`
      })
      .join('\n')

    const surveyJson = surveyData ?? {}
    const favoredIngredients =
      Array.isArray((surveyJson as Record<string, unknown>)?.favored_ingredients)
        ? (surveyJson as Record<string, unknown>).favored_ingredients
        : []
    const excludedIngredients =
      Array.isArray((surveyJson as Record<string, unknown>)?.excluded_ingredients)
        ? (surveyJson as Record<string, unknown>).excluded_ingredients
        : []

    let ingredientPreferencesSection = ''
    if (
      Array.isArray(favoredIngredients) && favoredIngredients.length > 0 ||
      Array.isArray(excludedIngredients) && excludedIngredients.length > 0
    ) {
      ingredientPreferencesSection = '\n\n### Ingredient Preferences:\n'
      if (Array.isArray(favoredIngredients) && favoredIngredients.length > 0) {
        ingredientPreferencesSection += `**Favored Ingredients (prioritize using these):** ${favoredIngredients.join(', ')}\n`
      }
      if (Array.isArray(excludedIngredients) && excludedIngredients.length > 0) {
        ingredientPreferencesSection += `**Excluded Ingredients (NEVER use these):** ${excludedIngredients.join(', ')}\n`
      }
    }

    const enhancedPrompt = `${mealPlanFromSurveyPrompt}

### User Input:
${JSON.stringify(surveyData, null, 2)}
${ingredientPreferencesSection}

## 🎯 GENERATION REQUIREMENTS (MANDATORY)

**Recipe Count:** You MUST generate exactly ${totalMeals} recipes total.

**Breakdown (total meal slots):**
- ${mealSelection.breakfast} slots for "Breakfast"
- ${mealSelection.lunch} slots for "Lunch"
- ${mealSelection.dinner} slots for "Dinner"

**Unique recipe targets (per mealType):**
- Create exactly ${distinctCounts.breakfast} unique breakfast recipe(s)
- Create exactly ${distinctCounts.lunch} unique lunch recipe(s)
- Create exactly ${distinctCounts.dinner} unique dinner recipe(s)

**Process:**
1. Generate the unique recipes (IDs) per meal type.
2. Each recipe\'s "servings" must equal the total number of schedule portions assigned to that recipe.
3. Build the schedule array so that EVERY slot listed below is mapped to one of the recipe IDs:

${slotListText}

4. For duplicated recipes, reuse the same recipe ID and set \`portionMultiplier\` (integer >= 1) for each slot, typically 1 per person.
5. VALIDATE before returning:
   - Unique recipe counts per meal type match the targets above.
   - Schedule length equals ${resolvedSlots.length} and covers every slot exactly once.
   - Every schedule entry references a valid recipe ID.

**Critical:** The "recipes" array must contain exactly ${
      distinctCounts.breakfast + distinctCounts.lunch + distinctCounts.dinner
    } unique recipe objects.${complexityMap ? complexityTierPrompt(complexityMap) : ''}`

    const result = streamText({
      model: openai('gpt-4o'),
      system: `You are an expert meal planning assistant for GroceryGo. Generate detailed and personalized meal plans with recipes and a corresponding grocery list in JSON format.

CRITICAL RULES:
- Generate the EXACT number of recipes requested—no more, no less
- After generating all recipes, COUNT them and verify the total matches exactly
- If the count is wrong, you MUST regenerate until it matches
- Follow measurement units and formatting guidelines strictly

PROCESS:
1. Plan: Determine recipe distribution (X breakfasts, Y lunches, Z dinners)
2. Generate: Create each recipe group-by-group (all breakfasts, then all lunches, then all dinners)
3. Validate: Count recipes per meal type and total before outputting
4. Output: Return only if validation passes`,
      prompt: enhancedPrompt,
    })

    // Return the stream as a response
    return result.toTextStreamResponse()

  } catch (error: unknown) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate meal plan' },
      { status: 500 }
    )
  }
}

