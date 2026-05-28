export function shouldUseWorkspaceIcp(params: {
  prompt: string
  icpHint?: string | null
}): boolean {
  const prompt = params.prompt.trim().toLowerCase()
  const icpHint = params.icpHint?.trim() ?? ''

  if (icpHint) return true
  if (!prompt) return false

  return [
    /\bicp\b/,
    /ideal customer/,
    /fit (our|my) /,
    /match (our|my) /,
    /relevant to (our|my) /,
    /(our|my) customers/,
    /(our|my) buyers/,
    /(our|my) product/,
    /(our|my) service/,
    /(our|my) offering/,
  ].some(pattern => pattern.test(prompt))
}

export function assessExplorePrompt(prompt: string): {
  allowed: boolean
  reason: string | null
} {
  const normalized = prompt.trim().toLowerCase()

  if (normalized.length < 8) {
    return {
      allowed: false,
      reason: 'Add a more specific targeting prompt.',
    }
  }

  const targetingIntent = [
    /\bfind\b/,
    /\btarget\b/,
    /\bprospect\b/,
    /\baccount\b/,
    /\blead\b/,
    /\bcompany\b/,
    /\bcompanies\b/,
    /\bstartup\b/,
    /\bstartups\b/,
    /\bbuyer\b/,
    /\bbuyers\b/,
    /\bsegment\b/,
    /\bsegments\b/,
    /\bindustry\b/,
    /\bindustries\b/,
    /\boutreach\b/,
    /\bicp\b/,
    /\bwho should (i|we) (target|go after|reach out to)\b/,
  ].some(pattern => pattern.test(normalized))

  if (targetingIntent) {
    return {
      allowed: true,
      reason: null,
    }
  }

  const obviouslyUnrelated = [
    /\brecipe\b/,
    /\bpoem\b/,
    /\bstory\b/,
    /\bjoke\b/,
    /\btranslate\b/,
    /\bsummar(?:ize|ise)\b/,
    /\brewrite\b/,
    /\bgrammar\b/,
    /\bessay\b/,
    /\bcover letter\b/,
    /\bresume\b/,
    /\bmath\b/,
    /\bequation\b/,
    /\bsql\b/,
    /\bjavascript\b/,
    /\btypescript\b/,
    /\breact\b/,
    /\bnext\.?js\b/,
    /\bpython\b/,
    /\bdebug\b/,
    /\berror\b/,
    /\bstack trace\b/,
    /\bbug\b/,
    /\bcustomer support\b/,
    /\bsupport ticket\b/,
    /\bmeeting notes\b/,
  ].some(pattern => pattern.test(normalized))

  if (obviouslyUnrelated) {
    return {
      allowed: false,
      reason: 'Batch sourcing only supports prompts for finding target accounts, companies, or prospects.',
    }
  }

  return {
    allowed: true,
    reason: null,
  }
}

export function resolveExploreScoreThreshold(params: {
  useWorkspaceIcp: boolean
  minRelevanceScore: number
}): number {
  if (params.useWorkspaceIcp) {
    return Math.max(5, params.minRelevanceScore - 1)
  }

  return 4
}

export function rankExploreCandidates<T extends {
  score: number
  publishedAt?: string | null
}>(candidates: T[]): T[] {
  return [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0
    const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0
    return bTime - aTime
  })
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'for', 'find', 'from', 'in', 'into',
  'is', 'it', 'me', 'my', 'of', 'on', 'or', 'some', 'that', 'the', 'their',
  'them', 'these', 'those', 'to', 'us', 'with', 'you', 'your',
])

export function buildExploreSearchTerms(params: {
  prompt: string
  queries: string[]
}): string[] {
  const text = [params.prompt, ...params.queries].join(' ').toLowerCase()
  const tokens = text
    .split(/[^a-z0-9+.#-]+/g)
    .map(token => token.trim())
    .filter(token => token.length >= 2 && !STOPWORDS.has(token))

  const enriched = new Set(tokens)

  if (/\bearly stage\b|\bstartup\b|\bstartups\b/.test(text)) {
    for (const alias of ['startup', 'seed', 'pre-seed', 'series a', 'series b']) {
      enriched.add(alias)
    }
  }

  if (/\bai\b|\bartificial intelligence\b|\bllm\b/.test(text)) {
    for (const alias of ['ai', 'artificial intelligence', 'machine learning', 'llm']) {
      enriched.add(alias)
    }
  }

  return Array.from(enriched).slice(0, 18)
}

export function scoreExploreSourceItem(text: string, terms: string[]): number {
  const haystack = text.toLowerCase()
  let score = 0

  for (const term of terms) {
    if (!term) continue
    if (haystack.includes(term)) {
      score += term.includes(' ') ? 3 : 2
    }
  }

  return score
}
