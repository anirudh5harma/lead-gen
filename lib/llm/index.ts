/**
 * LLM abstraction — one `complete()` entry point used by drafting, content
 * writing and editing. Default provider is DeepSeek ("Bombsell Default LLM",
 * billed via credits). A workspace can connect its own Claude / ChatGPT key
 * (`workspace_llm_keys`), in which case calls run on the user's key with no
 * LLM credit charge. See PLAN.md §3.5.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { completePrompt } from '@/lib/deepseek'

export type LlmProvider = 'default' | 'anthropic' | 'openai'

export interface LlmCallOptions {
  system?: string
  prompt: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
  json?: boolean
  /** Resolve a workspace-connected key if present; otherwise use the default. */
  supabase?: SupabaseClient
  workspaceId?: string
  /** Force a provider (skips workspace lookup). */
  provider?: LlmProvider
}

export interface LlmResult {
  text: string
  provider: LlmProvider
  /** true when the call ran on a user-supplied key (→ no LLM credit charge). */
  byoKey: boolean
}

const ANTHROPIC_MODEL_DEFAULT = 'claude-sonnet-4-6'
const OPENAI_MODEL_DEFAULT = 'gpt-4o'

async function resolveProvider(
  supabase: SupabaseClient | undefined,
  workspaceId: string | undefined,
): Promise<{ provider: LlmProvider; apiKey?: string; model?: string }> {
  if (!supabase || !workspaceId) return { provider: 'default' }
  const { data } = await supabase
    .from('workspace_llm_keys')
    .select('provider, api_key, model, is_active')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (data?.api_key && (data.provider === 'anthropic' || data.provider === 'openai')) {
    return { provider: data.provider, apiKey: data.api_key, model: data.model ?? undefined }
  }
  return { provider: 'default' }
}

async function callAnthropic(opts: LlmCallOptions & { apiKey: string; model: string }): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.4,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: 'user', content: opts.prompt }],
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  })
  if (!res.ok) throw new Error(`Anthropic API error (${res.status}): ${(await res.text().catch(() => '')).slice(0, 240)}`)
  const json = await res.json() as { content?: Array<{ type?: string; text?: string }> }
  return (json.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('\n').trim()
}

async function callOpenAI(opts: LlmCallOptions & { apiKey: string; model: string }): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.4,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
        { role: 'user', content: opts.prompt },
      ],
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  })
  if (!res.ok) throw new Error(`OpenAI API error (${res.status}): ${(await res.text().catch(() => '')).slice(0, 240)}`)
  const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  return (json.choices?.[0]?.message?.content ?? '').trim()
}

export async function complete(opts: LlmCallOptions): Promise<LlmResult> {
  const resolved = opts.provider && opts.provider !== 'default'
    ? { provider: opts.provider, apiKey: undefined, model: undefined }
    : opts.provider === 'default'
      ? { provider: 'default' as LlmProvider, apiKey: undefined, model: undefined }
      : await resolveProvider(opts.supabase, opts.workspaceId)

  if (resolved.provider === 'anthropic' && resolved.apiKey) {
    const text = await callAnthropic({ ...opts, apiKey: resolved.apiKey, model: resolved.model ?? ANTHROPIC_MODEL_DEFAULT })
    return { text, provider: 'anthropic', byoKey: true }
  }
  if (resolved.provider === 'openai' && resolved.apiKey) {
    const text = await callOpenAI({ ...opts, apiKey: resolved.apiKey, model: resolved.model ?? OPENAI_MODEL_DEFAULT })
    return { text, provider: 'openai', byoKey: true }
  }

  // Default — DeepSeek (credit-billed)
  const text = await completePrompt({
    system: opts.system,
    prompt: opts.prompt,
    maxTokens: opts.maxTokens ?? 1024,
    timeoutMs: opts.timeoutMs ?? 30_000,
    temperature: opts.temperature ?? 0.4,
    ...(opts.json ? { responseFormat: { type: 'json_object' } } : {}),
  })
  return { text, provider: 'default', byoKey: false }
}

/** Parse a JSON object/array out of an LLM response, tolerating code fences. */
export function parseJsonLoose<T = unknown>(text: string): T | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try { return JSON.parse(cleaned) as T } catch { /* fall through */ }
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const a = cleaned.indexOf(open), b = cleaned.lastIndexOf(close)
    if (a !== -1 && b > a) { try { return JSON.parse(cleaned.slice(a, b + 1)) as T } catch { /* keep trying */ } }
  }
  return null
}
