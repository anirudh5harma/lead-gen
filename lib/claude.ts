import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL       = 'claude-sonnet-4-6'
const CHEAP_MODEL = 'claude-haiku-4-5-20251001'

/**
 * Extracts structured signal data from a news headline + description.
 * Returns null if the item doesn't represent a clear company event.
 */
export async function extractSignal(
  headline: string,
  description: string,
  timeoutMs = 12_000
): Promise<{
  company_name: string
  company_domain: string | null
  signal_type: 'funding' | 'acquisition' | 'expansion' | 'regulation' | 'hiring'
  summary: string
  funding_amount: string | null
  confidence: 1 | 2 | 3
} | null> {
  const message = await client.messages.create({
    model: CHEAP_MODEL,
    max_tokens: 350,
    system: `You extract structured company-event signals from noisy RSS headlines and snippets.

Many descriptions are truncated, HTML-encoded, or low quality. If the headline alone clearly indicates a company event, extract it.

Be permissive for clear events like:
- funding raises / funding rounds / valuation updates tied to a named company
- acquisitions / mergers
- executive appointments / CFO, CTO, CEO hires
- market expansion / launches / new offices
- regulations affecting a specific company

Only return null for generic market commentary, roundups, sector snapshots, opinion pieces, or items without a specific named company event.

Return JSON only.`,
    messages: [{
      role: 'user',
      content: `Extract structured signal data from this news item.

Headline: ${headline}
Description: ${description}

Return a JSON object with these fields:
- company_name: string (the primary company involved in the event)
- company_domain: string | null (e.g. "stripe.com" — infer if obvious, else null)
- signal_type: one of "funding" | "acquisition" | "expansion" | "regulation" | "hiring"
- summary: string (one crisp sentence describing the event and its business implication)
- funding_amount: string | null (e.g. "$50M Series B" — only for funding signals)
- confidence: 1 | 2 | 3
  - 3 = clear, specific company event with named company and concrete details
  - 2 = plausible company event but vague or indirect
  - 1 = generic industry news, opinion, listicle, product review, or no named company

If this is not a company business event at all, return null.
Return ONLY valid JSON, no markdown, no explanation.`,
    }],
  }, { signal: AbortSignal.timeout(timeoutMs) })

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
  if (text === 'null' || !text) return null

  try {
    const parsed = parseJsonObject(text)
    if (!parsed) return fallbackExtractFromHeadline(headline, description)
    const validated = normalizeExtractedSignal(parsed)
    if (!validated || validated.confidence <= 1) {
      return fallbackExtractFromHeadline(headline, description)
    }
    return validated
  } catch {
    return fallbackExtractFromHeadline(headline, description)
  }
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  try {
    return JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) return null
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
    } catch {
      return null
    }
  }
}

function normalizeExtractedSignal(parsed: Record<string, unknown>): {
  company_name: string
  company_domain: string | null
  signal_type: 'funding' | 'acquisition' | 'expansion' | 'regulation' | 'hiring'
  summary: string
  funding_amount: string | null
  confidence: 1 | 2 | 3
} | null {
  const company_name = typeof parsed.company_name === 'string' ? parsed.company_name.trim() : ''
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
  const rawType = typeof parsed.signal_type === 'string' ? parsed.signal_type.trim().toLowerCase() : ''
  const funding_amount = typeof parsed.funding_amount === 'string' && parsed.funding_amount.trim()
    ? parsed.funding_amount.trim()
    : null
  const company_domain = typeof parsed.company_domain === 'string' && parsed.company_domain.trim()
    ? parsed.company_domain.trim().toLowerCase()
    : null
  const confidenceValue = typeof parsed.confidence === 'number' ? parsed.confidence : 2
  const confidence = confidenceValue === 3 ? 3 : confidenceValue === 1 ? 1 : 2

  const signal_type = normalizeSignalType(rawType)
  if (!company_name || !summary || !signal_type) return null

  return {
    company_name,
    company_domain,
    signal_type,
    summary,
    funding_amount,
    confidence,
  }
}

function normalizeSignalType(value: string): 'funding' | 'acquisition' | 'expansion' | 'regulation' | 'hiring' | null {
  if (['funding', 'fundraise', 'financing'].includes(value)) return 'funding'
  if (['acquisition', 'acquire', 'merger', 'm&a', 'mna'].includes(value)) return 'acquisition'
  if (['expansion', 'launch', 'market_expansion'].includes(value)) return 'expansion'
  if (['regulation', 'compliance', 'legal'].includes(value)) return 'regulation'
  if (['hiring', 'executive_hire', 'appointment'].includes(value)) return 'hiring'
  return null
}

function fallbackExtractFromHeadline(
  headline: string,
  description: string,
): {
  company_name: string
  company_domain: string | null
  signal_type: 'funding' | 'acquisition' | 'expansion' | 'regulation' | 'hiring'
  summary: string
  funding_amount: string | null
  confidence: 1 | 2 | 3
} | null {
  const normalizedHeadline = decodeEntities(headline).replace(/\s+/g, ' ').trim()
  const normalizedDescription = decodeEntities(description).replace(/\s+/g, ' ').trim()
  const text = `${normalizedHeadline} ${normalizedDescription}`.trim()

  const funding = /\b(raise|raises|raised|raising|funding|financing|series [a-z]|seed|pre-seed|valuation|valued at)\b/i
  const acquisition = /\b(acquires?|acquired|acquisition|merger|merge(?:s|d)?|buyout)\b/i
  const hiring = /\b(appoints?|appointed|hires?|hired|joins?|joined)\b.{0,80}\b(ceo|cto|cfo|cmo|cro|cpo|ciso|chief|vp|vice president|head of)\b/i
  const expansion = /\b(expands?|expanded|launch(?:es|ed)?|opens? (?:a|its)|enters? .*market|new office|new market)\b/i
  const regulation = /\b(regulation|regulatory|compliance|fined|settlement|sec|fda|finra)\b/i

  let signal_type: 'funding' | 'acquisition' | 'expansion' | 'regulation' | 'hiring' | null = null
  if (acquisition.test(text)) signal_type = 'acquisition'
  else if (funding.test(text)) signal_type = 'funding'
  else if (hiring.test(text)) signal_type = 'hiring'
  else if (expansion.test(text)) signal_type = 'expansion'
  else if (regulation.test(text)) signal_type = 'regulation'

  if (!signal_type) return null

  const company_name = extractCompanyName(normalizedHeadline)
  if (!company_name) return null

  const fundingMatch = text.match(/(\$|€|£|Rs\.?\s?|INR\s?)\s?\d[\d.,]*(?:\s?(?:million|billion|crore|lakh|m|bn|b))?/i)
  const summary = buildFallbackSummary(company_name, signal_type, normalizedHeadline, normalizedDescription)

  return {
    company_name,
    company_domain: null,
    signal_type,
    summary,
    funding_amount: signal_type === 'funding' ? fundingMatch?.[0] ?? null : null,
    confidence: 2,
  }
}

function extractCompanyName(headline: string): string | null {
  const stripped = headline
    .replace(/\s+-\s+[^-]+$/, '')
    .replace(/\s+[|]\s+.+$/, '')
    .replace(/^[/"' ]+|[/"' ]+$/g, '')

  const patterns = [
    /^(.+?)\s+\b(acquires?|acquired|acquisition|merger|merge(?:s|d)?|raises?|raised|raising|appoints?|appointed|hires?|hired|launch(?:es|ed)?|expands?|expanded)\b/i,
    /^(.+?)\s+\bto\s+\b(acquire|raise|launch|expand)\b/i,
  ]

  for (const pattern of patterns) {
    const match = stripped.match(pattern)
    if (!match) continue
    const candidate = match[1]?.trim()
    if (candidate && candidate.length >= 2) return candidate
  }

  const generic = stripped.match(/\b[A-Z][A-Za-z0-9&.'-]+(?:\s+[A-Z][A-Za-z0-9&.'-]+){0,4}\b/)
  return generic?.[0] ?? null
}

function buildFallbackSummary(
  companyName: string,
  signalType: 'funding' | 'acquisition' | 'expansion' | 'regulation' | 'hiring',
  headline: string,
  description: string,
): string {
  const sourceText = description || headline
  switch (signalType) {
    case 'funding':
      return `${companyName} appears to have raised capital, which usually signals active budget deployment and near-term vendor evaluation.`
    case 'acquisition':
      return `${companyName} appears to be involved in an acquisition or merger, which typically creates integration and change-management demand.`
    case 'hiring':
      return `${companyName} appears to have made a senior hire, which often signals a new mandate and openness to outside support.`
    case 'expansion':
      return `${companyName} appears to be expanding into a new market or initiative, which often creates fresh operational needs.`
    case 'regulation':
      return `${companyName} appears to be affected by a regulatory or compliance event, which can create urgency around operational changes.`
    default:
      return sourceText
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/**
 * Scores how relevant a signal is to a user's product/service.
 * Returns a score 1-10 and a reason string.
 */
export async function scoreLeadRelevance(
  servicesDescription: string,
  signalType: string,
  companyName: string,
  signalSummary: string
): Promise<{ score: number; reason: string }> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: [
      {
        type: 'text',
        text: `You evaluate whether a company event is a good sales trigger. Score 1-10 based on how likely the company needs the seller's product RIGHT NOW because of the event.
- 8-10: Strong fit — event directly creates a need
- 5-7: Possible fit — plausible but indirect connection
- 1-4: Poor fit — weak or no connection
Return ONLY valid JSON: {"score": <int>, "reason": "<one sentence>"}`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{
      role: 'user',
      content: `Seller's product/service: ${servicesDescription}

Event: ${companyName} — ${signalType}
Summary: ${signalSummary}`,
    }],
  }, { signal: AbortSignal.timeout(25_000) })

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
  try {
    return JSON.parse(text)
  } catch {
    return { score: 5, reason: 'Could not assess relevance.' }
  }
}

/**
 * Extracts ICP keywords from a company's services description.
 */
export async function extractICPKeywords(servicesDescription: string): Promise<string[]> {
  const message = await client.messages.create({
    model: CHEAP_MODEL,
    max_tokens: 150,
    messages: [{
      role: 'user',
      content: `Extract 5-10 keywords that describe the ideal customer profile (ICP) for this product/service.
Focus on: industries, company stages, pain points, and use cases.

Product/service: ${servicesDescription}

Return ONLY a JSON array of strings, no markdown.`,
    }],
  }, { signal: AbortSignal.timeout(20_000) })

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]'
  try {
    return JSON.parse(text)
  } catch {
    return []
  }
}

const SIGNAL_ANGLE: Record<string, string> = {
  funding: `SITUATION: They closed a round. The board expects rapid growth; the CEO must deploy capital fast and show ROI within 12-18 months.

PARAGRAPH 1: Open with what actually happens operationally in the first 90 days post-raise, not "congrats on the raise" but the specific hidden cost: hiring surges before process is ready, tooling decisions get locked in under speed pressure, and the systems that worked at half the headcount start cracking under load. If the article context includes the lead investor or use-of-proceeds language, weave it in and show you read beyond the headline.

PARAGRAPH 2: Frame your offer as the thing that prevents the most predictable post-raise breakdown relevant to what you sell. Hormozi lens: dream outcome + what pain is removed + at what speed?

PARAGRAPH 3: Make it feel observed, not generic: "Teams at this stage typically hit [X] within [Y] months of the round, right at the inflection point they're about to enter."

SUBJECT: prefer Challenger or Hormozi style. Something like "The hidden cost of [company]'s raise" or "How [company] scales without the usual breakage."`,

  acquisition: `SITUATION: An acquisition just closed or was announced. The next 90 days are integration chaos: systems, teams, cultures, and data colliding under a mandate to show synergies fast.

PARAGRAPH 1: Open with the real operational reality of Day 1-90 post-acquisition: the mandate to show synergies clashes with the actual pace of integration. The acquiring team is discovering unknown unknowns faster than they can address them. If the article mentions what was acquired or the stated strategic rationale, make the insight specific to that integration challenge.

PARAGRAPH 2: Frame your offer as removing one precise integration bottleneck, not "we help with integrations" but the exact friction your product eliminates at this stage. Hormozi: reduce time delay + reduce sacrifice.

PARAGRAPH 3: "Companies at this stage almost always underestimate [X]. By the time it surfaces, it's already a 3-month slip." Make it feel like you've seen this movie before.

SUBJECT: Voss or Challenger style: name their situation or reframe their risk.`,

  expansion: `SITUATION: They're entering a new market, launching a new product line, or expanding geographically. The playbook from their home market creates false confidence.

PARAGRAPH 1: Open with the non-obvious challenge of this specific expansion, not "entering new markets is exciting" but the specific friction that catches companies in their situation off guard. If the article mentions the target market or geography, use that to be concrete.

PARAGRAPH 2: Position your offer as specific capability that reduces the unknown-unknown risk of this expansion. Predictable Revenue style: hyper-specific relevance. "We work with companies making exactly this move."

PARAGRAPH 3: "The first thing that breaks for companies coming from [their background] into [new market] is usually [X]." This is your vantage point, make it feel earned.

SUBJECT: Challenger style: a non-obvious consequence of the expansion they haven't considered.`,

  regulation: `SITUATION: A new regulation creates a hard deadline, fear of penalties, and an overwhelmed compliance team. The window to act is closing.

PARAGRAPH 1: Open by naming the emotional reality, not the regulation itself but what it feels like inside the company right now. Voss labeling first: "Right now most [industry] teams are realizing the regulation is broader than the initial read. Compliance is triaging, legal is cautious, and the deadline isn't moving." Then add the one non-obvious risk most companies underestimate about this specific regulation.

PARAGRAPH 2: Frame your offer as risk removal + deadline certainty. Hormozi: the dream outcome is not getting caught off-guard; the removed downside is scrambling and penalties.

PARAGRAPH 3: Make timeline the proof: "Teams that start [X weeks] before the deadline can [achieve Y]. Teams that wait typically [face Z]."

SUBJECT: Voss style: label their reality. "Looks like [company] has a tight compliance window."`,

  hiring: `SITUATION: A new C-suite or VP hire just joined, or the company is on a major hiring surge. New leaders have ~90 days to establish credibility before the org forms an opinion.

PARAGRAPH 1: Open with what new leaders at this specific title typically discover in their first 30 days, not generic "new leaders face challenges" but the role-specific pattern. A new VP of Engineering inherits tech debt and a team stretched by attrition. A new CMO inherits a funnel with attribution gaps. Make it title-specific. If the signal mentions the specific hire by name or title, calibrate to that role's typical 90-day mandate.

PARAGRAPH 2: Frame your offer as a fast path to an early win in your domain, the thing that makes them look good before the honeymoon period ends. Hormozi: minimize time delay. "We typically have [result] visible within [X weeks], fast enough to show in the next board update."

PARAGRAPH 3: "New [titles] who address [your area] in the first 60 days typically [achieve X]. Those who deprioritize it spend the first year fighting it instead."

SUBJECT: Challenger style: teach them something about their role they didn't expect.`,
}

/**
 * Drafts a short follow-up email (3-5 days after no reply).
 * Adds a new angle rather than re-pitching.
 */
export async function draftFollowUpEmail(params: {
  senderCompany: string
  servicesDescription: string
  stakeholderName: string
  targetCompany: string
  signalType: string
  signalSummary: string
  originalSubject: string
  originalBody: string
  customInstructions?: string | null
}): Promise<{ subject: string; body: string }> {
  const {
    senderCompany, servicesDescription, stakeholderName, targetCompany,
    signalType, signalSummary, originalSubject, originalBody,
    customInstructions,
  } = params

  const firstName = stakeholderName.split(' ')[0] || 'there'

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Write a BRIEF follow-up email for a cold outreach that got no reply after ~3 days.

Context:
- Sender: ${senderCompany}, ${servicesDescription.slice(0, 500)}
- Recipient: ${firstName} at ${targetCompany}
- Original trigger: ${targetCompany} ${signalType}, ${signalSummary}
- Original subject line: "${originalSubject}"

Original email body:
${originalBody.slice(0, 600)}

Additional template guidance:
${customInstructions || 'None'}

Follow-up rules (strict):
- Max 3 sentences total
- Do NOT re-pitch, summarize, or repeat the original email
- Add ONE new piece of value: a different angle, a quick data point, or a short question they haven't heard
- Voss-style opener: "Probably caught you at a bad time..." or "Figured this might still be on your radar given..."
- Close with a single soft question or ultra-low-friction ask
- Zero corporate speak. Write like a smart peer.
- Do not use em dashes, en dashes, long divider lines, or separator-style punctuation. Use commas, periods, or short sentences instead.

Return ONLY this JSON (no markdown):
{"subject": "Re: ${originalSubject}", "body": "..."}

Body must use \\n\\n between paragraphs.`,
    }],
  }, { signal: AbortSignal.timeout(30_000) })

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
  try {
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    return sanitizeGeneratedEmail(JSON.parse(cleaned))
  } catch {
    return sanitizeGeneratedEmail({
      subject: `Re: ${originalSubject}`,
      body: `${firstName}, probably caught you in the middle of something. Figured I'd check back since the ${signalType} at ${targetCompany} is likely still in full swing.\n\nIs there a better moment this week for a quick 15-min call?`,
    })
  }
}

/**
 * Drafts a highly personalized cold outreach email using frameworks from:
 * Voss (tactical empathy + calibrated questions), Hormozi (value equation framing),
 * Challenger Sale (insight-led), Predictable Revenue (short + specific CTA),
 * Fanatical Prospecting (interrupt → bridge → ask structure).
 */
export async function draftOutreachEmail(params: {
  senderCompany: string
  servicesDescription: string
  stakeholderName: string
  stakeholderTitle: string
  targetCompany: string
  signalType: string
  signalSummary: string
  headline?: string | null
  fundingAmount?: string | null
  signalAgeLabel?: string | null
  articleContext?: string | null
  calendlyUrl?: string | null
  customInstructions?: string | null
}): Promise<{ subject: string; body: string }> {
  const {
    senderCompany, servicesDescription, stakeholderName, stakeholderTitle,
    targetCompany, signalType, signalSummary,
    headline, fundingAmount, signalAgeLabel, articleContext,
    calendlyUrl,
    customInstructions,
  } = params

  const angle = SIGNAL_ANGLE[signalType] || SIGNAL_ANGLE.expansion
  const firstName = stakeholderName.split(' ')[0] || stakeholderName

  const ctaInstruction = calendlyUrl
    ? `4. CLOSING PARAGRAPH (standalone, 1-2 sentences): A low-friction ask to book a 15-minute call. Include the Calendly link naturally, for example: "If any of this lands, here's a link to grab 15 minutes: ${calendlyUrl}" or "Happy to show you how in 15 min: ${calendlyUrl}". Keep it casual, not pushy.`
    : `4. CLOSING PARAGRAPH (standalone, 1-2 sentences): A low-friction ask for a 15-minute call, such as "15 min this week?" or a Voss calibrated question ("What would need to be true for this to be worth 15 minutes of your time?"). Never "Would you be interested in...".`

  const signalBlock = [
    `Trigger event: ${targetCompany} had a ${signalType}: ${signalSummary}`,
    headline       ? `Original headline: ${headline}` : '',
    fundingAmount  ? `Amount: ${fundingAmount}` : '',
    signalAgeLabel ? `Timing: ${signalAgeLabel} (calibrate urgency accordingly)` : '',
  ].filter(Boolean).join('\n')

  const articleBlock = articleContext
    ? `ARTICLE INTELLIGENCE: use these specific facts because they make the email feel researched.\n${articleContext}`
    : ''

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `You are a world-class B2B sales strategist writing a cold outreach email.
Your writing is informed by: Never Split the Difference (Voss), $100M Offers (Hormozi), Fanatical Prospecting (Blount), The Challenger Sale, Predictable Revenue (Aaron Ross).

CONTEXT:
Sender: ${senderCompany}
What they offer: ${servicesDescription}

Recipient: ${firstName} (${stakeholderTitle}) at ${targetCompany}
${signalBlock}

${articleBlock}

TEMPLATE GUIDANCE:
${customInstructions || 'None'}

STRATEGIC ANGLE FOR THIS SIGNAL TYPE:
${angle}

EMAIL CONSTRUCTION RULES:

SUBJECT LINE: generate THREE options (one per style below), then choose the strongest for this specific signal:
Option A, Challenger: A non-obvious insight or provocative question about their actual situation
Option B, Voss: A label that names their emotional reality right now
Option C, Hormozi: Outcome-led with a time anchor
Constraints for all three: max 9 words, no clickbait, no "Congrats on the raise" (everyone sends that), no empty buzzwords.
After writing all three, select the ONE that fits this signal best. Only that subject goes in the JSON.

BODY: 3 paragraphs + closing:

PARAGRAPH 1, INTERRUPT + INSIGHT (2-3 sentences):
Follow the PARAGRAPH 1 instruction in the strategic angle above. If article intelligence is provided, use a specific fact (CEO quote, use of proceeds, lead investor) because it signals you did real research.

PARAGRAPH 2, CONNECT (1-2 sentences):
Follow the PARAGRAPH 2 instruction above. No feature-dumping. What dream outcome + what pain removed?

PARAGRAPH 3, PROOF OR SPECIFICITY (1-2 sentences):
Follow the PARAGRAPH 3 instruction above. One concrete, felt-by-them claim. "Companies at this stage typically..." is acceptable if you make it specific.

${ctaInstruction}

TONE:
- Human, direct, slightly informal but sharp
- Zero corporate speak: no "synergies", "leverage", "solutions", "reach out", "touch base"
- Write like a smart peer, not a sales rep
- First name only for recipient
- Don't mention the company name more than twice in the body
- Do not use em dashes, en dashes, long divider lines, or separator-style punctuation. Use commas, periods, colons, or short sentences instead.
- Do not put dash-separated clauses in the body. If a sentence needs a dash, split it into two sentences.

Return ONLY this JSON (no markdown):
{"subject": "...", "body": "..."}

The body must use \\n\\n between paragraphs.`,
    }],
  }, { signal: AbortSignal.timeout(60_000) })

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
  try {
    // Strip markdown code fences if Claude wrapped the JSON
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    return sanitizeGeneratedEmail(JSON.parse(cleaned))
  } catch {
    return sanitizeGeneratedEmail({
      subject: `${targetCompany}'s ${signalType}: a thought`,
      body: `${firstName}, most companies at this stage of ${signalType} hit a specific wall around [area], usually faster than expected. ${senderCompany} helps ${signalType === 'funding' ? 'post-raise teams' : 'companies in this situation'} avoid that by ${servicesDescription.split('.')[0].toLowerCase()}. Worth a 15-min call to see if it's relevant?`,
    })
  }
}

function sanitizeGeneratedEmail(value: unknown): { subject: string; body: string } {
  const input = value as { subject?: unknown; body?: unknown }
  return {
    subject: sanitizeEmailText(typeof input.subject === 'string' ? input.subject : ''),
    body: sanitizeEmailText(typeof input.body === 'string' ? input.body : ''),
  }
}

function sanitizeEmailText(value: string): string {
  return value
    .replace(/[\u2500-\u257f]+/g, '')
    .replace(/^\s*[-_=*]{3,}\s*$/gm, '')
    .replace(/\s*[\u2013\u2014]\s*/g, ', ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}
