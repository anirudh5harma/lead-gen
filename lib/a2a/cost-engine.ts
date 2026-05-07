import type { SupabaseClient } from '@supabase/supabase-js'

export interface CostEstimate {
  action: string
  creditCost: number
  unit: string
  description: string
}

export interface TransactionResult {
  transactionId: string | null
  balanceAfter: number | null
  success: boolean
  error?: string
}

export async function getCostEstimate(
  supabase: SupabaseClient,
  action: string,
): Promise<CostEstimate | null> {
  const { data } = await supabase
    .from('agent_cost_catalog')
    .select('action, credit_cost, unit, description')
    .eq('action', action)
    .maybeSingle()

  if (!data) return null

  return {
    action: data.action,
    creditCost: Number(data.credit_cost),
    unit: data.unit,
    description: data.description,
  }
}

export async function consumeAgentCredit(
  supabase: SupabaseClient,
  agentId: string,
  action: string,
  tool: string,
  requestPayload?: Record<string, unknown>,
): Promise<TransactionResult> {
  const cost = await getCostEstimate(supabase, action)
  if (!cost) {
    return { transactionId: null, balanceAfter: null, success: false, error: `Unknown action: ${action}` }
  }

  const { data, error } = await supabase.rpc('consume_agent_credit', {
    p_agent_id: agentId,
    p_amount: cost.creditCost,
    p_tool: tool,
    p_action: action,
    p_request_payload: requestPayload ?? {},
  })

  if (error || !data) {
    return { transactionId: null, balanceAfter: null, success: false, error: error?.message ?? 'Credit consumption failed' }
  }

  // data is returned as a JSON array from the function
  const result = Array.isArray(data) ? data[0] : data

  const balanceAfter = result?.balance_after ?? null

  // Auto top-up if enabled and balance dropped below threshold
  if (result?.success && balanceAfter !== null && balanceAfter < 10) {
    try {
      const { data: wallet } = await supabase
        .from('agent_wallets')
        .select('auto_top_up, auto_top_up_threshold, auto_top_up_amount, user_id')
        .eq('agent_id', agentId)
        .maybeSingle()

      if (wallet?.auto_top_up && balanceAfter < Number(wallet.auto_top_up_threshold ?? 10)) {
        const amount = Number(wallet.auto_top_up_amount ?? 50)
        await grantAgentCredits(supabase, agentId, amount, 'auto_top_up')
      }
    } catch (e) {
      // Log but don't fail the original transaction
      console.error('[auto-top-up] failed:', e)
    }
  }

  return {
    transactionId: result?.transaction_id ?? null,
    balanceAfter: result?.balance_after ?? null,
    success: result?.success ?? false,
    error: result?.success ? undefined : 'Insufficient agent credits',
  }
}

export async function finalizeTransaction(
  supabase: SupabaseClient,
  transactionId: string,
  status: 'completed' | 'failed' | 'refunded',
  responsePayload?: Record<string, unknown>,
  auditHash?: string,
): Promise<void> {
  await supabase.rpc('finalize_agent_transaction', {
    p_transaction_id: transactionId,
    p_status: status,
    p_response_payload: responsePayload ?? {},
    p_audit_hash: auditHash ?? null,
  })
}

export async function getAgentBalance(
  supabase: SupabaseClient,
  agentId: string,
): Promise<number> {
  const { data } = await supabase
    .from('agent_wallets')
    .select('balance')
    .eq('agent_id', agentId)
    .maybeSingle()

  return Number(data?.balance ?? 0)
}

export async function grantAgentCredits(
  supabase: SupabaseClient,
  agentId: string,
  amount: number,
  source: string = 'purchase',
): Promise<number> {
  const { data, error } = await supabase.rpc('grant_agent_credits', {
    p_agent_id: agentId,
    p_amount: amount,
    p_source: source,
  })

  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

export function formatCostResponse(cost: CostEstimate): Record<string, unknown> {
  return {
    cost_basis: {
      action: cost.action,
      credits: cost.creditCost,
      unit: cost.unit,
      description: cost.description,
    },
  }
}
