import { NextResponse } from 'next/server'
import { enrichLeadsInBatch } from '@/lib/email-finder/enrich'

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

  const result = await enrichLeadsInBatch(200)
  console.log('[enrich-contacts]', result)
  return NextResponse.json(result)
}
