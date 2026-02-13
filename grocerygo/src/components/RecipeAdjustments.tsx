'use client'

interface RecipeAdjustmentsProps {
  recipeId: string
  currentServings: number
  ingredients: Array<{
    item: string
    quantity: string
    unit?: string
  }>
  onScaleServings?: (recipeId: string, multiplier: number) => void
  onSwapIngredient?: (recipeId: string, oldIngredient: string, newIngredient: string) => void
  onSimplifySteps?: (recipeId: string) => void
}

export default function RecipeAdjustments({
  recipeId,
  currentServings,
  ingredients,
  onScaleServings,
  onSwapIngredient,
  onSimplifySteps
}: RecipeAdjustmentsProps) {
  const scaleOptions = [0.5, 1, 2]

  const handleScale = (multiplier: number) => {
    if (onScaleServings) {
      onScaleServings(recipeId, multiplier)
    }
  }

  const handleSwapFirstIngredient = () => {
    if (onSwapIngredient && ingredients.length > 0) {
      const ingredient = ingredients[0]
      onSwapIngredient(recipeId, ingredient.item, ingredient.item)
    }
  }

  const handleSimplify = () => {
    if (onSimplifySteps) {
      onSimplifySteps(recipeId)
    }
  }

  return (
    <div className="space-y-4">
      <div className="border-2 border-dashed border-gray-200 rounded-lg p-4 bg-gray-50">
        <h4 className="font-semibold text-gray-900 mb-2">Recipe Adjustments</h4>
        <p className="text-sm text-gray-600 mb-4">
          Current servings: <span className="font-medium">{currentServings}</span>
        </p>

        {onScaleServings && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-gray-500 mb-2">Quick scale:</p>
            <div className="flex gap-2">
              {scaleOptions.map((option) => (
                <button
                  key={option}
                  onClick={() => handleScale(option)}
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:border-[var(--gg-primary)] hover:text-[var(--gg-primary)] transition-colors"
                >
                  {option}x
                </button>
              ))}
            </div>
          </div>
        )}

        {onSwapIngredient && ingredients.length > 0 && (
          <button
            onClick={handleSwapFirstIngredient}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:border-[var(--gg-primary)] hover:text-[var(--gg-primary)] transition-colors"
          >
            Swap ingredient: {ingredients[0].item}
          </button>
        )}

        {onSimplifySteps && (
          <button
            onClick={handleSimplify}
            className="w-full mt-3 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:border-[var(--gg-primary)] hover:text-[var(--gg-primary)] transition-colors"
          >
            Request simplified version
          </button>
        )}

        {!onScaleServings && !onSwapIngredient && !onSimplifySteps && (
          <p className="text-xs text-gray-500">
            Adjustment actions will appear here as they become available for this recipe.
          </p>
        )}
      </div>
    </div>
  )
}

