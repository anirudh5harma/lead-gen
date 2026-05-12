/**
 * Lightweight per-field profile updates for the dashboard.
 *
 * The main /api/profile endpoint expects the full onboarding payload
 * (company_name, industry, target_industries, services_description). This
 * endpoint is for in-product edits of single optional fields:
 *   - calendly_url   (booking link)
 *   - automation_mode ('research_only' | 'approve_first' | 'autopilot')
 *
 * Each request must specify exactly one field. Extra/unknown fields are
 * rejected to keep the surface tight.
 */
import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'

const VALID_AUTOMATION_MODES = ['research_only', 'approve_first', 'autopilot'] as const
type AutomationMode = typeof VALID_AUTOMATION_MODES[number]

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const serviceSupabase = createAdminClient()

  let body: Record<string, unknown>
  try { body = (await request.json()) as Record<string, unknown> }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const update: Record<string, string | null> = {}

  if ('calendly_url' in body) {
    const v = body.calendly_url
    if (v == null || v === '') {
      update.calendly_url = null
    } else if (typeof v === 'string') {
      const trimmed = v.trim()
      if (trimmed.length > 500) {
        return NextResponse.json({ error: 'URL too long' }, { status: 400 })
      }
      // Lightweight URL validation — allow either bare domain or full URL.
      try { new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`) }
      catch { return NextResponse.json({ error: 'Invalid URL' }, { status: 400 }) }
      update.calendly_url = trimmed
    } else {
      return NextResponse.json({ error: 'calendly_url must be a string' }, { status: 400 })
    }
  }

  if ('automation_mode' in body) {
    const v = body.automation_mode
    if (typeof v !== 'string' || !VALID_AUTOMATION_MODES.includes(v as AutomationMode)) {
      return NextResponse.json({
        error: `automation_mode must be one of: ${VALID_AUTOMATION_MODES.join(', ')}`,
      }, { status: 400 })
    }
    // Autopilot is available on every plan.
    update.automation_mode = v
  }

  const updateKeys = Object.keys(update)
  if (updateKeys.length === 0) {
    return NextResponse.json({ error: 'No supported fields provided' }, { status: 400 })
  }
  if (updateKeys.length > 1) {
    return NextResponse.json({ error: 'Update one field at a time.' }, { status: 400 })
  }

  let activeClientId: string | null = null
  if ('calendly_url' in update) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('active_client_id')
      .eq('user_id', user.id)
      .maybeSingle()
    activeClientId = (profile as { active_client_id?: string | null } | null)?.active_client_id ?? null
  }

  const { error } = activeClientId
    ? await updateActiveWorkspaceField(serviceSupabase, {
        userId: user.id,
        clientId: activeClientId,
        update,
      })
    : await supabase
        .from('user_profiles')
        .update(update)
        .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, updated: Object.keys(update) })
}

async function updateActiveWorkspaceField(
  supabase: ReturnType<typeof createAdminClient>,
  params: {
    userId: string
    clientId: string
    update: Record<string, string | null>
  },
) {
  const { data: client } = await supabase
    .from('client_accounts')
    .select('id, user_id')
    .eq('id', params.clientId)
    .maybeSingle()
  if (!client) return { error: { message: 'Active workspace not found' } }
  if (client.user_id !== params.userId) {
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('client_id', params.clientId)
      .eq('user_id', params.userId)
      .not('accepted_at', 'is', null)
      .maybeSingle()
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return { error: { message: 'Only workspace owners and admins can edit this field.' } }
    }
  }
  return await supabase
    .from('client_accounts')
    .update(params.update)
    .eq('id', params.clientId)
}
