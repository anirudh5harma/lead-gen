const EMAIL_PATTERN = /^[^\s@<>,;:"'()[\]\\]+@[^\s@<>,;:"'()[\]\\]+\.[^\s@<>,;:"'()[\]\\]+$/

export function normalizeEmailAddress(value: string): string {
  const email = sanitizeHeaderValue(value).trim().toLowerCase()
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    throw new Error('Invalid recipient email address')
  }
  return email
}

export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n\0]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function formatMailboxHeader(name: string, email: string): string {
  const safeEmail = normalizeEmailAddress(email)
  const safeName = sanitizeHeaderValue(name)
  if (!safeName || safeName === safeEmail) return safeEmail
  const escapedName = safeName.replace(/[\\"]/g, '\\$&')
  return `"${escapedName}" <${safeEmail}>`
}
