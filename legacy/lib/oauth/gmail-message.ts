import { formatMailboxHeader, normalizeEmailAddress, sanitizeHeaderValue } from '../email-safety.ts'

export function buildGmailRawMessage(params: {
  fromEmail: string
  fromName: string
  to: string
  cc?: string[]
  subject: string
  body: string
  inReplyTo?: string | null
  unsubLink: string
}): string {
  const { fromEmail, fromName, to, cc = [], subject, body, inReplyTo, unsubLink } = params
  const safeFrom = formatMimeMailboxHeader(fromName, fromEmail)
  const safeTo = normalizeEmailAddress(to)
  const safeCc = cc.map(email => normalizeEmailAddress(email)).filter(email => email.toLowerCase() !== safeTo.toLowerCase())
  const safeSubject = encodeMimeHeader(sanitizeHeaderValue(subject))
  const safeInReplyTo = inReplyTo ? sanitizeHeaderValue(inReplyTo) : null

  const headerLines = [
    `From: ${safeFrom}`,
    `To: ${safeTo}`,
    ...(safeCc.length > 0 ? [`Cc: ${safeCc.join(', ')}`] : []),
    `Subject: ${safeSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    `List-Unsubscribe: <${unsubLink}>`,
    'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
    ...(safeInReplyTo ? [`In-Reply-To: ${safeInReplyTo}`, `References: ${safeInReplyTo}`] : []),
  ]

  return Buffer
    .from(`${headerLines.join('\r\n')}\r\n\r\n${encodeMimeBody(body)}`, 'utf8')
    .toString('base64url')
}

function formatMimeMailboxHeader(name: string, email: string): string {
  const safeEmail = normalizeEmailAddress(email)
  const safeName = sanitizeHeaderValue(name)
  if (!safeName || safeName === safeEmail) return safeEmail
  if (isAscii(safeName)) return formatMailboxHeader(safeName, safeEmail)
  return `${encodeMimeHeader(safeName)} <${safeEmail}>`
}

function encodeMimeHeader(value: string): string {
  if (isAscii(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

function encodeMimeBody(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? ''
}

function isAscii(value: string): boolean {
  return /^[\x00-\x7F]*$/.test(value)
}
