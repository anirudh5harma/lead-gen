import type { Pool } from "pg";
import type { EventBus } from "../../substrate/events/index.ts";
import type {
  CompletionRequest,
  CompletionResponse,
  LLMClient,
} from "./types.ts";
import {
  DEEPSEEK_V4_FLASH_MODEL,
  DEEPSEEK_V4_PRO_MODEL,
} from "./model-policy.ts";

export interface BudgetedLLMClientOptions {
  llm: LLMClient;
  pool: Pool;
  bus?: EventBus;
  workspace_id: string;
  purpose: string;
  defaultDailyTokenCap?: number;
  estimateTokens?: (req: CompletionRequest) => number;
  estimateCostUsd?: (res: CompletionResponse) => number | null;
}

export class LLMBudgetExceededError extends Error {
  readonly workspace_id: string;
  readonly purpose: string;
  readonly token_cap: number;
  readonly used_tokens: number;
  readonly requested_tokens: number;
  readonly retry_after: string;

  constructor(input: {
    workspace_id: string;
    purpose: string;
    token_cap: number;
    used_tokens: number;
    requested_tokens: number;
    retry_after: string;
  }) {
    super(
      `LLM daily token budget exceeded for ${input.workspace_id}: ${input.used_tokens}/${input.token_cap} used, ${input.requested_tokens} requested`,
    );
    this.name = "LLMBudgetExceededError";
    this.workspace_id = input.workspace_id;
    this.purpose = input.purpose;
    this.token_cap = input.token_cap;
    this.used_tokens = input.used_tokens;
    this.requested_tokens = input.requested_tokens;
    this.retry_after = input.retry_after;
  }
}

export function isLLMBudgetExceededError(err: unknown): err is LLMBudgetExceededError {
  return err instanceof LLMBudgetExceededError;
}

export function estimateCompletionTokens(req: CompletionRequest): number {
  const promptChars = req.messages.reduce((sum, msg) => sum + msg.content.length, 0);
  const promptTokens = Math.ceil(promptChars / 4);
  return promptTokens + (req.max_tokens ?? 1024);
}

export function estimateDeepSeekCostUsd(res: CompletionResponse): number | null {
  const defaults = defaultDeepSeekPricesUsdPerMillion(res.model);
  const promptPerMillion = Number(
    process.env.DEEPSEEK_PROMPT_USD_PER_MILLION ?? defaults.prompt,
  );
  const completionPerMillion = Number(
    process.env.DEEPSEEK_COMPLETION_USD_PER_MILLION ?? defaults.completion,
  );
  if (!Number.isFinite(promptPerMillion) || !Number.isFinite(completionPerMillion)) {
    return null;
  }
  return (
    (res.usage.prompt_tokens / 1_000_000) * promptPerMillion +
    (res.usage.completion_tokens / 1_000_000) * completionPerMillion
  );
}

function defaultDeepSeekPricesUsdPerMillion(
  model: string,
): { prompt: number; completion: number } {
  if (model === DEEPSEEK_V4_PRO_MODEL) return { prompt: 0.435, completion: 0.87 };
  if (model === DEEPSEEK_V4_FLASH_MODEL) return { prompt: 0.14, completion: 0.28 };
  return { prompt: 0.14, completion: 0.28 };
}

export function createBudgetedLLMClient(opts: BudgetedLLMClientOptions): LLMClient {
  const estimateTokens = opts.estimateTokens ?? estimateCompletionTokens;
  const estimateCostUsd = opts.estimateCostUsd ?? estimateDeepSeekCostUsd;
  const defaultDailyTokenCap =
    opts.defaultDailyTokenCap ??
    Number(process.env.BOMBSELL_LLM_DAILY_TOKEN_CAP ?? 100_000);

  async function complete(req: CompletionRequest): Promise<CompletionResponse> {
    const requested = estimateTokens(req);
    const budget = await loadBudget(opts.pool, opts.workspace_id, defaultDailyTokenCap);
    if (budget.cap >= 0 && budget.used + requested > budget.cap) {
      const retry_after = nextBudgetWindow().toISOString();
      await opts.bus?.publish({
        workspace_id: opts.workspace_id,
        event_type: "llm.call.deferred",
        source: "system",
        producer_ref: `llm:${opts.purpose}`,
        payload: {
          purpose: opts.purpose,
          reason: "daily_token_cap_exhausted",
          token_cap: budget.cap,
          used_tokens: budget.used,
          requested_tokens: requested,
          retry_after,
        },
      });
      throw new LLMBudgetExceededError({
        workspace_id: opts.workspace_id,
        purpose: opts.purpose,
        token_cap: budget.cap,
        used_tokens: budget.used,
        requested_tokens: requested,
        retry_after,
      });
    }

    const response = await opts.llm.complete(req);
    const estimatedCost = estimateCostUsd(response);
    await opts.pool.query(
      `insert into workspace_llm_usage (
         workspace_id, purpose, model, prompt_tokens, completion_tokens,
         total_tokens, estimated_cost_usd, properties
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        opts.workspace_id,
        opts.purpose,
        response.model,
        response.usage.prompt_tokens,
        response.usage.completion_tokens,
        response.usage.total_tokens,
        estimatedCost,
        JSON.stringify({ finish_reason: response.finish_reason }),
      ],
    );
    await opts.bus?.publish({
      workspace_id: opts.workspace_id,
      event_type: "llm.usage.recorded",
      source: "system",
      producer_ref: `llm:${opts.purpose}`,
      payload: {
        purpose: opts.purpose,
        model: response.model,
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
        total_tokens: response.usage.total_tokens,
        estimated_cost_usd: estimatedCost,
      },
    });
    return response;
  }

  return { complete };
}

async function loadBudget(
  pool: Pool,
  workspace_id: string,
  defaultDailyTokenCap: number,
): Promise<{ cap: number; used: number }> {
  const budget = await pool.query<{
    daily_token_cap: string | null;
    used_tokens: string;
  }>(
    `select coalesce(
              settings #>> '{llm,daily_token_cap}',
              settings->>'llm_daily_token_cap'
            ) as daily_token_cap,
            coalesce((
              select sum(total_tokens)::text
                from workspace_llm_usage
               where workspace_id = workspaces.id
                 and created_at >= now() - interval '24 hours'
            ), '0') as used_tokens
       from workspaces
      where id = $1`,
    [workspace_id],
  );
  const row = budget.rows[0];
  const configuredCap = row?.daily_token_cap == null ? NaN : Number(row.daily_token_cap);
  const cap = Number.isFinite(configuredCap)
    ? Math.max(0, Math.trunc(configuredCap))
    : Math.max(0, Math.trunc(defaultDailyTokenCap));
  const used = Math.max(0, Math.trunc(Number(row?.used_tokens ?? 0)));
  return { cap, used };
}

function nextBudgetWindow(): Date {
  const now = new Date();
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}
