import type {
  CompletionRequest,
  CompletionResponse,
  LLMClient,
} from "./types.ts";

/**
 * DeepSeek client. DeepSeek's API is OpenAI-compatible
 * (POST /v1/chat/completions); this implementation uses `fetch` directly
 * to avoid pulling in the openai SDK as a dependency.
 *
 * Defaults (overridable via opts or env):
 *   - baseUrl        : https://api.deepseek.com/v1
 *   - defaultModel   : process.env.DEEPSEEK_MODEL ?? "deepseek-v4-pro"
 *   - timeoutMs      : 60_000
 *   - retries        : 2  (so 3 total attempts on 429 / 5xx / network)
 *
 * Retry policy: linear-then-exponential backoff with `Retry-After` honoured
 * for 429s. 4xx other than 429 fail fast (caller bug, not a transient).
 */

export interface DeepSeekOptions {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  timeoutMs?: number;
  retries?: number;
  /** Inject a fetch impl (tests). Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export class DeepSeekError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`DeepSeek API error (status ${status}): ${body.slice(0, 500)}`);
    this.status = status;
    this.body = body;
    this.name = "DeepSeekError";
  }
}

interface DeepSeekResponseBody {
  model: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function createDeepSeekClient(opts: DeepSeekOptions): LLMClient {
  const baseUrl = (opts.baseUrl ?? "https://api.deepseek.com/v1").replace(/\/$/, "");
  const defaultModel =
    opts.defaultModel ?? process.env.DEEPSEEK_MODEL ?? "deepseek-v4-pro";
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const retries = opts.retries ?? 2;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  async function complete(req: CompletionRequest): Promise<CompletionResponse> {
    const model = req.model ?? defaultModel;
    const body = JSON.stringify({
      model,
      messages: req.messages,
      ...(req.temperature !== undefined && { temperature: req.temperature }),
      ...(req.max_tokens !== undefined && { max_tokens: req.max_tokens }),
      ...(req.stop && { stop: req.stop }),
      ...(req.response_format && { response_format: req.response_format }),
    });

    let lastError: unknown;
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onUserAbort = () => controller.abort();
      req.abort_signal?.addEventListener("abort", onUserAbort);

      try {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${opts.apiKey}`,
          },
          body,
          signal: controller.signal,
        });

        const transient =
          response.status === 429 ||
          response.status === 408 ||
          response.status >= 500;

        if (!response.ok) {
          const text = await response.text();
          if (transient && attempt <= retries) {
            const retryAfter = Number(response.headers.get("retry-after"));
            const wait = Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : 500 * 2 ** (attempt - 1);
            lastError = new DeepSeekError(response.status, text);
            await delay(wait);
            continue;
          }
          throw new DeepSeekError(response.status, text);
        }

        const json = (await response.json()) as DeepSeekResponseBody;
        const choice = json.choices[0];
        if (!choice) {
          throw new DeepSeekError(200, "response had no choices");
        }
        return {
          content: choice.message.content ?? "",
          model: json.model,
          finish_reason: choice.finish_reason,
          usage: {
            prompt_tokens: json.usage?.prompt_tokens ?? 0,
            completion_tokens: json.usage?.completion_tokens ?? 0,
            total_tokens: json.usage?.total_tokens ?? 0,
          },
        };
      } catch (err) {
        // AbortError on the internal timeout is transient — retry. AbortError
        // triggered by the caller's abort_signal is NOT — fail fast.
        const isAbort = err instanceof Error && err.name === "AbortError";
        const userAborted = req.abort_signal?.aborted ?? false;
        if (isAbort && !userAborted && attempt <= retries) {
          lastError = new DeepSeekError(408, "request timed out");
          await delay(500 * 2 ** (attempt - 1));
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
        req.abort_signal?.removeEventListener("abort", onUserAbort);
      }
    }
    throw lastError ?? new DeepSeekError(0, "exhausted retries");
  }

  return { complete };
}

/**
 * Construct a client from `DEEPSEEK_API_KEY` in the environment. Throws if
 * unset. Most call sites use this; tests inject a configured client via
 * `createDeepSeekClient` directly.
 */
export function createDeepSeekClientFromEnv(
  overrides: Partial<DeepSeekOptions> = {},
): LLMClient {
  const apiKey = overrides.apiKey ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY is not set. The default LLM client needs a DeepSeek key.",
    );
  }
  return createDeepSeekClient({ ...overrides, apiKey });
}
