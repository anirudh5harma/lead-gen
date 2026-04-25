export type CrmProvider = 'webhook' | 'hubspot' | 'salesforce' | 'pipedrive' | 'zoho'
export type CrmExportFeed = 'signal' | 'explore' | 'crm_import'

export interface CrmProviderPreset {
  id: CrmProvider
  label: string
  exportDescription: string
  importDescription: string
  exportFields: Array<{ ourField: string; crmField: string }>
  importFields: Array<{ ourField: string; crmField: string; required?: boolean }>
}

export interface CrmImportRecord {
  externalId: string
  companyName: string
  companyDomain: string | null
  websiteUrl: string | null
  contactName: string | null
  contactTitle: string | null
  contactEmail: string | null
  crmStatus: string | null
  ownerName: string | null
  leadSource: string | null
  notes: string | null
  raw: Record<string, unknown>
}

export interface CrmExportRecord {
  company: string
  domain: string
  website: string
  contactName: string
  firstName: string
  lastName: string
  contactTitle: string
  contactEmail: string
  signalType: string
  signalHeadline: string
  signalSummary: string
  fitScore: string
  fitReason: string
  status: string
  createdAt: string
  sentAt: string
  repliedAt: string
  bookedAt: string
  workspace: string
  crmNote: string
}

interface ExportColumn {
  header: string
  value: (record: CrmExportRecord) => string
}

const CRM_PRESET_MAP: Record<CrmProvider, CrmProviderPreset> = {
  webhook: {
    id: 'webhook',
    label: 'Generic Webhook',
    exportDescription: 'Bombsell standard CSV with fit context and outreach fields.',
    importDescription: 'Accepts a flat JSON payload or records array from any automation tool.',
    exportFields: [
      { ourField: 'company', crmField: 'company' },
      { ourField: 'contact_email', crmField: 'contact_email' },
      { ourField: 'signal_summary', crmField: 'signal_summary' },
      { ourField: 'fit_reason', crmField: 'fit_reason' },
    ],
    importFields: [
      { ourField: 'companyName', crmField: 'company_name', required: true },
      { ourField: 'contactEmail', crmField: 'contact_email' },
      { ourField: 'crmStatus', crmField: 'status' },
      { ourField: 'notes', crmField: 'notes' },
    ],
  },
  hubspot: {
    id: 'hubspot',
    label: 'HubSpot',
    exportDescription: 'Maps signal leads into company/contact import columns used by HubSpot CSV imports.',
    importDescription: 'Use a HubSpot workflow webhook that sends company, contact, lifecycle, and notes fields.',
    exportFields: [
      { ourField: 'company', crmField: 'Company name' },
      { ourField: 'domain', crmField: 'Company domain name' },
      { ourField: 'website', crmField: 'Website URL' },
      { ourField: 'firstName', crmField: 'First name' },
      { ourField: 'lastName', crmField: 'Last name' },
      { ourField: 'contactTitle', crmField: 'Job title' },
      { ourField: 'contactEmail', crmField: 'Email' },
      { ourField: 'status', crmField: 'Lead status' },
      { ourField: 'crmNote', crmField: 'Notes' },
    ],
    importFields: [
      { ourField: 'companyName', crmField: 'properties.company', required: true },
      { ourField: 'companyDomain', crmField: 'properties.domain' },
      { ourField: 'contactEmail', crmField: 'properties.email' },
      { ourField: 'contactName', crmField: 'properties.firstname + properties.lastname' },
      { ourField: 'crmStatus', crmField: 'properties.hs_lead_status' },
      { ourField: 'notes', crmField: 'properties.notes_last_contacted' },
    ],
  },
  salesforce: {
    id: 'salesforce',
    label: 'Salesforce',
    exportDescription: 'Maps into standard Salesforce lead/account import columns.',
    importDescription: 'Use Salesforce Flow, Apex, or automation to POST lead/account/contact fields to Bombsell.',
    exportFields: [
      { ourField: 'company', crmField: 'Company' },
      { ourField: 'website', crmField: 'Website' },
      { ourField: 'firstName', crmField: 'First Name' },
      { ourField: 'lastName', crmField: 'Last Name' },
      { ourField: 'contactTitle', crmField: 'Title' },
      { ourField: 'contactEmail', crmField: 'Email' },
      { ourField: 'status', crmField: 'Lead Status' },
      { ourField: 'fitScore', crmField: 'Rating' },
      { ourField: 'crmNote', crmField: 'Description' },
    ],
    importFields: [
      { ourField: 'companyName', crmField: 'Company', required: true },
      { ourField: 'websiteUrl', crmField: 'Website' },
      { ourField: 'contactEmail', crmField: 'Email' },
      { ourField: 'contactName', crmField: 'FirstName + LastName' },
      { ourField: 'contactTitle', crmField: 'Title' },
      { ourField: 'crmStatus', crmField: 'Status' },
      { ourField: 'notes', crmField: 'Description' },
    ],
  },
  pipedrive: {
    id: 'pipedrive',
    label: 'Pipedrive',
    exportDescription: 'Maps Bombsell leads into organization/person friendly CSV columns for Pipedrive.',
    importDescription: 'Use Pipedrive webhooks or automation to send organization, person, label, and note fields.',
    exportFields: [
      { ourField: 'company', crmField: 'Organization name' },
      { ourField: 'website', crmField: 'Website' },
      { ourField: 'contactName', crmField: 'Person name' },
      { ourField: 'contactEmail', crmField: 'Email' },
      { ourField: 'contactTitle', crmField: 'Title' },
      { ourField: 'status', crmField: 'Label' },
      { ourField: 'crmNote', crmField: 'Notes' },
    ],
    importFields: [
      { ourField: 'companyName', crmField: 'org_name', required: true },
      { ourField: 'websiteUrl', crmField: 'org_website' },
      { ourField: 'contactName', crmField: 'person_name' },
      { ourField: 'contactEmail', crmField: 'email' },
      { ourField: 'contactTitle', crmField: 'title' },
      { ourField: 'crmStatus', crmField: 'label' },
      { ourField: 'notes', crmField: 'note' },
    ],
  },
  zoho: {
    id: 'zoho',
    label: 'Zoho CRM',
    exportDescription: 'Maps into common Zoho lead import fields for company, contact, stage, and description.',
    importDescription: 'Use Zoho Flow or a webhook to send lead company, contact, stage, and description fields.',
    exportFields: [
      { ourField: 'company', crmField: 'Company' },
      { ourField: 'website', crmField: 'Website' },
      { ourField: 'contactName', crmField: 'Full Name' },
      { ourField: 'contactTitle', crmField: 'Designation' },
      { ourField: 'contactEmail', crmField: 'Email' },
      { ourField: 'status', crmField: 'Lead Status' },
      { ourField: 'crmNote', crmField: 'Description' },
    ],
    importFields: [
      { ourField: 'companyName', crmField: 'Company', required: true },
      { ourField: 'websiteUrl', crmField: 'Website' },
      { ourField: 'contactName', crmField: 'Full_Name' },
      { ourField: 'contactEmail', crmField: 'Email' },
      { ourField: 'contactTitle', crmField: 'Designation' },
      { ourField: 'crmStatus', crmField: 'Lead_Status' },
      { ourField: 'notes', crmField: 'Description' },
    ],
  },
}

const EXPORT_COLUMNS: Record<CrmProvider, ExportColumn[]> = {
  webhook: [
    { header: 'Company', value: record => record.company },
    { header: 'Domain', value: record => record.domain },
    { header: 'Website', value: record => record.website },
    { header: 'Contact Name', value: record => record.contactName },
    { header: 'Contact Title', value: record => record.contactTitle },
    { header: 'Contact Email', value: record => record.contactEmail },
    { header: 'Signal Type', value: record => record.signalType },
    { header: 'Signal Headline', value: record => record.signalHeadline },
    { header: 'Signal Summary', value: record => record.signalSummary },
    { header: 'Fit Score', value: record => record.fitScore },
    { header: 'Fit Reason', value: record => record.fitReason },
    { header: 'Status', value: record => record.status },
    { header: 'Workspace', value: record => record.workspace },
    { header: 'Created At', value: record => record.createdAt },
    { header: 'Sent At', value: record => record.sentAt },
    { header: 'Replied At', value: record => record.repliedAt },
    { header: 'Booked At', value: record => record.bookedAt },
    { header: 'CRM Note', value: record => record.crmNote },
  ],
  hubspot: [
    { header: 'Company name', value: record => record.company },
    { header: 'Company domain name', value: record => record.domain },
    { header: 'Website URL', value: record => record.website },
    { header: 'First name', value: record => record.firstName },
    { header: 'Last name', value: record => record.lastName },
    { header: 'Job title', value: record => record.contactTitle },
    { header: 'Email', value: record => record.contactEmail },
    { header: 'Lead status', value: record => record.status },
    { header: 'Notes', value: record => record.crmNote },
  ],
  salesforce: [
    { header: 'Company', value: record => record.company },
    { header: 'Website', value: record => record.website },
    { header: 'First Name', value: record => record.firstName },
    { header: 'Last Name', value: record => record.lastName || record.company },
    { header: 'Title', value: record => record.contactTitle },
    { header: 'Email', value: record => record.contactEmail },
    { header: 'Lead Status', value: record => record.status },
    { header: 'Rating', value: record => scoreToRating(record.fitScore) },
    { header: 'Description', value: record => record.crmNote },
  ],
  pipedrive: [
    { header: 'Organization name', value: record => record.company },
    { header: 'Website', value: record => record.website },
    { header: 'Person name', value: record => record.contactName },
    { header: 'Email', value: record => record.contactEmail },
    { header: 'Title', value: record => record.contactTitle },
    { header: 'Label', value: record => record.status },
    { header: 'Notes', value: record => record.crmNote },
  ],
  zoho: [
    { header: 'Company', value: record => record.company },
    { header: 'Website', value: record => record.website },
    { header: 'Full Name', value: record => record.contactName },
    { header: 'Designation', value: record => record.contactTitle },
    { header: 'Email', value: record => record.contactEmail },
    { header: 'Lead Status', value: record => record.status },
    { header: 'Description', value: record => record.crmNote },
  ],
}

export const CRM_PROVIDER_PRESETS = Object.values(CRM_PRESET_MAP)

export function normalizeCrmProvider(value: unknown): CrmProvider {
  if (typeof value !== 'string') return 'webhook'
  const normalized = value.trim().toLowerCase()
  if (normalized in CRM_PRESET_MAP) return normalized as CrmProvider
  return 'webhook'
}

export function getCrmProviderPreset(provider: unknown): CrmProviderPreset {
  return CRM_PRESET_MAP[normalizeCrmProvider(provider)]
}

export function buildCrmImportUrl(secret: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  return `${baseUrl}/api/crm/import?key=${encodeURIComponent(secret)}`
}

export function buildCrmExportFilename(provider: unknown, feed: CrmExportFeed): string {
  const preset = getCrmProviderPreset(provider)
  const suffix =
    feed === 'crm_import'
      ? 'crm-imports'
      : feed === 'explore'
        ? 'explore-feed'
        : 'signal-feed'
  return `bombsell-${preset.id}-${suffix}-${new Date().toISOString().slice(0, 10)}.csv`
}

export function buildCrmExportCsv(provider: unknown, records: CrmExportRecord[]): string {
  const columns = EXPORT_COLUMNS[normalizeCrmProvider(provider)] ?? EXPORT_COLUMNS.webhook
  const rows = [
    columns.map(column => column.header),
    ...records.map(record => columns.map(column => escapeCsv(column.value(record)))),
  ]

  return rows.map(row => row.map(value => `"${value}"`).join(',')).join('\n')
}

function escapeCsv(value: string): string {
  return value.replace(/"/g, '""')
}

function scoreToRating(score: string): string {
  const numeric = Number(score)
  if (Number.isNaN(numeric)) return ''
  if (numeric >= 8) return 'Hot'
  if (numeric >= 6) return 'Warm'
  return 'Cold'
}

export function buildCrmExportRecord(input: {
  company: string
  domain?: string | null
  contactName?: string | null
  contactTitle?: string | null
  contactEmail?: string | null
  signalType?: string | null
  signalHeadline?: string | null
  signalSummary?: string | null
  fitScore?: number | null
  fitReason?: string | null
  status?: string | null
  workspace?: string | null
  createdAt?: string | null
  sentAt?: string | null
  repliedAt?: string | null
  bookedAt?: string | null
}): CrmExportRecord {
  const company = input.company.trim()
  const domain = normalizeDomain(input.domain)
  const website = domain ? `https://${domain}` : ''
  const contactName = input.contactName?.trim() ?? ''
  const [firstName, lastName] = splitFullName(contactName)
  const signalType = input.signalType?.trim() ?? ''
  const signalHeadline = input.signalHeadline?.trim() ?? ''
  const signalSummary = input.signalSummary?.trim() ?? ''
  const fitReason = input.fitReason?.trim() ?? ''
  const status = input.status?.trim() ?? 'new'
  const workspace = input.workspace?.trim() ?? ''
  const fitScore = typeof input.fitScore === 'number' ? String(input.fitScore) : ''
  const crmNote = [
    signalHeadline || signalSummary,
    fitReason ? `Fit: ${fitReason}` : '',
    status ? `Status: ${status}` : '',
  ].filter(Boolean).join(' | ')

  return {
    company,
    domain: domain ?? '',
    website,
    contactName,
    firstName,
    lastName,
    contactTitle: input.contactTitle?.trim() ?? '',
    contactEmail: input.contactEmail?.trim() ?? '',
    signalType,
    signalHeadline,
    signalSummary,
    fitScore,
    fitReason,
    status,
    createdAt: input.createdAt ?? '',
    sentAt: input.sentAt ?? '',
    repliedAt: input.repliedAt ?? '',
    bookedAt: input.bookedAt ?? '',
    workspace,
    crmNote,
  }
}

export function mapCrmImportRecord(provider: unknown, input: unknown): CrmImportRecord | null {
  const normalizedProvider = normalizeCrmProvider(provider)
  const record = asObject(input)
  if (!record) return null

  const properties = asObject(record.properties) ?? record
  const companyName = pickString(
    properties,
    ['company', 'company_name', 'companyName', 'account_name', 'organization_name', 'org_name', 'AccountName'],
  )
  if (!companyName) return null

  const websiteUrl = pickString(properties, ['website', 'website_url', 'Website', 'org_website'])
  const companyDomain = normalizeDomain(
    pickString(properties, ['domain', 'company_domain', 'CompanyDomainName']) ?? websiteUrl,
  )
  const contactEmail = pickString(properties, ['email', 'contact_email', 'Email'])
  const contactTitle = pickString(properties, ['title', 'job_title', 'jobTitle', 'designation', 'Designation'])
  const crmStatus = pickString(properties, [
    'status',
    'lead_status',
    'LeadStatus',
    'hs_lead_status',
    'lifecyclestage',
    'label',
    'Lead_Status',
    'StageName',
  ])
  const ownerName = pickString(properties, ['owner', 'owner_name', 'account_owner', 'OwnerName'])
  const leadSource = pickString(properties, ['source', 'lead_source', 'LeadSource'])
  const notes = pickString(properties, ['notes', 'note', 'description', 'Description', 'crm_note'])

  const firstName = pickString(properties, ['firstname', 'first_name', 'FirstName'])
  const lastName = pickString(properties, ['lastname', 'last_name', 'LastName'])
  const combinedName = [firstName, lastName].filter(Boolean).join(' ').trim()
  const contactName = pickString(properties, ['contact_name', 'full_name', 'name', 'person_name', 'Full_Name'])
    ?? (combinedName || null)

  const externalId = buildExternalId(
    normalizedProvider,
    pickString(record, ['id', 'recordId', 'objectId', 'uuid'])
      ?? pickString(properties, ['id', 'recordId', 'objectId', 'LeadId', 'DealId'])
      ?? `${companyName}:${contactEmail ?? crmStatus ?? 'record'}`,
  )

  return {
    externalId,
    companyName,
    companyDomain,
    websiteUrl: normalizeUrl(websiteUrl),
    contactName,
    contactTitle,
    contactEmail,
    crmStatus,
    ownerName,
    leadSource,
    notes,
    raw: record,
  }
}

function buildExternalId(provider: CrmProvider, value: string): string {
  return `${provider}:${value.trim().toLowerCase()}`
}

export function buildCrmImportSignal(input: {
  provider: unknown
  record: CrmImportRecord
}): {
  signalType: 'crm_import'
  headline: string
  summary: string
  sourceUrl: string
} {
  const preset = getCrmProviderPreset(input.provider)
  const summaryParts = [
    input.record.crmStatus ? `Status: ${input.record.crmStatus}` : '',
    input.record.ownerName ? `Owner: ${input.record.ownerName}` : '',
    input.record.leadSource ? `Source: ${input.record.leadSource}` : '',
    input.record.notes ?? '',
  ].filter(Boolean)

  return {
    signalType: 'crm_import',
    headline: `${input.record.companyName} imported from ${preset.label}`,
    summary: summaryParts.join(' | ').slice(0, 600) || `${input.record.companyName} was imported from ${preset.label} for outreach.`,
    sourceUrl: `crm://${input.record.externalId}`,
  }
}

export function buildCrmImportLeadReason(input: {
  provider: unknown
  record: CrmImportRecord
}): { score: number; reason: string } {
  const preset = getCrmProviderPreset(input.provider)
  const score =
    input.record.contactEmail && input.record.contactTitle ? 8 :
      input.record.contactEmail ? 7 :
        input.record.crmStatus ? 6 :
          5

  const reasonParts = [
    `Imported from ${preset.label}.`,
    input.record.crmStatus ? `CRM status: ${input.record.crmStatus}.` : '',
    input.record.ownerName ? `Owner: ${input.record.ownerName}.` : '',
    input.record.notes ? input.record.notes : '',
  ]

  return {
    score,
    reason: reasonParts.filter(Boolean).join(' ').slice(0, 700),
  }
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = /^https?:\/\//i.test(trimmed) ? new URL(trimmed) : new URL(`https://${trimmed}`)
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
  return normalized && normalized.includes('.') ? normalized : null
}

function splitFullName(name: string): [string, string] {
  const trimmed = name.trim()
  if (!trimmed) return ['', '']
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return [parts[0], '']
  return [parts[0], parts.slice(1).join(' ')]
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function pickString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

export async function emitCrmLeadEvent(params: {
  userId: string
  clientId?: string | null
  eventType: 'lead.created' | 'lead.updated' | 'lead.sent' | 'lead.replied' | 'lead.booked'
  payload: Record<string, unknown>
}): Promise<void> {
  const { userId, clientId = null, eventType, payload } = params
  const { createAdminClient } = await import('./supabase/server')
  const supabase = createAdminClient()

  let query = supabase
    .from('crm_sync_settings')
    .select('provider, webhook_url, enabled')
    .eq('user_id', userId)
    .eq('enabled', true)
    .limit(1)

  query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)

  const { data: setting } = await query.maybeSingle()
  const row = setting as { provider?: string | null; webhook_url?: string | null } | null
  if (!row?.webhook_url) return

  await fetch(row.webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: eventType,
      occurred_at: new Date().toISOString(),
      client_id: clientId,
      provider: normalizeCrmProvider(row.provider),
      ...payload,
    }),
  })
}
