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
 *
 * `automation_mode` delegates to `applyAutomationMode` so the auto-send policy
 * row is kept in sync — otherwise the send-automation cron silently skips the
 * workspace despite the profile showing "autopilot".
 */
import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { applyAutomationMode, AUTOMATION_MODES, normalizeAutomationMode } from '@/lib/autopilot'

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = (await request.json()) as Record<string, unknown> }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const providedKeys = Object.keys(body).filter(k => k === 'calendly_url' || k === 'automation_mode')
  if (providedKeys.length === 0) {
    return NextResponse.json({ error: 'No supported fields provided' }, { status: 400 })
  }
  if (providedKeys.length > 1) {
    return NextResponse.json({ error: 'Update one field at a time.' }, { status: 400 })
  }

  if (providedKeys[0] === 'automation_mode') {
    return handleAutomationMode(supabase, user.id, user.email ?? null, body.automation_mode)
  }
  return handleCalendlyUrl(supabase, user.id, body.calendly_url)
}

async function handleAutomationMode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  userEmail: string | null,
  value: unknown,
) {
  const mode = normalizeAutomationMode(value)
  if (!mode) {
    return NextResponse.json({
      error: `automation_mode must be one of: ${AUTOMATION_MODES.join(', ')}`,
    }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('active_client_id')
    .eq('user_id', userId)
    .maybeSingle()
  const activeClientId = (profile as { active_client_id?: string | null } | null)?.active_client_id ?? null

  // applyAutomationMode performs the readiness gate, writes user_profiles, and
  // upserts the auto_send_policies row (the cron's source of truth).
  const result = await applyAutomationMode(supabase, {
    userId,
    clientId: activeClientId,
    mode,
    userEmail,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, readiness: result.readiness },
      { status: result.status ?? 500 },
    )
  }
  return NextResponse.json({
    ok: true,
    updated: ['automation_mode'],
    mode: result.mode,
    enabled: result.enabled,
    readiness: result.readiness,
  })
}

async function handleCalendlyUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  value: unknown,
) {
  let calendlyUrl: string | null
  if (value == null || value === '') {
    calendlyUrl = null
  } else if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 500) return NextResponse.json({ error: 'URL too long' }, { status: 400 })
    try { new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`) }
    catch { return NextResponse.json({ error: 'Invalid URL' }, { status: 400 }) }
    calendlyUrl = trimmed
  } else {
    return NextResponse.json({ error: 'calendly_url must be a string' }, { status: 400 })
  }

  const serviceSupabase = createAdminClient()
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('active_client_id')
    .eq('user_id', userId)
    .maybeSingle()
  const activeClientId = (profile as { active_client_id?: string | null } | null)?.active_client_id ?? null

  const { error } = activeClientId
    ? await updateActiveWorkspaceField(serviceSupabase, {
        userId,
        clientId: activeClientId,
        update: { calendly_url: calendlyUrl },
      })
    : await supabase
        .from('user_profiles')
        .update({ calendly_url: calendlyUrl })
        .eq('user_id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, updated: ['calendly_url'] })
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
