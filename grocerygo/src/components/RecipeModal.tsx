'use client'

import { useEffect, useState } from 'react'
import type { Recipe } from '@/types/database'
import RecipeAdjustments from './RecipeAdjustments'
import { askRecipeCookingQuestion } from '@/app/actions/recipeCookingAssistant'

interface RecipeModalProps {
  recipe: Recipe
  isOpen: boolean
  onClose: () => void
  // Optional callbacks for recipe adjustments
  onScaleServings?: (recipeId: string, multiplier: number) => void
  onSwapIngredient?: (recipeId: string, oldIngredient: string, newIngredient: string) => void
  onSimplifySteps?: (recipeId: string) => void
  // Optional callback to save cooking notes
  onSaveCookingNote?: (recipeId: string, note: string) => void
  plannedSlots?: Array<{
    label: string
    portionMultiplier: number
    plannedDate?: string | null
    mealType?: string
  }>
}

interface ChatMessage {
  question: string
  answer: string
  timestamp: Date
}

export default function RecipeModal({ 
  recipe, 
  isOpen, 
  onClose,
  onScaleServings,
  onSwapIngredient,
  onSimplifySteps,
  onSaveCookingNote,
  plannedSlots
}: RecipeModalProps) {
  const totalPlannedPortions = plannedSlots?.reduce((sum, slot) => sum + slot.portionMultiplier, 0)

  const formatPlannedDate = (value?: string | null) => {
    if (!value) return null
    const date = new Date(value + 'T00:00:00')
    if (Number.isNaN(date.getTime())) return null
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    })
  }

  // State for cooking assistant
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [currentQuestion, setCurrentQuestion] = useState('')
  const [isAsking, setIsAsking] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEsc)
      document.body.style.overflow = 'hidden' // Prevent background scroll
    }
    return () => {
      document.removeEventListener('keydown', handleEsc)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  // Reset chat when modal closes
  useEffect(() => {
    if (!isOpen) {
      setChatMessages([])
      setCurrentQuestion('')
      setAskError(null)
    }
  }, [isOpen])

  // Handle asking a cooking question
  const handleAskQuestion = async () => {
    if (!currentQuestion.trim()) return

    setIsAsking(true)
    setAskError(null)

    try {
      const result = await askRecipeCookingQuestion(
        recipe.name,
        recipe.ingredients,
        recipe.steps,
        currentQuestion
      )

      if (result.success && result.data) {
        // Add message to chat
        setChatMessages(prev => [...prev, {
          question: currentQuestion,
          answer: result.data!.detailedResponse,
          timestamp: new Date()
        }])

        // Save note to recipe if callback provided AND response is recipe-related
        // Don't save notes for rejection messages (non-recipe questions)
        const isRejectionMessage = 
          result.data.shortSummary.toLowerCase().includes('not related') ||
          result.data.detailedResponse.toLowerCase().includes('only help with questions about cooking this specific recipe')
        
        if (onSaveCookingNote && result.data.shortSummary && !isRejectionMessage) {
          onSaveCookingNote(recipe.id, result.data.shortSummary)
        }

        // Clear input
        setCurrentQuestion('')
      } else {
        setAskError(result.error || 'Failed to get answer')
      }
    } catch (error) {
      setAskError('An unexpected error occurred: ' + error)
    } finally {
      setIsAsking(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black opacity-40 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div 
          className="relative bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-gray-200 px-8 py-6 flex items-start justify-between z-10">
            <div className="flex-1 pr-8">
              <h2 className="text-3xl font-bold text-gray-900 mb-3">
                {recipe.name}
              </h2>
              <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                {recipe.meal_type && (
                  <span className="inline-flex items-center justify-center gap-2 px-3 py-1 rounded-full bg-[var(--gg-primary)]">
                    <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <span className="font-semibold text-white capitalize">{recipe.meal_type}</span>
                  </span>
                )}
                {recipe.prep_time_minutes && (
                  <span className="flex items-center gap-2">
                    <svg className="h-5 w-5 text-[var(--gg-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="font-medium">{recipe.prep_time_minutes} minutes</span>
                  </span>
                )}
                {recipe.servings && (
                  <span className="flex items-center gap-2">
                    <svg className="h-5 w-5 text-[var(--gg-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <span className="font-medium">{recipe.servings} servings</span>
                  </span>
                )}
                {recipe.difficulty && (
                  <span className="flex items-center gap-2">
                    <svg className="h-5 w-5 text-[var(--gg-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span className="font-medium capitalize">{recipe.difficulty}</span>
                  </span>
                )}
              </div>
            </div>
            
            {plannedSlots && plannedSlots.length > 0 && (
              <div className="mb-6 rounded-xl border border-green-100 bg-green-50 px-6 py-5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <div>
                      <p className="font-semibold text-green-900 text-sm">
                        Planned across {plannedSlots.length} meal slot{plannedSlots.length === 1 ? '' : 's'}
                      </p>
                      <p className="text-xs text-green-800">
                        Cook once, enjoy {plannedSlots.length} times. Total portions planned: {totalPlannedPortions ?? recipe.servings ?? plannedSlots.length}.
                      </p>
                    </div>
                  </div>
                  {recipe.servings && (
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-green-700 border border-green-200">
                      Base recipe makes {recipe.servings} serving{recipe.servings === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {plannedSlots.map((slot, idx) => {
                    const dateLabel = slot.plannedDate ? formatPlannedDate(slot.plannedDate) : null
                    return (
                      <span
                        key={`${slot.label}-${idx}`}
                        className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs text-green-800 border border-green-200 shadow-sm"
                      >
                        <span className="font-semibold">{slot.label}</span>
                        {dateLabel && <span className="text-gray-400">{dateLabel}</span>}
                        <span className="inline-flex items-center gap-1 text-green-600 font-semibold">
                          ×{slot.portionMultiplier}
                        </span>
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
            
            {/* Close Button */}
            <button
              onClick={onClose}
              className="flex-shrink-0 p-2 rounded-full hover:bg-gray-100 transition-colors"
              aria-label="Close modal"
            >
              <svg className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="px-8 py-6 pb-8 overflow-y-auto max-h-[calc(90vh-100px)]">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              
              {/* Ingredients */}
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <svg className="h-6 w-6 text-[var(--gg-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Ingredients
                </h3>
                <div className="space-y-3">
                  {recipe.ingredients.map((ingredient, index) => (
                    <div 
                      key={index}
                      className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--gg-primary)] text-white text-xs font-bold flex-shrink-0">
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">
                          {ingredient.item}
                        </p>
                        <p className="text-sm text-gray-600">
                          {ingredient.quantity}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Instructions */}
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <svg className="h-6 w-6 text-[var(--gg-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Instructions
                </h3>
                <div className="space-y-4">
                  {recipe.steps.map((step, index) => (
                    <div 
                      key={index}
                      className="flex items-start gap-4"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--gg-primary)] text-white text-sm font-bold flex-shrink-0">
                        {index + 1}
                      </div>
                      <p className="flex-1 text-gray-700 leading-relaxed pt-1">
                        {step}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Nutrition Info (if available) */}
            {recipe.nutrition_info && (
              <div className="mt-8 p-6 rounded-xl bg-gradient-to-br from-green-50 to-blue-50 border border-green-200">
                <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <svg className="h-6 w-6 text-[var(--gg-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  Nutrition Facts
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {recipe.nutrition_info.calories && (
                    <div className="bg-white rounded-lg p-4 text-center">
                      <p className="text-2xl font-bold text-[var(--gg-primary)]">
                        {recipe.nutrition_info.calories}
                      </p>
                      <p className="text-sm text-gray-600">Calories</p>
                    </div>
                  )}
                  {recipe.nutrition_info.protein && (
                    <div className="bg-white rounded-lg p-4 text-center">
                      <p className="text-2xl font-bold text-[var(--gg-primary)]">
                        {recipe.nutrition_info.protein}g
                      </p>
                      <p className="text-sm text-gray-600">Protein</p>
                    </div>
                  )}
                  {recipe.nutrition_info.carbs && (
                    <div className="bg-white rounded-lg p-4 text-center">
                      <p className="text-2xl font-bold text-[var(--gg-primary)]">
                        {recipe.nutrition_info.carbs}g
                      </p>
                      <p className="text-sm text-gray-600">Carbs</p>
                    </div>
                  )}
                  {recipe.nutrition_info.fat && (
                    <div className="bg-white rounded-lg p-4 text-center">
                      <p className="text-2xl font-bold text-[var(--gg-primary)]">
                        {recipe.nutrition_info.fat}g
                      </p>
                      <p className="text-sm text-gray-600">Fat</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Recipe Adjustments */}
            {(onScaleServings || onSwapIngredient || onSimplifySteps) && (
              <div className="mt-8">
                <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <svg className="h-6 w-6 text-[var(--gg-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                  </svg>
                  Customize This Recipe
                </h3>
                <RecipeAdjustments
                  recipeId={recipe.id}
                  currentServings={recipe.servings || 4}
                  ingredients={recipe.ingredients}
                  onScaleServings={onScaleServings}
                  onSwapIngredient={onSwapIngredient}
                  onSimplifySteps={onSimplifySteps}
                />
              </div>
            )}

            {/* Tags (if available) */}
            {(recipe.dietary_tags || recipe.cuisine_type || recipe.flavor_profile) && (
              <div className="mt-6 flex flex-wrap gap-2">
                {recipe.dietary_tags?.map((tag) => (
                  <span 
                    key={tag}
                    className="px-3 py-1 rounded-full bg-blue-100 text-blue-800 text-sm font-medium"
                  >
                    {tag}
                  </span>
                ))}
                {recipe.cuisine_type?.map((cuisine) => (
                  <span 
                    key={cuisine}
                    className="px-3 py-1 rounded-full bg-purple-100 text-purple-800 text-sm font-medium"
                  >
                    {cuisine}
                  </span>
                ))}
                {recipe.flavor_profile?.map((flavor) => (
                  <span 
                    key={flavor}
                    className="px-3 py-1 rounded-full bg-orange-100 text-orange-800 text-sm font-medium"
                  >
                    {flavor}
                  </span>
                ))}
              </div>
            )}

            {/* Cooking Notes Section */}
            {recipe.cooking_notes && recipe.cooking_notes.length > 0 && (
              <div className="mt-8 p-6 rounded-xl bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-200">
                <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <svg className="h-6 w-6 text-[var(--gg-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Cooking Notes
                </h3>
                <div className="space-y-2">
                  {recipe.cooking_notes.map((note, index) => (
                    <div 
                      key={index}
                      className="flex items-start gap-3 p-3 rounded-lg bg-white"
                    >
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white text-xs font-bold flex-shrink-0 mt-0.5">
                        •
                      </div>
                      <p className="flex-1 text-gray-700 text-sm">
                        {note}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Cooking Assistant */}
            <div className="mt-8 p-6 rounded-xl bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200">
              <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <svg className="h-6 w-6 text-[var(--gg-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Cooking Assistant
                <span className="text-xs text-gray-500 font-normal ml-2">
                  Ask questions about cooking this recipe
                </span>
              </h3>

              {/* Chat Messages */}
              {chatMessages.length > 0 && (
                <div className="mb-4 space-y-3 max-h-60 overflow-y-auto">
                  {chatMessages.map((msg, index) => (
                    <div key={index} className="space-y-2">
                      {/* User Question */}
                      <div className="flex justify-end">
                        <div className="max-w-[80%] p-3 rounded-lg bg-indigo-600 text-white">
                          <p className="text-sm">{msg.question}</p>
                        </div>
                      </div>
                      {/* AI Answer */}
                      <div className="flex justify-start">
                        <div className="max-w-[80%] p-3 rounded-lg bg-white border border-indigo-200">
                          <p className="text-sm text-gray-700">{msg.answer}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Error Message */}
              {askError && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200">
                  <p className="text-sm text-red-600">{askError}</p>
                </div>
              )}

              {/* Question Input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={currentQuestion}
                  onChange={(e) => setCurrentQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isAsking) {
                      handleAskQuestion()
                    }
                  }}
                  placeholder="Ask about ingredients, techniques, timing..."
                  className="flex-1 px-4 py-3 rounded-lg border border-indigo-300 focus:outline-none focus:ring-2 focus:ring-[var(--gg-primary)] focus:border-transparent text-sm"
                  disabled={isAsking}
                />
                <button
                  onClick={handleAskQuestion}
                  disabled={isAsking || !currentQuestion.trim()}
                  className="px-6 py-3 rounded-lg bg-[var(--gg-primary)] text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isAsking ? (
                    <>
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Asking...</span>
                    </>
                  ) : (
                    <span>Ask</span>
                  )}
                </button>
              </div>
              
              <p className="mt-3 text-xs text-gray-500 italic">
                Note: This assistant only answers questions about cooking this specific recipe.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

