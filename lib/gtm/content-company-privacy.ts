const COMPANY_SUFFIX_RE = /\b(incorporated|inc|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|s\.?a\.?|bv|pte|oy|ab)\.?$/i
const GENERIC_NAME_TOKENS = new Set([
  'a',
  'an',
  'and',
  'company',
  'group',
  'holdings',
  'inc',
  'labs',
  'limited',
  'llc',
  'platform',
  'software',
  'systems',
  'tech',
  'technologies',
  'the',
])

export function collectPrivateCompanyNames(input: {
  ownCompanyName?: string | null
  leadCompanyNames?: Array<string | null | undefined>
}): string[] {
  const ownNames = new Set(companyNameVariants(input.ownCompanyName ?? '').map(normalizeComparableCompanyName))
  const names = new Set<string>()

  for (const companyName of input.leadCompanyNames ?? []) {
    const variants = companyNameVariants(companyName ?? '')
    if (variants.length === 0) continue
    const comparable = normalizeComparableCompanyName(variants[0] ?? '')
    if (!comparable || ownNames.has(comparable)) continue
    for (const variant of variants) names.add(variant)
  }

  return [...names].sort((a, b) => b.length - a.length || a.localeCompare(b))
}

export function sanitizePublicCompanyReferences(
  value: string,
  privateCompanyNames: string[],
  replacement = 'a company in the market',
): string {
  let output = value
  for (const companyName of privateCompanyNames) {
    if (!isUsefulCompanyName(companyName)) continue
    const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(companyName)}(?:['’]s)?(?=$|[^A-Za-z0-9])`, 'gi')
    output = output.replace(pattern, `$1${replacement}`)
  }
  return output
    .replace(new RegExp(`(?:${escapeRegExp(replacement)}\\s*){2,}`, 'gi'), replacement)
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function containsPrivateCompanyReference(value: string, privateCompanyNames: string[]): boolean {
  return sanitizePublicCompanyReferences(value, privateCompanyNames) !== value.trim()
}

export function inferPrivateCompanyNamesFromText(
  values: string[],
  ownCompanyName?: string | null,
): string[] {
  const candidates = values
    .map(value => value.trim().match(/^([^:]{2,80}):/)?.[1]?.trim())
    .filter((value): value is string => Boolean(value))
  return collectPrivateCompanyNames({ ownCompanyName, leadCompanyNames: candidates })
}

function companyNameVariants(value: string): string[] {
  const cleaned = value
    .replace(/\s+/g, ' ')
    .replace(/[",]/g, '')
    .trim()
  if (!cleaned) return []

  const withoutSuffix = stripCompanySuffix(cleaned)
  const firstToken = withoutSuffix.split(/\s+/)[0] ?? ''
  const variants = [cleaned, withoutSuffix]
  if (isDistinctiveShortName(firstToken)) variants.push(firstToken)

  return [...new Set(variants.filter(isUsefulCompanyName))]
}

function stripCompanySuffix(value: string): string {
  let output = value.trim()
  for (let i = 0; i < 3; i++) {
    const next = output.replace(/[,\s]+$/, '').replace(COMPANY_SUFFIX_RE, '').replace(/[,\s]+$/, '').trim()
    if (next === output) break
    output = next
  }
  return output
}

function isDistinctiveShortName(value: string): boolean {
  const normalized = value.replace(/[^A-Za-z0-9]/g, '')
  if (!normalized) return false
  if (GENERIC_NAME_TOKENS.has(normalized.toLowerCase())) return false
  return normalized.length >= 4 || /^[A-Z0-9]{2,5}$/.test(normalized)
}

function isUsefulCompanyName(value: string): boolean {
  const normalized = value.replace(/[^A-Za-z0-9]/g, '')
  if (!normalized) return false
  if (GENERIC_NAME_TOKENS.has(normalized.toLowerCase())) return false
  return normalized.length >= 2
}

function normalizeComparableCompanyName(value: string): string {
  return stripCompanySuffix(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
