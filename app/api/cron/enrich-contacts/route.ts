import { NextResponse } from 'next/server'
import { enrichLeadsInBatch } from '@/lib/email-finder/enrich'
import { createServiceClient } from '@/lib/supabase/server'
import { finishCronRun, startCronRun } from '@/lib/cron-runs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()
  const runId = await startCronRun(supabase, 'enrich_contacts')
  try {
    const result = await enrichLeadsInBatch(200)
    console.log('[enrich-contacts]', result)
    await finishCronRun(supabase, runId, { status: 'success', metrics: result })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    await finishCronRun(supabase, runId, { status: 'error', errorMessage: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
