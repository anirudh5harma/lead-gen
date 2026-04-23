import test from 'node:test'
import assert from 'node:assert/strict'
import { buildWorkspaceAccessPlan } from '../lib/client-workspaces.ts'
import { resolveOutreachContext, scheduleFollowupAt } from '../lib/outreach-context.ts'
import { resolveLeadQuotaDecision } from '../lib/lead-quota.ts'
import { normalizeCompanyWebsiteUrl, resolveServicesDescription } from '../lib/company-profile.ts'
import { buildLeadDedupeKey, normalizeLeadCompanyKey } from '../lib/lead-dedupe.ts'

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

test('lead quota decision previews free over-limit leads and allows paid overage', () => {
  assert.equal(resolveLeadQuotaDecision({
    used: 10,
    monthlyLimit: 10,
    allowLeadOverage: true,
    plan: 'free',
  }), 'preview')

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

test('company website URL normalization accepts plain domains and rejects invalid hosts', () => {
  assert.equal(normalizeCompanyWebsiteUrl('acme.com'), 'https://acme.com')
  assert.equal(normalizeCompanyWebsiteUrl('https://www.acme.com/'), 'https://www.acme.com')
  assert.equal(normalizeCompanyWebsiteUrl('localhost:3000'), null)
  assert.equal(normalizeCompanyWebsiteUrl('not a url'), null)
})

test('services description resolver keeps manual description when website context is unavailable', async () => {
  const resolved = await resolveServicesDescription({
    companyName: 'Acme',
    industry: 'saas',
    manualDescription: 'We help finance teams automate revenue reconciliation and audit workflows.',
    websiteUrl: '',
  })

  assert.equal(resolved?.description, 'We help finance teams automate revenue reconciliation and audit workflows.')
  assert.equal(resolved?.websiteUrl, null)
  assert.equal(resolved?.source, 'manual')
})

test('lead dedupe keys normalize company variants by domain or legal suffix', () => {
  assert.equal(
    normalizeLeadCompanyKey('Acme Technologies, Inc.', null),
    normalizeLeadCompanyKey('Acme', null),
  )
  assert.equal(
    normalizeLeadCompanyKey('Acme Anything', 'https://www.acme.com/team'),
    'domain:acme.com',
  )
  assert.equal(
    buildLeadDedupeKey({
      companyName: 'Acme Inc.',
      signalType: 'expansion',
      date: new Date('2026-04-23T00:00:00.000Z'),
    }),
    buildLeadDedupeKey({
      companyName: 'Acme',
      signalType: 'expansion',
      date: new Date('2026-04-23T12:00:00.000Z'),
    }),
  )
})
