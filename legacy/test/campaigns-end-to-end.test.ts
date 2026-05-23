import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCampaignReadiness,
  deriveCampaignTargetStatus,
  syncCampaignTargetsWithLeads,
  type CampaignLeadLike,
  type CampaignTargetLike,
} from '../lib/gtm/campaigns.ts'

test('deriveCampaignTargetStatus mirrors lead outcomes without demoting manual approvals', () => {
  assert.equal(deriveCampaignTargetStatus({ id: 'l1', target_company: 'Acme', status: 'booked', booked_at: '2026-01-01T00:00:00Z' }, 'enrolled'), 'booked')
  assert.equal(deriveCampaignTargetStatus({ id: 'l2', target_company: 'Beta', status: 'replied', replied_at: '2026-01-01T00:00:00Z' }, 'sent'), 'replied')
  assert.equal(deriveCampaignTargetStatus({ id: 'l3', target_company: 'Coda', status: 'sent', sent_at: '2026-01-01T00:00:00Z' }, 'approved'), 'sent')
  assert.equal(deriveCampaignTargetStatus({ id: 'l4', target_company: 'Delta', status: 'new' }, 'approved'), 'approved')
  assert.equal(deriveCampaignTargetStatus({ id: 'l5', target_company: 'Echo', status: 'dismissed' }, 'enrolled'), 'dismissed')
})

test('syncCampaignTargetsWithLeads only emits target rows whose status changed', () => {
  const leads: CampaignLeadLike[] = [
    { id: 'sent-lead', target_company: 'Sent', status: 'sent', sent_at: '2026-01-01T00:00:00Z' },
    { id: 'same-lead', target_company: 'Same', status: 'replied', replied_at: '2026-01-01T00:00:00Z' },
    { id: 'untouched', target_company: 'Untouched', status: 'new' },
  ]
  const targets: CampaignTargetLike[] = [
    { campaign_id: 'camp', lead_id: 'sent-lead', status: 'enrolled' },
    { campaign_id: 'camp', lead_id: 'same-lead', status: 'replied' },
    { campaign_id: 'camp', lead_id: 'untouched', status: 'approved' },
  ]

  const updates = syncCampaignTargetsWithLeads(targets, leads)

  assert.deepEqual(updates, [{ campaign_id: 'camp', lead_id: 'sent-lead', status: 'sent' }])
})

test('buildCampaignReadiness explains what blocks launch and what to do next', () => {
  const draft = buildCampaignReadiness({
    campaign: { id: 'camp', status: 'draft', name: 'AI infra founder launch', segment: '', trigger: 'funding', narrative: '' },
    targetCount: 0,
    contentCount: 0,
    approvedAssetCount: 0,
  })

  assert.equal(draft.stage, 'strategy')
  assert.equal(draft.canLaunch, false)
  assert.deepEqual(draft.missing, ['audience', 'narrative', 'targets'])
  assert.deepEqual(draft.recommendations, ['content_air_cover'])
  assert.match(draft.nextAction, /Define the audience/)

  const ready = buildCampaignReadiness({
    campaign: { id: 'camp', status: 'draft', name: 'AI infra founder launch', segment: 'AI infra founders', trigger: 'funding', narrative: 'Hiring GTM after funding creates urgency' },
    targetCount: 12,
    contentCount: 0,
    approvedAssetCount: 0,
  })

  assert.equal(ready.stage, 'launch-ready')
  assert.equal(ready.canLaunch, true)
  assert.deepEqual(ready.missing, [])
  assert.deepEqual(ready.recommendations, ['content_air_cover'])
})
