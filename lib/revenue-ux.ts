import type { Lead } from '@/lib/leads'

export interface RevenueActionItem {
  id: string
  label: string
  reason: string
  href: string
  priority: number
}

export interface RevenueSignalItem {
  id: string
  label: string
  detail: string
}

export interface RevenueSnapshot {
  pipeline: {
    observed: number
    qualified: number
    engaged: number
    opportunity: number
    customer: number
    blocked: number
    active: number
    staleObserved14d: number
    draftedBacklog: number
  }
  windows: {
    found7d: number
    found30d: number
    sent7d: number
    sent30d: number
    replied7d: number
    replied30d: number
    booked7d: number
    booked30d: number
    booked90d: number
  }
  rates: {
    sendCoverage30: number
    replyRate30: number
    bookRate30: number
    replyToBooked30: number
    dismissedShare: number
  }
  summary: {
    headline: string
    detail: string
  }
  working: RevenueSignalItem[]
  notWorking: RevenueSignalItem[]
  actions: RevenueActionItem[]
}

export function buildRevenueSnapshot(leads: Lead[], nowMs = Date.now()): RevenueSnapshot {
  const day = 24 * 60 * 60 * 1000
  const last7d = nowMs - 7 * day
  const last14d = nowMs - 14 * day
  const last30d = nowMs - 30 * day
  const last90d = nowMs - 90 * day

  const observed = leads.filter(lead => lead.status === 'new' || lead.status === 'viewed').length
  const qualified = leads.filter(lead => lead.status === 'drafted').length
  const engaged = leads.filter(lead => lead.status === 'sent').length
  const opportunity = leads.filter(lead => lead.status === 'replied').length
  const customer = leads.filter(lead => lead.status === 'booked').length
  const blocked = leads.filter(lead => lead.status === 'dismissed').length
  const active = observed + qualified + engaged + opportunity

  const staleObserved14d = leads.filter(lead => {
    if (!(lead.status === 'new' || lead.status === 'viewed')) return false
    const createdAt = parseTime(lead.created_at)
    return createdAt > 0 && createdAt < last14d
  }).length

  const found7d = leads.filter(lead => inWindow(lead.created_at, last7d)).length
  const found30d = leads.filter(lead => inWindow(lead.created_at, last30d)).length
  const sent7d = leads.filter(lead => inWindow(lead.sent_at, last7d)).length
  const sent30d = leads.filter(lead => inWindow(lead.sent_at, last30d)).length
  const replied7d = leads.filter(lead => inWindow(lead.replied_at, last7d)).length
  const replied30d = leads.filter(lead => inWindow(lead.replied_at, last30d)).length
  const booked7d = leads.filter(lead => inWindow(lead.booked_at, last7d)).length
  const booked30d = leads.filter(lead => inWindow(lead.booked_at, last30d)).length
  const booked90d = leads.filter(lead => inWindow(lead.booked_at, last90d)).length

  const sendCoverage30 = ratio(sent30d, found30d)
  const replyRate30 = ratio(replied30d, sent30d)
  const bookRate30 = ratio(booked30d, sent30d)
  const replyToBooked30 = ratio(booked30d, replied30d)
  const dismissedShare = ratio(blocked, leads.length)

  const working: RevenueSignalItem[] = []
  const notWorking: RevenueSignalItem[] = []
  const actionMap = new Map<string, RevenueActionItem>()

  if (sent30d >= 15) {
    working.push({
      id: 'outbound-volume-healthy',
      label: 'Outbound volume is healthy',
      detail: `${sent30d} sends in the last 30 days keeps the funnel moving.`,
    })
  }
  if (sent30d >= 10 && replyRate30 >= 8) {
    working.push({
      id: 'reply-rate-healthy',
      label: 'Reply quality is healthy',
      detail: `${replyRate30}% reply rate on recent outreach.`,
    })
  }
  if (booked30d >= 2) {
    working.push({
      id: 'meeting-conversion-active',
      label: 'Meetings are converting',
      detail: `${booked30d} meetings booked in the last 30 days.`,
    })
  }
  if (staleObserved14d <= 5 && qualified <= 8 && active > 0) {
    working.push({
      id: 'backlog-contained',
      label: 'Backlog is under control',
      detail: `${staleObserved14d} stale observed leads and ${qualified} drafted leads waiting.`,
    })
  }

  if (sent30d === 0) {
    notWorking.push({
      id: 'no-sends',
      label: 'No outreach activity',
      detail: 'Zero sends in the last 30 days means no path to replies or meetings.',
    })
    pushAction(actionMap, {
      id: 'send-first-batch',
      label: 'Send the first batch from drafted leads',
      reason: 'Create immediate funnel movement.',
      href: '/dashboard?view=sales/outreach',
      priority: 100,
    })
  }

  if (qualified >= 5) {
    notWorking.push({
      id: 'draft-backlog',
      label: 'Draft backlog is building',
      detail: `${qualified} leads are drafted but not sent.`,
    })
    pushAction(actionMap, {
      id: 'clear-draft-backlog',
      label: 'Clear drafted backlog',
      reason: `Prioritize the ${Math.min(qualified, 10)} highest-signal drafts.`,
      href: '/dashboard?view=sales/outreach',
      priority: 95,
    })
  }

  if (staleObserved14d >= 8) {
    notWorking.push({
      id: 'stale-observed',
      label: 'Observed leads are going stale',
      detail: `${staleObserved14d} leads have been untouched for over 14 days.`,
    })
    pushAction(actionMap, {
      id: 'triage-observed',
      label: 'Triage stale observed leads',
      reason: 'Draft, dismiss, or promote them to active outreach.',
      href: '/dashboard?view=sales/inbox',
      priority: 90,
    })
  }

  if (sent30d >= 10 && replyRate30 < 5) {
    notWorking.push({
      id: 'weak-reply-rate',
      label: 'Reply rate is below target',
      detail: `${replyRate30}% reply rate from ${sent30d} sends indicates weak message-market fit.`,
    })
    pushAction(actionMap, {
      id: 'improve-message-quality',
      label: 'Refresh top outreach drafts',
      reason: 'Regenerate opening and signal alignment for recent sends.',
      href: '/dashboard?view=sales/outreach',
      priority: 88,
    })
  }

  if (replied30d >= 4 && replyToBooked30 < 25) {
    notWorking.push({
      id: 'weak-meeting-conversion',
      label: 'Replies are not converting to meetings',
      detail: `${replyToBooked30}% of replies became meetings in the last 30 days.`,
    })
    pushAction(actionMap, {
      id: 'tighten-booking-path',
      label: 'Tighten booking follow-up flow',
      reason: 'Ensure reply handling and calendar CTA are explicit.',
      href: '/dashboard?view=settings',
      priority: 84,
    })
  }

  if (leads.length >= 25 && dismissedShare >= 35) {
    notWorking.push({
      id: 'high-dismissed-share',
      label: 'Too many leads are being dismissed',
      detail: `${dismissedShare}% dismissed share suggests targeting noise.`,
    })
    pushAction(actionMap, {
      id: 'tighten-targeting',
      label: 'Tighten targeting filters',
      reason: 'Refine search filters and ICP constraints for higher match quality.',
      href: '/dashboard?view=sales/explore',
      priority: 80,
    })
  }

  if (notWorking.length === 0 && sent30d >= 10) {
    pushAction(actionMap, {
      id: 'scale-automation',
      label: 'Scale with autopilot controls',
      reason: 'Current baseline is healthy enough for safe automation expansion.',
      href: '/dashboard?view=engine/autopilot',
      priority: 60,
    })
  }

  if (working.length === 0) {
    working.push({
      id: 'baseline-collecting',
      label: 'Baseline is still forming',
      detail: 'Keep shipping daily outreach so trend comparisons become reliable.',
    })
  }

  const actions = [...actionMap.values()]
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 4)

  const summary = notWorking.length > 0
    ? {
        headline: 'Revenue flow needs intervention',
        detail: `${notWorking.length} issue${notWorking.length === 1 ? '' : 's'} are blocking conversion momentum.`,
      }
    : {
        headline: 'Revenue flow is stable',
        detail: `${working.length} healthy signal${working.length === 1 ? '' : 's'} detected from current funnel activity.`,
      }

  return {
    pipeline: {
      observed,
      qualified,
      engaged,
      opportunity,
      customer,
      blocked,
      active,
      staleObserved14d,
      draftedBacklog: qualified,
    },
    windows: {
      found7d,
      found30d,
      sent7d,
      sent30d,
      replied7d,
      replied30d,
      booked7d,
      booked30d,
      booked90d,
    },
    rates: {
      sendCoverage30,
      replyRate30,
      bookRate30,
      replyToBooked30,
      dismissedShare,
    },
    summary,
    working: working.slice(0, 4),
    notWorking: notWorking.slice(0, 4),
    actions,
  }
}

function pushAction(map: Map<string, RevenueActionItem>, action: RevenueActionItem) {
  const existing = map.get(action.id)
  if (!existing || existing.priority < action.priority) {
    map.set(action.id, action)
  }
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 100)
}

function parseTime(value: string | null | undefined): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function inWindow(value: string | null | undefined, since: number): boolean {
  return parseTime(value) >= since
}
