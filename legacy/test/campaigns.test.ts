import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCampaignMetrics,
  rankCampaignLeadCandidates,
  summarizeCampaignCounts,
  type CampaignRowLike,
  type CampaignTargetLike,
  type CampaignContentLinkLike,
  type CampaignLeadLike,
} from '../lib/gtm/campaigns.ts'

test('summarizeCampaignCounts combines asset, target, and content link counts per campaign', () => {
  const campaigns: CampaignRowLike[] = [
    { id: 'camp-a', status: 'active' },
    { id: 'camp-b', status: 'paused' },
  ]
  const targets: CampaignTargetLike[] = [
    { campaign_id: 'camp-a', status: 'enrolled' },
    { campaign_id: 'camp-a', status: 'sent' },
    { campaign_id: 'camp-a', status: 'replied' },
    { campaign_id: 'camp-b', status: 'booked' },
  ]
  const links: CampaignContentLinkLike[] = [
    { campaign_id: 'camp-a', status: 'linked', channel: 'linkedin' },
    { campaign_id: 'camp-a', status: 'published', channel: 'email' },
    { campaign_id: 'camp-b', status: 'drafted', channel: 'blog' },
  ]
  const assets = [
    { campaign_id: 'camp-a', status: 'draft' },
    { campaign_id: 'camp-a', status: 'published' },
  ]

  const [first, second] = summarizeCampaignCounts(campaigns, { targets, links, assets })

  assert.deepEqual(first.target_counts, {
    total: 3,
    proposed: 0,
    enrolled: 1,
    drafted: 0,
    approved: 0,
    sent: 1,
    replied: 1,
    booked: 0,
    dismissed: 0,
    blocked: 0,
  })
  assert.deepEqual(first.content_counts, {
    total: 2,
    linked: 1,
    drafted: 0,
    approved: 0,
    scheduled: 0,
    published: 1,
    dismissed: 0,
  })
  assert.equal(first.asset_counts.published, 1)
  assert.equal(second.target_counts.booked, 1)
  assert.equal(second.content_counts.drafted, 1)
})

test('buildCampaignMetrics reports active campaigns and real outcome totals', () => {
  const metrics = buildCampaignMetrics(
    [
      { id: 'camp-a', status: 'active' },
      { id: 'camp-b', status: 'paused' },
      { id: 'camp-c', status: 'completed' },
    ],
    {
      targets: [
        { campaign_id: 'camp-a', status: 'sent' },
        { campaign_id: 'camp-a', status: 'replied' },
        { campaign_id: 'camp-b', status: 'booked' },
      ],
      links: [
        { campaign_id: 'camp-a', status: 'published', channel: 'linkedin' },
        { campaign_id: 'camp-c', status: 'linked', channel: 'blog' },
      ],
      assets: [{ campaign_id: 'camp-a', status: 'approved' }],
    },
  )

  assert.deepEqual(metrics, {
    total: 3,
    draft: 0,
    active: 1,
    paused: 1,
    completed: 1,
    targets: 3,
    sent: 1,
    replied: 1,
    booked: 1,
    content: 3,
    content_published: 1,
  })
})

test('rankCampaignLeadCandidates prioritizes high-fit unsent leads and excludes enrolled leads', () => {
  const leads: CampaignLeadLike[] = [
    { id: 'low', target_company: 'Low Co', relevance_score: 55, status: 'new', created_at: '2026-01-01T00:00:00.000Z' },
    { id: 'sent', target_company: 'Sent Co', relevance_score: 99, status: 'sent', sent_at: '2026-01-02T00:00:00.000Z', created_at: '2026-01-01T00:00:00.000Z' },
    { id: 'hot', target_company: 'Hot Co', relevance_score: 92, status: 'drafted', created_at: '2026-01-03T00:00:00.000Z' },
    { id: 'enrolled', target_company: 'Already Co', relevance_score: 100, status: 'new', created_at: '2026-01-04T00:00:00.000Z' },
  ]

  const ranked = rankCampaignLeadCandidates(leads, [{ campaign_id: 'camp-a', lead_id: 'enrolled', status: 'enrolled' }], 'camp-a')

  assert.deepEqual(ranked.map(lead => lead.id), ['hot', 'low', 'sent'])
})
