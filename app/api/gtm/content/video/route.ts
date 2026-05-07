import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { AvatarVideoError, createAvatarVideoJob } from '@/lib/gtm/avatar-video'
import { consumeLeadCredit, refundLeadCredit } from '@/lib/lead-credits'
import { checkRateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 90

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rate = await checkRateLimit(`marketing:avatar-video:${user.id}`, 20, 60 * 60, { supabase })
  if (!rate.allowed) return NextResponse.json({ error: 'Too many avatar video requests. Try again later.' }, { status: 429 })

  const body = await request.json().catch(() => null) as { idea_id?: unknown; settings?: unknown } | null
  const ideaId = typeof body?.idea_id === 'string' ? body.idea_id.trim() : ''
  if (!ideaId) return NextResponse.json({ error: 'idea_id is required' }, { status: 400 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  let reservedCredit = false
  try {
    reservedCredit = await consumeLeadCredit(supabase, {
      userId: user.id,
      metadata: {
        source: 'avatar_video_generation',
        content_idea_id: ideaId,
        client_id: activeClientId,
        status: 'reserved',
      },
    })
    if (!reservedCredit) {
      return NextResponse.json({ error: 'Avatar video generation costs 1 credit. Add credits before generating a video.' }, { status: 402 })
    }

    const job = await createAvatarVideoJob(supabase, {
      userId: user.id,
      clientId: activeClientId,
      ideaId,
      settings: typeof body?.settings === 'object' && body.settings !== null && !Array.isArray(body.settings) ? body.settings as Record<string, unknown> : null,
      creditReserved: true,
    })

    if (job.status === 'manual_ready') {
      await refundReservedAvatarCredit(supabase, user.id, ideaId, job.id, 'manual_ready')
      reservedCredit = false
      return NextResponse.json({ ok: true, job, charged: false })
    }

    return NextResponse.json({ ok: true, job, charged: true, credits_used: 1 })
  } catch (error) {
    if (reservedCredit) {
      await refundReservedAvatarCredit(supabase, user.id, ideaId, null, 'generation_failed').catch(refundError => {
        console.error('[content/video] avatar video credit refund failed:', refundError instanceof Error ? refundError.message : refundError)
      })
    }
    const message = error instanceof Error ? error.message : 'Failed to prepare avatar video'
    console.error('[content/video] avatar video preparation failed:', message)
    if (isMissingAvatarTableError(message)) {
      return NextResponse.json({ error: 'Avatar video database table is missing. Run migration 058_avatar_video_jobs_table.sql and reload the Supabase schema cache.' }, { status: 503 })
    }
    if (error instanceof AvatarVideoError) {
      return NextResponse.json({ error: message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function refundReservedAvatarCredit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  ideaId: string,
  jobId: string | null,
  reason: string,
) {
  await refundLeadCredit(supabase, {
    userId,
    metadata: {
      source: 'avatar_video_generation',
      content_idea_id: ideaId,
      avatar_job_id: jobId,
      status: 'refunded',
      reason,
    },
  })
}

function isMissingAvatarTableError(message: string): boolean {
  return /gtm_avatar_video_jobs|schema cache|could not find the table|does not exist/i.test(message)
}
