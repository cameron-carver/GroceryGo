import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import MealPlanGenerateClient from './MealPlanGenerateClient'

export default async function MealPlanGeneratePage({
  searchParams,
}: {
  searchParams: Promise<{ complexityMap?: string; weekScoreId?: string }>
}) {
  const supabase = await createClient()

  // Check authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  // Check if user has completed the questionnaire
  const { data: userData } = await supabase
    .from('users')
    .select('survey_response')
    .eq('user_id', user.id)
    .single()

  if (!userData?.survey_response) {
    redirect('/onboarding')
  }

  const resolvedParams = await searchParams
  let complexityMap: Record<string, string> | undefined
  if (resolvedParams.complexityMap) {
    try {
      complexityMap = JSON.parse(resolvedParams.complexityMap)
    } catch {
      // Ignore invalid JSON
    }
  }

  return (
    <MealPlanGenerateClient
      surveyResponse={userData.survey_response}
      complexityMap={complexityMap}
      weekScoreId={resolvedParams.weekScoreId}
    />
  )
}
