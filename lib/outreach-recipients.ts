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
  } else if (salutationPattern.test(first)) {
    paragraphs[0] = first.replace(salutationPattern, `${cleanGreeting}, `)
  } else {
    paragraphs[0] = `${cleanGreeting}, ${first}`
  }
  return paragraphs.join('\n\n')
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
