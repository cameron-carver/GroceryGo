import { createClient } from '@/utils/supabase/server'
import { GoogleCalendarProvider } from '@/services/calendarProviders/google'
import { AppleCalendarProvider } from '@/services/calendarProviders/apple'
import type { CalendarEvent, CalendarProvider, CalendarSource } from '@/types/calendar'

function getProvider(source: CalendarSource): CalendarProvider {
  switch (source) {
    case 'google':
      return new GoogleCalendarProvider()
    case 'apple':
      return new AppleCalendarProvider()
    default:
      throw new Error(`Unknown calendar source: ${source}`)
  }
}

export async function getConnectedProviders(userId: string): Promise<CalendarSource[]> {
  const supabase = await createClient()

  const { data: connections, error } = await supabase
    .from('calendar_connections')
    .select('provider')
    .eq('user_id', userId)

  if (error) {
    console.error('Failed to fetch calendar connections:', error.message)
    return []
  }

  return (connections ?? []).map((c) => c.provider as CalendarSource)
}

export async function fetchAllEvents(
  startDate: Date,
  endDate: Date
): Promise<CalendarEvent[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Not authenticated')
  }

  const sources = await getConnectedProviders(user.id)

  if (sources.length === 0) {
    return []
  }

  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const provider = getProvider(source)
      await provider.authenticate(user.id)
      const events = await provider.fetchEvents(startDate, endDate)

      // Update last_fetched_at on successful fetch
      await supabase
        .from('calendar_connections')
        .update({ last_fetched_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('provider', source)

      return events
    })
  )

  const allEvents: CalendarEvent[] = []

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allEvents.push(...result.value)
    } else {
      console.error('Calendar fetch failed for a provider:', result.reason)
    }
  }

  // Sort by startTime ascending
  allEvents.sort((a, b) => a.startTime.getTime() - b.startTime.getTime())

  return allEvents
}

export async function disconnectCalendar(
  userId: string,
  source: CalendarSource
): Promise<void> {
  const provider = getProvider(source)
  await provider.revokeAccess(userId)
}
