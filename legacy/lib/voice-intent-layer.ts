/**
 * Bombsell Voice Intent Layer
 *
 * LLM-based intent + sentiment classification for voice and text commands.
 * Replaces ~960 lines of hard-coded regex keyword matching across
 * three intent parsers with a single structured LLM call.
 *
 * The LLM understands natural phrasing — "hey can you put together an
 * email for Acme" maps to `{intent: "lead_draft", target: "Acme"}` —
 * without the user needing to match specific trigger words.
 *
 * Sentiment detection (urgent, frustrated, confused, curious, neutral)
 * lets the system adapt its response tone — concise for urgency, extra
 * guidance for confusion, empathy for frustration.
 *
 * Fast path: simple confirm/cancel phrases bypass the LLM entirely
 * (< 1ms). Everything else routes through the LLM with JSON mode.
 */
import { complete, parseJsonLoose } from '@/lib/llm'
import {
  tryVoiceFastPath,
  type VoiceClassification,
  type VoiceIntentType,
  type VoiceSentiment,
} from '@/lib/voice-intent-core'
import type { DashboardView, LeadStatusCommand } from './dashboard-command-layer'

// ─── Intent types ────────────────────────────────────────────────────────────
export type { VoiceClassification, VoiceIntent, VoiceIntentType, VoiceSentiment } from '@/lib/voice-intent-core'

// ─── LLM classification ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Bombsell's voice command classifier. Bombsell is a B2B GTM platform that helps teams find, qualify, and reach out to leads.

Your job: classify a user's spoken or typed command into structured JSON with two parts:

1. INTENT — exactly ONE from the list below. Extract the MEANING, not specific keywords.
2. SENTIMENT — the user's emotional tone / urgency level.

Available intents (output ONLY one per utterance):

list_pipeline — User wants to see their pipeline, leads, accounts, opportunities, or outreach queue.
  Examples: "show me my pipeline", "what leads do I have", "list accounts", "what's in my queue", "show pipeline"

list_content_ideas — User wants to see content/post ideas.
  Examples: "what content ideas do I have", "show my posts", "list ideas", "show content queue"

lead_details — User wants details about a specific lead/company. Extract company name as target.
  Examples: "tell me about Acme", "show me the Stripe lead", "what's the status of Tesla", "details on lead 3"

lead_draft — User wants to draft/prepare/write/create outreach for a lead. Extract company name or number as target.
  Examples: "draft an email for Acme", "prepare outreach for Stripe", "write to lead 3", "compose message for Tesla"

lead_unlock — User wants to unlock/find/resolve contact info for a lead. Extract company name as target.
  Examples: "unlock Acme", "find contacts for Stripe", "get the email for lead 2", "resolve contact for Tesla"

lead_send — User wants to send/approve/dispatch outreach for a lead. Extract company name as target.
  Examples: "send the email to Acme", "approve and send to Stripe", "dispatch outreach to lead 1"

lead_status — User wants to mark/update a lead's status. Extract company name as target AND the new status.
  Valid statuses: viewed, dismissed, booked, sent, replied
  Examples: "mark Acme as booked", "dismiss the Stripe lead", "set lead 3 to viewed", "archive Tesla"

content_idea_approve — User wants to approve/accept a content idea. Extract the number as index.
  Examples: "approve idea 2", "accept the third post", "greenlight idea 1"

content_idea_reject — User wants to reject/dismiss a content idea. Extract the number as index.
  Examples: "reject idea 3", "skip the first one", "dismiss idea 2"

content_idea_draft — User wants to draft/write/compose a post from a content idea. Extract the number as index.
  Examples: "draft idea 1", "write the second post idea", "compose from idea 3"

navigate — User wants to go to a different view or section in the dashboard. Extract the view name AND optionally the sectionId.

Use this FEATURE REGISTRY to route questions to the correct view and section:

VIEW: integrations
  Section "integrations-social" — Social accounts (LinkedIn, X/Twitter). Keywords: linkedin, twitter, x account, social, post to social, content publishing
  Section "integrations-remote" — Remote control (Telegram, Discord). Keywords: telegram, discord, chat command, voice note, operate from chat, remote control
  Section "integrations-sending" — Outreach inboxes (Gmail, Outlook). Keywords: gmail, outlook, email account, mailbox, inbox, sending account, connect email
  Section "integrations-crm" — CRM sync (HubSpot, Salesforce, Pipedrive). Keywords: crm, hubspot, salesforce, pipedrive, zoho, crm sync, import crm
  Section "integrations-ops" — Notifications and booking. Keywords: slack, calendly, cal.com, booking, notifications, webhook
  Section "integrations-ai" — AI models. Keywords: ai model, llm, openai, chatgpt, claude, anthropic, api key, model key
  Section "integrations-agents-api" — Agents API. Keywords: agents api, agent key, developer api, api docs, rest api

VIEW: settings
  Section "settings-billing" — Billing and plans. Keywords: billing, plan, subscription, upgrade, credits, invoice, payment, pricing
  Section "settings-profile" — Profile and ICP. Keywords: profile, workspace profile, company profile, icp, ideal customer, target industries, keywords
  Section "settings-automation" — Automation settings. Keywords: automation, autopilot, approve first, research only, approval mode, safety mode
  Section "settings-team" — Team management. Keywords: team, members, invite, people, teammates

VIEW: outreach
  Pipeline, drafts, sent emails, replies, review queue. Keywords: pipeline, drafts, sent, replies, email status, review queue, outreach queue

VIEW: accounts
  Account signals, hot fits, watchlist. Keywords: signals, hot accounts, watchlist, fit score, lead score, account list

VIEW: content
  Content ideas, composer, calendar, performance.
  TABS: ideas (content ideas queue), composer (draft editor), calendar (scheduling), performance (metrics).
  Keywords: content idea, post idea, composer, calendar, content calendar, performance, published posts, metrics, schedule
  Examples: "go to content ideas" → view="content", tab="ideas"
  "open the composer" → view="content", tab="composer"
  "show content calendar" → view="content", tab="calendar"
  "how is my content performing" → view="content", tab="performance"

VIEW: campaigns
  GTM campaigns, objectives, audience, trigger, narrative, channels, campaign outcomes. Keywords: campaigns, campaign, launch motion, gtm motion, go-to-market campaign, narrative, audience

VIEW: home
  Dashboard, queue, command bar. Keywords: home, dashboard, today, queue, command bar, start, overview

Examples: "how do I connect telegram" → view="integrations", sectionId="integrations-remote"
"where do I set up my LinkedIn" → view="integrations", sectionId="integrations-social"
"i want to upgrade my plan" → view="settings", sectionId="settings-billing"
"connect my gmail account" → view="integrations", sectionId="integrations-sending"
"show me billing" → view="settings", sectionId="settings-billing"
"where are signals" → view="accounts" (signals live in the Accounts view)
"where is the watchlist" → view="accounts"
"where can I see my content ideas" → view="content"
"where do I build a campaign" → view="campaigns"
"take me to campaigns" → view="campaigns"
"where do I find agent status" → view="integrations", sectionId="integrations-agents-api"
"take me to the pipeline" → view="outreach"
"what agents does Bombsell offer" → view="integrations", sectionId="integrations-agents-api"
"how to find companies" → view="accounts"
"where to find leads" → view="accounts"
"how can I see my pipeline" → view="outreach"
"where do I create content" → view="content"

search — User wants to search for something. Extract the search query.
  Examples: "search for fintech", "find companies in healthcare", "look up SaaS startups"
  Signal-related: "do we have any signal from Google", "show me signals about Stripe", "any funding news from OpenAI", "find signals for Tesla" — extract the company/topic as query.
  IMPORTANT: classify as search ONLY when the user asks for specific data about a named company or topic. If the user asks HOW or WHERE to find things (without naming a specific company), classify as navigate instead.

refresh — User wants to refresh/reload/sync dashboard data.
  Examples: "refresh", "reload the dashboard", "sync data"

help — User is asking for help or what they can do.
  Examples: "what can you do", "help me", "what commands are available", "how do I use this"

unknown — Cannot determine intent. Provide a brief reason in note.

--- SENTIMENT (choose one) ---

neutral — Normal, calm, routine conversation. Default if no strong signal.
urgent — User sounds rushed, time-pressed, or uses words like "quickly", "now", "ASAP", "urgent", "fast". Short imperative sentences.
confused — User sounds uncertain, uses question-like phrasing, says "I don't know how", "how do I", "what does this mean", "I'm lost".
frustrated — User sounds annoyed, uses negative language, repeats themselves, says "this isn't working", "why can't I", "ugh", "come on".
curious — User is exploring, using open-ended questions, experimenting with what's possible.

IMPORTANT RULES:

DISAMBIGUATION: Feature-discovery vs content-search:
- "how do I find companies", "where to find leads", "where can I see signals", "what agents does Bombsell offer" → these ask WHERE a feature lives → classify as navigate to the relevant view (accounts for leads/companies/signals, integrations-agents-api for agent API, content for posts/ideas, campaigns for GTM motions, etc.)
- "find me companies in fintech", "show me signals from Google", "do we have any leads from Stripe" → these ask for specific content/results → classify as search with the topic/company as query
- KEY TEST: if the user asks about Bombsell's features/capabilities ("what can Bombsell do", "how does X work", "where is Y"), navigate. If they ask for specific data or results ("find X about Y", "show me Z from W"), search.
1. If the user references a company by name (e.g. "Acme Corp", "Stripe"), set target to that company name.
2. If the user references by number (e.g. "lead 3", "idea 2", "the third one"), set index to that number.
3. If the user says "the first one" or "the top one", set index to 1. For "second", index=2, "third"=3, etc.
4. For lead_status, extract the status keyword (viewed/dismissed/booked/sent/replied) into the status field.
5. For navigate, extract the view name. Map synonyms: "dashboard/home/today/queue"→home, "campaigns/campaign/gtm motion/go-to-market campaign"→campaigns, "pipeline/outreach/drafts/sent/replies"→outreach, "accounts/signals/watchlist/fits"→accounts, "content/ideas/composer/calendar/posts"→content, "agents/fleet/system/agent api"→integrations with sectionId="integrations-agents-api" when agent-specific, "integrations/connections/connectors"→integrations, "settings/billing/profile/team"→settings.
6. For content_idea_* intents, always extract the index number — never a name.
7. Be decisive. If you're 70%+ sure, classify it. Only use unknown if genuinely ambiguous or completely out of scope.
8. Out-of-scope: general chitchat, questions about weather/news/sports, greetings without a command. These are help or unknown.

Return ONLY valid JSON matching this TypeScript type:
{
  "intent": "lead_draft",
  "sentiment": "neutral",
  "target"?: string,
  "index"?: number,
  "status"?: string,
  "view"?: string,
  "sectionId"?: string,
  "tab"?: string,
  "query"?: string,
  "note"?: string
}`

const VALID_SENTIMENTS = new Set<VoiceSentiment>(['neutral', 'urgent', 'confused', 'frustrated', 'curious'])

function normalizeSentiment(raw: string | undefined): VoiceSentiment {
  if (raw && VALID_SENTIMENTS.has(raw as VoiceSentiment)) return raw as VoiceSentiment
  return 'neutral'
}

// ─── LRU cache ───────────────────────────────────────────────────────────────

const CACHE_MAX = 64
const responseCache = new Map<string, VoiceClassification>()

function cacheKey(transcript: string): string {
  return transcript.trim().toLowerCase().replace(/\s+/g, ' ')
}

function cacheGet(key: string): VoiceClassification | undefined {
  const entry = responseCache.get(key)
  if (entry) {
    // Move to end (most recent) by re-inserting
    responseCache.delete(key)
    responseCache.set(key, entry)
  }
  return entry
}

function cacheSet(key: string, value: VoiceClassification): void {
  if (responseCache.size >= CACHE_MAX) {
    // Evict oldest (first key in insertion order)
    const first = responseCache.keys().next().value
    if (first !== undefined) responseCache.delete(first)
  }
  responseCache.set(key, value)
}

/**
 * Classify a voice or text utterance into a structured Bombsell intent.
 * Uses fast-path regex for simple confirm/cancel; LLM for everything else.
 */
export async function classifyVoiceIntent(
  transcript: string,
  _context?: {
    /** Currently active dashboard view (for context-aware parsing). */
    activeView?: DashboardView
  },
): Promise<VoiceClassification> {
  void _context

  const trimmed = transcript.trim()
  if (!trimmed) {
    return {
      intent: { intent: 'unknown', sentiment: 'neutral', note: 'No command text was received.' },
      latencyMs: 0,
      llmUsed: false,
    }
  }

  // Fast path: confirm / cancel bypasses LLM entirely
  const fast = tryVoiceFastPath(trimmed)
  if (fast) {
    return { intent: fast, latencyMs: 0, llmUsed: false }
  }

  // LRU cache: identical transcripts return instantly
  const key = cacheKey(trimmed)
  const cached = cacheGet(key)
  if (cached) return { ...cached, latencyMs: 0 }

  // LLM classification
  const t0 = Date.now()
  try {
    const result = await complete({
      system: SYSTEM_PROMPT,
      prompt: trimmed,
      maxTokens: 256,
      temperature: 0.0,
      json: true,
      timeoutMs: 8_000,
    })

    const parsed = parseJsonLoose<{
      intent: string
      sentiment?: string
      target?: string
      index?: number
      status?: string
      view?: string
      sectionId?: string
      tab?: string
      query?: string
      note?: string
    }>(result.text)

    if (!parsed || !parsed.intent) {
      return {
        intent: { intent: 'unknown', sentiment: 'neutral', note: 'Assistant returned no valid intent.' },
        latencyMs: Date.now() - t0,
        llmUsed: true,
      }
    }

    // Validate and normalize the intent
    const validIntents = new Set<VoiceIntentType>([
      'list_pipeline', 'list_content_ideas', 'lead_details', 'lead_draft',
      'lead_unlock', 'lead_send', 'lead_status', 'content_idea_approve',
      'content_idea_reject', 'content_idea_draft', 'navigate', 'search',
      'refresh', 'help', 'confirm', 'cancel', 'unknown',
    ])

    const intent = validIntents.has(parsed.intent as VoiceIntentType)
      ? (parsed.intent as VoiceIntentType)
      : 'unknown'

    const status = parsed.status
      ? (['viewed', 'dismissed', 'booked', 'sent', 'replied'].includes(parsed.status)
        ? (parsed.status as LeadStatusCommand)
        : undefined)
      : undefined

    const parsedView = parsed.view === 'agents' ? 'integrations' : parsed.view
    const view = parsedView
      ? (['home', 'campaigns', 'outreach', 'accounts', 'content', 'integrations', 'settings'].includes(parsedView)
        ? (parsedView as DashboardView)
        : undefined)
      : undefined

    const classification: VoiceClassification = {
      intent: {
        intent,
        sentiment: normalizeSentiment(parsed.sentiment),
        target: parsed.target?.trim() || undefined,
        index: typeof parsed.index === 'number' && parsed.index > 0 ? parsed.index : undefined,
        status,
        view,
        sectionId: parsed.sectionId?.trim() || undefined,
        tab: parsed.tab?.trim() || undefined,
        query: parsed.query?.trim() || undefined,
        note: parsed.note?.trim() || undefined,
      },
      latencyMs: Date.now() - t0,
      llmUsed: true,
    }
    cacheSet(key, classification)
    return classification
  } catch (err) {
    const latencyMs = Date.now() - t0
    return {
      intent: {
        intent: 'unknown',
        sentiment: 'neutral',
        note: `Intent classification failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      latencyMs,
      llmUsed: true,
    }
  }
}

export { isVoiceCancellation, isVoiceConfirmation } from '@/lib/voice-intent-core'
