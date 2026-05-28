import { normalizeEmailAddress } from './email-safety.ts'
import { cleanPersonName, emailContainsProfessionalSuffix } from './person-normalization.ts'

export interface OutreachRecipient {
  name: string
  title: string
  email: string
  confidence?: string
  source?: string
}

export interface OutreachRecipientGroup {
  to: OutreachRecipient
  cc: OutreachRecipient[]
  all: OutreachRecipient[]
  greeting: string
  titleSummary: string
}

export function mergeRecipientStakeholders(
  existingValue: unknown,
  resolvedStakeholders: Array<Partial<OutreachRecipient>>,
): Array<OutreachRecipient & { confidence: string; source: string }> {
  const existingStakeholders = normalizeRecipientStakeholders(existingValue)
  const merged = new Map<string, OutreachRecipient & { confidence: string; source: string }>()

  for (const stakeholder of [...existingStakeholders, ...resolvedStakeholders]) {
    const group = buildRecipientGroup([stakeholder])
    const recipient = group?.to
    if (!recipient) continue
    const key = recipient.email.toLowerCase()
    if (merged.has(key)) continue
    merged.set(key, {
      name: recipient.name,
      title: recipient.title,
      email: recipient.email,
      confidence: stakeholder.confidence || recipient.confidence || 'medium',
      source: stakeholder.source || recipient.source || 'draft',
    })
  }

  return [...merged.values()]
}

export function buildRecipientGroup(
  contacts: Array<Partial<OutreachRecipient> | null | undefined>,
): OutreachRecipientGroup | null {
  const seen = new Set<string>()
  const all: OutreachRecipient[] = []

  for (const contact of contacts) {
    if (!contact?.email) continue
    let email: string
    try {
      email = normalizeEmailAddress(contact.email)
    } catch {
      continue
    }
    if (emailContainsProfessionalSuffix(email, contact.name)) continue
    const key = email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    all.push({
      name: cleanName(contact.name) || 'there',
      title: cleanName(contact.title) || 'Leadership',
      email,
      confidence: contact.confidence,
      source: contact.source,
    })
  }

  if (all.length === 0) return null

  return {
    to: all[0],
    cc: all.slice(1),
    all,
    greeting: formatGreeting(all),
    titleSummary: formatTitleSummary(all),
  }
}

export function recipientEmails(group: OutreachRecipientGroup): string[] {
  return group.all.map(recipient => recipient.email)
}

export function formatRecipientListForLog(group: OutreachRecipientGroup): string {
  return recipientEmails(group).join(', ')
}

export function ensureBodyGreetsRecipients(body: string, greeting: string): string {
  const cleanGreeting = cleanName(greeting)
  if (!cleanGreeting) return body
  const paragraphs = body.split(/\n{2,}/).map(paragraph => paragraph.trim()).filter(Boolean)
  if (paragraphs.length === 0) return `${cleanGreeting},\n\n${body}`.trim()

  const first = collapseRepeatedGreeting(paragraphs[0], cleanGreeting)
  const explicitGreetingPattern = new RegExp(`^(?:hi|hey|hello)?\\s*${escapeRegExp(cleanGreeting)}\\s*,\\s*`, 'i')
  const salutationPattern = /^(?:hi|hey|hello)\s+[^,\n]{1,80},\s*|^[A-Z][A-Za-z.'-]*(?:\s+and\s+[A-Z][A-Za-z.'-]*|(?:,\s*(?:and\s+)?[A-Z][A-Za-z.'-]*){0,6}),\s*/i
  if (explicitGreetingPattern.test(first)) {
    paragraphs[0] = first.replace(explicitGreetingPattern, `${cleanGreeting}, `)
    paragraphs[0] = stripDuplicateNameAfterGreeting(paragraphs[0], cleanGreeting)
  } else if (salutationPattern.test(first)) {
    paragraphs[0] = first.replace(salutationPattern, `${cleanGreeting}, `)
    // Strip any greeting name that immediately follows the salutation replacement.
    // e.g. "Jeff and Hammad, Hammad, noticed..." → "Jeff and Hammad, noticed..."
    paragraphs[0] = stripDuplicateNameAfterGreeting(paragraphs[0], cleanGreeting)
  } else {
    paragraphs[0] = `${cleanGreeting}, ${first}`
  }
  return paragraphs.join('\n\n')
}

function stripDuplicateNameAfterGreeting(text: string, greeting: string): string {
  // After a salutation replacement, strip any greeting name that immediately follows.
  // e.g. "Jeff and Hammad, Hammad, noticed..." → "Jeff and Hammad, noticed..."
  //      "Jeff and Hammad, Jeff, thanks..." → "Jeff and Hammad, thanks..."
  const names = greeting.split(/\s+and\s+|\s*,\s*/).map(n => n.trim()).filter(Boolean)
  if (names.length <= 1) return text
  const greetingPrefix = `${greeting}, `
  if (!text.startsWith(greetingPrefix)) return text
  const after = text.slice(greetingPrefix.length)
  for (const name of names) {
    const dupPattern = new RegExp(`^${escapeRegExp(name)}\\b\\s*,?\\s*`, 'i')
    if (dupPattern.test(after)) {
      return greetingPrefix + after.replace(dupPattern, '')
    }
  }
  return text
}

function collapseRepeatedGreeting(value: string, greeting: string): string {
  const greetingPattern = `(?:hi|hey|hello)?\\s*${escapeRegExp(greeting)}\\s*,\\s*`
  let collapsed = value
  const repeated = new RegExp(`^(?:${greetingPattern}){2,}`, 'i')
  while (repeated.test(collapsed)) {
    collapsed = collapsed.replace(repeated, `${greeting}, `)
  }
  const firstName = greeting.split(/\s+/)[0]
  if (firstName && !/\b(and|team|there)\b/i.test(firstName)) {
    const duplicateFirstName = new RegExp(`^${escapeRegExp(greeting)}\\s*,\\s*${escapeRegExp(firstName)}\\b\\s*,?\\s*`, 'i')
    collapsed = collapsed.replace(duplicateFirstName, `${greeting}, `)
  }
  // Also strip any greeting name that immediately follows the greeting.
  // e.g. "Jeff and Hammad, Hammad, noticed..." → "Jeff and Hammad, noticed..."
  collapsed = stripDuplicateNameAfterGreeting(collapsed, greeting)
  return collapsed
}

function formatGreeting(recipients: OutreachRecipient[]): string {
  const seen = new Set<string>()
  const names: string[] = []
  for (const recipient of recipients) {
    const name = firstName(recipient.name)
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  if (names.length === 0) return 'there'
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

function formatTitleSummary(recipients: OutreachRecipient[]): string {
  const titles = recipients
    .map(recipient => cleanName(recipient.title))
    .filter(Boolean)
  if (titles.length === 0) return 'Leadership'
  const unique = [...new Set(titles)]
  if (unique.length === 1) return unique[0]
  if (unique.length === 2) return unique.join(' and ')
  return `${unique.slice(0, 2).join(', ')} and team`
}

function firstName(value: string): string {
  const cleaned = cleanName(value)
  if (!cleaned || /^(team|sales|revenue|growth|operations|leadership|there)$/i.test(cleaned)) return cleaned
  return cleaned.split(/\s+/)[0] ?? cleaned
}

function cleanName(value: unknown): string {
  return cleanPersonName(value)
}

function normalizeRecipientStakeholders(value: unknown): Array<OutreachRecipient & { confidence: string; source: string }> {
  if (!Array.isArray(value)) return []
  const group = buildRecipientGroup(value as Array<Partial<OutreachRecipient> | null>)
  if (!group) return []
  return group.all.map(recipient => ({
    name: recipient.name,
    title: recipient.title,
    email: recipient.email,
    confidence: recipient.confidence || 'medium',
    source: recipient.source || 'draft',
  }))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
