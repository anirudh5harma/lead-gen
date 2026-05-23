const PROFESSIONAL_SUFFIX_PATTERN = /\b(?:esq|esquire|jd|j\.d|phd|ph\.d|mba|cpa|cfa|md|m\.d|dds|dvm|llm|ll\.m)\b\.?/gi
const HONORIFIC_PATTERN = /^(?:mr|mrs|ms|miss|mx|dr|prof)\.?\s+/i

export function cleanPersonName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\s+/g, ' ')
    .replace(HONORIFIC_PATTERN, '')
    .replace(PROFESSIONAL_SUFFIX_PATTERN, '')
    .replace(/\s*,\s*/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function splitCleanPersonName(value: unknown): { firstName: string; lastName: string; fullName: string } {
  const fullName = cleanPersonName(value)
  const parts = fullName.split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
    fullName,
  }
}

export function emailContainsProfessionalSuffix(email: string, rawName?: string | null): boolean {
  const local = email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? ''
  if (!local) return false

  const raw = typeof rawName === 'string' ? rawName : ''
  PROFESSIONAL_SUFFIX_PATTERN.lastIndex = 0
  const hadSuffix = PROFESSIONAL_SUFFIX_PATTERN.test(raw)
  PROFESSIONAL_SUFFIX_PATTERN.lastIndex = 0
  if (!hadSuffix) return false

  return /(esq|esquire|jd|phd|mba|cpa|cfa|md|dds|dvm|llm)$/.test(local)
}
