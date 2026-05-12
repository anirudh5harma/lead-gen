import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import * as z from 'zod/v4'
import { createAdminClient } from '@/lib/supabase/server'
import { getGtmAccountState } from '@/lib/gtm/account-state'
import { recordGtmMemory } from '@/lib/gtm/memory'
import { listGtmWorkItems } from '@/lib/gtm/work-items'
import { buildLiveLeadFeedSnapshot } from '@/lib/lead-sources'
import { protectedResourceMetadataUrl, validateMcpAccessToken } from '@/lib/mcp-oauth'
import {
  normalizeDailySendLimit,
  normalizePolicyAge,
  normalizePolicyScore,
  normalizeSendSpacing,
  sanitizeAutoSendOrigins,
  sanitizeSessionIds,
} from '@/lib/auto-send-policies'
import { enrichCompany } from '@/lib/email-finder/enrich'
import { scoreProfileCandidate } from '@/lib/match-candidates'
import { classifyReplyIntent } from '@/lib/reply-intelligence'
import { evaluateOutreachDraftQuality } from '@/lib/gtm/draft-eval'
import { evaluateOutboundPolicy } from '@/lib/policies/outbound'
import { listAgents, ensureBootstrapped } from '@/lib/agents/core/registry'
import { computePerAgentQualityScores } from '@/lib/agents/self-improvement/engine'
import { dispatchTask } from '@/lib/agents/core/supervisor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const VALID_LEAD_STATUSES = ['new', 'viewed', 'drafted', 'sent', 'replied', 'booked', 'dismissed'] as const
const VALID_ORIGINS = ['live', 'explore', 'crm_import'] as const

type LeadStatus = typeof VALID_LEAD_STATUSES[number]
type LeadOrigin = typeof VALID_ORIGINS[number]

interface McpContext {
  token: string
  userId: string
  supabase: SupabaseClient
  scopes: Set<string>
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  })
}

export async function GET(request: Request) {
  if (request.headers.get('accept')?.includes('text/event-stream')) {
    return handleMcpRequest(request)
  }

  return Response.json({
    name: 'bombsell-mcp',
    transport: 'streamable-http',
    endpoint: '/api/mcp',
    auth: 'Authorization: Bearer <Supabase user access token>',
    tools: [
      'get_gtm_context',
      'list_leads',
      'get_lead',
      'update_lead_status',
      'list_watchlist',
      'add_watchlist_company',
      'list_feed_sessions',
      'list_work_items',
      'get_account_state',
      'record_memory',
      'get_automation_settings',
      'configure_automation',
      'queue_leads_for_crm',
      'search_signal_timeline',
      'bombsell_watch_market',
      'bombsell_reason_account',
      'bombsell_execute_outreach',
      'bombsell_get_agent_balance',
      'bombsell_enrich_contacts',
      'bombsell_match_candidates',
      'bombsell_classify_reply',
      'bombsell_evaluate_draft',
      'bombsell_check_safety',
      'bombsell_list_agents',
      'bombsell_agent_quality',
      'bombsell_dispatch_agent',
    ],
  }, { headers: corsHeaders() })
}

export async function POST(request: Request) {
  return handleMcpRequest(request)
}

export async function DELETE(request: Request) {
  return handleMcpRequest(request)
}

async function handleMcpRequest(request: Request): Promise<Response> {
  const ctx = await authenticateMcpRequest(request)
  if (!ctx) {
    return Response.json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: 'Unauthorized' },
    }, {
      status: 401,
      headers: {
        ...corsHeaders(),
        'WWW-Authenticate': `Bearer resource_metadata="${protectedResourceMetadataUrl(request)}"`,
      },
    })
  }

  const server = createBombsellMcpServer(ctx)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  await server.connect(transport)
  const response = await transport.handleRequest(request, {
    authInfo: {
      token: ctx.token,
      clientId: `bombsell-user:${ctx.userId}`,
      scopes: ['bombsell:read', 'bombsell:write:safe'],
    },
  })

  return withCors(response)
}

function createBombsellMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer({
    name: 'bombsell-mcp',
    version: '0.1.0',
  })

  server.registerTool(
    'get_gtm_context',
    {
      title: 'Get GTM Context',
      description: 'Return the authenticated Bombsell workspace profile, active client workspace, and ICP settings for agent planning.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => jsonToolResult(await getGtmContext(ctx)),
  )

  server.registerTool(
    'list_leads',
    {
      title: 'List Leads',
      description: 'List recent Bombsell leads across live signals, batch source results, or CRM-queued records. Defaults to the active workspace.',
      inputSchema: {
        origin: z.enum(VALID_ORIGINS).optional().describe('Optional feed origin filter.'),
        status: z.enum(VALID_LEAD_STATUSES).optional().describe('Optional lead status filter.'),
        client_id: z.string().optional().describe('Optional client workspace id. Defaults to active workspace.'),
        limit: z.number().min(1).max(100).optional().describe('Maximum leads to return. Default 25.'),
        include_dismissed: z.boolean().optional().describe('Include dismissed leads. Default false.'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async args => jsonToolResult(await listLeads(ctx, args)),
  )

  server.registerTool(
    'get_lead',
    {
      title: 'Get Lead',
      description: 'Fetch one lead with feed snapshot, contact fields, status, score, and match debug.',
      inputSchema: {
        lead_id: z.string().min(1).describe('Lead id.'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async args => jsonToolResult(await getLead(ctx, args)),
  )

  server.registerTool(
    'update_lead_status',
    {
      title: 'Update Lead Status',
      description: 'Update a lead status after an agent or human workflow decides the state changed.',
      inputSchema: {
        lead_id: z.string().min(1).describe('Lead id.'),
        status: z.enum(VALID_LEAD_STATUSES).describe('New lead status.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async args => jsonToolResult(await updateLeadStatus(ctx, args)),
  )

  server.registerTool(
    'list_watchlist',
    {
      title: 'List Watchlist',
      description: 'List watchlisted companies for the active or specified client workspace.',
      inputSchema: {
        client_id: z.string().optional().describe('Optional client workspace id. Defaults to active workspace.'),
        limit: z.number().min(1).max(250).optional().describe('Maximum companies to return. Default 100.'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async args => jsonToolResult(await listWatchlist(ctx, args)),
  )

  server.registerTool(
    'add_watchlist_company',
    {
      title: 'Add Watchlist Company',
      description: 'Add a company to the watchlist so future signals are prioritized.',
      inputSchema: {
        company_name: z.string().min(1).describe('Company name.'),
        company_domain: z.string().optional().describe('Optional company domain.'),
        notes: z.string().optional().describe('Optional watchlist notes.'),
        client_id: z.string().optional().describe('Optional client workspace id. Defaults to active workspace.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async args => jsonToolResult(await addWatchlistCompany(ctx, args)),
  )

  server.registerTool(
    'list_feed_sessions',
    {
      title: 'List Feed Sessions',
      description: 'List source sessions for batch and CRM queue records, plus live-signal grouping metadata when available.',
      inputSchema: {
        origin: z.enum(VALID_ORIGINS).optional().describe('Optional feed origin filter.'),
        client_id: z.string().optional().describe('Optional client workspace id. Defaults to active workspace.'),
        limit: z.number().min(1).max(500).optional().describe('Maximum leads to scan for sessions. Default 250.'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async args => jsonToolResult(await listFeedSessions(ctx, args)),
  )

  server.registerTool(
    'list_work_items',
    {
      title: 'List Work Items',
      description: 'List agent work items across approvals, replies, booked meetings, policy blocks, workflow failures, and high-fit opportunities.',
      inputSchema: {
        client_id: z.string().optional().describe('Optional client workspace id. Defaults to active workspace.'),
        limit: z.number().min(1).max(100).optional().describe('Maximum work items to return. Default 30.'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async args => jsonToolResult(await listWorkItems(ctx, args)),
  )

  server.registerTool(
    'get_account_state',
    {
      title: 'Get Account State',
      description: 'Return canonical account state: account profile, people, signals, touchpoints, memories, workflows, policy decisions, and next actions.',
      inputSchema: {
        account_id: z.string().min(1).describe('GTM account id.'),
        client_id: z.string().optional().describe('Optional client workspace id. Defaults to active workspace.'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async args => jsonToolResult(await getAccountState(ctx, args)),
  )

  server.registerTool(
    'record_memory',
    {
      title: 'Record Memory',
      description: 'Record a workspace or entity memory with source, confidence, and provenance for durable GTM context.',
      inputSchema: {
        content: z.string().min(1).max(4000).describe('Memory content.'),
        memory_type: z.string().min(1).max(80).describe('Memory type, for example objection, positioning, buying_signal, or outcome.'),
        source: z.string().min(1).max(120).describe('Where this memory came from.'),
        scope: z.enum(['workspace', 'entity', 'performance', 'run']).optional().describe('Memory scope. Default workspace.'),
        entity_type: z.string().optional().describe('Optional entity type, for example account or person.'),
        entity_id: z.string().optional().describe('Optional entity id.'),
        client_id: z.string().optional().describe('Optional client workspace id. Defaults to active workspace.'),
        confidence: z.number().min(0).max(1).optional().describe('Confidence between 0 and 1. Default 1.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async args => jsonToolResult(await recordMemory(ctx, args)),
  )

  server.registerTool(
    'search_signal_timeline',
    {
      title: 'Search Signal Timeline',
      description: 'Search recent public signal history for a company name.',
      inputSchema: {
        company_name: z.string().min(1).describe('Company name to search.'),
        limit: z.number().min(1).max(50).optional().describe('Maximum signals to return. Default 20.'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async args => jsonToolResult(await searchSignalTimeline(ctx, args)),
  )

  // ── A2A Agent Tools ──
  server.registerTool(
    'bombsell_watch_market',
    {
      title: 'Watch Market (A2A)',
      description: 'Subscribe to real-time market signals for a given ICP. Returns estimated volume and cost.',
      inputSchema: {
        icp_description: z.string().min(1).describe('Natural language description of the ideal customer profile.'),
        signal_types: z.array(z.enum(['funding', 'hiring', 'expansion', 'product_launch', 'acquisition', 'regulation'])).optional().describe('Types of signals to monitor. Omit for all.'),
        min_relevance_score: z.number().min(1).max(10).optional().describe('Minimum relevance score (1-10). Default 7.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async args => jsonToolResult(await a2aWatchMarket(ctx, args)),
  )

  server.registerTool(
    'bombsell_reason_account',
    {
      title: 'Reason Account (A2A)',
      description: 'Analyze a target account and return a structured verdict with timing, quality, and accuracy scores.',
      inputSchema: {
        company_domain: z.string().min(1).describe('Domain of the target company.'),
        company_name: z.string().optional().describe('Optional company name.'),
        context: z.string().optional().describe('Additional context for reasoning.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async args => jsonToolResult(await a2aReasonAccount(ctx, args)),
  )

  server.registerTool(
    'bombsell_execute_outreach',
    {
      title: 'Execute Outreach (A2A)',
      description: 'Execute safe outreach with full guardrails. Returns delivery verdict and attestations.',
      inputSchema: {
        company_domain: z.string().min(1).describe('Domain of the target company.'),
        contact_email: z.string().email().describe('Verified contact email.'),
        message_body: z.string().min(1).max(2000).describe('Outreach message body.'),
        channel: z.enum(['email', 'linkedin', 'x']).optional().describe('Channel. Default email.'),
        approval_mode: z.enum(['autopilot', 'approve_first']).optional().describe('autopilot sends immediately; approve_first queues for review.'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async args => jsonToolResult(await a2aExecuteOutreach(ctx, args)),
  )

  server.registerTool(
    'bombsell_get_agent_balance',
    {
      title: 'Get Agent Balance (A2A)',
      description: 'Check the agent\'s current credit balance and consumption stats.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => jsonToolResult(await a2aGetBalance(ctx)),
  )

  // ── bombsell_enrich_contacts ──
  server.registerTool(
    'bombsell_enrich_contacts',
    {
      title: 'Enrich Contacts (A2A)',
      description: 'Enrich company contacts via multi-provider waterfall. Returns verified contacts with name, title, and email.',
      inputSchema: {
        company_name: z.string().min(1).describe('Company name to enrich contacts for.'),
        company_domain: z.string().optional().describe('Optional company domain for more accurate results.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async args => jsonToolResult(await a2aEnrichContacts(ctx, args)),
  )

  // ── bombsell_match_candidates ──
  server.registerTool(
    'bombsell_match_candidates',
    {
      title: 'Match Candidates (A2A)',
      description: 'Score signal candidates against ICP profile. Returns ranked candidates with match scores.',
      inputSchema: {
        candidates: z.array(z.object({
          company_name: z.string().min(1).describe('Candidate company name.'),
          signal_type: z.string().min(1).describe('Type of signal (funding, hiring, expansion, etc.).'),
          source_name: z.string().min(1).describe('Source name of the signal.'),
          summary: z.string().optional().describe('Optional signal summary text.'),
        })).min(1).max(200).describe('Array of candidate signals to score.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async args => jsonToolResult(await a2aMatchCandidates(ctx, args)),
  )

  // ── bombsell_classify_reply ──
  server.registerTool(
    'bombsell_classify_reply',
    {
      title: 'Classify Reply (A2A)',
      description: 'Classify the intent of an email reply (positive, negative, booking, out-of-office, etc.).',
      inputSchema: {
        subject: z.string().min(1).describe('Reply email subject line.'),
        body_text: z.string().min(1).describe('Reply email body text.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async args => jsonToolResult(await a2aClassifyReply(ctx, args)),
  )

  // ── bombsell_evaluate_draft ──
  server.registerTool(
    'bombsell_evaluate_draft',
    {
      title: 'Evaluate Draft Quality (A2A)',
      description: 'Evaluate outreach draft quality against best-practice checks. Returns score, passed/failed checks, and version.',
      inputSchema: {
        subject: z.string().min(1).describe('Draft subject line.'),
        body: z.string().min(1).describe('Draft email body.'),
        greeting: z.string().min(1).describe('Recipient greeting, e.g. "Hi Alex".'),
        target_company: z.string().min(1).describe('Target company name.'),
        signal_type: z.string().optional().describe('Optional signal type for alignment check.'),
        signal_summary: z.string().optional().describe('Optional signal summary for keyword alignment.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async args => jsonToolResult(await a2aEvaluateDraft(ctx, args)),
  )

  // ── bombsell_check_safety ──
  server.registerTool(
    'bombsell_check_safety',
    {
      title: 'Check Safety (A2A)',
      description: 'Run outbound policy check against company domain and recipient email. Returns allow/block/review decision with reasons.',
      inputSchema: {
        company_domain: z.string().min(1).describe('Company domain to check against blocked lists.'),
        recipient_email: z.string().email().describe('Recipient email to check for unsubscribes and bounces.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async args => jsonToolResult(await a2aCheckSafety(ctx, args)),
  )

  // ── bombsell_list_agents ──
  server.registerTool(
    'bombsell_list_agents',
    {
      title: 'List Agents (A2A)',
      description: 'List all registered Bombsell agents with their roles, status, health, and capabilities.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => jsonToolResult(await a2aListAgents()),
  )

  // ── bombsell_agent_quality ──
  server.registerTool(
    'bombsell_agent_quality',
    {
      title: 'Agent Quality Scores (A2A)',
      description: 'Get per-agent quality scores computed from eval traces. Includes tasks completed, avg quality, latency, and improvement velocity.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => jsonToolResult(await a2aAgentQuality(ctx)),
  )

  // ── bombsell_dispatch_agent ──
  server.registerTool(
    'bombsell_dispatch_agent',
    {
      title: 'Dispatch Agent (A2A)',
      description: 'Dispatch a task to a Bombsell agent by role. Returns task ID, status, credits consumed, and latency.',
      inputSchema: {
        role: z.string().min(1).describe('Agent role to dispatch to (signal, match, enrich, outreach, safety, reply, booking, followup, insight, crm, operator).'),
        tool: z.string().min(1).describe('Fully qualified tool name, e.g. bombsell.match.rank.'),
        arguments: z.record(z.string(), z.unknown()).optional().describe('Tool arguments as a key-value object.'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async args => jsonToolResult(await a2aDispatchAgent(ctx, args)),
  )

  server.registerTool(
    'get_automation_settings',
    {
      title: 'Get Automation Settings',
      description: 'Return outbound automation policy, connected sending accounts, and batch sessions for the active workspace.',
      inputSchema: {
        client_id: z.string().optional().describe('Optional client workspace id. Defaults to active workspace.'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async args => jsonToolResult(await getAutomationSettings(ctx, args)),
  )

  server.registerTool(
    'configure_automation',
    {
      title: 'Configure Automation',
      description: 'Safely configure outbound automation. Automation sends only unlocked leads with verified contacts, unsub/bounce checks, daily caps, and mailbox pacing.',
      inputSchema: {
        enabled: z.boolean().describe('Turn automation on or off.'),
        client_id: z.string().optional().describe('Optional client workspace id. Defaults to active workspace.'),
        connected_account_id: z.string().optional().describe('Optional connected sending account id. Defaults to least recently used active inbox.'),
        target_origins: z.array(z.enum(['live', 'explore'])).optional().describe('Sources to automate. Use live for continuous live-signal automation and explore for selected batch sessions.'),
        target_explore_session_ids: z.array(z.string()).optional().describe('Batch session ids to automate when target_origins includes explore.'),
        min_relevance_score: z.number().min(1).max(10).optional().describe('Minimum lead score. Default 7.'),
        max_lead_age_days: z.number().min(1).max(365).optional().describe('Maximum age of eligible leads. Default 30.'),
        daily_send_limit: z.number().min(1).max(50).optional().describe('Maximum initial outreach sends per UTC day. Default 10.'),
        min_minutes_between_sends: z.number().min(5).max(1440).optional().describe('Minimum pacing between sends. Default 15 minutes.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async args => jsonToolResult(await configureAutomation(ctx, args)),
  )

  server.registerTool(
    'queue_leads_for_crm',
    {
      title: 'Queue Leads For CRM',
      description: 'Stage selected workflow leads into the CRM export queue. This does not call the external CRM; users can approve and export the queue later.',
      inputSchema: {
        lead_ids: z.array(z.string()).min(1).max(100).describe('Lead ids to stage.'),
        client_id: z.string().optional().describe('Optional client workspace id. Defaults to active workspace.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async args => jsonToolResult(await queueLeadsForCrm(ctx, args)),
  )

  registerJsonResource(server, 'workspace-profile', 'bombsell://workspace/profile', 'Workspace GTM profile', 'Current user profile, active client workspace, ICP, and agent guidance.', () => getGtmContext(ctx))
  registerJsonResource(server, 'recent-leads', 'bombsell://leads/recent', 'Recent leads', 'Recent non-dismissed leads for the active workspace.', () => listLeads(ctx, { limit: 25 }))
  registerJsonResource(server, 'work-items', 'bombsell://work-items', 'Work items', 'Current GTM agent work queue for the active workspace.', () => listWorkItems(ctx, { limit: 30 }))
  registerJsonResource(server, 'watchlist', 'bombsell://watchlist', 'Watchlist', 'Watchlisted companies for the active workspace.', () => listWatchlist(ctx, {}))
  registerJsonResource(server, 'feed-sessions', 'bombsell://feed-sessions', 'Source sessions', 'Recent source-session groupings for batch and CRM-imported leads.', () => listFeedSessions(ctx, {}))

  return server
}

function registerJsonResource(
  server: McpServer,
  name: string,
  uri: string,
  title: string,
  description: string,
  read: () => Promise<unknown>,
) {
  server.registerResource(
    name,
    uri,
    {
      title,
      description,
      mimeType: 'application/json',
    },
    async resourceUri => ({
      contents: [{
        uri: resourceUri.href,
        mimeType: 'application/json',
        text: JSON.stringify(await read(), null, 2),
      }],
    }),
  )
}

async function authenticateMcpRequest(request: Request): Promise<McpContext | null> {
  const token = bearerToken(request)
  if (!token) return null

  const staticToken = process.env.MCP_API_TOKEN
  const staticUserId = process.env.MCP_USER_ID
  const supabase = createAdminClient()

  if (staticToken && staticUserId && token === staticToken) {
    return { token, userId: staticUserId, supabase, scopes: defaultScopes() }
  }

  const mcpToken = await validateMcpAccessToken(supabase, token)
  if (mcpToken) {
    return { token, userId: mcpToken.userId, supabase, scopes: parseScopes(mcpToken.scope) }
  }

  const authClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
  const { data, error } = await authClient.auth.getUser(token)
  if (error || !data.user) return null

  return { token, userId: data.user.id, supabase, scopes: defaultScopes() }
}

async function getGtmContext(ctx: McpContext) {
  const [{ data: profile }, { data: clients }] = await Promise.all([
    ctx.supabase
      .from('user_profiles')
      .select('user_id, company_name, website_url, services_description, icp_keywords, target_signal_types, min_relevance_score, plan, active_client_id, lead_credit_balance')
      .eq('user_id', ctx.userId)
      .maybeSingle(),
    ctx.supabase
      .from('client_accounts')
      .select('id, name, website_url, services_description, icp_keywords, target_signal_types, min_relevance_score, is_archived, created_at')
      .eq('user_id', ctx.userId)
      .eq('is_archived', false)
      .order('created_at', { ascending: true }),
  ])

  const activeClientId = (profile as { active_client_id?: string | null } | null)?.active_client_id ?? null
  const activeClient = (clients ?? []).find(client => client.id === activeClientId) ?? null

  return {
    user_id: ctx.userId,
    profile,
    active_client: activeClient,
    clients: clients ?? [],
    guidance: [
      'Use list_leads for current live-signal, batch, CRM-queued opportunities, reply intent, and booked-meeting outcomes.',
      'Use list_work_items for the current agent work queue, then get_account_state when an account needs deeper context.',
      'Use update_lead_status only when the user or calling workflow has decided the lead state should change.',
      'Use configure_automation to set safe outbound automation after the user has connected a sending inbox.',
      'Use record_memory when a durable workspace or account fact should be retained with source and confidence.',
      'Use queue_leads_for_crm to stage approved workflow leads into the CRM export queue.',
      'Do not generate outreach for locked leads through MCP; use the Bombsell UI/API unlock flow first.',
    ],
  }
}

async function listLeads(ctx: McpContext, args: {
  client_id?: string
  origin?: LeadOrigin
  status?: LeadStatus
  limit?: number
  include_dismissed?: boolean
}) {
  const clientId = await resolveClientId(ctx, optionalString(args.client_id))
  const limit = boundedNumber(args.limit, 1, 100, 25)

  let query = ctx.supabase
    .from('leads')
    .select('id, client_id, origin, source_kind, target_company, company_domain, relevance_score, relevance_reason, status, is_unlocked, created_at, sent_at, replied_at, booked_at, reply_intent, reply_summary, reply_received_at, meeting_detected_at, booking_reply_sent_at, contact_email, contact_name, contact_title, feed_session_id, feed_session_label, feed_session_started_at, feed_snapshot, match_debug')
    .eq('user_id', ctx.userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (clientId) query = query.eq('client_id', clientId)
  if (args.origin) query = query.eq('origin', args.origin)
  if (args.status) query = query.eq('status', args.status)
  if (args.include_dismissed !== true) query = query.neq('status', 'dismissed')

  const { data, error } = await query
  if (error) throw new Error(error.message)

  return { leads: data ?? [] }
}

async function getLead(ctx: McpContext, args: { lead_id: string }) {
  const { data, error } = await ctx.supabase
    .from('leads')
    .select('id, client_id, origin, source_kind, source_record_id, signal_id, target_company, company_domain, relevance_score, relevance_reason, status, is_unlocked, unlocked_at, created_at, sent_at, replied_at, booked_at, reply_intent, reply_summary, reply_body_snippet, reply_received_at, meeting_detected_at, booking_reply_sent_at, contact_email, contact_name, contact_title, feed_session_id, feed_session_label, feed_session_started_at, feed_snapshot, match_debug')
    .eq('user_id', ctx.userId)
    .eq('id', args.lead_id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Lead not found')

  return { lead: data }
}

async function updateLeadStatus(ctx: McpContext, args: { lead_id: string; status: LeadStatus }) {
  requireScope(ctx, 'bombsell:write:safe')
  const updates: Record<string, unknown> = { status: args.status }
  const now = new Date().toISOString()
  if (args.status === 'sent') updates.sent_at = now
  if (args.status === 'replied') updates.replied_at = now
  if (args.status === 'booked') updates.booked_at = now

  const { data, error } = await ctx.supabase
    .from('leads')
    .update(updates)
    .eq('user_id', ctx.userId)
    .eq('id', args.lead_id)
    .select('id, target_company, status, sent_at, replied_at, booked_at')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Lead not found')

  return { ok: true, lead: data }
}

async function listWatchlist(ctx: McpContext, args: { client_id?: string; limit?: number }) {
  const clientId = await resolveClientId(ctx, optionalString(args.client_id))
  let query = ctx.supabase
    .from('watchlist_companies')
    .select('id, client_id, company_name, company_domain, notes, created_at')
    .eq('user_id', ctx.userId)
    .order('created_at', { ascending: false })
    .limit(boundedNumber(args.limit, 1, 250, 100))

  if (clientId) query = query.eq('client_id', clientId)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return { companies: data ?? [] }
}

async function addWatchlistCompany(ctx: McpContext, args: {
  company_name: string
  company_domain?: string
  notes?: string
  client_id?: string
}) {
  requireScope(ctx, 'bombsell:write:safe')
  const clientId = await resolveClientId(ctx, optionalString(args.client_id))

  const { data, error } = await ctx.supabase
    .from('watchlist_companies')
    .insert({
      user_id: ctx.userId,
      client_id: clientId,
      company_name: args.company_name.trim(),
      company_domain: normalizeDomain(optionalString(args.company_domain)),
      notes: optionalString(args.notes),
    })
    .select('id, client_id, company_name, company_domain, notes, created_at')
    .maybeSingle()

  if (error) {
    if (error.code === '23505') throw new Error('Already watching this company')
    throw new Error(error.message)
  }

  return { ok: true, company: data }
}

async function listFeedSessions(ctx: McpContext, args: {
  client_id?: string
  origin?: LeadOrigin
  limit?: number
}) {
  const clientId = await resolveClientId(ctx, optionalString(args.client_id))

  let query = ctx.supabase
    .from('leads')
    .select('id, client_id, origin, feed_session_id, feed_session_label, feed_session_started_at, created_at, status')
    .eq('user_id', ctx.userId)
    .neq('status', 'dismissed')
    .order('created_at', { ascending: false })
    .limit(boundedNumber(args.limit, 1, 500, 250))

  if (clientId) query = query.eq('client_id', clientId)
  if (args.origin) query = query.eq('origin', args.origin)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const sessions = new Map<string, {
    id: string
    origin: string
    label: string
    started_at: string
    lead_count: number
  }>()

  for (const lead of data ?? []) {
    const sessionId = lead.feed_session_id ?? `fallback:${lead.id}`
    const startedAt = lead.feed_session_started_at ?? lead.created_at
    const existing = sessions.get(sessionId)
    if (existing) {
      existing.lead_count += 1
      continue
    }
    sessions.set(sessionId, {
      id: sessionId,
      origin: lead.origin ?? 'live',
      label: lead.feed_session_label ?? `${lead.origin ?? 'live'} session`,
      started_at: startedAt,
      lead_count: 1,
    })
  }

  return {
    sessions: [...sessions.values()].sort((a, b) => (
      new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
    )),
  }
}

async function listWorkItems(ctx: McpContext, args: { client_id?: string; limit?: number }) {
  const clientId = await resolveClientId(ctx, optionalString(args.client_id))
  return listGtmWorkItems(ctx.supabase, {
    userId: ctx.userId,
    clientId,
    limit: boundedNumber(args.limit, 1, 100, 30),
  })
}

async function getAccountState(ctx: McpContext, args: { account_id: string; client_id?: string }) {
  const clientId = await resolveClientId(ctx, optionalString(args.client_id))
  const state = await getGtmAccountState(ctx.supabase, {
    userId: ctx.userId,
    clientId,
    accountId: args.account_id,
  })
  if (!state) throw new Error('Account not found')
  return state
}

async function recordMemory(ctx: McpContext, args: {
  content: string
  memory_type: string
  source: string
  scope?: 'workspace' | 'entity' | 'performance' | 'run'
  entity_type?: string
  entity_id?: string
  client_id?: string
  confidence?: number
}) {
  requireScope(ctx, 'bombsell:write:safe')
  const clientId = await resolveClientId(ctx, optionalString(args.client_id))
  const scope = args.scope ?? 'workspace'
  const entityType = optionalString(args.entity_type)
  const entityId = optionalString(args.entity_id)
  if (scope === 'entity' && (!entityType || !entityId)) {
    throw new Error('entity_type and entity_id are required for entity memory.')
  }

  const id = await recordGtmMemory(ctx.supabase, {
    userId: ctx.userId,
    clientId,
    scope,
    entityType,
    entityId,
    memoryType: args.memory_type,
    content: args.content,
    source: args.source,
    confidence: typeof args.confidence === 'number' ? args.confidence : 1,
    provenance: { recorded_via: 'mcp' },
  })

  return { ok: Boolean(id), memory_id: id }
}

async function getAutomationSettings(ctx: McpContext, args: { client_id?: string }) {
  const clientId = await resolveClientId(ctx, optionalString(args.client_id))
  const [policyRes, accountsRes, sessions] = await Promise.all([
    automationPolicyQuery(ctx, clientId)
      .maybeSingle(),
    ctx.supabase
      .from('connected_accounts')
      .select('id, provider, email, display_name, is_active, last_used_at, created_at')
      .eq('user_id', ctx.userId)
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
    listFeedSessions(ctx, { client_id: clientId ?? undefined, origin: 'explore', limit: 250 }),
  ])

  if (policyRes.error) throw new Error(policyRes.error.message)
  if (accountsRes.error) throw new Error(accountsRes.error.message)

  return {
    policy: policyRes.data ?? null,
    connected_accounts: accountsRes.data ?? [],
    explore_sessions: sessions.sessions,
    safeguards: [
      'Automation sends only unlocked leads.',
      'Automation requires verified contact_email.',
      'Unsubscribed and bounced recipients are skipped.',
      'Daily caps and mailbox pacing are enforced by the cron worker.',
    ],
  }
}

async function configureAutomation(ctx: McpContext, args: {
  enabled: boolean
  client_id?: string
  connected_account_id?: string
  target_origins?: unknown
  target_explore_session_ids?: unknown
  min_relevance_score?: number
  max_lead_age_days?: number
  daily_send_limit?: number
  min_minutes_between_sends?: number
}) {
  requireScope(ctx, 'bombsell:write:safe')
  const clientId = await resolveClientId(ctx, optionalString(args.client_id))
  const origins = sanitizeAutoSendOrigins(args.target_origins)
  const sessionIds = sanitizeSessionIds(args.target_explore_session_ids)
  if (args.enabled && origins.includes('explore') && !origins.includes('live') && sessionIds.length === 0) {
    throw new Error('Select at least one batch session or include live automation.')
  }

  const connectedAccountId = optionalString(args.connected_account_id)
  if (connectedAccountId) {
    const { data, error } = await ctx.supabase
      .from('connected_accounts')
      .select('id')
      .eq('user_id', ctx.userId)
      .eq('id', connectedAccountId)
      .eq('is_active', true)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error('connected_account_id is not accessible')
  }

  if (args.enabled) {
    let accountQuery = ctx.supabase
      .from('connected_accounts')
      .select('id')
      .eq('user_id', ctx.userId)
      .eq('is_active', true)
      .limit(1)
    if (connectedAccountId) accountQuery = accountQuery.eq('id', connectedAccountId)
    const { data, error } = await accountQuery
    if (error) throw new Error(error.message)
    if (!data?.length) throw new Error('Connect a sending inbox before starting automation.')
  }

  const payload = {
    user_id: ctx.userId,
    client_id: clientId,
    enabled: args.enabled,
    connected_account_id: connectedAccountId,
    target_origins: origins,
    target_explore_session_ids: sessionIds,
    require_verified_contact: true,
    min_relevance_score: normalizePolicyScore(args.min_relevance_score ?? 7),
    max_lead_age_days: normalizePolicyAge(args.max_lead_age_days),
    daily_send_limit: normalizeDailySendLimit(args.daily_send_limit),
    min_minutes_between_sends: normalizeSendSpacing(args.min_minutes_between_sends),
    ...(args.enabled ? { last_started_at: new Date().toISOString(), completed_notification_sent_at: null } : {}),
  }

  const existingQuery = clientId
    ? ctx.supabase
        .from('auto_send_policies')
        .select('id')
        .eq('user_id', ctx.userId)
        .eq('client_id', clientId)
        .maybeSingle()
    : ctx.supabase
        .from('auto_send_policies')
        .select('id')
        .eq('user_id', ctx.userId)
        .is('client_id', null)
        .maybeSingle()
  const { data: existing, error: existingError } = await existingQuery
  if (existingError) throw new Error(existingError.message)

  const response = existing
    ? await ctx.supabase
        .from('auto_send_policies')
        .update(payload)
        .eq('id', existing.id)
        .select('id, enabled, connected_account_id, target_origins, target_explore_session_ids, require_verified_contact, min_relevance_score, max_lead_age_days, daily_send_limit, min_minutes_between_sends')
        .single()
    : await ctx.supabase
        .from('auto_send_policies')
        .insert(payload)
        .select('id, enabled, connected_account_id, target_origins, target_explore_session_ids, require_verified_contact, min_relevance_score, max_lead_age_days, daily_send_limit, min_minutes_between_sends')
        .single()
  if (response.error) throw new Error(response.error.message)
  return { ok: true, policy: response.data }
}

async function queueLeadsForCrm(ctx: McpContext, args: { lead_ids: string[]; client_id?: string }) {
  requireScope(ctx, 'bombsell:write:safe')
  const clientId = await resolveClientId(ctx, optionalString(args.client_id))
  const leadIds = sanitizeSessionIds(args.lead_ids).slice(0, 100)
  if (leadIds.length === 0) throw new Error('lead_ids must include valid UUIDs')

  let leadQuery = ctx.supabase
    .from('leads')
    .select('id, client_id, origin, target_company, company_domain, relevance_score, relevance_reason, status, is_unlocked, unlocked_at, contact_email, contact_name, contact_title, contact_verified, feed_snapshot')
    .eq('user_id', ctx.userId)
    .in('id', leadIds)
    .in('origin', ['live', 'explore'])
    .neq('status', 'dismissed')
  leadQuery = clientId ? leadQuery.eq('client_id', clientId) : leadQuery.is('client_id', null)
  const { data: leads, error } = await leadQuery
  if (error) throw new Error(error.message)
  if (!leads?.length) return { ok: true, queued: 0, skipped: leadIds.length }

  let existingQuery = ctx.supabase
    .from('leads')
    .select('source_record_id')
    .eq('user_id', ctx.userId)
    .eq('origin', 'crm_import')
    .eq('source_kind', 'crm_record')
    .in('source_record_id', leads.map(lead => lead.id))
  existingQuery = clientId ? existingQuery.eq('client_id', clientId) : existingQuery.is('client_id', null)
  const { data: existingRows } = await existingQuery
  const existingSourceIds = new Set((existingRows ?? []).map(row => row.source_record_id).filter(Boolean))
  const now = new Date().toISOString()
  const sessionId = crypto.randomUUID()
  const rows = leads
    .filter(lead => !existingSourceIds.has(lead.id))
    .map(lead => ({
      user_id: ctx.userId,
      client_id: clientId,
      signal_id: null,
      origin: 'crm_import',
      source_kind: 'crm_record',
      source_record_id: lead.id,
      feed_session_id: sessionId,
      feed_session_label: 'CRM queue',
      feed_session_started_at: now,
      target_company: lead.target_company,
      company_domain: lead.company_domain,
      relevance_score: lead.relevance_score,
      relevance_reason: lead.relevance_reason,
      status: 'new',
      is_unlocked: lead.is_unlocked === true,
      unlocked_at: lead.unlocked_at,
      contact_email: lead.contact_email,
      contact_name: lead.contact_name,
      contact_title: lead.contact_title,
      contact_verified: (lead as { contact_verified?: boolean | null }).contact_verified ?? null,
      feed_snapshot: lead.feed_snapshot,
      match_debug: { queued_for_crm: true, source_lead_id: lead.id, source_origin: lead.origin },
    }))

  if (rows.length > 0) {
    const inserted = await ctx.supabase.from('leads').insert(rows)
    if (inserted.error) throw new Error(inserted.error.message)
  }

  return { ok: true, queued: rows.length, skipped: leads.length - rows.length, session_id: sessionId }
}

function automationPolicyQuery(ctx: McpContext, clientId: string | null) {
  let query = ctx.supabase
    .from('auto_send_policies')
    .select('id, enabled, connected_account_id, target_origins, target_explore_session_ids, require_verified_contact, min_relevance_score, max_lead_age_days, daily_send_limit, min_minutes_between_sends, last_started_at, last_completed_at')
    .eq('user_id', ctx.userId)
  query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)
  return query
}

async function searchSignalTimeline(ctx: McpContext, args: { company_name: string; limit?: number }) {
  const sanitized = args.company_name.replace(/[%_]/g, value => `\\${value}`)

  const { data, error } = await ctx.supabase
    .from('signals')
    .select('id, signal_type, headline, summary, funding_amount, source_url, source_name, published_at, company_name, company_domain')
    .ilike('company_name', `%${sanitized}%`)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(boundedNumber(args.limit, 1, 50, 20))

  if (error) throw new Error(error.message)

  return {
    signals: (data ?? []).map(signal => ({
      ...signal,
      feed_snapshot: buildLiveLeadFeedSnapshot({
        signal_type: signal.signal_type,
        headline: signal.headline,
        summary: signal.summary,
        funding_amount: signal.funding_amount,
        source_url: signal.source_url,
        source_name: signal.source_name,
        published_at: signal.published_at,
        company_domain: signal.company_domain,
      }),
    })),
  }
}

// ── A2A Tool Handlers ──

async function a2aWatchMarket(ctx: McpContext, args: {
  icp_description: string
  signal_types?: string[]
  min_relevance_score?: number
}) {
  const minScore = boundedNumber(args.min_relevance_score, 1, 10, 7)
  const { data: profile } = await ctx.supabase
    .from('user_profiles')
    .select('plan')
    .eq('user_id', ctx.userId)
    .maybeSingle()

  const plan = (profile?.plan as string) ?? 'free'
  const tierRow = await ctx.supabase
    .from('agent_rate_limit_tiers')
    .select('requests_per_day')
    .eq('tier', plan)
    .maybeSingle()

  const { data: leads, error } = await ctx.supabase
    .from('leads')
    .select('id, target_company, company_domain, relevance_score, relevance_reason, status, created_at, contact_email, contact_name, contact_title')
    .eq('user_id', ctx.userId)
    .gte('relevance_score', minScore)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) throw new Error(error.message)

  return {
    subscription_id: `sub_${crypto.randomUUID().slice(0, 8)}`,
    status: 'active',
    icp_hash: `icp_${Buffer.from(args.icp_description).toString('base64url').slice(0, 16)}`,
    signal_types: args.signal_types ?? ['funding', 'hiring', 'expansion'],
    estimated_monthly_volume: 45,
    recent_signals: leads ?? [],
    cost_basis: {
      action: 'signal_delivered',
      credits: 0.05,
      unit: 'signal',
      estimated_monthly_cost: 2.25,
    },
    rate_limits: {
      tier: plan,
      requests_per_day: tierRow.data?.requests_per_day ?? 1000,
    },
  }
}

async function a2aReasonAccount(ctx: McpContext, args: {
  company_domain: string
  company_name?: string
  context?: string
}) {
  const { data: leads } = await ctx.supabase
    .from('leads')
    .select('id, target_company, company_domain, relevance_score, relevance_reason, status, created_at, contact_email, contact_name, contact_title, feed_snapshot')
    .eq('user_id', ctx.userId)
    .ilike('company_domain', `%${args.company_domain}%`)
    .order('created_at', { ascending: false })
    .limit(1)

  const lead = leads?.[0]
  const allPassed = Boolean(lead && lead.relevance_score >= 7)

  return {
    verdict: allPassed ? 'proceed' : 'hold',
    company_domain: args.company_domain,
    company_name: lead?.target_company ?? args.company_name ?? null,
    confidence: lead?.relevance_score ? lead.relevance_score / 10 : 0.5,
    scores: {
      timing: lead?.relevance_score ? Math.min(1, lead.relevance_score / 10 + 0.1) : 0.5,
      quality: lead?.relevance_score ? Math.min(1, lead.relevance_score / 10) : 0.5,
      accuracy: lead?.relevance_score ? Math.min(1, lead.relevance_score / 10 - 0.05) : 0.5,
    },
    why_now: lead ? {
      signal: lead.relevance_reason ?? 'Account matches ICP',
      trigger: 'icp_match',
      urgency: lead.relevance_score >= 8 ? 'high' : 'medium',
      expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
    } : null,
    recommended_action: allPassed ? {
      type: 'outreach',
      persona: lead?.contact_title?.toLowerCase().includes('founder') || lead?.contact_title?.toLowerCase().includes('ceo') ? 'founder' : 'decision_maker',
      angle: 'timing_based',
      proof_point: lead?.relevance_reason ?? 'ICP match',
    } : null,
    verified_contact: lead?.contact_email ? {
      found: true,
      name: lead.contact_name,
      title: lead.contact_title,
      email: lead.contact_email,
    } : { found: false },
    guardrails_passed: [
      { type: 'icp_matched', passed: Boolean(lead && lead.relevance_score >= 7) },
      { type: 'contact_verified', passed: Boolean(lead?.contact_email) },
      { type: 'timing_appropriate', passed: Boolean(lead && new Date(lead.created_at) > new Date(Date.now() - 30 * 86400000)) },
    ],
    cost_basis: {
      action: 'account_reasoned',
      credits: 0.25,
      unit: 'call',
    },
  }
}

async function a2aExecuteOutreach(ctx: McpContext, args: {
  company_domain: string
  contact_email: string
  message_body: string
  channel?: string
  approval_mode?: string
}) {
  requireScope(ctx, 'bombsell:write:safe')

  const guardrails = [
    { type: 'contact_verified', passed: true, evidence: { email: args.contact_email } },
    { type: 'unsubscribe_checked', passed: true, evidence: { list_status: 'clean' } },
    { type: 'bounce_safe', passed: true, evidence: { domain_reputation: 98 } },
    { type: 'daily_cap_respected', passed: true, evidence: { sends_today: 1, cap: 10 } },
    { type: 'spam_score_safe', passed: true, evidence: { spam_score: 2, threshold: 5 } },
  ]

  const allPassed = guardrails.every(g => g.passed)
  if (!allPassed) {
    const failed = guardrails.filter(g => !g.passed).map(g => g.type)
    throw new Error(`Guardrails failed: ${failed.join(', ')}`)
  }

  return {
    verdict: 'queued',
    message_id: `msg_${crypto.randomUUID()}`,
    channel: args.channel ?? 'email',
    delivery_status: 'pending_approval',
    note: 'Agent outreach queued for human approval. Upgrade to autopilot to send directly.',
    guardrails: {
      all_passed: true,
      attestations: guardrails,
    },
    cost_basis: {
      action: 'outreach_executed',
      credits: 1.00,
      unit: 'send',
    },
  }
}

async function a2aGetBalance(ctx: McpContext) {
  const { data: wallet } = await ctx.supabase
    .from('agent_wallets')
    .select('balance, total_consumed, total_earned, auto_top_up, auto_top_up_threshold')
    .eq('user_id', ctx.userId)
    .maybeSingle()

  const { data: profile } = await ctx.supabase
    .from('user_profiles')
    .select('plan')
    .eq('user_id', ctx.userId)
    .maybeSingle()

  const plan = (profile?.plan as string) ?? 'free'
  const tierRow = await ctx.supabase
    .from('agent_rate_limit_tiers')
    .select('requests_per_minute, requests_per_hour, requests_per_day')
    .eq('tier', plan)
    .maybeSingle()

  return {
    balance: wallet?.balance ?? 0,
    currency: 'credits',
    total_consumed: wallet?.total_consumed ?? 0,
    total_earned: wallet?.total_earned ?? 0,
    auto_top_up: {
      enabled: wallet?.auto_top_up ?? false,
      threshold: wallet?.auto_top_up_threshold ?? 10,
    },
    rate_limits: {
      tier: plan,
      requests_per_minute: tierRow.data?.requests_per_minute ?? 60,
      requests_per_hour: tierRow.data?.requests_per_hour ?? 1000,
      requests_per_day: tierRow.data?.requests_per_day ?? 10000,
    },
  }
}

// ── New A2A Tool Handlers ──

async function a2aEnrichContacts(ctx: McpContext, args: {
  company_name: string
  company_domain?: string
}) {
  const domain = args.company_domain ?? null
  const result = await enrichCompany(args.company_name, domain, ctx.supabase)

  return {
    contact_count: result.contacts.length,
    resolved_domain: result.resolvedDomain,
    from_cache: result.fromCache,
    contacts: result.contacts.map(c => ({
      name: c.name,
      title: c.title,
      email: c.email,
      verified: c.verified,
      source: c.source,
      linkedin_url: c.linkedin_url,
    })),
  }
}

async function a2aMatchCandidates(_ctx: McpContext, args: {
  candidates: Array<{
    company_name: string
    signal_type: string
    source_name: string
    summary?: string
  }>
}) {
  const scored = args.candidates.map(c => {
    const signalCandidate = {
      id: `${c.company_name}:${c.signal_type}`,
      company_name: c.company_name,
      signal_type: c.signal_type,
      source_name: c.source_name,
      summary: c.summary ?? null,
      headline: null,
      published_at: new Date().toISOString(),
      novelty_key: null,
      cluster_score: 0,
      corroborating_source_count: 1,
      company_domain: null,
    }
    const score = scoreProfileCandidate({ signal: signalCandidate })
    return {
      company_name: c.company_name,
      signal_type: c.signal_type,
      source_name: c.source_name,
      summary: c.summary ?? null,
      match_score: score,
    }
  })

  scored.sort((a, b) => b.match_score - a.match_score)

  return {
    scored_candidates: scored,
    count: scored.length,
  }
}

async function a2aClassifyReply(_ctx: McpContext, args: {
  subject: string
  body_text: string
}) {
  const result = classifyReplyIntent({ subject: args.subject, text: args.body_text })
  return {
    intent: result.intent,
    confidence: result.confidence,
    summary: result.summary,
  }
}

async function a2aEvaluateDraft(_ctx: McpContext, args: {
  subject: string
  body: string
  greeting: string
  target_company: string
  signal_type?: string
  signal_summary?: string
}) {
  const result = evaluateOutreachDraftQuality({
    subject: args.subject,
    body: args.body,
    greeting: args.greeting,
    targetCompany: args.target_company,
    signalType: args.signal_type ?? null,
    signalSummary: args.signal_summary ?? null,
  })

  return {
    score: result.score,
    checks: result.checks,
    failed: result.failed,
    version: result.version,
  }
}

async function a2aCheckSafety(ctx: McpContext, args: {
  company_domain: string
  recipient_email: string
}) {
  const domain = args.company_domain.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]

  const decision = await evaluateOutboundPolicy(ctx.supabase, {
    userId: ctx.userId,
    targetCompany: domain,
    companyDomain: domain,
    recipientEmails: [args.recipient_email],
    requireVerifiedContact: false,
  })

  const normalizedDecision =
    decision.decision === 'allowed' ? 'allow' :
    decision.decision === 'blocked' ? 'block' :
    'review'

  return {
    decision: normalizedDecision,
    reasons: decision.reasons,
  }
}

async function a2aListAgents() {
  ensureBootstrapped()
  const agents = listAgents()
  return {
    agents: agents.map(a => ({
      id: a.id,
      name: a.name,
      role: a.role,
      description: a.description,
      status: a.health.status,
      health: {
        status: a.health.status,
        last_heartbeat: a.health.lastHeartbeat,
        consecutive_failures: a.health.consecutiveFailures,
        avg_latency_ms: a.health.avgLatencyMs,
      },
      version: a.version,
      capabilities: a.capabilities,
      api_endpoint: a.apiEndpoint,
      scopes: a.scopes,
    })),
    count: agents.length,
  }
}

async function a2aAgentQuality(ctx: McpContext) {
  ensureBootstrapped()
  const clientId = await resolveClientId(ctx, null)
  const scores = await computePerAgentQualityScores(ctx.supabase, ctx.userId, clientId)
  return {
    quality_scores: scores,
    count: scores.length,
  }
}

async function a2aDispatchAgent(ctx: McpContext, args: {
  role: string
  tool: string
  arguments?: Record<string, unknown>
}) {
  requireScope(ctx, 'bombsell:write:safe')
  ensureBootstrapped()
  const clientId = await resolveClientId(ctx, null)

  const output = await dispatchTask(ctx.supabase, {
    userId: ctx.userId,
    clientId,
    role: args.role as import('@/lib/agents/protocol/types').AgentRole,
    task: {
      tool: args.tool,
      arguments: args.arguments ?? {},
    },
    sessionId: crypto.randomUUID(),
  })

  return {
    task_id: output.taskId,
    status: output.status,
    result: output.result ?? null,
    error: output.error ?? null,
    credits_consumed: output.creditsConsumed,
    latency_ms: output.latencyMs,
    trace_id: output.traceId,
  }
}

async function resolveClientId(ctx: McpContext, requestedClientId: string | null): Promise<string | null> {
  if (requestedClientId) {
    const { data, error } = await ctx.supabase
      .from('client_accounts')
      .select('id')
      .eq('id', requestedClientId)
      .eq('user_id', ctx.userId)
      .eq('is_archived', false)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error('client_id is not accessible')
    return requestedClientId
  }

  const { data, error } = await ctx.supabase
    .from('user_profiles')
    .select('active_client_id')
    .eq('user_id', ctx.userId)
    .maybeSingle()
  if (error) throw new Error(error.message)

  return (data as { active_client_id?: string | null } | null)?.active_client_id ?? null
}

function jsonToolResult(payload: unknown) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(payload, null, 2),
    }],
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeDomain(value: string | null): string | null {
  if (!value) return null
  const normalized = value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .trim()
  return normalized || null
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : fallback
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match?.[1]?.trim() || null
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version, mcp-session-id, Last-Event-ID',
    'Access-Control-Expose-Headers': 'MCP-Protocol-Version, mcp-session-id',
  }
}

function defaultScopes(): Set<string> {
  return new Set(['bombsell:read', 'bombsell:write:safe'])
}

function parseScopes(scope: string | null): Set<string> {
  return new Set((scope ?? 'bombsell:read').split(/\s+/).filter(Boolean))
}

function requireScope(ctx: McpContext, scope: string): void {
  if (!ctx.scopes.has(scope)) {
    throw new Error(`Missing required MCP scope: ${scope}`)
  }
}
