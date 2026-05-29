import type { LLMClient } from "../agents/llm/index.ts";
import { createDeepSeekClientFromEnv } from "../agents/llm/index.ts";

const WEBSITE_SCRAPE_TIMEOUT_MS = 15_000;

export interface CompanyWebsiteProfile {
  company_name: string | null;
  website_url: string;
  domain: string | null;
  industry: string | null;
  description: string;
  source: "firecrawl" | "fallback";
}

export interface AnalyzeCompanyWebsiteOptions {
  websiteUrl: unknown;
  companyHint?: string;
  allowedIndustries?: string[];
  fetchImpl?: typeof fetch;
  llm?: LLMClient;
}

export function normalizeCompanyWebsiteUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".") || url.hostname === "localhost") return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function analyzeCompanyWebsite(
  opts: AnalyzeCompanyWebsiteOptions,
): Promise<CompanyWebsiteProfile | null> {
  const websiteUrl = normalizeCompanyWebsiteUrl(opts.websiteUrl);
  if (!websiteUrl) return null;
  const markdown = await scrapeWebsiteMarkdown(websiteUrl, opts.fetchImpl);
  if (!markdown) return null;

  const allowed = (opts.allowedIndustries ?? []).filter(Boolean);
  const fallbackName = opts.companyHint?.trim() || companyNameFromHost(websiteUrl);
  const llm = opts.llm ?? createOptionalLlm();
  if (llm) {
    try {
      const response = await llm.complete({
        temperature: 0.1,
        max_tokens: 420,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You analyze a company website for B2B GTM onboarding. Return only factual JSON. Do not invent details.",
          },
          {
            role: "user",
            content: [
              `Website: ${websiteUrl}`,
              opts.companyHint ? `Company hint: ${opts.companyHint}` : "",
              allowed.length
                ? `Industry must be exactly one of: ${allowed.join(", ")}. Use null if none fit.`
                : "Industry should be a short lowercase category, or null.",
              "",
              "Website markdown:",
              markdown.slice(0, 7000),
              "",
              'Return {"company_name": string|null, "industry": string|null, "description": string}.',
              "Description must be 2-4 plain-English sentences covering what the company sells, who it helps, and the outcome.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      });
      const parsed = parseJsonObject(response.content);
      const description = cleanDescription(parsed.description) ?? fallbackDescription(markdown);
      if (description) {
        const industry =
          typeof parsed.industry === "string" && parsed.industry.trim()
            ? allowed.length > 0 && !allowed.includes(parsed.industry.trim())
              ? null
              : parsed.industry.trim()
            : null;
        return {
          company_name: cleanName(parsed.company_name) ?? (fallbackName || null),
          website_url: websiteUrl,
          domain: domainFromUrl(websiteUrl),
          industry,
          description,
          source: "firecrawl",
        };
      }
    } catch {
      // Fall through to deterministic extraction.
    }
  }

  const description = fallbackDescription(markdown);
  if (!description) return null;
  return {
    company_name: fallbackName || null,
    website_url: websiteUrl,
    domain: domainFromUrl(websiteUrl),
    industry: null,
    description,
    source: "fallback",
  };
}

async function scrapeWebsiteMarkdown(
  websiteUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<string | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey) return null;
  const endpoint =
    process.env.FIRECRAWL_API_URL?.trim() ||
    "https://api.firecrawl.dev/v2/scrape";
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: websiteUrl,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
      signal: AbortSignal.timeout(WEBSITE_SCRAPE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      data?: { markdown?: string };
      markdown?: string;
    };
    const markdown = (json.data?.markdown ?? json.markdown ?? "").trim();
    return markdown.length >= 120 ? markdown : null;
  } catch {
    return null;
  }
}

function createOptionalLlm(): LLMClient | null {
  if (!process.env.DEEPSEEK_API_KEY?.trim()) return null;
  return createDeepSeekClientFromEnv({ timeoutMs: 25_000, retries: 1 });
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
}

function cleanName(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null;
}

function cleanDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").replace(/^["'\s]+|["'\s]+$/g, "").trim();
  return cleaned.length >= 20 ? cleaned.slice(0, 1200) : null;
}

function fallbackDescription(markdown: string): string | null {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[#>*_`|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = plain
    .split(/(?<=[.!?])\s+/)
    .map(cleanDescription)
    .filter((sentence): sentence is string => Boolean(sentence))
    .filter((sentence) => !/^(home|privacy|terms|copyright|login|sign up)\b/i.test(sentence));
  return cleanDescription(sentences.slice(0, 3).join(" "));
}

function domainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function companyNameFromHost(url: string): string {
  const domain = domainFromUrl(url);
  const stem = domain?.split(".")[0]?.replace(/[-_]+/g, " ") ?? "";
  return stem.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
