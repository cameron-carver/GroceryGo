'use server'

import { callOpenAI } from './aiHelper'

/**
 * Sanitize user input to remove potentially malicious content
 * Strips HTML, script tags, SQL injection attempts, and code blocks
 */
function sanitizeUserInput(input: string): string {
  if (!input || typeof input !== 'string') {
    return ''
  }

  let sanitized = input
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove script tags and content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove potential SQL injection patterns
    .replace(/(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/gi, '')
    // Remove markdown code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Remove inline code
    .replace(/`[^`]*`/g, '')
    // Remove potential XSS attempts
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    // Trim excessive whitespace
    .replace(/\s+/g, ' ')
    .trim()

  // Limit length to prevent abuse
  if (sanitized.length > 500) {
    sanitized = sanitized.substring(0, 500)
  }

  return sanitized
}

/**
 * Validate that the question is related to cooking/recipes
 */
function isValidCookingQuestion(question: string): boolean {
  // Check for minimum length
  if (question.length < 3) {
    return false
  }

  // Check for cooking-related keywords (flexible but important)
  const cookingKeywords = [
    'cook', 'bake', 'recipe', 'ingredient', 'prep', 'prepare', 'temperature',
    'time', 'how', 'what', 'when', 'why', 'oven', 'stove', 'pan', 'mix',
    'cut', 'chop', 'boil', 'fry', 'saute', 'simmer', 'serve', 'season',
    'substitute', 'replace', 'alternative', 'taste', 'flavor', 'texture',
    'done', 'ready', 'help', 'question', 'explain', 'tell', 'mean', 'step'
  ]

  const lowerQuestion = question.toLowerCase()
  
  // Allow questions with cooking keywords OR general interrogatives about the recipe
  const hasRelevantKeyword = cookingKeywords.some(keyword => 
    lowerQuestion.includes(keyword)
  )

  // Also allow short questions if they contain question words
  const hasQuestionWord = /\b(how|what|when|why|where|can|should|do|does|is|are)\b/i.test(question)

  return hasRelevantKeyword || hasQuestionWord
}

interface RecipeCookingAssistantResponse {
  detailedResponse: string
  shortSummary: string
}

interface RecipeCookingAssistantResult {
  success: boolean
  data?: RecipeCookingAssistantResponse
  error?: string
}

/**
 * Ask AI questions about cooking a specific recipe
 * Strictly enforces policy to only answer cooking-related questions
 */
export async function askRecipeCookingQuestion(
  recipeName: string,
  ingredients: Array<{ item: string; quantity: string }>,
  steps: string[],
  userQuestion: string
): Promise<RecipeCookingAssistantResult> {
  try {
    // Sanitize user input
    const sanitizedQuestion = sanitizeUserInput(userQuestion)

    if (!sanitizedQuestion) {
      return {
        success: false,
        error: 'Invalid question. Please provide a valid cooking-related question.'
      }
    }

    // Validate that question is cooking-related
    if (!isValidCookingQuestion(sanitizedQuestion)) {
      return {
        success: false,
        error: 'Please ask questions specifically about cooking this recipe.'
      }
    }

    // Create strict system prompt
    const systemPrompt = `You are a helpful cooking assistant that ONLY answers questions about cooking the specific recipe provided.

STRICT POLICY:
1. ONLY answer questions directly related to cooking, preparing, or understanding THIS SPECIFIC RECIPE
2. Do NOT answer questions about:
   - Other recipes or dishes
   - Nutrition or health advice (beyond basic cooking)
   - Shopping or where to buy ingredients
   - Personal information or non-cooking topics
   - Programming, technology, or any non-cooking subjects
3. If the question is not about cooking this recipe, politely redirect the user to ask about the recipe
4. Keep responses focused, practical, and helpful for someone cooking this dish
5. Be concise but thorough when explaining cooking techniques

Your response MUST be in this EXACT JSON format:
{
  "detailedResponse": "A detailed, helpful answer to the cooking question (2-4 sentences)",
  "shortSummary": "A brief 1-sentence summary suitable for saving as a note"
}

If the question is not about cooking this recipe, use:
{
  "detailedResponse": "I can only help with questions about cooking this specific recipe. Please ask about the ingredients, cooking steps, techniques, or timing for this dish.",
  "shortSummary": "Question not related to recipe"
}`

    // Create user prompt with recipe context
    const userPrompt = `Recipe: ${recipeName}

Ingredients:
${ingredients.map(ing => `- ${ing.quantity} ${ing.item}`).join('\n')}

Instructions:
${steps.map((step, idx) => `${idx + 1}. ${step}`).join('\n')}

User Question: ${sanitizedQuestion}

Remember: ONLY answer if this question is about cooking this specific recipe. If not, politely redirect.`

    // Call OpenAI with strict validation
    const result = await callOpenAI<RecipeCookingAssistantResponse>(
      systemPrompt,
      userPrompt,
      (response: string) => {
        // Extract JSON from response
        const jsonMatch = response.match(/\{[\s\S]*\}/)
        if (!jsonMatch) {
          throw new Error('No JSON found in response')
        }
        
        const parsed = JSON.parse(jsonMatch[0])
        
        if (!parsed.detailedResponse || !parsed.shortSummary) {
          throw new Error('Missing required fields in response')
        }

        return {
          detailedResponse: parsed.detailedResponse,
          shortSummary: parsed.shortSummary
        }
      },
      (data: RecipeCookingAssistantResponse) => {
        // Validate response is reasonable
        return (
          data.detailedResponse.length > 10 &&
          data.detailedResponse.length < 2000 &&
          data.shortSummary.length > 5 &&
          data.shortSummary.length < 200
        )
      }
    )

    if (!result.success || !result.data) {
      return {
        success: false,
        error: result.error || 'Failed to get cooking assistance'
      }
    }

    // Additional safety check: ensure response doesn't contain code or scripts
    const response = result.data.detailedResponse
    const summary = result.data.shortSummary
    
    if (
      response.includes('<script') ||
      response.includes('javascript:') ||
      summary.includes('<script') ||
      summary.includes('javascript:')
    ) {
      return {
        success: false,
        error: 'Invalid response from AI assistant'
      }
    }

    return {
      success: true,
      data: result.data
    }

  } catch (error: unknown) {
    console.error('Recipe cooking assistant error:', error)
    return {
      success: false,
      error:
        error instanceof Error
          ? `An unexpected error occurred: ${error.message}`
          : 'An unexpected error occurred. Please try again.'
    }
  }
}

