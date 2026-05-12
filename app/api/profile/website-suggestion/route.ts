import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { analyzeCompanyWebsite, normalizeCompanyWebsiteUrl } from '@/lib/company-profile'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * Analyse a company website: scrape it (Firecrawl) and return a crisp
 * "what you sell" description, a clean company name, and the closest industry
 * from the provided list. Used by onboarding's "Analyse" button — only the URL
 * is required.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await checkRateLimit(`profile-website-suggestion:${user.id}`, 8, 3600, { failClosed: true })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many analyses. Add your description manually or try again later.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    )
  }

  const body = await request.json().catch(() => null) as {
    website_url?: unknown
    company_name?: unknown
    industries?: unknown
  } | null

  const websiteUrl = normalizeCompanyWebsiteUrl(body?.website_url)
  if (!websiteUrl) return NextResponse.json({ error: 'Enter a valid company website first.' }, { status: 400 })

  const allowedIndustries = Array.isArray(body?.industries)
    ? body!.industries.filter((x): x is string => typeof x === 'string')
    : []
  const companyHint = typeof body?.company_name === 'string' ? body.company_name.trim() : undefined

  const analysis = await analyzeCompanyWebsite({ websiteUrl, allowedIndustries, companyHint })
  if (!analysis) {
    return NextResponse.json(
      { error: 'Could not read that website. Add what you sell manually.' },
      { status: 422 },
    )
  }

  return NextResponse.json({
    description: analysis.description,
    website_url: analysis.websiteUrl,
    company_name: analysis.companyName,
    industry: analysis.industry,
  })
}
