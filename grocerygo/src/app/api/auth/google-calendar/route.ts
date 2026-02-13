import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { GoogleCalendarProvider } from '@/services/calendarProviders/google'
import { cookies } from 'next/headers'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user) {
      return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'))
    }

    const nonce = crypto.randomUUID()

    const cookieStore = await cookies()
    cookieStore.set('calendar_auth_nonce', nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
      path: '/',
    })

    const provider = new GoogleCalendarProvider()
    const authUrl = provider.getAuthUrl(nonce)

    return NextResponse.redirect(authUrl)
  } catch (err) {
    console.error('Google Calendar auth initiation failed:', err)
    return NextResponse.redirect(
      new URL('/dashboard?error=calendar_auth_failed', process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000')
    )
  }
}
