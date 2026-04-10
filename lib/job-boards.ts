/**
 * Job board helpers for Lever and Greenhouse.
 *
 * Both platforms expose free, public APIs for job listings.
 * We use them to detect hiring signals for watchlisted companies:
 * - 5+ open roles in a new area → expansion signal
 * - Senior/C-suite openings → leadership-change signal
 */

export interface JobBoardResult {
  platform: 'lever' | 'greenhouse'
  jobCount: number
  seniorRoles: Array<{ title: string; team?: string }>
}

const SENIOR_PATTERN =
  /\b(VP|Vice President|Director|Head of|Chief|CTO|CFO|CPO|CISO|CMO|CRO|SVP|EVP|Principal|Staff|Distinguished|Fellow)\b/i

function toSlug(companyName: string, domain?: string | null): string {
  if (domain) {
    // stripe.com → stripe, app.stripe.com → stripe
    return domain.replace(/^www\./, '').split('.')[0]
  }
  return companyName
    .toLowerCase()
    .replace(/[,.'&]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Checks Lever then Greenhouse for a company's job listings.
 * Returns null if neither platform has listings for this company.
 */
export async function fetchJobBoard(
  companyName: string,
  companyDomain?: string | null
): Promise<JobBoardResult | null> {
  const slug = toSlug(companyName, companyDomain)

  // --- Lever ---
  try {
    const res = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProspectSignal/1.0)' },
    })
    if (res.ok) {
      const jobs = (await res.json()) as Array<{
        text: string
        categories?: { team?: string }
      }>
      if (Array.isArray(jobs) && jobs.length > 0) {
        const seniorRoles = jobs
          .filter(j => SENIOR_PATTERN.test(j.text))
          .map(j => ({ title: j.text, team: j.categories?.team }))
        return { platform: 'lever', jobCount: jobs.length, seniorRoles }
      }
    }
  } catch {
    // timeout / CORS / 404 — try next
  }

  // --- Greenhouse ---
  try {
    const res = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
      {
        signal: AbortSignal.timeout(6000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProspectSignal/1.0)' },
      }
    )
    if (res.ok) {
      const data = (await res.json()) as {
        jobs?: Array<{ title: string; departments?: Array<{ name: string }> }>
      }
      const jobs = data.jobs ?? []
      if (jobs.length > 0) {
        const seniorRoles = jobs
          .filter(j => SENIOR_PATTERN.test(j.title))
          .map(j => ({ title: j.title, team: j.departments?.[0]?.name }))
        return { platform: 'greenhouse', jobCount: jobs.length, seniorRoles }
      }
    }
  } catch {
    // timeout / 404
  }

  return null
}
