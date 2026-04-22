import test from 'node:test'
import assert from 'node:assert/strict'
import { buildWorkspaceAccessPlan } from '../lib/client-workspaces.ts'
import { resolveOutreachContext, scheduleFollowupAt } from '../lib/outreach-context.ts'
import { resolveLeadQuotaDecision } from '../lib/lead-quota.ts'

test('non-max plans only keep the active workspace visible', () => {
  const plan = buildWorkspaceAccessPlan({
    plan: 'pro',
    activeClientId: 'client_b',
    clients: [
      { id: 'client_a', is_archived: false, created_at: '2026-04-20T00:00:00.000Z' },
      { id: 'client_b', is_archived: false, created_at: '2026-04-21T00:00:00.000Z' },
    ],
  })

  assert.deepEqual(plan.visibleClientIds, ['client_b'])
  assert.equal(plan.keepClientId, 'client_b')
  assert.deepEqual(plan.archiveClientIds, ['client_a'])
})

test('non-max plans fall back to the oldest available workspace when active is missing', () => {
  const plan = buildWorkspaceAccessPlan({
    plan: 'free',
    activeClientId: null,
    clients: [
      { id: 'client_a', is_archived: false, created_at: '2026-04-20T00:00:00.000Z' },
      { id: 'client_b', is_archived: false, created_at: '2026-04-21T00:00:00.000Z' },
    ],
  })

  assert.deepEqual(plan.visibleClientIds, ['client_a'])
  assert.equal(plan.keepClientId, 'client_a')
})

test('max plan keeps every unarchived workspace visible', () => {
  const plan = buildWorkspaceAccessPlan({
    plan: 'max',
    activeClientId: 'client_b',
    clients: [
      { id: 'client_a', is_archived: false, created_at: '2026-04-20T00:00:00.000Z' },
      { id: 'client_b', is_archived: false, created_at: '2026-04-21T00:00:00.000Z' },
      { id: 'client_c', is_archived: true, created_at: '2026-04-22T00:00:00.000Z' },
    ],
  })

  assert.deepEqual(plan.visibleClientIds, ['client_a', 'client_b'])
  assert.equal(plan.keepClientId, 'client_b')
  assert.deepEqual(plan.archiveClientIds, [])
})

test('outreach context prefers client branding and falls back to user branding', () => {
  const context = resolveOutreachContext({
    userProfile: {
      company_name: 'Bombsell',
      services_description: 'Signal-based outreach',
      calendly_url: 'https://cal.com/bombsell',
    },
    clientProfile: {
      name: 'Acme Agency',
      services_description: 'Outbound for fintech teams',
      calendly_url: 'https://cal.com/acme',
    },
  })

  assert.equal(context.senderCompany, 'Acme Agency')
  assert.equal(context.fromName, 'Acme Agency')
  assert.equal(context.servicesDescription, 'Outbound for fintech teams')
  assert.equal(context.calendlyUrl, 'https://cal.com/acme')
})

test('outreach context falls back cleanly when no client profile exists', () => {
  const context = resolveOutreachContext({
    userProfile: {
      company_name: 'Bombsell',
      services_description: 'Signal-based outreach',
      calendly_url: null,
    },
  })

  assert.equal(context.senderCompany, 'Bombsell')
  assert.equal(context.fromName, 'Bombsell')
  assert.equal(context.servicesDescription, 'Signal-based outreach')
  assert.equal(context.calendlyUrl, null)
})

test('lead quota decision blocks free overage and allows paid overage', () => {
  assert.equal(resolveLeadQuotaDecision({
    used: 10,
    monthlyLimit: 10,
    allowLeadOverage: true,
    plan: 'free',
  }), 'blocked')

  assert.equal(resolveLeadQuotaDecision({
    used: 300,
    monthlyLimit: 300,
    allowLeadOverage: true,
    plan: 'pro',
  }), 'overage')
})

test('lead quota decision reserves quota when still under limit', () => {
  assert.equal(resolveLeadQuotaDecision({
    used: 9,
    monthlyLimit: 10,
    allowLeadOverage: false,
    plan: 'free',
  }), 'reserve')
})

test('follow-up scheduling stays exactly three days out by default', () => {
  const scheduledAt = scheduleFollowupAt(new Date('2026-04-23T10:00:00.000Z'))
  assert.equal(scheduledAt, '2026-04-26T10:00:00.000Z')
})
