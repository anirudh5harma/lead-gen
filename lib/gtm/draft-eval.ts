export const DRAFT_EVAL_VERSION = 'v1'

export interface DraftQualityCheck {
  id: string
  passed: boolean
  weight: number
  detail: string
}

export interface DraftQualityEval {
  score: number
  checks: DraftQualityCheck[]
  failed: string[]
  version: string
}

export function evaluateOutreachDraftQuality(input: {
  subject: string
  body: string
  greeting: string
  targetCompany: string
  signalType?: string | null
  signalSummary?: string | null
}): DraftQualityEval {
  const subject = normalizeText(input.subject)
  const body = normalizeText(input.body)
  const greeting = normalizeText(input.greeting)
  const targetCompany = normalizeText(input.targetCompany)
  const signalType = normalizeText(input.signalType ?? '')
  const signalSummary = normalizeText(input.signalSummary ?? '')

  const paragraphs = body.split(/\n{2,}/).map(block => block.trim()).filter(Boolean)
  const words = subject.split(/\s+/).filter(Boolean)
  const lowerBody = body.toLowerCase()
  const firstParagraph = paragraphs[0]?.toLowerCase() ?? ''
  const lastParagraph = paragraphs[paragraphs.length - 1]?.toLowerCase() ?? ''
  const targetCompanyLower = targetCompany.toLowerCase()
  const greetingLower = greeting.toLowerCase()

  const checks: DraftQualityCheck[] = [
    {
      id: 'subject_present',
      passed: subject.length > 0,
      weight: 8,
      detail: 'Subject must be present.',
    },
    {
      id: 'subject_concise',
      passed: words.length >= 2 && words.length <= 9,
      weight: 8,
      detail: 'Subject should stay between 2 and 9 words.',
    },
    {
      id: 'recipient_greeting',
      passed: greetingLower.length > 0 && firstParagraph.startsWith(`${greetingLower},`),
      weight: 12,
      detail: 'First paragraph should start with the recipient greeting.',
    },
    {
      id: 'paragraph_shape',
      passed: paragraphs.length >= 3 && paragraphs.length <= 5,
      weight: 10,
      detail: 'Body should have 3-5 short paragraphs.',
    },
    {
      id: 'mentions_target_company',
      passed: targetCompanyLower.length > 0 && lowerBody.includes(targetCompanyLower),
      weight: 12,
      detail: 'Body should explicitly reference the target company.',
    },
    {
      id: 'trigger_opening_sane',
      passed: !duplicateCompanyTriggerPattern(targetCompanyLower).test(lowerBody),
      weight: 14,
      detail: 'Opening should not duplicate company mention around the trigger.',
    },
    {
      id: 'signal_alignment',
      passed: hasSignalAlignment({ lowerBody, signalType, signalSummary }),
      weight: 14,
      detail: 'Body should stay anchored to the signal trigger.',
    },
    {
      id: 'low_friction_cta',
      passed: /(\?|15[- ]?minute|quick call|quick chat|compare notes|worth a quick)/i.test(lastParagraph),
      weight: 10,
      detail: 'Closing should include a low-friction CTA.',
    },
    {
      id: 'no_markdown_links',
      passed: !/\[[^\]]+\]\([^)]+\)/.test(body),
      weight: 6,
      detail: 'Body should not include markdown links.',
    },
    {
      id: 'no_corporate_filler',
      passed: !containsBannedFiller(lowerBody),
      weight: 6,
      detail: 'Body should avoid known generic filler phrases.',
    },
  ]

  const totalWeight = checks.reduce((sum, item) => sum + item.weight, 0)
  const earned = checks.reduce((sum, item) => sum + (item.passed ? item.weight : 0), 0)
  const score = totalWeight > 0 ? roundToTwo((earned / totalWeight) * 100) : 0

  return {
    score,
    checks,
    failed: checks.filter(item => !item.passed).map(item => item.id),
    version: DRAFT_EVAL_VERSION,
  }
}

function duplicateCompanyTriggerPattern(targetCompanyLower: string): RegExp {
  const escaped = escapeRegExp(targetCompanyLower)
  return new RegExp(`noticed\\s+${escaped}\\s+around\\s+${escaped}`, 'i')
}

function hasSignalAlignment(input: {
  lowerBody: string
  signalType: string
  signalSummary: string
}): boolean {
  if (input.signalType && input.lowerBody.includes(input.signalType.toLowerCase())) return true
  const keywords = topSignalKeywords(input.signalSummary)
  if (keywords.length === 0) return true
  return keywords.some(keyword => input.lowerBody.includes(keyword))
}

function topSignalKeywords(value: string): string[] {
  if (!value) return []
  const stopwords = new Set([
    'about', 'after', 'around', 'because', 'between', 'company', 'from', 'have', 'into', 'just',
    'likely', 'market', 'recent', 'their', 'there', 'these', 'those', 'through', 'with',
  ])
  const words = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(word => word.trim())
    .filter(word => word.length >= 5 && !stopwords.has(word))
  return [...new Set(words)].slice(0, 4)
}

function containsBannedFiller(lowerBody: string): boolean {
  const banned = [
    'most companies at this stage',
    'specific wall',
    'usual breakage',
    'short window',
    'priorities shift',
    'unlock growth',
    'streamline operations',
  ]
  return banned.some(phrase => lowerBody.includes(phrase))
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
