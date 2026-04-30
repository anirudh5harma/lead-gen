import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { suggestServicesDescriptionFromWebsite } from '@/lib/company-profile'
import { checkRateLimit } from '@/lib/rate-limit'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rl = await checkRateLimit(`profile-website-suggestion:${user.id}`, 8, 3600, { failClosed: true })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many website suggestions. Add your description manually or try later.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    )
  }

  const body = await request.json().catch(() => null) as {
    company_name?: unknown
    industry?: unknown
    website_url?: unknown
  } | null

  const companyName = typeof body?.company_name === 'string' ? body.company_name.trim() : ''
  const industry = typeof body?.industry === 'string' ? body.industry.trim() : ''

  if (companyName.length < 2 || !industry) {
    return NextResponse.json({ error: 'Add company name and industry first.' }, { status: 400 })
  }

  const suggestion = await suggestServicesDescriptionFromWebsite({
    companyName,
    industry,
    websiteUrl: body?.website_url,
  })

  if (!suggestion) {
    return NextResponse.json(
      { error: 'Could not generate a useful website suggestion. Add what you sell manually.' },
      { status: 422 },
    )
  }

  return NextResponse.json({
    description: suggestion.description,
    website_url: suggestion.websiteUrl,
  })
}
