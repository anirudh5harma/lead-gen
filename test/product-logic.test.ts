import test from 'node:test'
import assert from 'node:assert/strict'
import { buildWorkspaceAccessPlan } from '../lib/client-workspaces.ts'
import { resolveOutreachContext, scheduleFollowupAt } from '../lib/outreach-context.ts'
import { resolveLeadQuotaDecision } from '../lib/lead-quota.ts'
import { normalizeCompanyWebsiteUrl, resolveServicesDescription } from '../lib/company-profile.ts'
import { buildLeadDedupeKey, normalizeLeadCompanyKey } from '../lib/lead-dedupe.ts'
import { computeDeliveryAllowance } from '../lib/lead-delivery.ts'
import { aggregateMonitoredAccountSeeds, buildMonitoredAccountKey, computeMonitoredAccountPriority } from '../lib/monitored-accounts.ts'
import { mergeProfileCandidates, signalTextMatchesKeywords } from '../lib/match-candidates.ts'
import { buildFeedbackMaps, computeCandidateFeedbackBoost, computeLeadFeedbackScore, sortQueueRowsByFeedback } from '../lib/ranking-feedback.ts'
import { extractBearerToken, isInternalOpsBearerToken, isInternalOpsEmailAllowed } from '../lib/internal-ops-auth.ts'
import { buildWeeklyReview } from '../lib/internal-ops-review.ts'
import { buildSignalNoveltyKey, isLikelySameSignalEvent } from '../lib/signal-novelty.ts'
import { compareCachedContactRows, isCandidateSafeWithoutVerification, shouldShortCircuitEnrichmentFailure } from '../lib/email-finder/enrich-helpers.ts'
import { buildCrmExportRecord, mapCrmImportRecord, normalizeCrmProvider } from '../lib/crm-sync.ts'
import { buildFeedSessionLabel } from '../lib/feed-sessions.ts'
import {
  assessExplorePrompt,
  buildExploreSearchTerms,
  rankExploreCandidates,
  resolveExploreScoreThreshold,
  scoreExploreSourceItem,
  shouldUseWorkspaceIcp,
} from '../lib/explore.ts'

test('free plan only keeps the active workspace visible', () => {
  const plan = buildWorkspaceAccessPlan({
    plan: 'free',
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

test('free plan falls back to the oldest available workspace when active is missing', () => {
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

test('pro plan keeps every unarchived workspace visible', () => {
  const plan = buildWorkspaceAccessPlan({
    plan: 'pro',
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

test('lead quota decision previews free over-limit leads and blocks paid users without credits', () => {
  assert.equal(resolveLeadQuotaDecision({
    used: 10,
    monthlyLimit: 10,
    plan: 'free',
  }), 'preview')

  assert.equal(resolveLeadQuotaDecision({
    used: 10,
    monthlyLimit: 10,
    creditBalance: 3,
    plan: 'free',
  }), 'credit')

  assert.equal(resolveLeadQuotaDecision({
    used: 500,
    monthlyLimit: 500,
    plan: 'pro',
  }), 'blocked')

  assert.equal(resolveLeadQuotaDecision({
    used: 500,
    monthlyLimit: 500,
    creditBalance: 1,
    plan: 'pro',
  }), 'credit')
})

test('lead quota decision reserves quota when still under limit', () => {
  assert.equal(resolveLeadQuotaDecision({
    used: 9,
    monthlyLimit: 10,
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

  const noveltyKey = 'domain:acme.com:credit-union-underwrit'
  assert.equal(
    buildLeadDedupeKey({
      companyName: 'Acme',
      companyDomain: 'acme.com',
      signalType: 'expansion',
      noveltyKey,
      date: new Date('2026-04-23T00:00:00.000Z'),
    }),
    buildLeadDedupeKey({
      companyName: 'Acme',
      companyDomain: 'acme.com',
      signalType: 'funding',
      noveltyKey,
      date: new Date('2026-04-23T12:00:00.000Z'),
    }),
  )
})

test('signal novelty detects the same event across slightly different wording', () => {
  const eventA = {
    companyName: 'Acme',
    companyDomain: 'acme.com',
    headline: 'Acme launches underwriting platform for credit unions',
    summary: 'Acme launched an underwriting workflow product for credit unions and community lenders.',
  }
  const eventB = {
    companyName: 'Acme Inc.',
    companyDomain: 'https://www.acme.com',
    headline: 'Acme unveils product for credit unions',
    summary: 'Acme introduced an underwriting workflow platform for credit unions and community lenders.',
  }

  assert.equal(isLikelySameSignalEvent(eventA, eventB), true)
  assert.match(buildSignalNoveltyKey(eventA), /^domain:acme\.com:/)
})

test('crm provider normalization falls back to webhook for unknown providers', () => {
  assert.equal(normalizeCrmProvider('hubspot'), 'hubspot')
  assert.equal(normalizeCrmProvider('unknown-crm'), 'webhook')
})

test('crm import mapping normalizes hubspot style workflow payloads', () => {
  const mapped = mapCrmImportRecord('hubspot', {
    id: '123',
    properties: {
      company: 'Acme Labs',
      domain: 'www.acme.com',
      email: 'owner@acme.com',
      firstname: 'Taylor',
      lastname: 'Chen',
      job_title: 'VP Revenue',
      hs_lead_status: 'OPEN',
      notes: 'Existing outbound target',
    },
  })

  assert.equal(mapped?.companyName, 'Acme Labs')
  assert.equal(mapped?.companyDomain, 'acme.com')
  assert.equal(mapped?.contactName, 'Taylor Chen')
  assert.equal(mapped?.contactEmail, 'owner@acme.com')
  assert.equal(mapped?.crmStatus, 'OPEN')
})

test('crm export records build CRM-safe notes and split contact names', () => {
  const record = buildCrmExportRecord({
    company: 'Acme Labs',
    domain: 'acme.com',
    contactName: 'Taylor Chen',
    contactTitle: 'VP Revenue',
    contactEmail: 'taylor@acme.com',
    signalType: 'funding',
    signalHeadline: 'Acme closes Series B',
    signalSummary: 'Acme raised a growth round.',
    fitScore: 8,
    fitReason: 'Recent funding and expansion fit the ICP.',
    status: 'new',
  })

  assert.equal(record.website, 'https://acme.com')
  assert.equal(record.firstName, 'Taylor')
  assert.equal(record.lastName, 'Chen')
  assert.match(record.crmNote, /Recent funding/)
})

test('feed session labels summarize explore prompts and crm imports clearly', () => {
  const exploreLabel = buildFeedSessionLabel({
    origin: 'explore',
    startedAt: '2026-04-27T10:00:00.000Z',
    prompt: 'Find 50 healthcare compliance startups selling into community banks and regional lenders',
  })
  const crmLabel = buildFeedSessionLabel({
    origin: 'crm_import',
    startedAt: '2026-04-27T10:00:00.000Z',
    provider: 'hubspot',
    recordCount: 24,
  })

  assert.match(exploreLabel, /^Explore · Find 50 healthcare compliance startups/)
  assert.match(crmLabel, /^Hubspot import · 24 records · /)
})

test('explore only applies workspace icp when the user explicitly asks for it', () => {
  assert.equal(shouldUseWorkspaceIcp({
    prompt: 'find some early stage AI startups for me',
    icpHint: null,
  }), false)

  assert.equal(shouldUseWorkspaceIcp({
    prompt: 'find companies that match our ICP in fintech infrastructure',
    icpHint: null,
  }), true)

  assert.equal(shouldUseWorkspaceIcp({
    prompt: 'find some early stage AI startups for me',
    icpHint: 'Series A, US healthcare',
  }), true)
})

test('explore prompt assessment accepts normal targeting prompts and rejects obviously unrelated ones', () => {
  assert.deepEqual(
    assessExplorePrompt('find some early stage AI startups for me'),
    { allowed: true, reason: null },
  )

  assert.deepEqual(
    assessExplorePrompt('find React developer tools companies selling into fintech'),
    { allowed: true, reason: null },
  )

  assert.deepEqual(
    assessExplorePrompt('debug this Next.js build error for me'),
    {
      allowed: false,
      reason: 'Explore only supports prompts for finding target accounts, companies, or prospects.',
    },
  )
})

test('explore threshold is looser for prompt-only discovery', () => {
  assert.equal(resolveExploreScoreThreshold({
    useWorkspaceIcp: false,
    minRelevanceScore: 8,
  }), 4)

  assert.equal(resolveExploreScoreThreshold({
    useWorkspaceIcp: true,
    minRelevanceScore: 8,
  }), 7)
})

test('explore candidates rank by score first and recency second', () => {
  const ranked = rankExploreCandidates([
    { id: 'older-mid', score: 6, publishedAt: '2026-04-20T00:00:00.000Z' },
    { id: 'top', score: 8, publishedAt: '2026-04-18T00:00:00.000Z' },
    { id: 'newer-mid', score: 6, publishedAt: '2026-04-22T00:00:00.000Z' },
  ])

  assert.deepEqual(ranked.map(candidate => candidate.id), ['top', 'newer-mid', 'older-mid'])
})

test('explore search terms enrich startup and ai prompts with useful aliases', () => {
  const terms = buildExploreSearchTerms({
    prompt: 'find some early stage AI startups for me',
    queries: ['early stage ai startups', 'seed ai startup funding'],
  })

  assert.ok(terms.includes('ai'))
  assert.ok(terms.includes('startup'))
  assert.ok(terms.includes('seed'))
  assert.ok(terms.includes('series a'))
})

test('explore source scoring favors press release items with matching topical terms', () => {
  const terms = ['ai', 'startup', 'series a']
  const matching = scoreExploreSourceItem('AI startup raises Series A funding', terms)
  const nonMatching = scoreExploreSourceItem('Industrial manufacturer opens Ohio warehouse', terms)

  assert.ok(matching > nonMatching)
  assert.equal(nonMatching, 0)
})

test('delivery allowance for paid plans has no daily cap and respects quota plus credits', () => {
  assert.equal(computeDeliveryAllowance({
    plan: 'pro',
    monthlyLimit: 500,
    used: 120,
    pendingCount: 96,
    deliveredLast24h: 2,
  }), 96)

  assert.equal(computeDeliveryAllowance({
    plan: 'pro',
    monthlyLimit: 500,
    used: 500,
    creditBalance: 25,
    pendingCount: 1200,
    deliveredLast24h: 0,
  }), 25)
})

test('delivery allowance lets free users receive preview batches', () => {
  assert.equal(computeDeliveryAllowance({
    plan: 'free',
    monthlyLimit: 15,
    used: 15,
    pendingCount: 48,
    deliveredLast24h: 0,
  }), 1)
})

test('monitored account keys normalize across website and domain variants', () => {
  assert.equal(
    buildMonitoredAccountKey({
      companyName: 'Acme Technologies, Inc.',
      websiteUrl: 'https://www.acme.com',
    }),
    buildMonitoredAccountKey({
      companyName: 'Acme',
      companyDomain: 'acme.com',
    }),
  )
})

test('watchlist seeds outrank queue-only monitored accounts', () => {
  const watchlistPriority = computeMonitoredAccountPriority({
    userId: 'u1',
    clientId: 'c1',
    companyName: 'Acme',
    companyDomain: 'acme.com',
    source: 'watchlist',
    sourceTimestamp: new Date().toISOString(),
  })

  const queuePriority = computeMonitoredAccountPriority({
    userId: 'u1',
    clientId: 'c1',
    companyName: 'Acme',
    companyDomain: 'acme.com',
    source: 'queue',
    sourceTimestamp: new Date().toISOString(),
  })

  assert.ok(watchlistPriority > queuePriority)
})

test('monitored account aggregation merges seed sources for the same workspace company', () => {
  const aggregated = aggregateMonitoredAccountSeeds([
    {
      userId: 'u1',
      clientId: 'c1',
      companyName: 'Acme',
      companyDomain: 'acme.com',
      source: 'watchlist',
      sourceTimestamp: '2026-04-24T00:00:00.000Z',
    },
    {
      userId: 'u1',
      clientId: 'c1',
      companyName: 'Acme Inc.',
      websiteUrl: 'https://www.acme.com',
      source: 'lead',
      sourceTimestamp: '2026-04-25T00:00:00.000Z',
    },
  ])

  assert.equal(aggregated.length, 1)
  assert.equal(aggregated[0]?.isWatchlist, true)
  assert.deepEqual([...aggregated[0]!.seedSources].sort(), ['lead', 'watchlist'])
})

test('keyword matching checks signal text fields together', () => {
  assert.equal(signalTextMatchesKeywords({
    id: 'sig_1',
    company_name: 'Acme',
    signal_type: 'expansion',
    summary: 'Acme launched an underwriting platform for credit unions.',
    headline: 'Acme launches new underwriting platform',
  }, ['credit unions']), true)

  assert.equal(signalTextMatchesKeywords({
    id: 'sig_2',
    company_name: 'Acme',
    signal_type: 'funding',
    summary: 'Series A financing',
    headline: 'Acme raises capital',
  }, ['health systems']), false)
})

test('candidate merging keeps the strongest combined watchlist and semantic signals', () => {
  const merged = mergeProfileCandidates([
    {
      signal: {
        id: 'sig_1',
        company_name: 'Acme',
        signal_type: 'expansion',
        summary: 'Acme launched a new platform',
        headline: 'Acme launches platform',
        published_at: '2026-04-24T10:00:00.000Z',
        source_name: 'company_owned',
      },
      similarity: 0.42,
    },
    {
      signal: {
        id: 'sig_1',
        company_name: 'Acme',
        signal_type: 'expansion',
        summary: 'Acme launched a new platform',
        headline: 'Acme launches platform',
        published_at: '2026-04-24T10:00:00.000Z',
        source_name: 'company_owned',
      },
      isWatchlisted: true,
    },
    {
      signal: {
        id: 'sig_2',
        company_name: 'Beta',
        signal_type: 'funding',
        summary: 'Beta raised a Series A',
        headline: 'Beta raises Series A',
        published_at: '2026-04-23T10:00:00.000Z',
        source_name: 'prnewswire',
      },
      similarity: 0.55,
    },
  ], 5)

  assert.equal(merged.length, 2)
  assert.equal(merged[0]?.signal.id, 'sig_1')
  assert.equal(merged[0]?.isWatchlisted, true)
  assert.equal(merged[0]?.similarity, 0.42)
})

test('feedback boosts favor companies and sources with positive historical outcomes', () => {
  const maps = buildFeedbackMaps([
    {
      client_id: 'client_1',
      target_company: 'Acme',
      company_domain: 'acme.com',
      status: 'replied',
      is_unlocked: true,
      created_at: new Date().toISOString(),
      replied_at: new Date().toISOString(),
      signals: { signal_type: 'expansion', source_name: 'company_owned' },
    },
    {
      client_id: 'client_1',
      target_company: 'Acme',
      company_domain: 'acme.com',
      status: 'booked',
      is_unlocked: true,
      created_at: new Date().toISOString(),
      booked_at: new Date().toISOString(),
      signals: { signal_type: 'expansion', source_name: 'company_owned' },
    },
  ])

  const positiveBoost = computeCandidateFeedbackBoost(maps, {
    clientId: 'client_1',
    companyName: 'Acme Inc.',
    companyDomain: 'acme.com',
    signalType: 'expansion',
    sourceName: 'company_owned',
  })

  const neutralBoost = computeCandidateFeedbackBoost(maps, {
    clientId: 'client_1',
    companyName: 'Beta',
    companyDomain: 'beta.com',
    signalType: 'funding',
    sourceName: 'prnewswire',
  })

  assert.ok(positiveBoost > neutralBoost)
})

test('feedback ranking can reorder queue rows beyond stored priority', () => {
  const maps = buildFeedbackMaps([
    {
      client_id: 'client_1',
      target_company: 'Acme',
      company_domain: 'acme.com',
      status: 'booked',
      is_unlocked: true,
      created_at: new Date().toISOString(),
      booked_at: new Date().toISOString(),
      signals: { signal_type: 'expansion', source_name: 'company_owned' },
    },
  ])

  const ranked = sortQueueRowsByFeedback([
    {
      id: 'queue_1',
      client_id: 'client_1',
      target_company: 'Beta',
      company_domain: 'beta.com',
      source_name: 'prnewswire',
      priority_score: 120,
      signals: { signal_type: 'funding' },
    },
    {
      id: 'queue_2',
      client_id: 'client_1',
      target_company: 'Acme',
      company_domain: 'acme.com',
      source_name: 'company_owned',
      priority_score: 90,
      signals: { signal_type: 'expansion' },
    },
  ], maps)

  assert.equal(ranked[0]?.id, 'queue_2')
  assert.ok((ranked[0]?.feedbackBoost ?? 0) > 0)
})

test('feedback scoring does not treat missing unlock state as positive engagement', () => {
  const score = computeLeadFeedbackScore({
    client_id: 'client_1',
    target_company: 'Acme',
    status: 'new',
    created_at: new Date().toISOString(),
  })

  assert.equal(score, 0)
})

test('weekly review compares current and prior seven-day windows correctly', () => {
  const review = buildWeeklyReview({
    now: new Date('2026-04-24T12:00:00.000Z'),
    signalRows: [
      { id: 'sig_current', signal_type: 'funding', source_name: 'company_owned', published_at: '2026-04-22T00:00:00.000Z' },
      { id: 'sig_previous', signal_type: 'funding', source_name: 'prnewswire', published_at: '2026-04-12T00:00:00.000Z' },
    ],
    queueRows: [
      {
        id: 'queue_current',
        queue_status: 'delivered',
        attempt_count: 1,
        created_at: '2026-04-21T00:00:00.000Z',
        queued_at: '2026-04-21T00:00:00.000Z',
        delivered_at: '2026-04-22T00:00:00.000Z',
        last_attempted_at: '2026-04-22T00:00:00.000Z',
        source_name: 'company_owned',
        priority_score: 120,
      },
      {
        id: 'queue_previous',
        queue_status: 'expired',
        attempt_count: 3,
        created_at: '2026-04-11T00:00:00.000Z',
        queued_at: '2026-04-11T00:00:00.000Z',
        delivered_at: null,
        last_attempted_at: '2026-04-13T00:00:00.000Z',
        source_name: 'prnewswire',
        priority_score: 80,
      },
    ],
    leadRows: [
      {
        client_id: 'client_1',
        target_company: 'Acme',
        company_domain: 'acme.com',
        status: 'replied',
        is_unlocked: true,
        created_at: '2026-04-22T00:00:00.000Z',
        unlocked_at: '2026-04-22T00:00:00.000Z',
        replied_at: '2026-04-23T00:00:00.000Z',
        signals: { signal_type: 'funding', source_name: 'company_owned' },
      },
      {
        client_id: 'client_1',
        target_company: 'Beta',
        company_domain: 'beta.com',
        status: 'new',
        is_unlocked: true,
        created_at: '2026-04-12T00:00:00.000Z',
        unlocked_at: '2026-04-12T00:00:00.000Z',
        signals: { signal_type: 'funding', source_name: 'prnewswire' },
      },
    ],
  })

  assert.equal(review.current.signals, 1)
  assert.equal(review.previous.signals, 1)
  assert.equal(review.current.delivered, 1)
  assert.equal(review.previous.expired, 1)
  assert.equal(review.current.replied, 1)
  assert.equal(review.deltas.replied, 1)
  assert.equal(review.top_sources[0]?.source, 'company_owned')
  assert.ok(review.recommendations.length > 0)
})

test('internal ops auth recognizes allowlisted emails and bearer tokens', () => {
  const originalEmails = process.env.INTERNAL_OPS_ALLOWED_EMAILS
  const originalSecret = process.env.INTERNAL_OPS_SECRET
  const originalCron = process.env.CRON_SECRET

  process.env.INTERNAL_OPS_ALLOWED_EMAILS = 'ops@example.com, founder@example.com'
  process.env.INTERNAL_OPS_SECRET = 'internal-secret'
  process.env.CRON_SECRET = 'cron-secret'

  try {
    assert.equal(isInternalOpsEmailAllowed('ops@example.com'), true)
    assert.equal(isInternalOpsEmailAllowed('random@example.com'), false)
    assert.equal(extractBearerToken('Bearer internal-secret'), 'internal-secret')
    assert.equal(isInternalOpsBearerToken('internal-secret'), true)
    assert.equal(isInternalOpsBearerToken('cron-secret'), true)
    assert.equal(isInternalOpsBearerToken('wrong-secret'), false)
  } finally {
    process.env.INTERNAL_OPS_ALLOWED_EMAILS = originalEmails
    process.env.INTERNAL_OPS_SECRET = originalSecret
    process.env.CRON_SECRET = originalCron
  }
})

test('cached contact comparison prefers verified direct contacts over newer weaker rows', () => {
  const stronger = {
    contact_email: 'ceo@acme.com',
    contact_name: 'Jane Doe',
    contact_title: 'CEO',
    contact_source: 'hunter' as const,
    contact_verified: true,
    zb_status: 'valid' as const,
    linkedin_url: null,
    base_score: 95,
    resolution_method: 'direct' as const,
    enriched_at: '2026-04-20T00:00:00.000Z',
  }
  const weakerButNewer = {
    ...stronger,
    contact_verified: false,
    zb_status: null,
    contact_source: 'pattern' as const,
    resolution_method: 'pattern' as const,
    enriched_at: '2026-04-24T00:00:00.000Z',
  }

  assert.ok(compareCachedContactRows(stronger, weakerButNewer) > 0)
  assert.ok(compareCachedContactRows(weakerButNewer, stronger) < 0)
})

test('recent enrichment failures do not suppress retries when a new domain appears or success exists', () => {
  const recentFailure = {
    company_key: 'name:acme',
    input_domain: null,
    resolved_domain: null,
    last_succeeded_at: null,
    last_failed_at: '2026-04-23T12:00:00.000Z',
  }

  assert.equal(shouldShortCircuitEnrichmentFailure({
    cache: recentFailure,
    companyDomain: null,
    now: new Date('2026-04-24T00:00:00.000Z'),
  }), true)

  assert.equal(shouldShortCircuitEnrichmentFailure({
    cache: recentFailure,
    companyDomain: 'acme.com',
    now: new Date('2026-04-24T00:00:00.000Z'),
  }), false)

  assert.equal(shouldShortCircuitEnrichmentFailure({
    cache: {
      ...recentFailure,
      last_succeeded_at: '2026-04-10T00:00:00.000Z',
    },
    companyDomain: null,
    now: new Date('2026-04-24T00:00:00.000Z'),
  }), false)
})

test('unverified candidates are only treated as safe when zerobounce is disabled', () => {
  assert.equal(isCandidateSafeWithoutVerification({
    zeroBounceEnabled: false,
    resolutionMethod: 'direct',
  }), true)

  assert.equal(isCandidateSafeWithoutVerification({
    zeroBounceEnabled: true,
    resolutionMethod: 'direct',
  }), false)

  assert.equal(isCandidateSafeWithoutVerification({
    zeroBounceEnabled: false,
    resolutionMethod: 'pattern',
  }), false)
})
