import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import {
  codeChallenge,
  createDistributionOAuthState,
  distributionAuthUrl,
  isDistributionProvider,
  providerConnectStatus,
  randomCodeVerifier,
} from '@/lib/distribution'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: rawProvider } = await params
  if (!isDistributionProvider(rawProvider)) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard?view=marketing/content&distribution_error=unknown_provider`)
  }

  const status = providerConnectStatus(rawProvider)
  if (!status.enabled) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard?view=marketing/content&distribution_error=provider_not_configured`)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/`)

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  const verifier = rawProvider === 'x' ? randomCodeVerifier() : undefined
  const state = createDistributionOAuthState({
    userId: user.id,
    clientId: activeClientId,
    provider: rawProvider,
    codeVerifier: verifier,
  })

  return NextResponse.redirect(distributionAuthUrl({
    provider: rawProvider,
    state,
    codeChallenge: verifier ? codeChallenge(verifier) : undefined,
  }))
}
