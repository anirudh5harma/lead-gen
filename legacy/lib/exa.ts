import {
  buildExaCampaignSearchPayload,
  buildExaCampaignWebsetPayload,
  campaignDiscoveryCompanyKey,
  extractExaCampaignCandidates,
  extractExaWebsetCampaignCandidates,
  type CampaignDiscoveryCandidate,
  type CampaignDiscoveryBrief,
  type CampaignDiscoveryResult,
} from '@/lib/gtm/campaign-discovery'

const EXA_SEARCH_URL = 'https://api.exa.ai/search'
const EXA_WEBSETS_URL = 'https://api.exa.ai/websets/v0/websets'

type FetchLike = typeof fetch

export async function discoverCampaignCandidatesWithExa(params: {
  brief: CampaignDiscoveryBrief
  count: number
  excludeKeys?: Set<string>
  fetchImpl?: FetchLike
}): Promise<CampaignDiscoveryResult> {
  const apiKey = process.env.EXA_API_KEY?.trim()
  if (!apiKey) {
    return {
      provider: 'exa',
      mode: 'search',
      status: 'not_configured',
      candidates: [],
      error: 'EXA_API_KEY is not configured',
    }
  }

  const fetcher = params.fetchImpl ?? fetch
  const requestIds: string[] = []
  const candidates: CampaignDiscoveryCandidate[] = []
  const seen = new Set(params.excludeKeys ?? [])
  const queries = params.brief.queries.length ? params.brief.queries : [params.brief.prompt]
  const maxQueries = boundedNumber(process.env.EXA_CAMPAIGN_SEARCH_MAX_QUERIES, 1, 6, 5)

  try {
    for (const [index, query] of queries.slice(0, maxQueries).entries()) {
      if (candidates.length >= params.count) break
      const configuredType = process.env.EXA_CAMPAIGN_SEARCH_TYPE
      const searchType = configuredType || (index >= 2 ? 'deep' : 'auto')
      const payload = buildExaCampaignSearchPayload({
        brief: params.brief,
        count: Math.max(params.count, params.count - candidates.length),
        searchType,
        query,
      })
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
          mode: 'search',
          status: 'provider_error',
          requestIds,
          candidates,
          error: `Exa search failed (${response.status}): ${text.slice(0, 240)}`,
        }
      }

      const json = await response.json() as unknown
      const requestId = typeof (json as { requestId?: unknown }).requestId === 'string'
        ? (json as { requestId: string }).requestId
        : null
      if (requestId) requestIds.push(requestId)
      const nextCandidates = extractExaCampaignCandidates({
        response: json,
        brief: params.brief,
        maxCandidates: params.count,
        excludeKeys: seen,
      })
      for (const candidate of nextCandidates) {
        const key = campaignDiscoveryCompanyKey(candidate.company_name, candidate.company_domain)
        if (seen.has(key)) continue
        seen.add(key)
        candidates.push(candidate)
        if (candidates.length >= params.count) break
      }
    }

    return {
      provider: 'exa',
      mode: 'search',
      status: 'ready',
      requestId: requestIds[0] ?? null,
      requestIds,
      candidates,
    }
  } catch (error) {
    return {
      provider: 'exa',
      mode: 'search',
      status: 'provider_error',
      requestIds,
      candidates,
      error: error instanceof Error ? error.message : 'Exa search failed',
    }
  }
}

export async function createCampaignWebsetWithExa(params: {
  brief: CampaignDiscoveryBrief
  count: number
  campaignId: string
  fetchImpl?: FetchLike
}): Promise<CampaignDiscoveryResult> {
  const apiKey = process.env.EXA_API_KEY?.trim()
  if (!apiKey) {
    return {
      provider: 'exa',
      mode: 'webset',
      status: 'not_configured',
      candidates: [],
      error: 'EXA_API_KEY is not configured',
    }
  }

  const fetcher = params.fetchImpl ?? fetch
  const payload = buildExaCampaignWebsetPayload({
    brief: params.brief,
    count: params.count,
    campaignId: params.campaignId,
  })

  try {
    const response = await fetcher(EXA_WEBSETS_URL, {
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
        mode: 'webset',
        status: 'provider_error',
        candidates: [],
        error: `Exa Webset creation failed (${response.status}): ${text.slice(0, 240)}`,
      }
    }

    const json = await response.json() as Record<string, unknown>
    const search = Array.isArray(json.searches) ? json.searches[0] as Record<string, unknown> | undefined : undefined
    const progress = asProgress(search?.progress)
    return {
      provider: 'exa',
      mode: 'webset',
      status: 'running',
      websetId: typeof json.id === 'string' ? json.id : null,
      websetSearchId: typeof search?.id === 'string' ? search.id : null,
      websetStatus: typeof json.status === 'string' ? json.status : null,
      progress,
      candidates: [],
    }
  } catch (error) {
    return {
      provider: 'exa',
      mode: 'webset',
      status: 'provider_error',
      candidates: [],
      error: error instanceof Error ? error.message : 'Exa Webset creation failed',
    }
  }
}

export async function syncCampaignWebsetWithExa(params: {
  brief: CampaignDiscoveryBrief
  count: number
  websetId: string
  websetSearchId?: string | null
  excludeKeys?: Set<string>
  fetchImpl?: FetchLike
}): Promise<CampaignDiscoveryResult> {
  const apiKey = process.env.EXA_API_KEY?.trim()
  if (!apiKey) {
    return {
      provider: 'exa',
      mode: 'webset',
      status: 'not_configured',
      candidates: [],
      error: 'EXA_API_KEY is not configured',
    }
  }

  const fetcher = params.fetchImpl ?? fetch
  const headers = { 'x-api-key': apiKey }

  try {
    let searchStatus: string | null = null
    let progress: CampaignDiscoveryResult['progress'] = null
    if (params.websetSearchId) {
      const searchResponse = await fetcher(`${EXA_WEBSETS_URL}/${encodeURIComponent(params.websetId)}/searches/${encodeURIComponent(params.websetSearchId)}`, {
        headers,
        signal: AbortSignal.timeout(30_000),
      })
      if (searchResponse.ok) {
        const searchJson = await searchResponse.json() as Record<string, unknown>
        searchStatus = typeof searchJson.status === 'string' ? searchJson.status : null
        progress = asProgress(searchJson.progress)
      }
    }

    const itemsResponse = await fetcher(`${EXA_WEBSETS_URL}/${encodeURIComponent(params.websetId)}/items?limit=${Math.min(100, Math.max(1, params.count))}`, {
      headers,
      signal: AbortSignal.timeout(45_000),
    })
    if (!itemsResponse.ok) {
      const text = await itemsResponse.text().catch(() => '')
      return {
        provider: 'exa',
        mode: 'webset',
        status: 'provider_error',
        websetId: params.websetId,
        websetSearchId: params.websetSearchId ?? null,
        websetStatus: searchStatus,
        progress,
        candidates: [],
        error: `Exa Webset sync failed (${itemsResponse.status}): ${text.slice(0, 240)}`,
      }
    }

    const itemsJson = await itemsResponse.json() as unknown
    const candidates = extractExaWebsetCampaignCandidates({
      response: itemsJson,
      brief: params.brief,
      maxCandidates: params.count,
      excludeKeys: params.excludeKeys,
    })
    return {
      provider: 'exa',
      mode: 'webset',
      status: searchStatus === 'completed' ? 'ready' : 'running',
      websetId: params.websetId,
      websetSearchId: params.websetSearchId ?? null,
      websetStatus: searchStatus,
      progress,
      candidates,
    }
  } catch (error) {
    return {
      provider: 'exa',
      mode: 'webset',
      status: 'provider_error',
      websetId: params.websetId,
      websetSearchId: params.websetSearchId ?? null,
      candidates: [],
      error: error instanceof Error ? error.message : 'Exa Webset sync failed',
    }
  }
}

function asProgress(value: unknown): CampaignDiscoveryResult['progress'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  return {
    found: numeric(row.found),
    analyzed: numeric(row.analyzed),
    completion: numeric(row.completion),
    timeLeft: numeric(row.timeLeft),
  }
}

function numeric(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.round(parsed)))
}
