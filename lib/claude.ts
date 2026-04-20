import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL       = 'claude-sonnet-4-6'
const CHEAP_MODEL = 'claude-haiku-4-5-20251001'

/**
 * Extracts structured signal data from a news headline + description.
 * Returns null if the item doesn't represent a clear company event.
 */
export async function extractSignal(headline: string, description: string): Promise<{
  company_name: string
  company_domain: string | null
  signal_type: 'funding' | 'acquisition' | 'expansion' | 'regulation' | 'hiring'
  summary: string
  funding_amount: string | null
} | null> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
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

If this is not a clear company business event (e.g. it's an opinion piece, product review, or generic news), return null.

Return ONLY valid JSON, no markdown, no explanation.`,
    }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
  if (text === 'null' || !text) return null

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
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
    model: CHEAP_MODEL,
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `You are evaluating whether a company event is a good sales trigger.

Seller's product/service: ${servicesDescription}

Event: ${companyName} — ${signalType}
Summary: ${signalSummary}

Score 1-10: How likely is this company to need what the seller offers RIGHT NOW because of this event?
- 8-10: Strong fit — the event directly creates a need for the seller's product
- 5-7: Possible fit — plausible but indirect connection
- 1-4: Poor fit — weak or no connection

Return ONLY this JSON: {"score": <int>, "reason": "<one sentence explaining why>"}`,
    }],
  })

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
    model: MODEL,
    max_tokens: 150,
    messages: [{
      role: 'user',
      content: `Extract 5-10 keywords that describe the ideal customer profile (ICP) for this product/service.
Focus on: industries, company stages, pain points, and use cases.

Product/service: ${servicesDescription}

Return ONLY a JSON array of strings, no markdown.`,
    }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]'
  try {
    return JSON.parse(text)
  } catch {
    return []
  }
}

/**
 * Signal-specific strategic angles derived from sales methodology:
 * - Funding: money to spend + scaling pain imminent (Hormozi: "dream outcome within reach")
 * - Acquisition: integration chaos + 100-day mandate (Challenger: reframe their risk)
 * - Expansion: new market = new operational gaps (Predictable Revenue: research-led relevance)
 * - Regulation: fear + shrinking window (Voss: label the emotion, create urgency without pressure)
 * - Hiring: new leader = new mandate in first 90 days (Challenger: teach them something about their new role)
 */
const SIGNAL_ANGLE: Record<string, string> = {
  funding: `They just received capital and are under pressure to deploy it fast and show ROI to investors.
The acute pain: headcount, tooling, and processes don't scale linearly with funding — something always breaks first.
Your angle: position your solution as the thing that lets them scale without the typical breakage.
Lead with what breaks at their stage (Challenger insight), frame your offer around time-to-value (Hormozi), and make the ask feel low-stakes (Voss: "Would it be crazy to...").`,

  acquisition: `The first 90 days post-acquisition are defined by integration chaos — systems, teams, data, and processes colliding.
The acute pain: the acquiring team has a mandate to show synergies fast but everything is slower than expected.
Your angle: you've seen this exact situation and know the specific bottleneck they'll hit.
Lead with a sharp insight about what breaks at this stage (Challenger), use tactical empathy to acknowledge the chaos (Voss labeling), frame your offer as eliminating one specific obstacle (Hormozi: reduce effort/sacrifice).`,

  expansion: `Entering a new market or geography means they're flying blind on local regulations, buyer behavior, and operational fit.
The acute pain: the playbook that worked in their home market creates false confidence — unknown unknowns will slow them down.
Your angle: you have specific knowledge about this new market/segment that they need.
Lead with a non-obvious insight about the new market they're entering (Challenger), connect it directly to what you offer (Predictable Revenue: hyper-specific relevance), make the CTA about sharing intelligence, not selling (Blount: remove the pressure).`,

  regulation: `A new regulation creates a hard deadline and a fear of being caught unprepared.
The acute pain: compliance teams are overwhelmed, leadership is unsure of scope, and the window to act is shrinking.
Your angle: you've helped others navigate this exact regulation and know where most companies underestimate the work.
Lead by labeling the emotional reality of compliance pressure (Voss), share one specific non-obvious risk they face (Challenger), make the offer feel like risk removal not a purchase (Hormozi: reduce downside fear).`,

  hiring: `A new C-suite hire has ~90 days to establish credibility before the organization forms an opinion about them.
The acute pain: they inherit systems and problems they didn't choose, and they're under pressure to show early wins.
Your angle: you can help them get a quick win in your domain — which is exactly what new leaders are hunting for.
Lead with insight about what new [title] leaders typically prioritize in their first 90 days (Challenger), position your offer as a fast path to that early win (Hormozi: time delay minimized), ask a calibrated question that makes them think, not a pitch (Voss: "What's the biggest gap you've found so far?").`,
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
}): Promise<{ subject: string; body: string }> {
  const {
    senderCompany, servicesDescription, stakeholderName, targetCompany,
    signalType, signalSummary, originalSubject, originalBody,
  } = params

  const firstName = stakeholderName.split(' ')[0] || 'there'

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Write a BRIEF follow-up email for a cold outreach that got no reply after ~4 days.

Context:
- Sender: ${senderCompany} — ${servicesDescription.slice(0, 120)}
- Recipient: ${firstName} at ${targetCompany}
- Original trigger: ${targetCompany} ${signalType} — ${signalSummary}
- Original subject line: "${originalSubject}"

Original email body:
${originalBody.slice(0, 600)}

Follow-up rules (strict):
- Max 3 sentences total
- Do NOT re-pitch, summarize, or repeat the original email
- Add ONE new piece of value: a different angle, a quick data point, or a short question they haven't heard
- Voss-style opener: "Probably caught you at a bad time..." or "Figured this might still be on your radar given..."
- Close with a single soft question or ultra-low-friction ask
- Zero corporate speak. Write like a smart peer.

Return ONLY this JSON (no markdown):
{"subject": "Re: ${originalSubject}", "body": "..."}

Body must use \\n\\n between paragraphs.`,
    }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
  try {
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    return JSON.parse(cleaned)
  } catch {
    return {
      subject: `Re: ${originalSubject}`,
      body: `${firstName}, probably caught you in the middle of something — figured I'd check back since the ${signalType} at ${targetCompany} is likely still in full swing.\n\nIs there a better moment this week for a quick 15-min call?`,
    }
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
  calendlyUrl?: string | null
}): Promise<{ subject: string; body: string }> {
  const {
    senderCompany, servicesDescription, stakeholderName, stakeholderTitle,
    targetCompany, signalType, signalSummary, calendlyUrl,
  } = params

  const angle = SIGNAL_ANGLE[signalType] || SIGNAL_ANGLE.expansion
  const firstName = stakeholderName.split(' ')[0] || stakeholderName

  const ctaInstruction = calendlyUrl
    ? `4. CLOSING PARAGRAPH (standalone, 1–2 sentences): A low-friction ask to book a 15-minute call. Include the Calendly link naturally — e.g. "If any of this lands, here's a link to grab 15 minutes: ${calendlyUrl}" or "Happy to show you how in 15 min — ${calendlyUrl}". Keep it casual, not pushy.`
    : `4. CLOSING PARAGRAPH (standalone, 1–2 sentences): A low-friction ask for a 15-minute call — "15 min this week?" or a Voss calibrated question ("What would need to be true for this to be worth 15 minutes of your time?"). Never "Would you be interested in...".`

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 900,
    messages: [{
      role: 'user',
      content: `You are a world-class B2B sales strategist writing a cold outreach email.
Your writing is informed by: Never Split the Difference (Voss), $100M Offers (Hormozi), Fanatical Prospecting (Blount), The Challenger Sale, Predictable Revenue (Aaron Ross), and top sales blogs (Lenny's Newsletter, Apollo, HubSpot, SaaStr).

━━━ CONTEXT ━━━
Sender: ${senderCompany}
What they offer: ${servicesDescription}

Recipient: ${firstName} (${stakeholderTitle}) at ${targetCompany}
Trigger event: ${targetCompany} just had a ${signalType} — ${signalSummary}

━━━ STRATEGIC ANGLE FOR THIS SIGNAL TYPE ━━━
${angle}

━━━ EMAIL CONSTRUCTION RULES ━━━

SUBJECT LINE — pick one style based on the signal:
- Challenger style: A non-obvious insight or provocative question ("The hidden cost of [event]")
- Voss style: A label that names their reality ("Looks like [company] is in scale mode")
- Hormozi style: Outcome-led, time-specific ("How [company] could [result] in 60 days")
Max 9 words. No clickbait. No "Congrats on the raise" (everyone sends that).

BODY — structured as 3 separate paragraphs + a closing paragraph:

PARAGRAPH 1 — INTERRUPT + INSIGHT (2–3 sentences):
- Open with one sentence showing deep awareness of their specific situation right now. Reference the event with an insight they haven't heard — not "Saw the news about X", but what this event *really means* for them operationally.
- Follow with the Challenger "teach" moment: something they probably don't know — a pattern, a risk, a non-obvious consequence of their event that your vantage point gives you.

PARAGRAPH 2 — CONNECT (1–2 sentences):
- Link the insight directly to what ${senderCompany} does. No feature-dumping.
- Hormozi lens: what's the dream outcome they get + what's removed (pain, time, risk)?

PARAGRAPH 3 — PROOF OR SPECIFICITY (1–2 sentences):
- One concrete, specific claim or example that makes this feel real. A number, a pattern you've seen, a named outcome. If you don't have specifics, frame it as "companies at this stage typically..." — make it feel earned, not generic.

${ctaInstruction}

TONE:
- Human, direct, slightly informal but sharp
- Zero corporate speak: no "synergies", "leverage", "solutions", "reach out", "touch base"
- Write like a smart peer, not a sales rep
- First name only for recipient
- Don't mention the company name more than once in the body

Return ONLY this JSON (no markdown):
{"subject": "...", "body": "..."}

The body must use \\n\\n between paragraphs so they render as separate paragraphs.`,
    }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
  try {
    // Strip markdown code fences if Claude wrapped the JSON
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    return JSON.parse(cleaned)
  } catch {
    return {
      subject: `${targetCompany}'s ${signalType} — a thought`,
      body: `${firstName}, most companies at this stage of ${signalType} hit a specific wall around [area] — usually faster than expected. ${senderCompany} helps ${signalType === 'funding' ? 'post-raise teams' : 'companies in this situation'} avoid that by ${servicesDescription.split('.')[0].toLowerCase()}. Worth a 15-min call to see if it's relevant?`,
    }
  }
}
