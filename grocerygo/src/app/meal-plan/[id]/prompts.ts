import type { SurveyResponse } from '@/types/database'

const MEASUREMENT_UNITS_PROMPT = `
When specifying ingredient quantities, use these standardized measurement units based on Instacart's API requirements:

Volume Measurements:
- cup, cups, or c (e.g., walnuts, heavy cream, rolled oats)
- fl oz (e.g., milk, water, oil)
- gallon, gallons, gal, or gals (e.g., milk, water)
- milliliter, millilitre, milliliters, millilitres, ml, or mls (e.g., milk, juice)
- liter, litre, liters, litres, or l (e.g., water, juice)
- pint, pints, pt, or pts (e.g., ice cream)
- quart, quarts, qt, or qts (e.g., ice cream)
- tablespoon, tablespoons, tb, or tbs (e.g., oil, salt, sugar) - DO NOT use "tbsp"
- teaspoon, teaspoons, ts, tsp, or tspn (e.g., pepper, spices)

Weight Measurements:
- gram, grams, g, or gs (e.g., rice, pasta)
- kilogram, kilograms, kg, or kgs (e.g., meat, flour)
- ounce, ounces, or oz (e.g., cereal, butter)
- pound, pounds, lb, or lbs (e.g., meat, flour)

Countable Items:
- bunch or bunches (e.g., carrots, beets)
- can or cans (e.g., corn, beans)
- each (e.g., tomatoes, onions, garlic cloves) - Use for individual items
- ears (e.g., corn)
- head or heads (e.g., lettuce)
- large, lrg, lge, or lg (e.g., eggs, avocados)
- medium, med, or md (e.g., eggs, avocados)
- package or packages (e.g., meat)
- packet (e.g., scones)
- small or sm (e.g., eggs, avocados)

Container Types:
- container (e.g., berries, prepared meals)
- jar (e.g., oil, broth)
- pouch (e.g., baby food)
- bag (e.g., produce)
- box (e.g., cereal)

Important Rules:
1. For countable items (like tomatoes, onions), use "each" rather than weight
2. For garlic cloves, use "each" as the unit (e.g., "4 each garlic cloves") - DO NOT use "cloves" as a unit
3. Use the most appropriate unit for the ingredient (e.g., "2 cups milk" not "16 fl oz milk")
4. Be consistent with units throughout the recipe
5. ONLY use abbreviations from the list above (e.g., "tbs" or "tb" for tablespoon, NEVER "tbsp")
6. Include both quantity and unit in the format: "quantity unit" (e.g., "2 cups", "1 lb", "3 each")
`;

export const replaceRecipePrompt = (
  surveyData: SurveyResponse,
  mealType: string,
  existingIngredients: string[],
  recipeToReplace: string
) => {
  // Extract favored and excluded ingredients
  const favoredIngredients = (surveyData.favored_ingredients || []) as string[]
  const excludedIngredients = (surveyData.excluded_ingredients || []) as string[]
  
  let ingredientPreferencesSection = ''
  if (favoredIngredients.length > 0 || excludedIngredients.length > 0) {
    ingredientPreferencesSection = '\n### Ingredient Preferences:\n'
    
    if (favoredIngredients.length > 0) {
      ingredientPreferencesSection += `**Favored Ingredients (prioritize using these):** ${favoredIngredients.join(', ')}\n`
    }
    
    if (excludedIngredients.length > 0) {
      ingredientPreferencesSection += `**Excluded Ingredients (NEVER use these):** ${excludedIngredients.join(', ')}\n`
    }
  }
  
  // Check if protein requirement applies
  const goals = (surveyData['9'] || []) as string[]
  const priorities = (surveyData['11'] || []) as string[]
  const requiresProtein = goals.includes('Eat healthier') || priorities[0] === 'Nutrition'
  
  let proteinRequirement = ''
  if (requiresProtein) {
    proteinRequirement = `\n### Protein Requirement:
Since the user has "Eat healthier" as a goal or "Nutrition" as their #1 priority, this recipe MUST include a good quality protein source:
- Animal proteins: chicken, turkey, beef, pork, fish, seafood, eggs, Greek yogurt, cottage cheese
- Plant proteins: tofu, tempeh, legumes (beans, lentils, chickpeas), quinoa, nuts, seeds
- For breakfast: eggs, Greek yogurt, cottage cheese, protein powder, nut butters
- For lunch/dinner: include a substantial protein as the main component
- Minimum 15-20g protein per serving\n`
  }
  
  return `You are an expert meal planner generating a single replacement recipe.

### Context:
The user wants to replace the recipe "${recipeToReplace}" with a new ${mealType} recipe.

### User Preferences:
${JSON.stringify(surveyData, null, 2)}
${ingredientPreferencesSection}${proteinRequirement}
### Existing Ingredients in Meal Plan:
${existingIngredients.join(', ')}

### Requirements:
1. Generate EXACTLY 1 ${mealType} recipe
2. Follow all dietary restrictions and preferences from the user data
3. NEVER use any excluded ingredients
4. Prioritize using favored ingredients when appropriate
5. Try to reuse ingredients from the existing meal plan when possible
6. Match the user's skill level and time constraints
7. Different from "${recipeToReplace}" - don't generate similar recipes
8. ${requiresProtein ? 'MANDATORY: Include a good quality protein source (see Protein Requirement above)' : 'Include appropriate protein if suitable for the meal type'}

### Measurement Units:
${MEASUREMENT_UNITS_PROMPT}

### Output Format (JSON only, no explanation):
{
  "recipe": {
    "name": "Recipe Name",
    "ingredients": [
      { "item": "Ingredient Name", "quantity": "Amount + Unit" }
    ],
    "steps": [
      "Step 1",
      "Step 2"
    ]
  },
  "additional_grocery_items": [
    { "item": "Ingredient Name", "quantity": "Amount + Unit" }
  ]
}

Note: additional_grocery_items should only include NEW ingredients not in the existing list.`;
};

export const bulkAdjustmentPrompt = (
  surveyData: SurveyResponse,
  adjustments: {
    reduceTime?: boolean
    lowerBudget?: boolean
    minimizeIngredients?: boolean
  },
  totalMeals: number,
  mealBreakdown: { breakfast: number; lunch: number; dinner: number }
) => {
  const adjustmentInstructions = []
  
  if (adjustments.reduceTime) {
    adjustmentInstructions.push('- Prioritize recipes that take 30 minutes or less')
    adjustmentInstructions.push('- Favor simple cooking techniques and minimal prep')
  }
  
  if (adjustments.lowerBudget) {
    adjustmentInstructions.push('- Use budget-friendly ingredients (chicken thighs instead of breasts, canned beans, etc.)')
    adjustmentInstructions.push('- Maximize ingredient reuse across recipes')
    adjustmentInstructions.push('- Avoid expensive or specialty ingredients')
  }
  
  if (adjustments.minimizeIngredients) {
    adjustmentInstructions.push('- Limit total unique ingredients to 15-20 items maximum')
    adjustmentInstructions.push('- Reuse the same ingredients across multiple recipes')
    adjustmentInstructions.push('- Focus on pantry staples')
  }

  // Extract favored and excluded ingredients
  const favoredIngredients = (surveyData.favored_ingredients || []) as string[]
  const excludedIngredients = (surveyData.excluded_ingredients || []) as string[]
  
  let ingredientPreferencesSection = ''
  if (favoredIngredients.length > 0 || excludedIngredients.length > 0) {
    ingredientPreferencesSection = '\n### Ingredient Preferences:\n'
    
    if (favoredIngredients.length > 0) {
      ingredientPreferencesSection += `**Favored Ingredients (prioritize using these):** ${favoredIngredients.join(', ')}\n`
    }
    
    if (excludedIngredients.length > 0) {
      ingredientPreferencesSection += `**Excluded Ingredients (NEVER use these):** ${excludedIngredients.join(', ')}\n`
    }
  }

  // Check if protein requirement applies
  const goals = (surveyData['9'] || []) as string[]
  const priorities = (surveyData['11'] || []) as string[]
  const requiresProtein = goals.includes('Eat healthier') || priorities[0] === 'Nutrition'
  
  let proteinRequirement = ''
  if (requiresProtein) {
    proteinRequirement = `\n### Protein Requirement:
Since the user has "Eat healthier" as a goal or "Nutrition" as their #1 priority, ALL recipes MUST include a good quality protein source:
- Animal proteins: chicken, turkey, beef, pork, fish, seafood, eggs, Greek yogurt, cottage cheese
- Plant proteins: tofu, tempeh, legumes (beans, lentils, chickpeas), quinoa, nuts, seeds
- For breakfast: eggs, Greek yogurt, cottage cheese, protein powder, nut butters
- For lunch/dinner: include a substantial protein as the main component
- Minimum 15-20g protein per serving\n`
  }

  /**
   * NOTE FOR FUTURE IMPROVEMENTS:
   *   1. Add a validation checklist in the prompt so GPT confirms both recipes & schedule sections were produced.
   *   2. Consider switching regenerateWithAdjustments to callOpenAIStructured with a schema that requires schedule entries.
   *   3. Extend server-side fallback/repair logic so downstream inserts always receive a complete schedule even if GPT skips it.
   */
  return `You are an expert meal planner regenerating a complete meal plan with specific optimizations.

### User Preferences:
${JSON.stringify(surveyData, null, 2)}
${ingredientPreferencesSection}${proteinRequirement}
### Special Optimizations to Apply:
${adjustmentInstructions.join('\n')}

### Requirements:
1. Generate exactly ${totalMeals} recipes:
   - ${mealBreakdown.breakfast} breakfast meals
   - ${mealBreakdown.lunch} lunch meals
   - ${mealBreakdown.dinner} dinner meals
2. Follow all dietary restrictions from user preferences
3. NEVER use any excluded ingredients
4. Prioritize using favored ingredients when appropriate
5. Apply ALL optimization constraints listed above
6. Label each recipe with appropriate meal_type
7. ${requiresProtein ? 'MANDATORY: Every recipe MUST include a good quality protein source (see Protein Requirement above)' : 'Include appropriate protein in recipes where suitable'}

### Measurement Units:
${MEASUREMENT_UNITS_PROMPT}

### Output Format (JSON only, no explanation):
{
  "recipes": [
    {
      "name": "Recipe Name",
      "mealType": "Breakfast | Lunch | Dinner",
      "ingredients": [
        { "item": "Ingredient Name", "quantity": "Amount + Unit" }
      ],
      "steps": [
        "Step 1",
        "Step 2"
      ]
    }
  ],
  "grocery_list": [
    { "item": "Ingredient Name", "quantity": "Total Amount + Unit" }
  ]
}

**Important**: Every recipe MUST include a "mealType" field indicating the type of meal (Breakfast, Lunch, or Dinner).`;
};

export const swapIngredientPrompt = (
  ingredientName: string,
  recipeName: string,
  recipeContext: string
) => `You are a culinary expert suggesting ingredient substitutions.

### Context:
Recipe: "${recipeName}"
Current Ingredient: "${ingredientName}"
Recipe Type: ${recipeContext}

### Task:
Suggest 3-5 alternative ingredients that could replace "${ingredientName}" in this recipe.
Consider: allergies, availability, cost, and maintaining the recipe's flavor profile.

### Output Format (JSON only):
{
  "suggestions": [
    {
      "ingredient": "Alternative Ingredient Name",
      "reason": "Why this works as a substitute",
      "quantity_adjustment": "1:1 ratio" or "Use 2x amount" etc.
    }
  ]
}`;

export const simplifyRecipePrompt = (
  recipeName: string,
  ingredients: Array<{ item: string; quantity: string }>,
  steps: string[]
) => `You are a meal planning expert helping busy people cook more efficiently.

### Current Recipe: "${recipeName}"

### Current Ingredients:
${ingredients.map(ing => `- ${ing.quantity} ${ing.item}`).join('\n')}

### Current Steps:
${steps.map((step, idx) => `${idx + 1}. ${step}`).join('\n')}

### Task:
Simplify this recipe by:
1. Suggesting store-bought alternatives for complex components
2. Reducing the number of steps where possible
3. Using pre-prepped ingredients (rotisserie chicken, pre-cut vegetables, jarred sauces, etc.)
4. Maintaining the core flavor and dish concept

### Output Format (JSON only):
{
  "simplified_recipe": {
    "name": "${recipeName} (Simplified)",
    "ingredients": [
      { "item": "Ingredient (can be store-bought)", "quantity": "Amount + Unit" }
    ],
    "steps": [
      "Simplified step 1",
      "Simplified step 2"
    ]
  },
  "time_saved": "Estimated time savings",
  "changes_made": "Brief description of simplifications"
}`;

export { MEASUREMENT_UNITS_PROMPT };

