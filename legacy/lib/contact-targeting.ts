export const CONTACT_ROLE_OPTIONS = [
  { key: 'executive', label: 'Executive' },
  { key: 'founder', label: 'Founder' },
  { key: 'sales', label: 'Sales' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'operations', label: 'Operations' },
  { key: 'engineering', label: 'Engineering' },
  { key: 'product', label: 'Product' },
  { key: 'finance', label: 'Finance' },
  { key: 'it_security', label: 'IT/Security' },
] as const

export type ContactRoleKey = typeof CONTACT_ROLE_OPTIONS[number]['key']

const CONTACT_ROLE_APOLLO_TITLES: Record<ContactRoleKey, string[]> = {
  executive: [
    'CEO', 'COO', 'CTO', 'CFO', 'CRO', 'CIO', 'CISO',
    'Chief Executive Officer', 'Chief Operating Officer', 'Chief Technology Officer',
    'Chief Financial Officer', 'Chief Revenue Officer',
  ],
  founder: ['Founder', 'Co-Founder'],
  sales: ['VP Sales', 'VP of Sales', 'Head of Sales', 'Sales Director'],
  marketing: ['CMO', 'Head of Marketing', 'VP Marketing', 'VP of Marketing', 'Marketing Director'],
  revenue: ['VP Revenue', 'VP of Revenue', 'Head of Revenue', 'Revenue Operations'],
  operations: ['VP Operations', 'VP of Operations', 'Head of Operations', 'Operations Director'],
  engineering: ['VP Engineering', 'VP of Engineering', 'Head of Engineering', 'Engineering Director'],
  product: ['CPO', 'Head of Product', 'VP Product', 'VP of Product', 'Product Director'],
  finance: ['Finance Director', 'Head of Finance', 'VP Finance', 'VP of Finance'],
  it_security: ['CIO', 'CISO', 'Head of IT', 'Head of Security', 'VP Security', 'VP IT'],
}

const CONTACT_ROLE_MATCH_TOKENS: Record<ContactRoleKey, string[]> = {
  executive: ['chief', 'ceo', 'coo', 'cto', 'cfo', 'cro', 'cio', 'ciso', 'president'],
  founder: ['founder', 'co-founder'],
  sales: ['sales', 'account executive', 'bdr', 'sdr'],
  marketing: ['marketing', 'demand gen', 'growth marketing'],
  revenue: ['revenue', 'revops', 'revenue operations'],
  operations: ['operations', 'ops'],
  engineering: ['engineering', 'software', 'developer', 'architect'],
  product: ['product', 'product management', 'pm'],
  finance: ['finance', 'financial', 'controller', 'accounting'],
  it_security: ['security', 'infosec', 'it', 'cyber'],
}

const DEFAULT_ROLE_KEYS: ContactRoleKey[] = ['executive', 'founder', 'sales', 'revenue', 'operations', 'engineering']

export function normalizeRoleSelection(input: unknown): ContactRoleKey[] {
  if (!Array.isArray(input)) return []
  const allowed = new Set<ContactRoleKey>(CONTACT_ROLE_OPTIONS.map(option => option.key))
  const unique: ContactRoleKey[] = []
  for (const value of input) {
    if (typeof value !== 'string') continue
    const key = value.trim().toLowerCase() as ContactRoleKey
    if (!allowed.has(key)) continue
    if (!unique.includes(key)) unique.push(key)
  }
  return unique
}

export function buildApolloPersonTitles(selectedRoles?: ContactRoleKey[]): string[] {
  const roleKeys = selectedRoles && selectedRoles.length > 0 ? selectedRoles : DEFAULT_ROLE_KEYS
  const titles = new Set<string>()
  for (const role of roleKeys) {
    for (const title of CONTACT_ROLE_APOLLO_TITLES[role] ?? []) {
      titles.add(title)
    }
  }
  return [...titles]
}

export function contactTitleMatchesRoles(
  title: string | null | undefined,
  selectedRoles?: ContactRoleKey[],
): boolean {
  if (!title) return false
  if (!selectedRoles || selectedRoles.length === 0) return true

  const normalizedTitle = title.toLowerCase()
  for (const role of selectedRoles) {
    const tokens = CONTACT_ROLE_MATCH_TOKENS[role] ?? []
    if (tokens.some(token => normalizedTitle.includes(token))) return true
  }
  return false
}
