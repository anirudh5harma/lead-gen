import test from 'node:test'
import assert from 'node:assert/strict'
import type { Lead } from '../lib/leads.ts'
import { buildWorkspaceAccessPlan } from '../lib/client-workspaces.ts'
import { resolveOutreachContext, scheduleFollowupAt } from '../lib/outreach-context.ts'
import { resolveLeadQuotaDecision } from '../lib/lead-quota.ts'
import { normalizeCompanyWebsiteUrl, resolveServicesDescription } from '../lib/company-profile.ts'
import { buildLeadDedupeKey, normalizeLeadCompanyKey } from '../lib/lead-dedupe.ts'
import { computeDeliveryAllowance } from '../lib/lead-delivery.ts'
import { computeQueuePriority } from '../lib/lead-delivery.ts'
import { aggregateMonitoredAccountSeeds, buildMonitoredAccountKey, computeMonitoredAccountPriority } from '../lib/monitored-accounts.ts'
import { mergeProfileCandidates, signalTextMatchesKeywords } from '../lib/match-candidates.ts'
import { buildFeedbackMaps, computeCandidateFeedbackBoost, computeLeadFeedbackScore, sortQueueRowsByFeedback } from '../lib/ranking-feedback.ts'
import { extractBearerToken, isInternalOpsBearerToken, isInternalOpsEmailAllowed } from '../lib/internal-ops-auth.ts'
import { buildWeeklyReview } from '../lib/internal-ops-review.ts'
import { buildSignalNoveltyKey, isLikelySameSignalEvent } from '../lib/signal-novelty.ts'
import { buildBookingReplyBody, classifyReplyIntent, shouldAutoSendBookingLink } from '../lib/reply-intelligence.ts'
import { buildIcpKeywords } from '../lib/icp.ts'
import { buildRecipientGroup, ensureBodyGreetsRecipients, mergeRecipientStakeholders } from '../lib/outreach-recipients.ts'
import { isSafeToSend } from '../lib/email-finder/zeroBounce.ts'
import { accountKey, bodyPreview, normalizeDomain, personKey, signalKey } from '../lib/gtm/identity.ts'
import { buildContextQuery, normalizeEmbeddingContent, stableContentHash } from '../lib/gtm/semantic-context.ts'
import { applyDailySuggestionCaps, dailySuggestionDate, normalizeDraftSettings, tabForContentType } from '../lib/gtm/content-planning.ts'
import { compareCachedContactRows, isCandidateSafeWithoutVerification, shouldShortCircuitEnrichmentFailure } from '../lib/email-finder/enrich-helpers.ts'
import { buildCrmExportRecord, mapCrmImportRecord, normalizeCrmProvider } from '../lib/crm-sync.ts'
import { buildFeedSessionLabel } from '../lib/feed-sessions.ts'
import {
  parseExtraRssFeeds,
} from '../lib/rss.ts'
import {
  assessExplorePrompt,
  buildExploreSearchTerms,
  rankExploreCandidates,
  resolveExploreScoreThreshold,
  scoreExploreSourceItem,
  shouldUseWorkspaceIcp,
} from '../lib/explore.ts'
import { cheapJunkFilter, stableCandidateHash } from '../lib/signal-filter.ts'
import { draftOutreachEmail, repairOutreachBodyTriggerOpening, sanitizePublicSignalSummary } from '../lib/deepseek.ts'
import { checkAgentRateLimit } from '../lib/a2a/rate-limit.ts'
import { evaluateOutreachDraftQuality } from '../lib/gtm/draft-eval.ts'
import { classifyFailureTaxonomy, scoreEvalTrace } from '../lib/gtm/eval-traces.ts'
import { buildApolloPersonTitles, contactTitleMatchesRoles, normalizeRoleSelection } from '../lib/contact-targeting.ts'
import { apolloCompanyMatchesFilters } from '../lib/apollo.ts'
import { isPublishModeQueueEligible, selectPreferredDistributionAccount } from '../lib/distribution.ts'
import { buildRevenueSnapshot } from '../lib/revenue-ux.ts'
import { buildOutreachPlan } from '../lib/gtm/outreach-plan.ts'

test('free workspace keeps only the active workspace visible', () => {
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

test('free workspace falls back to the oldest available workspace when active is missing', () => {
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
  assert.deepEqual(plan.archiveClientIds, ['client_b'])
})

test('archived workspace is unarchived when it is the only available workspace', () => {
  const plan = buildWorkspaceAccessPlan({
    plan: 'free',
    activeClientId: 'client_c',
    clients: [
      { id: 'client_c', is_archived: true, created_at: '2026-04-22T00:00:00.000Z' },
    ],
  })

  assert.deepEqual(plan.visibleClientIds, ['client_c'])
  assert.equal(plan.keepClientId, 'client_c')
  assert.deepEqual(plan.archiveClientIds, [])
  assert.deepEqual(plan.unarchiveClientIds, ['client_c'])
})

test('agent rate limiter treats zero tier limits as unlimited', async () => {
  const supabase = {
    rpc() {
      return {
        data: [{
          allowed: true,
          remaining: 2147483647,
          reset_at: new Date(Date.now() + 60_000).toISOString(),
          window: 'minute',
        }],
        error: null,
      }
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: {
                    requests_per_minute: 0,
                    requests_per_hour: 0,
                    requests_per_day: 0,
                    concurrent_requests: 50,
                  },
                }),
              }
            },
          }
        },
      }
    },
  }

  for (let i = 0; i < 5; i += 1) {
    const result = await checkAgentRateLimit(supabase as never, 'enterprise_key', 'enterprise')
    assert.equal(result.allowed, true)
    assert.ok(result.remaining > 1000)
  }
})

test('outreach draft quality evaluator flags duplicate company trigger opening', () => {
  const result = evaluateOutreachDraftQuality({
    subject: 'Quick thought on your funding',
    body: 'Angelika, noticed Dreamteam around Dreamteam.\n\nThis usually creates GTM pressure.\n\nOpen to a quick call?',
    greeting: 'Angelika',
    targetCompany: 'Dreamteam',
    signalType: 'funding',
    signalSummary: 'Dreamteam is in talks to raise a Series A round.',
  })

  assert.ok(result.score < 80)
  assert.ok(result.failed.includes('trigger_opening_sane'))
})

test('outreach draft quality evaluator rewards signal-aligned structure', () => {
  const result = evaluateOutreachDraftQuality({
    subject: 'Funding motion at Dreamteam',
    body: 'Angelika,\n\nDreamteam\'s funding process usually creates immediate pressure to prioritize the right accounts and tighten outbound focus.\n\nWe help teams turn those funding and hiring signals into concrete first-touch sequences with verified contacts.\n\nWorth a 15-minute comparison this week?',
    greeting: 'Angelika',
    targetCompany: 'Dreamteam',
    signalType: 'funding',
    signalSummary: 'Dreamteam is in talks to raise a $40M Series A.',
  })

  assert.ok(result.score >= 80)
  assert.ok(!result.failed.includes('trigger_opening_sane'))
  assert.ok(!result.failed.includes('signal_alignment'))
  assert.ok(!result.failed.includes('recipient_greeting'))
})

test('eval traces classify contact-related blocks correctly', () => {
  const taxonomy = classifyFailureTaxonomy({
    status: 'blocked',
    reasons: ['contact_not_verified', 'recipient_verification_required'],
  })
  assert.equal(taxonomy, 'contact_quality')
})

test('eval traces classify runtime send errors as inbox or runtime faults', () => {
  assert.equal(classifyFailureTaxonomy({
    status: 'blocked',
    reasons: ['no_connected_inbox'],
    errorMessage: 'No sending account connected',
  }), 'inbox_config')

  assert.equal(classifyFailureTaxonomy({
    status: 'failed',
    reasons: ['runtime_send_failure'],
    errorMessage: 'Upstream network timeout',
  }), 'provider_transient')
})

test('eval trace scoring rewards pass and penalizes blocked reason stacks', () => {
  const passed = scoreEvalTrace({ status: 'passed', reasons: [], draftQualityScore: 82 })
  const blocked = scoreEvalTrace({ status: 'blocked', reasons: ['contact_not_verified', 'recipient_verification_required'] })
  const failed = scoreEvalTrace({ status: 'failed', reasons: ['runtime_send_failure'] })

  assert.ok(passed >= 80)
  assert.ok(blocked < 50)
  assert.ok(failed < blocked)
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

test('lead quota decision only depends on credit availability in PAYG mode', () => {
  assert.equal(resolveLeadQuotaDecision({
    used: 10,
    monthlyLimit: 10,
  }), 'preview')

  assert.equal(resolveLeadQuotaDecision({
    used: 10,
    monthlyLimit: 10,
    creditBalance: 3,
  }), 'credit')
})

test('lead quota decision does not reserve bundled unlocks in PAYG mode', () => {
  assert.equal(resolveLeadQuotaDecision({
    used: 9,
    monthlyLimit: 10,
  }), 'preview')
})

test('marketing suggestion date respects workspace timezone', () => {
  const now = new Date('2026-05-06T20:30:00.000Z')
  assert.equal(dailySuggestionDate(now, 'Asia/Kolkata'), '2026-05-07')
  assert.equal(dailySuggestionDate(now, 'UTC'), '2026-05-06')
})

test('marketing daily caps are enforced per content tab', () => {
  const items = [
    ...Array.from({ length: 6 }, (_, index) => ({ idea: { contentType: 'linkedin_post' as const }, id: `post_${index}` })),
    ...Array.from({ length: 4 }, (_, index) => ({ idea: { contentType: 'blog_article' as const }, id: `blog_${index}` })),
    ...Array.from({ length: 3 }, (_, index) => ({ idea: { contentType: 'video_script' as const }, id: `video_${index}` })),
  ]

  const capped = applyDailySuggestionCaps(items, { posts: 5, blogs: 2, videos: 1 })
  assert.equal(capped.filter(item => tabForContentType(item.idea.contentType) === 'posts').length, 5)
  assert.equal(capped.filter(item => tabForContentType(item.idea.contentType) === 'blogs').length, 2)
  assert.equal(capped.filter(item => tabForContentType(item.idea.contentType) === 'videos').length, 1)
  assert.deepEqual(capped.filter(item => item.idea.contentType === 'linkedin_post').map(item => item.rank), [1, 2, 3, 4, 5])
})

test('marketing draft settings normalize platform-specific controls', () => {
  const settings = normalizeDraftSettings({
    platform: 'instagram',
    wordTarget: 99999,
    emojiLevel: 'expressive',
    linkMode: 'inline',
    imageMode: 'required',
    voice: 'founder',
    durationSeconds: 2,
    aspectRatio: '9:16',
    aiLabel: false,
  }, 'video_script')

  assert.equal(settings.platform, 'instagram')
  assert.equal(settings.wordTarget, 75)
  assert.equal(settings.durationSeconds, 5)
  assert.equal(settings.emojiLevel, 'expressive')
  assert.equal(settings.aspectRatio, '9:16')
  assert.equal(settings.aiLabel, false)

  const cappedVideo = normalizeDraftSettings({ durationSeconds: 240 }, 'video_script')
  assert.equal(cappedVideo.durationSeconds, 30)
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

test('services description resolver keeps manual description when website is also provided', async () => {
  const previousFirecrawlKey = process.env.FIRECRAWL_API_KEY
  const originalFetch = globalThis.fetch
  process.env.FIRECRAWL_API_KEY = 'test'
  let fetched = false
  globalThis.fetch = (() => {
    fetched = true
    throw new Error('website should not be fetched when manual description exists')
  }) as typeof fetch

  try {
    const resolved = await resolveServicesDescription({
      companyName: 'Acme',
      industry: 'saas',
      manualDescription: 'We help finance teams automate revenue reconciliation and audit workflows.',
      websiteUrl: 'https://acme.com',
    })

    assert.equal(resolved?.description, 'We help finance teams automate revenue reconciliation and audit workflows.')
    assert.equal(resolved?.websiteUrl, 'https://acme.com')
    assert.equal(resolved?.source, 'manual')
    assert.equal(fetched, false)
  } finally {
    if (previousFirecrawlKey === undefined) delete process.env.FIRECRAWL_API_KEY
    else process.env.FIRECRAWL_API_KEY = previousFirecrawlKey
    globalThis.fetch = originalFetch
  }
})

test('services description resolver does not silently save website-only descriptions', async () => {
  const resolved = await resolveServicesDescription({
    companyName: 'Acme',
    industry: 'saas',
    manualDescription: '',
    websiteUrl: 'https://acme.com',
  })

  assert.equal(resolved, null)
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

test('semantic context hashes normalized content consistently', () => {
  assert.equal(
    stableContentHash('  Series A   funding announced\nfor Avoca  '),
    stableContentHash('Series A funding announced for Avoca'),
  )
  assert.equal(normalizeEmbeddingContent('one\n\n two\tthree'), 'one two three')
})

test('semantic context query uses lead and account signal context', () => {
  const query = buildContextQuery(null, {
    target_company: 'Avoca',
    company_domain: 'avoca.com',
    relevance_reason: 'Raised funding and is hiring revenue leadership.',
    feed_snapshot: {
      signal_type: 'funding',
      headline: 'Avoca raises Series A',
      summary: 'Funding creates GTM hiring pressure.',
    },
  }, {
    account: { name: 'Avoca', domain: 'avoca.com' },
  })

  assert.match(query, /Avoca/)
  assert.match(query, /funding/)
  assert.match(query, /GTM hiring pressure/)
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

test('cheap signal filter rejects market noise before extraction', () => {
  const decision = cheapJunkFilter({
    title: 'Top 10 AI market trends to watch this year',
    description: 'A research report and forecast for the software industry.',
    link: 'https://example.com/report',
    source: 'google_news',
  })

  assert.equal(decision.pass, false)
  assert.equal(decision.decision, 'market_noise')
})

test('cheap signal filter passes named company events with stable raw hashes', () => {
  const item = {
    title: 'Acme Labs raises $25M Series A funding',
    description: 'Acme Labs will expand its engineering and go-to-market teams.',
    link: 'https://news.example.com/acme-series-a',
    source: 'prnewswire',
  }
  const decision = cheapJunkFilter(item)

  assert.equal(decision.pass, true)
  assert.equal(decision.decision, 'company_event')
  assert.equal(stableCandidateHash(item), stableCandidateHash({ ...item }))
})

test('queue priority rewards corroborated signal clusters', () => {
  const base = computeQueuePriority({
    relevanceScore: 7,
    publishedAt: '2026-04-24T00:00:00.000Z',
    sourceName: 'google_news',
  })
  const corroborated = computeQueuePriority({
    relevanceScore: 7,
    publishedAt: '2026-04-24T00:00:00.000Z',
    sourceName: 'google_news',
    clusterScore: 80,
    corroboratingSourceCount: 3,
  })

  assert.ok(corroborated > base)
})

test('extra RSS feed config supports self-hosted source aggregators', () => {
  assert.deepEqual(
    parseExtraRssFeeds('x_founder_feed|https://rss.example.com/x.xml\nlinkedin_jobs|https://rss.example.com/linkedin.xml'),
    [
      { source: 'x_founder_feed', url: 'https://rss.example.com/x.xml' },
      { source: 'linkedin_jobs', url: 'https://rss.example.com/linkedin.xml' },
    ],
  )

  assert.deepEqual(
    parseExtraRssFeeds('[{"source":"RSS Bridge / VC","url":"https://rss.example.com/vc.xml"}]'),
    [{ source: 'rss_bridge_vc', url: 'https://rss.example.com/vc.xml' }],
  )
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

  assert.match(exploreLabel, /^Batch · Find 50 healthcare compliance startups/)
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
      reason: 'Batch sourcing only supports prompts for finding target accounts, companies, or prospects.',
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

test('delivery allowance keeps a bounded daily flow for locked PAYG leads', () => {
  assert.equal(computeDeliveryAllowance({
    pendingCount: 96,
    deliveredLast24h: 2,
  }), 3)

  assert.equal(computeDeliveryAllowance({
    pendingCount: 1200,
    deliveredLast24h: 0,
  }), 12)
})

test('delivery allowance pauses once the daily target is reached', () => {
  assert.equal(computeDeliveryAllowance({
    pendingCount: 48,
    deliveredLast24h: 16,
  }), 0)
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

test('catch-all verification is not safe unless explicitly enabled', () => {
  const previous = process.env.OUTBOUND_ALLOW_CATCH_ALL
  delete process.env.OUTBOUND_ALLOW_CATCH_ALL
  try {
    assert.equal(isSafeToSend('valid'), true)
    assert.equal(isSafeToSend('catch-all'), false)
  } finally {
    if (previous) process.env.OUTBOUND_ALLOW_CATCH_ALL = previous
  }
})

test('reply intent classifier detects meeting and booking outcomes', () => {
  const meeting = classifyReplyIntent({
    subject: 'Re: data ops',
    text: 'This looks relevant. Can you send over your calendar link so we can book a quick call next week?',
  })
  assert.equal(meeting.intent, 'meeting_requested')
  assert.equal(shouldAutoSendBookingLink(meeting), true)

  const booked = classifyReplyIntent({
    subject: 'Re: data ops',
    text: 'Booked a slot for Thursday and sent a calendar invite.',
  })
  assert.equal(booked.intent, 'meeting_booked')

  const noThanks = classifyReplyIntent({
    subject: 'Re: data ops',
    text: 'No thanks, not a fit for us right now.',
  })
  assert.equal(noThanks.intent, 'not_interested')
})

test('booking reply body includes the user booking link without fabricating slots', () => {
  const body = buildBookingReplyBody({
    calendlyUrl: 'https://calendly.com/acme/15min',
    senderCompany: 'Acme',
  })
  assert.match(body, /https:\/\/calendly\.com\/acme\/15min/)
  assert.match(body, /send over two times/i)
})

test('icp keywords keep explicit user terms without generated or industry fallbacks', () => {
  const keywords = buildIcpKeywords({
    explicitKeywords: 'seed-stage SaaS, RevOps',
    generatedKeywords: ['pipeline automation', 'RevOps'],
    targetIndustries: ['fintech', 'data_ai'],
  })

  assert.deepEqual(keywords, [
    'seed-stage SaaS',
    'RevOps',
  ])
})

test('icp keywords fall back to generated terms and selected target industries when explicit terms are empty', () => {
  const keywords = buildIcpKeywords({
    explicitKeywords: '',
    generatedKeywords: ['pipeline automation', 'RevOps'],
    targetIndustries: ['fintech', 'data_ai'],
  })

  assert.deepEqual(keywords, [
    'pipeline automation',
    'RevOps',
    'FinTech',
    'Data and AI',
  ])
})

test('outreach recipients use first contact as to and remaining verified contacts as cc', () => {
  const group = buildRecipientGroup([
    { name: 'Jane Doe', title: 'CEO', email: 'Jane@Acme.com' },
    { name: 'Rahul Mehta', title: 'Revenue', email: 'rahul@acme.com' },
    { name: 'Jane Duplicate', title: 'CEO', email: 'jane@acme.com' },
  ])

  assert.equal(group?.to.email, 'jane@acme.com')
  assert.deepEqual(group?.cc.map(recipient => recipient.email), ['rahul@acme.com'])
  assert.equal(group?.greeting, 'Jane and Rahul')
})

test('existing outreach draft stakeholders are not shrunk by lead primary contact reload', () => {
  const existing = [
    { name: 'Jane Doe', title: 'CEO', email: 'jane@acme.com', confidence: 'high', source: 'enrichment' },
    { name: 'Rahul Mehta', title: 'Revenue', email: 'rahul@acme.com', confidence: 'high', source: 'enrichment' },
    { name: 'Maya Singh', title: 'Growth', email: 'maya@acme.com', confidence: 'high', source: 'enrichment' },
  ]
  const resolvedFromLead = [
    { name: 'Jane Doe', title: 'CEO', email: 'jane@acme.com', confidence: 'high', source: 'lead_contact' },
  ]

  const merged = mergeRecipientStakeholders(existing, resolvedFromLead)
  const group = buildRecipientGroup(merged)

  assert.deepEqual(merged.map(stakeholder => stakeholder.email), ['jane@acme.com', 'rahul@acme.com', 'maya@acme.com'])
  assert.equal(group?.greeting, 'Jane, Rahul, and Maya')
  assert.deepEqual(group?.cc.map(recipient => recipient.email), ['rahul@acme.com', 'maya@acme.com'])
})

test('outreach recipients strip professional suffixes and reject suffix-tainted emails', () => {
  const group = buildRecipientGroup([
    { name: 'Katherine Vasconez, Esq.', title: 'General Counsel', email: 'katherine.vasconezesq@adept.ai' },
    { name: 'Katherine Vasconez, Esq.', title: 'General Counsel', email: 'katherine.vasconez@adept.ai' },
  ])

  assert.equal(group?.to.email, 'katherine.vasconez@adept.ai')
  assert.equal(group?.to.name, 'Katherine Vasconez')
  assert.equal(group?.greeting, 'Katherine')
})

test('outreach body greeting is rewritten to address grouped recipients', () => {
  const body = ensureBodyGreetsRecipients(
    'Jane, noticed Acme expanded into Europe.\n\nThat usually changes priorities.\n\nBombsell helps here.\n\nWorth a quick look?',
    'Jane and Rahul',
  )

  assert.match(body, /^Jane and Rahul, noticed Acme/)
})

test('outreach greeting rewrite is idempotent for grouped greetings', () => {
  assert.equal(
    ensureBodyGreetsRecipients(
      'Glenn and Lauren, Glenn and Lauren, noticed Cloudsmith is expanding its platform.',
      'Glenn and Lauren',
    ),
    'Glenn and Lauren, noticed Cloudsmith is expanding its platform.',
  )

  assert.equal(
    ensureBodyGreetsRecipients(
      'Glenn and Lauren, noticed Cloudsmith is expanding its platform.',
      'Glenn and Lauren',
    ),
    'Glenn and Lauren, noticed Cloudsmith is expanding its platform.',
  )

  assert.equal(
    ensureBodyGreetsRecipients(
      'Hi Glenn and Lauren, Glenn and Lauren, Glenn and Lauren, noticed Cloudsmith is expanding its platform.',
      'Glenn and Lauren',
    ),
    'Glenn and Lauren, noticed Cloudsmith is expanding its platform.',
  )

  assert.equal(
    ensureBodyGreetsRecipients(
      'katherine, katherine that funding round probably changes how Adept prioritizes enterprise accounts.',
      'Katherine',
    ),
    'Katherine, that funding round probably changes how Adept prioritizes enterprise accounts.',
  )
})

test('outreach draft fallback does not leak internal planning instructions', async () => {
  const oldKey = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  try {
    const draft = await draftOutreachEmail({
      senderCompany: 'Bombsell',
      servicesDescription: 'Bombsell is the best AI-native GTM infrastructure for finding companies in pain.',
      stakeholderName: 'Carmen Ruiz',
      stakeholderTitle: 'CEO',
      recipientGreeting: 'Carmen and Apurva',
      targetCompany: 'Avoca',
      signalType: 'funding',
      signalSummary: 'Connect the funding event at Avoca to a concrete GTM priority for executive sponsor. Keep the offer tied to: Bombsell is the best AI-native GTM infrastructure.',
      customInstructions: null,
    })

    assert.doesNotMatch(draft.body, /connect the funding event/i)
    assert.doesNotMatch(draft.body, /keep the offer tied/i)
    assert.doesNotMatch(draft.body, /concrete gtm priority/i)
    assert.doesNotMatch(draft.body, /short window where priorities shift/i)
    assert.match(draft.body, /^Carmen and Apurva,/)
  } finally {
    if (oldKey) process.env.DEEPSEEK_API_KEY = oldKey
  }
})

test('outreach draft fallback does not duplicate company around funding signal', async () => {
  const oldKey = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  try {
    const draft = await draftOutreachEmail({
      senderCompany: 'Bombsell',
      servicesDescription: 'Bombsell helps teams turn public buying signals into timely outbound.',
      stakeholderName: 'Angelika Sharma',
      stakeholderTitle: 'Head of Revenue',
      recipientGreeting: 'Angelika',
      targetCompany: 'Dreamteam',
      signalType: 'funding',
      signalSummary: 'dreamteam, an ai startup founded by former freshworks executives, is in talks to raise a $40 million series a round from accel, signaling strong investor interest.',
      customInstructions: null,
    })

    assert.doesNotMatch(draft.body, /Dreamteam\s+around\s+dreamteam/i)
    assert.doesNotMatch(draft.body, /noticed\s+Dreamteam\s+around/i)
    assert.match(draft.body, /^Angelika,/)
  } finally {
    if (oldKey) process.env.DEEPSEEK_API_KEY = oldKey
  }
})

test('stored outreach draft repair removes duplicated trigger opening', () => {
  const body = repairOutreachBodyTriggerOpening(
    'Angelika, noticed Dreamteam around dreamteam, an ai startup founded by former freshworks executives, is in talks to raise a $40 million series a round from accel.\n\nWorth a quick look?',
    {
      firstName: 'Angelika',
      recipientGreeting: 'Angelika',
      targetCompany: 'Dreamteam',
    },
  )

  assert.equal(
    body,
    'Angelika, noticed Dreamteam, an ai startup founded by former freshworks executives, is in talks to raise a $40 million series a round from accel.\n\nWorth a quick look?',
  )
})

test('public signal summaries strip internal outreach plan language', () => {
  const summary = sanitizePublicSignalSummary(
    'Connect the funding event at Avoca to a concrete GTM priority for executive sponsor. Keep the offer tied to: Bombsell is the best AI-native GTM infrastructure.',
    'funding',
    'Avoca',
  )

  assert.equal(summary, 'the recent funding signal at Avoca')
})

test('gtm identity keys normalize accounts people and signals deterministically', () => {
  assert.equal(normalizeDomain('https://www.Example.com/pricing'), 'example.com')
  assert.equal(accountKey({ name: 'Example, Inc.', domain: 'www.example.com' }), 'domain:example.com')
  assert.equal(accountKey({ name: 'Example, Inc.' }), 'name:example-inc')
  assert.equal(personKey({ email: 'ALEX@EXAMPLE.COM' }), 'email:alex@example.com')
  assert.equal(personKey({ name: 'Alex Rivera', accountId: 'acct_1' }), 'name:acct_1:alex-rivera')
  assert.equal(signalKey({
    accountKey: 'domain:example.com',
    sourceUrl: 'https://example.com/news',
    headline: 'Example hires a VP Sales',
  }), 'url:https://example.com/news')
})

test('gtm body previews collapse whitespace and bound stored context', () => {
  const preview = bodyPreview(' First line\n\nSecond\tline '.repeat(20), 40)
  assert.equal(preview.length, 40)
  assert.equal(preview.includes('\n'), false)
})

test('role selection normalizes and deduplicates known role keys', () => {
  const selected = normalizeRoleSelection(['sales', 'Sales', 'executive', 'unknown', '', 'sales'])
  assert.deepEqual(selected, ['sales', 'executive'])
})

test('apollo titles and title matching stay aligned with role filters', () => {
  const titles = buildApolloPersonTitles(['sales', 'executive'])
  assert.equal(titles.includes('Head of Sales'), true)
  assert.equal(titles.includes('Chief Executive Officer'), true)
  assert.equal(contactTitleMatchesRoles('VP of Sales', ['sales']), true)
  assert.equal(contactTitleMatchesRoles('Head of Product', ['sales']), false)
})

test('apollo company filter matching supports full employee and revenue ranges', () => {
  const enterprise = {
    name: 'Acme',
    domain: 'acme.com',
    employee_count: 5400,
    annual_revenue: 80_000_000,
    location: 'Austin, Texas, United States',
  }

  assert.equal(
    apolloCompanyMatchesFilters(enterprise, { employee_count: '5000+', revenue: '$50M-$250M' }).matches,
    true,
  )
  assert.equal(
    apolloCompanyMatchesFilters(enterprise, { revenue: 'Under $1M' }).matches,
    false,
  )
})

test('apollo company filter matching supports region aliases', () => {
  const company = {
    name: 'Northstar',
    domain: 'northstar.com',
    location: 'Seattle, Washington, USA',
  }
  assert.equal(
    apolloCompanyMatchesFilters(company, { region: 'United States' }).matches,
    true,
  )
})

test('distribution account selection prefers connected scheduled accounts', () => {
  const selected = selectPreferredDistributionAccount([
    { id: 'a', status: 'needs_reconnect', publish_mode: 'scheduled' },
    { id: 'b', status: 'connected', publish_mode: 'manual_review' },
    { id: 'c', status: 'connected', publish_mode: 'scheduled' },
  ])
  assert.equal(selected?.id, 'c')
})

test('distribution account selection still returns best fallback when no connected account exists', () => {
  const selected = selectPreferredDistributionAccount([
    { id: 'a', status: 'needs_reconnect', publish_mode: 'scheduled' },
    { id: 'b', status: 'needs_reconnect', publish_mode: 'manual_review' },
  ])
  assert.equal(selected?.id, 'a')
})

test('manual review publish mode is queue-eligible by default', () => {
  const previous = process.env.DISTRIBUTION_REQUIRE_MANUAL_REVIEW
  delete process.env.DISTRIBUTION_REQUIRE_MANUAL_REVIEW
  assert.equal(isPublishModeQueueEligible('manual_review'), true)
  if (typeof previous === 'string') process.env.DISTRIBUTION_REQUIRE_MANUAL_REVIEW = previous
  else delete process.env.DISTRIBUTION_REQUIRE_MANUAL_REVIEW
})

test('manual review publish mode is blocked when explicit manual review is required', () => {
  const previous = process.env.DISTRIBUTION_REQUIRE_MANUAL_REVIEW
  process.env.DISTRIBUTION_REQUIRE_MANUAL_REVIEW = 'true'
  assert.equal(isPublishModeQueueEligible('manual_review'), false)
  if (typeof previous === 'string') process.env.DISTRIBUTION_REQUIRE_MANUAL_REVIEW = previous
  else delete process.env.DISTRIBUTION_REQUIRE_MANUAL_REVIEW
})

test('revenue snapshot flags no-send state and proposes outreach action', () => {
  const now = Date.parse('2026-05-08T12:00:00.000Z')
  const leads = [
    { id: 'l1', target_company: 'Acme', relevance_score: 8, relevance_reason: null, status: 'drafted', created_at: '2026-05-01T00:00:00.000Z' },
    { id: 'l2', target_company: 'Beta', relevance_score: 7, relevance_reason: null, status: 'new', created_at: '2026-04-10T00:00:00.000Z' },
  ]
  const snapshot = buildRevenueSnapshot(leads as unknown as Lead[], now)
  assert.equal(snapshot.windows.sent30d, 0)
  assert.equal(snapshot.notWorking.some(item => item.id === 'no-sends'), true)
  assert.equal(snapshot.actions.some(action => action.id === 'send-first-batch'), true)
})

test('autonomous outreach plans do not require review for sendable matched leads', () => {
  const plan = buildOutreachPlan({
    mode: 'autonomous',
    lead: {
      id: 'lead-1',
      target_company: 'Acme',
      relevance_score: 7,
      relevance_reason: 'Hiring GTM leadership and expanding outbound.',
      is_unlocked: true,
      contact_email: 'buyer@acme.example',
      contact_verified: false,
      status: 'new',
      created_at: '2026-05-01T00:00:00.000Z',
    },
    senderContext: {
      companyName: 'Bombsell',
      servicesDescription: 'Signal-led outbound automation',
    },
  })

  assert.equal(plan.requires_review, false)
  assert.ok(plan.risk_flags.includes('contact_not_verified'))
})

test('revenue snapshot marks healthy activity when sends replies and bookings are present', () => {
  const now = Date.parse('2026-05-08T12:00:00.000Z')
  const leads = [
    {
      id: 'l1',
      target_company: 'Acme',
      relevance_score: 8,
      relevance_reason: null,
      status: 'booked',
      created_at: '2026-04-20T00:00:00.000Z',
      sent_at: '2026-04-25T00:00:00.000Z',
      replied_at: '2026-04-27T00:00:00.000Z',
      booked_at: '2026-04-29T00:00:00.000Z',
    },
    {
      id: 'l2',
      target_company: 'Beta',
      relevance_score: 8,
      relevance_reason: null,
      status: 'sent',
      created_at: '2026-04-22T00:00:00.000Z',
      sent_at: '2026-04-28T00:00:00.000Z',
    },
    {
      id: 'l3',
      target_company: 'Gamma',
      relevance_score: 8,
      relevance_reason: null,
      status: 'replied',
      created_at: '2026-04-23T00:00:00.000Z',
      sent_at: '2026-04-29T00:00:00.000Z',
      replied_at: '2026-05-01T00:00:00.000Z',
    },
    {
      id: 'l4',
      target_company: 'Delta',
      relevance_score: 8,
      relevance_reason: null,
      status: 'sent',
      created_at: '2026-04-24T00:00:00.000Z',
      sent_at: '2026-05-02T00:00:00.000Z',
    },
    {
      id: 'l5',
      target_company: 'Epsilon',
      relevance_score: 8,
      relevance_reason: null,
      status: 'sent',
      created_at: '2026-04-24T00:00:00.000Z',
      sent_at: '2026-05-03T00:00:00.000Z',
    },
    {
      id: 'l6',
      target_company: 'Zeta',
      relevance_score: 8,
      relevance_reason: null,
      status: 'sent',
      created_at: '2026-04-24T00:00:00.000Z',
      sent_at: '2026-05-04T00:00:00.000Z',
    },
    {
      id: 'l7',
      target_company: 'Eta',
      relevance_score: 8,
      relevance_reason: null,
      status: 'sent',
      created_at: '2026-04-24T00:00:00.000Z',
      sent_at: '2026-05-05T00:00:00.000Z',
    },
    {
      id: 'l8',
      target_company: 'Theta',
      relevance_score: 8,
      relevance_reason: null,
      status: 'sent',
      created_at: '2026-04-24T00:00:00.000Z',
      sent_at: '2026-05-06T00:00:00.000Z',
    },
    {
      id: 'l9',
      target_company: 'Iota',
      relevance_score: 8,
      relevance_reason: null,
      status: 'sent',
      created_at: '2026-04-24T00:00:00.000Z',
      sent_at: '2026-05-07T00:00:00.000Z',
    },
    {
      id: 'l10',
      target_company: 'Kappa',
      relevance_score: 8,
      relevance_reason: null,
      status: 'sent',
      created_at: '2026-04-24T00:00:00.000Z',
      sent_at: '2026-05-07T12:00:00.000Z',
    },
  ]
  const snapshot = buildRevenueSnapshot(leads as unknown as Lead[], now)
  assert.equal(snapshot.windows.sent30d >= 9, true)
  assert.equal(snapshot.windows.replied30d >= 2, true)
  assert.equal(snapshot.windows.booked30d >= 1, true)
  assert.equal(snapshot.working.length > 0, true)
})
