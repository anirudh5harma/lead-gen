export interface OutreachUserProfile {
  company_name?: string | null
  services_description?: string | null
  calendly_url?: string | null
}

export interface OutreachClientProfile {
  name?: string | null
  services_description?: string | null
  calendly_url?: string | null
}

export interface OutreachContext {
  senderCompany: string
  fromName: string
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

export function scheduleFollowupAt(base: Date = new Date(), daysAfter = 3): string {
  return new Date(base.getTime() + daysAfter * 24 * 60 * 60 * 1000).toISOString()
}
