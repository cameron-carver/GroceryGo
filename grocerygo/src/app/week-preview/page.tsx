import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { getWeekPreviewData } from './actions'
import WeekPreviewClient from './WeekPreviewClient'
import type { ComponentProps } from 'react'
import Link from 'next/link'

export default async function WeekPreviewPage() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  const previewData = await getWeekPreviewData()

  if ('needsCalendar' in previewData && previewData.needsCalendar) {
    return (
      <div className="gg-bg-page min-h-screen">
        <div className="gg-container">
          <div className="gg-section">
            <h1 className="gg-heading-page mb-4">Connect Your Calendar</h1>
            <p className="gg-text-subtitle mb-8">
              To generate a personalized week preview with complexity tiers, we need access to your calendar.
            </p>
            <div className="gg-card max-w-md">
              <p className="text-gray-700 mb-6">
                Connect your Google Calendar so we can analyze your schedule and recommend the right meal complexity for each day.
              </p>
              <Link
                href="/api/auth/google-calendar"
                className="gg-btn-primary inline-flex items-center gap-2"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
                Connect Google Calendar
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if ('error' in previewData && previewData.error) {
    return (
      <div className="gg-bg-page min-h-screen">
        <div className="gg-container">
          <div className="gg-section">
            <h1 className="gg-heading-page mb-4">Week Preview</h1>
            <div className="gg-card bg-red-50 border-red-200">
              <p className="text-red-800">{previewData.error}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return <WeekPreviewClient initialData={previewData as ComponentProps<typeof WeekPreviewClient>['initialData']} />
}
