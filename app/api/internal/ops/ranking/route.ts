import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { extractBearerToken, isInternalOpsBearerToken, isInternalOpsEmailAllowed } from '@/lib/internal-ops-auth'
import { getInternalOpsSummary } from '@/lib/internal-ops'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const bearerToken = extractBearerToken(request.headers.get('authorization'))
  const bearerAllowed = isInternalOpsBearerToken(bearerToken)

  if (!bearerAllowed) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !isInternalOpsEmailAllowed(user.email)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const service = await createServiceClient()
  const summary = await getInternalOpsSummary(service)
  return NextResponse.json(summary)
}
