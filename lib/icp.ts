const INDUSTRY_LABELS: Record<string, string> = {
  saas: 'SaaS',
  devtools: 'DevTools',
  cybersecurity: 'Cybersecurity',
  data_ai: 'Data and AI',
  martech: 'MarTech',
  hrtech: 'HR Tech',
  proptech: 'PropTech',
  legaltech: 'LegalTech',
  edtech: 'EdTech',
  ecommerce: 'E-commerce',
  fintech: 'FinTech',
  insurtech: 'InsurTech',
  wealthtech: 'WealthTech',
  payments: 'Payments',
  regtech: 'RegTech',
  healthtech: 'HealthTech',
  biotech: 'BioTech',
  medtech: 'MedTech',
  pharma: 'Pharma',
  digital_health: 'Digital Health',
}

export function industryLabel(value: string): string {
  return INDUSTRY_LABELS[value] ?? value.replace(/_/g, ' ')
}

export function normalizeIcpKeywords(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []

  const seen = new Set<string>()
  const keywords: string[] = []

  for (const item of raw) {
    if (typeof item !== 'string') continue
    const cleaned = item.replace(/\s+/g, ' ').trim()
    if (!cleaned || cleaned.length > 80) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    keywords.push(cleaned)
    if (keywords.length >= 16) break
  }

  return keywords
}

export function buildIcpKeywords(params: {
  explicitKeywords?: unknown
  generatedKeywords?: string[]
  targetIndustries?: string[]
}): string[] {
  return normalizeIcpKeywords([
    ...normalizeIcpKeywords(params.explicitKeywords),
    ...(params.generatedKeywords ?? []),
    ...(params.targetIndustries ?? []).map(industryLabel),
  ])
}
