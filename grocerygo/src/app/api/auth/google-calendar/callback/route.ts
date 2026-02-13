import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'
import { encrypt } from '@/utils/encryption'

export async function GET(request: NextRequest) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

  try {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')

    if (!code || !state) {
      return NextResponse.redirect(new URL('/dashboard?error=calendar_auth_failed', siteUrl))
    }

    // Verify CSRF nonce
    const cookieStore = await cookies()
    const storedNonce = cookieStore.get('calendar_auth_nonce')?.value
    cookieStore.delete('calendar_auth_nonce')

    if (!storedNonce || storedNonce !== state) {
      return NextResponse.redirect(new URL('/dashboard?error=calendar_auth_failed', siteUrl))
    }

    // Verify authenticated user
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.redirect(new URL('/login', siteUrl))
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    )

    const { tokens } = await oauth2Client.getToken(code)

    const { error } = await supabase
      .from('calendar_connections')
      .upsert(
        {
          user_id: user.id,
          provider: 'google' as const,
          access_token: encrypt(tokens.access_token ?? ''),
          refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
          token_expires_at: tokens.expiry_date
            ? new Date(tokens.expiry_date).toISOString()
            : undefined,
          connected_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' }
      )

    if (error) {
      console.error('Failed to store calendar connection:', error.message)
      return NextResponse.redirect(new URL('/dashboard?error=calendar_auth_failed', siteUrl))
    }

    return NextResponse.redirect(new URL('/week-preview', siteUrl))
  } catch (err) {
    console.error('Google Calendar callback error:', err)
    return NextResponse.redirect(new URL('/dashboard?error=calendar_auth_failed', siteUrl))
  }
}
