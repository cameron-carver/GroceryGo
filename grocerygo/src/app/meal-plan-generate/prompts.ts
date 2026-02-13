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

import { GROCERY_CATEGORIES } from '@/data/ingredientShelfLife'

const mealPlanFromSurveyPrompt = `You are an expert meal planner generating personalized meal plans based on user preferences.
Use the provided user input (below) to generate a detailed meal plan that supports duplicating recipes across multiple meal slots.

### Input format example:
{
  "1": "25-34",
  "2": "5+ people",
  "3": "$50-100",
  "4": "Intermediate (Comfortable with most recipes)",
  "5": "Quick (15-30 minutes)",
  "6": ["No restrictions"],
  "7": ["None"],
  "8": ["Savory", "Spicy", "Sweet"],
  "9": ["Eat healthier", "Learn new recipes", "Save money on groceries", "Reduce food waste"],
  "10": ["Wednesday", "Sunday"],
  "11": ["Cost efficiency", "Nutrition", "Time saving"]
}

### Your task:
1. **Recipe Generation**:  
   Generate recipes distributed by meal type (Breakfast, Lunch, Dinner) as specified by the schema.

2. **Dietary restrictions and allergies**:  
   - DO NOT include ingredients from question 6 (Dietary Restrictions) or question 7 (Allergies).
   - If none listed, no restrictions apply.

3. **Favored and Excluded Ingredients**:
   - **Favored Ingredients**: Prioritize using ingredients from the favored_ingredients list when creating recipes. Try to incorporate these ingredients whenever appropriate for the meal type and flavor profile.
   - **Excluded Ingredients**: NEVER use any ingredients from the excluded_ingredients list. These are ingredients the user dislikes or wants to avoid.
   - If no favored or excluded ingredients are specified, no special preferences apply.

4. **Protein Requirements**:
   - If "Nutrition" is ranked #1 in priorities (Question 11) OR "Eat healthier" is in goals (Question 9):
     EVERY recipe MUST include a good quality protein source. Examples:
     * Animal proteins: chicken, turkey, beef, pork, fish, seafood, eggs, Greek yogurt, cottage cheese
     * Plant proteins: tofu, tempeh, legumes (beans, lentils, chickpeas), quinoa, nuts, seeds
     * Minimum 15-20g protein per serving for main meals
   - For breakfast: eggs, Greek yogurt, cottage cheese, protein powder, nut butters
   - For lunch/dinner: include a substantial protein as the main component

5. **User priorities (Question 11)** - Follow ranked priorities:
   - **Nutrition #1**: Use whole, fresh ingredients. MANDATORY: Include quality protein in every recipe (see Protein Requirements above).
   - **Cost efficiency #1**: Reuse ingredients. Limit unique items (under 20 for "$50-100" budget).
   - **Time saving #1**: Use pre-made/pre-cut items (rotisserie chicken, salad kits).

6. **Budget (Question 3)**: "$50-100" = under 20 unique items; "$101-200" = under 30 items; "$200+" = flexible but reuse encouraged.

7. **Skill level (Question 4)**: Beginner = simple; Intermediate = moderate; Advanced = complex techniques OK.

8. **Time (Question 5)**: "Quick (15-30 min)" = fast recipes; "Standard (30-45 min)" = moderate; "Extended (45+ min)" = complex OK.

9. **Flavors (Question 8)**: Incorporate requested flavor profiles.

10. **Goals (Question 9)**:
   - "Eat healthier": MANDATORY: Include quality protein in every recipe (see Protein Requirements above).
   - "Learn new recipes": Introduce 1-2 new techniques.
   - "Save money": Reuse ingredients maximally.
   - "Reduce waste": Use ingredients fully across recipes.

11. **Measurement Units**:
${MEASUREMENT_UNITS_PROMPT}

12. **Grocery Categories**: Each grocery item MUST include a "category" field from this list: ${GROCERY_CATEGORIES.join(', ')}. Choose the most appropriate category for each item. If unsure, use "Pantry".

---

**Output Format**:
JSON object with keys "recipes", "schedule", and "grocery_list", for example:
{
  "recipes": [
    {
      "id": "recipe-1",
      "name": "Recipe Name",
      "mealType": "Breakfast | Lunch | Dinner",
      "servings": 4,
      "ingredients": [
        { "item": "Ingredient Name", "quantity": "Amount + Unit" }
      ],
      "steps": [
        "Step 1",
        "Step 2"
      ]
    }
  ],
  "schedule": [
    {
      "slotLabel": "Monday Lunch",
      "day": "Monday",
      "mealType": "Lunch",
      "recipeId": "recipe-1",
      "portionMultiplier": 1
    }
  ],
  "grocery_list": [
    { "item": "Ingredient Name", "quantity": "Total Amount + Unit", "category": "Produce" }
  ]
}

**Important**:
- Every recipe MUST include an "id" that will be referenced by the schedule array.
- The "schedule" array MUST contain an entry for every selected meal slot (day + mealType) and reference an existing recipe id.
- Every recipe MUST include a "mealType" field indicating the type of meal (Breakfast, Lunch, or Dinner).`;

export function complexityTierPrompt(complexityMap: Record<string, string>): string {
  const entries = Object.entries(complexityMap)
  if (entries.length === 0) return ''

  const dayLines = entries.map(([day, tier]) => {
    switch (tier) {
      case 'quick':
        return `- ${day}: QUICK meal — under 20 minutes total, minimal ingredients, simple preparation`
      case 'exploratory':
        return `- ${day}: EXPLORATORY meal — 60+ minutes OK, try new cuisines or techniques, elaborate recipes encouraged`
      default:
        return `- ${day}: STANDARD meal — 30-45 minutes, normal home cooking`
    }
  }).join('\n')

  return `\n\n### Day-Specific Meal Complexity (MANDATORY):\n${dayLines}\n\nRULES:\n- QUICK days: prep_time_minutes + cook_time_minutes MUST be under 20. Use 5 or fewer ingredients.\n- STANDARD days: prep_time_minutes + cook_time_minutes between 20-45.\n- EXPLORATORY days: prep_time_minutes + cook_time_minutes can be 45+. Use interesting ingredients, new cuisines, or advanced techniques.\n- This applies to ALL meals on that day.`
}

export { MEASUREMENT_UNITS_PROMPT, mealPlanFromSurveyPrompt };
