import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { completeGtmActionForSourceItem, upsertGtmAction } from '@/lib/gtm/actions'
import { eventIdempotencyKey, recordGtmEvent } from '@/lib/gtm/events'
import { markLatestOutreachPlanStatus } from '@/lib/gtm/outreach-plan-store'
import { persistLeadRecipientVerification, validateOutboundRecipients } from '@/lib/outbound-recipient-validation'
import { listGtmWorkItems } from '@/lib/gtm/work-items'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const limit = Number(url.searchParams.get('limit') ?? 30)
  const { activeClientId } = await getActiveClientContext(supabase, user.id)

  try {
    const result = await listGtmWorkItems(supabase, {
      userId: user.id,
      clientId: activeClientId,
      limit,
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load GTM work items' },
      { status: 500 },
    )
  }
}

const VALID_ACTIONS = ['reviewed', 'approved', 'discussed', 'dismissed', 'booked'] as const
type WorkItemAction = typeof VALID_ACTIONS[number]

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const payload = body as {
    item_id?: unknown
    action?: unknown
    lead_id?: unknown
    metadata?: unknown
  }
  const itemId = typeof payload.item_id === 'string' ? payload.item_id.trim() : ''
  const action = typeof payload.action === 'string' ? payload.action.trim() as WorkItemAction : null
  const leadId = typeof payload.lead_id === 'string' && payload.lead_id.trim() ? payload.lead_id.trim() : null
  const metadata = typeof payload.metadata === 'object' && payload.metadata !== null && !Array.isArray(payload.metadata)
    ? payload.metadata as Record<string, unknown>
    : {}

  if (!itemId || !action || !(VALID_ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: 'item_id and valid action are required' }, { status: 400 })
  }

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  let leadForAction: { id: string; client_id?: string | null; contact_email?: string | null; contact_verified?: boolean | null } | null = null
  if (leadId) {
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id, client_id, contact_email, contact_verified')
      .eq('id', leadId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (leadError) return NextResponse.json({ error: leadError.message }, { status: 500 })
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    leadForAction = lead
    const leadClientId = (lead as { client_id?: string | null }).client_id ?? null
    if ((activeClientId ?? null) !== leadClientId) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  if (leadId && action === 'approved') {
    if (!leadForAction?.contact_email) {
      return NextResponse.json({ error: 'A usable contact is required before approving this next move.' }, { status: 409 })
    }
    const serviceSupabase = await createServiceClient()
    const validation = await validateOutboundRecipients([leadForAction.contact_email], { maxCacheAgeDays: 1 })
    const verified = await persistLeadRecipientVerification(serviceSupabase, {
      leadId,
      userId: user.id,
      primaryEmail: leadForAction.contact_email,
      validation,
    })
    if (!verified) {
      return NextResponse.json({
        error: `Approval blocked: recipient validation failed for ${validation.unsafeEmails.join(', ')}`,
        reasons: validation.reasons,
      }, { status: 422 })
    }
  }

  let existingActionQuery = supabase
    .from('gtm_work_item_actions')
    .select('id')
    .eq('user_id', user.id)
    .eq('item_key', itemId)
    .eq('action', action)
    .limit(1)

  existingActionQuery = activeClientId
    ? existingActionQuery.eq('client_id', activeClientId)
    : existingActionQuery.is('client_id', null)

  const { data: existingAction, error: existingError } = await existingActionQuery.maybeSingle()
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })

  if (!existingAction) {
    const error = await recordWorkItemAction(supabase, {
      userId: user.id,
      clientId: activeClientId ?? null,
      itemKey: itemId,
      leadId,
      action,
      metadata,
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const actionStatus = action === 'dismissed' ? 'dismissed' : 'completed'
  const actionResult = { work_item_action: action, metadata }
  if (itemId.startsWith('action:')) {
    const durableActionId = itemId.slice('action:'.length)
    const { error: actionUpdateError } = await supabase
      .from('gtm_actions')
      .update({
        status: actionStatus,
        result: actionResult,
        completed_at: new Date().toISOString(),
      })
      .eq('id', durableActionId)
      .eq('user_id', user.id)
    if (actionUpdateError) return NextResponse.json({ error: actionUpdateError.message }, { status: 500 })
  } else {
    await upsertGtmAction(supabase, {
      userId: user.id,
      clientId: activeClientId ?? null,
      leadId,
      actionType: `work_item.${action}`,
      channel: 'workspace',
      title: `Work item ${action}`,
      body: `User marked ${itemId} as ${action}.`,
      priority: 50,
      status: actionStatus,
      payload: { item_id: itemId, metadata },
      result: actionResult,
      source: 'work_items',
      sourceItemKey: itemId,
    })
  }

  await completeGtmActionForSourceItem(supabase, {
    userId: user.id,
    clientId: activeClientId ?? null,
    sourceItemKey: itemId,
    result: actionResult,
    status: actionStatus,
  })

  await recordGtmEvent(supabase, {
    userId: user.id,
    clientId: activeClientId ?? null,
    entityType: leadId ? 'lead' : null,
    entityId: leadId,
    eventType: `work_item.${action}`,
    source: 'work_items',
    payload: {
      item_id: itemId,
      lead_id: leadId,
      action,
      metadata,
    },
    idempotencyKey: eventIdempotencyKey(['work_item', itemId, action]),
  })

  if (leadId && action === 'approved') {
    const serviceSupabase = await createServiceClient()
    await markLatestOutreachPlanStatus(serviceSupabase, {
      userId: user.id,
      leadId,
      status: 'approved',
    })
  }

  if (leadId && action === 'booked') {
    const { error: bookedError } = await supabase
      .from('leads')
      .update({
        status: 'booked',
        booked_at: new Date().toISOString(),
      })
      .eq('id', leadId)
      .eq('user_id', user.id)
    if (bookedError) return NextResponse.json({ error: bookedError.message }, { status: 500 })

    const derivedCloseError = await recordWorkItemAction(supabase, {
      userId: user.id,
      clientId: activeClientId ?? null,
      itemKey: `lead:${leadId}:meeting_booked`,
      leadId,
      action: 'reviewed',
      metadata: { ...metadata, closed_from: itemId, type: 'meeting_booked' },
    })
    if (derivedCloseError) return NextResponse.json({ error: derivedCloseError.message }, { status: 500 })
  }

  if (leadId && (action === 'approved' || (action === 'reviewed' && itemId.endsWith(':needs_approval')))) {
    const { error: viewedError } = await supabase
      .from('leads')
      .update({ status: 'viewed' })
      .eq('id', leadId)
      .eq('user_id', user.id)
      .in('status', ['new', 'viewed', 'drafted'])
    if (viewedError) return NextResponse.json({ error: viewedError.message }, { status: 500 })
  }

  if (leadId && action === 'dismissed') {
    const { error: dismissError } = await supabase
      .from('leads')
      .update({ status: 'dismissed' })
      .eq('id', leadId)
      .eq('user_id', user.id)
    if (dismissError) return NextResponse.json({ error: dismissError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

async function recordWorkItemAction(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    userId: string
    clientId: string | null
    itemKey: string
    leadId: string | null
    action: WorkItemAction
    metadata: Record<string, unknown>
  },
) {
  const { error } = await supabase
    .from('gtm_work_item_actions')
    .insert({
      user_id: input.userId,
      client_id: input.clientId,
      item_key: input.itemKey,
      lead_id: input.leadId,
      action: input.action,
      metadata: input.metadata,
    })

  if (error && error.code !== '23505') return error
  return null
}
