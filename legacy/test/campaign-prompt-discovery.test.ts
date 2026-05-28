import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCampaignBriefFromPrompt,
  buildExaCampaignSearchPayload,
  buildExaCampaignWebsetPayload,
  campaignDiscoveryCompanyKey,
  campaignDiscoveryResultKey,
  chooseCampaignDiscoveryMode,
  extractExaCampaignCandidates,
  extractExaWebsetCampaignCandidates,
} from '../lib/gtm/campaign-discovery.ts'

test('prompt campaign brief turns a natural language requirement into launch fields and Exa queries', () => {
  const brief = buildCampaignBriefFromPrompt('Find Series A vertical SaaS companies hiring RevOps leaders for a signal-led outbound campaign.')

  assert.match(brief.name, /Series A|Vertical SaaS/i)
  assert.match(brief.segment, /series a|vertical saas/i)
  assert.equal(brief.trigger, 'Hiring or team expansion')
  assert.match(brief.objective, /GTM motion/i)
  assert.deepEqual(brief.channels, ['email', 'linkedin', 'content'])
  assert.ok(brief.queries.length >= 3)
  assert.ok(brief.queries.some(query => /hiring/i.test(query)))
})

test('Exa search payload requests structured grounded company candidates', () => {
  const brief = buildCampaignBriefFromPrompt('Find funded healthcare SaaS companies expanding into enterprise accounts.')
  const payload = buildExaCampaignSearchPayload({ brief, count: 8, searchType: 'deep-lite' })

  assert.equal(payload.type, 'deep-lite')
  assert.equal(payload.moderation, true)
  assert.ok(payload.numResults >= 10)
  assert.match(JSON.stringify(payload.outputSchema), /companies/)
  assert.match(payload.systemPrompt, /evidence only/)
  assert.match(JSON.stringify(payload.contents), /highlights/)
})

test('campaign discovery uses Search below 25 targets and Websets at 25 or more', () => {
  assert.equal(chooseCampaignDiscoveryMode(10), 'search')
  assert.equal(chooseCampaignDiscoveryMode(24), 'search')
  assert.equal(chooseCampaignDiscoveryMode(25), 'webset')
  assert.equal(chooseCampaignDiscoveryMode(100), 'webset')
})

test('Exa Webset payload starts an async company search for large campaigns', () => {
  const brief = buildCampaignBriefFromPrompt('Find 50 Series A B2B SaaS companies hiring sales leaders.')
  const payload = buildExaCampaignWebsetPayload({ brief, count: 50, campaignId: 'campaign_1' })

  assert.equal(payload.externalId, 'gtm-campaign-campaign_1')
  assert.equal((payload.search as { count: number }).count, 50)
  assert.deepEqual((payload.search as { entity: { type: string } }).entity, { type: 'company' })
  assert.match(JSON.stringify((payload.search as { criteria: unknown }).criteria), /buying trigger/i)
})

test('Exa structured output is normalized, deduped, scored, and source-backed', () => {
  const brief = buildCampaignBriefFromPrompt('Find fintech companies hiring sales leaders.')
  const candidates = extractExaCampaignCandidates({
    brief,
    maxCandidates: 5,
    response: {
      requestId: 'exa_req_1',
      output: {
        content: {
          companies: [
            {
              company_name: 'Nimbus Ledger',
              company_domain: 'https://www.nimbusledger.com',
              signal_type: 'hiring',
              headline: 'Nimbus Ledger is hiring sales leadership',
              summary: 'Nimbus Ledger has open GTM leadership roles.',
              relevance_reason: 'The hiring trigger fits the campaign.',
              relevance_score: 9,
              source_url: 'https://news.example.com/nimbus-hiring',
              source_name: 'news.example.com',
              evidence: ['Nimbus Ledger listed a VP Sales role this week.'],
            },
            {
              company_name: 'Nimbus Ledger Inc.',
              company_domain: 'nimbusledger.com',
              signal_type: 'hiring',
              headline: 'Duplicate Acme mention',
              summary: 'Duplicate.',
              relevance_reason: 'Duplicate.',
              relevance_score: 8,
              source_url: 'https://example.com/duplicate',
              evidence: ['Duplicate mention.'],
            },
          ],
        },
      },
      results: [],
    },
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].company_domain, 'nimbusledger.com')
  assert.equal(candidates[0].signal_type, 'hiring')
  assert.equal(candidates[0].relevance_score, 9)
  assert.equal(candidates[0].source_url, 'https://news.example.com/nimbus-hiring')
})

test('Exa Webset items normalize into source-backed campaign candidates', () => {
  const brief = buildCampaignBriefFromPrompt('Find Series A companies hiring GTM leaders.')
  const candidates = extractExaWebsetCampaignCandidates({
    brief,
    maxCandidates: 3,
    response: {
      data: [
        {
          id: 'wsi_1',
          properties: {
            type: 'company',
            url: 'https://nimbusledger.com',
            description: 'Nimbus Ledger is hiring GTM leaders after raising Series A.',
            company: { name: 'Nimbus Ledger', website: 'https://nimbusledger.com' },
          },
          evaluations: [
            {
              criterion: 'Company has evidence of hiring',
              satisfied: 'yes',
              reasoning: 'Nimbus Ledger lists GTM leadership openings.',
              references: [{ title: 'Careers', snippet: 'VP Sales opening', url: 'https://nimbusledger.com/careers' }],
            },
          ],
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    },
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].company_name, 'Nimbus Ledger')
  assert.equal(candidates[0].company_domain, 'nimbusledger.com')
  assert.equal(candidates[0].signal_type, 'hiring')
  assert.equal(candidates[0].relevance_score, 9)
})

test('campaign discovery keys are stable and campaign-scoped', () => {
  assert.equal(campaignDiscoveryCompanyKey('Nimbus, Inc.', 'www.nimbus.com'), 'nimbus.com')
  assert.equal(
    campaignDiscoveryResultKey({
      userId: 'user_1',
      clientId: null,
      campaignId: 'campaign_1',
      companyName: 'Nimbus, Inc.',
      companyDomain: 'nimbus.com',
    }),
    'campaign-exa:user-1:workspace-none:campaign-1:nimbus.com',
  )
})
