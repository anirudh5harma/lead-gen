export interface OutreachUserProfile {
  company_name?: string | null
  website_url?: string | null
  services_description?: string | null
  calendly_url?: string | null
}

export interface OutreachClientProfile {
  name?: string | null
  website_url?: string | null
  services_description?: string | null
  calendly_url?: string | null
}

export interface OutreachContext {
  senderCompany: string
  fromName: string
  websiteUrl: string | null
  servicesDescription: string
  calendlyUrl: string | null
}

export function resolveOutreachContext(params: {
  userProfile: OutreachUserProfile | null
  clientProfile?: OutreachClientProfile | null
}): OutreachContext {
  const { userProfile, clientProfile = null } = params

  const senderCompany =
    clientProfile?.name?.trim() ||
    userProfile?.company_name?.trim() ||
    'us'

  return {
    senderCompany,
    fromName:
      clientProfile?.name?.trim() ||
      userProfile?.company_name?.trim() ||
      'Outreach',
    websiteUrl:
      normalizeWebsiteUrl(clientProfile?.website_url) ||
      normalizeWebsiteUrl(userProfile?.website_url) ||
      null,
    servicesDescription:
      clientProfile?.services_description?.trim() ||
      userProfile?.services_description?.trim() ||
      '',
    calendlyUrl:
      clientProfile?.calendly_url?.trim() ||
      userProfile?.calendly_url?.trim() ||
      null,
  }
}

function normalizeWebsiteUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export function scheduleFollowupAt(base: Date = new Date(), daysAfter = 3): string {
  return new Date(base.getTime() + daysAfter * 24 * 60 * 60 * 1000).toISOString()
}
