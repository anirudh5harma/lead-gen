import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { embed, toVectorLiteral } from '@/lib/embeddings'
import { extractICPKeywords } from '@/lib/claude'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const {
    company_name, industry, target_industries, services_description,
    calendly_url, target_signal_types, min_relevance_score,
  } = body

  if (!company_name || !industry || !target_industries?.length || !services_description) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // ICP keywords are optional — don't let Claude errors block the profile save
  const [icp_keywords, embedding] = await Promise.all([
    extractICPKeywords(services_description).catch(() => [] as string[]),
    embed(`${company_name} ${services_description} targets: ${target_industries.join(', ')}`),
  ])

  const { error } = await supabase.from('user_profiles').upsert({
    user_id: user.id,
    company_name,
    industry,
    target_industries,
    services_description,
    calendly_url: calendly_url || null,
    target_signal_types: target_signal_types || ['funding', 'acquisition', 'expansion', 'regulation', 'hiring'],
    min_relevance_score: typeof min_relevance_score === 'number' ? min_relevance_score : 6,
    icp_keywords,
    profile_embedding: toVectorLiteral(embedding),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })

  if (error) {
    console.error('Profile save error:', error)
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
