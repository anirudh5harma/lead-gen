import {
  buildExaCampaignSearchPayload,
  extractExaCampaignCandidates,
  type CampaignDiscoveryBrief,
  type CampaignDiscoveryResult,
} from '@/lib/gtm/campaign-discovery'

const EXA_SEARCH_URL = 'https://api.exa.ai/search'

type FetchLike = typeof fetch

export async function discoverCampaignCandidatesWithExa(params: {
  brief: CampaignDiscoveryBrief
  count: number
  fetchImpl?: FetchLike
}): Promise<CampaignDiscoveryResult> {
  const apiKey = process.env.EXA_API_KEY?.trim()
  if (!apiKey) {
    return {
      provider: 'exa',
      status: 'not_configured',
      candidates: [],
      error: 'EXA_API_KEY is not configured',
    }
  }

  const fetcher = params.fetchImpl ?? fetch
  const payload = buildExaCampaignSearchPayload({
    brief: params.brief,
    count: params.count,
    searchType: process.env.EXA_CAMPAIGN_SEARCH_TYPE,
  })

  try {
    const response = await fetcher(EXA_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return {
        provider: 'exa',
        status: 'provider_error',
        candidates: [],
        error: `Exa search failed (${response.status}): ${text.slice(0, 240)}`,
      }
    }

    const json = await response.json() as unknown
    const candidates = extractExaCampaignCandidates({
      response: json,
      brief: params.brief,
      maxCandidates: params.count,
    })
    const requestId = typeof (json as { requestId?: unknown }).requestId === 'string'
      ? (json as { requestId: string }).requestId
      : null

    return {
      provider: 'exa',
      status: 'ready',
      requestId,
      candidates,
    }
  } catch (error) {
    return {
      provider: 'exa',
      status: 'provider_error',
      candidates: [],
      error: error instanceof Error ? error.message : 'Exa search failed',
    }
  }
}
