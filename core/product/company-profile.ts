import type { LLMClient } from "../agents/llm/index.ts";
import { createDeepSeekClientFromEnv } from "../agents/llm/index.ts";
import { normalizePublicHttpUrl } from "../../lib/network/public-url.ts";

const WEBSITE_SCRAPE_TIMEOUT_MS = 15_000;
const DIRECT_FETCH_TIMEOUT_MS = 10_000;

interface WebsiteContent {
  markdown: string;
  source: CompanyWebsiteProfile["source"];
}

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
  return normalizePublicHttpUrl(raw);
}

export async function analyzeCompanyWebsite(
  opts: AnalyzeCompanyWebsiteOptions,
): Promise<CompanyWebsiteProfile | null> {
  const websiteUrl = normalizeCompanyWebsiteUrl(opts.websiteUrl);
  if (!websiteUrl) return null;
  const allowed = (opts.allowedIndustries ?? []).filter(Boolean);
  const fallbackName = opts.companyHint?.trim() || companyNameFromHost(websiteUrl);
  const websiteContent = await scrapeWebsiteContent(websiteUrl, opts.fetchImpl);

  if (!websiteContent) {
    const description = fallbackProfileDescription(fallbackName, websiteUrl);
    return {
      company_name: fallbackName || null,
      website_url: websiteUrl,
      domain: domainFromUrl(websiteUrl),
      industry: null,
      description,
      source: "fallback",
    };
  }
  const { markdown, source } = websiteContent;

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
          source,
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
    source,
  };
}

async function scrapeWebsiteContent(
  websiteUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<WebsiteContent | null> {
  const firecrawl = await scrapeWithFirecrawl(websiteUrl, fetchImpl);
  if (firecrawl) return { markdown: firecrawl, source: "firecrawl" };
  return scrapeDirectHomepage(websiteUrl, fetchImpl);
}

async function scrapeWithFirecrawl(
  websiteUrl: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey) return null;
  const endpoint = process.env.FIRECRAWL_API_URL?.trim() || "https://api.firecrawl.dev/v2/scrape";
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

async function scrapeDirectHomepage(
  websiteUrl: string,
  fetchImpl: typeof fetch,
): Promise<WebsiteContent | null> {
  try {
    const response = await fetchImpl(websiteUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent": "BombsellProfileBot/1.0 (+https://www.bombsell.com)",
      },
      signal: AbortSignal.timeout(DIRECT_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const text = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|text\/plain|application\/xhtml\+xml/i.test(contentType)) {
      return null;
    }
    const extracted = htmlToProfileText(text);
    return extracted.length >= 80
      ? { markdown: extracted, source: "fallback" }
      : null;
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

function fallbackProfileDescription(companyName: string, websiteUrl: string): string {
  const domain = domainFromUrl(websiteUrl) ?? "the supplied website";
  return `Public website profile for ${companyName || domain}. Bombsell could not read enough website content automatically, so this profile starts with the domain and can be refined in Profile.`;
}

function htmlToProfileText(html: string): string {
  const withoutNoise = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  const title = matchTagText(withoutNoise, "title");
  const description = matchMetaContent(withoutNoise, "description");
  const ogDescription = matchMetaContent(withoutNoise, "og:description");
  const headings = [...withoutNoise.matchAll(/<h[1-2]\b[^>]*>([\s\S]*?)<\/h[1-2]>/gi)]
    .slice(0, 4)
    .map((match) => stripHtml(match[1]));
  const body = stripHtml(withoutNoise).slice(0, 4000);
  return [title, description, ogDescription, ...headings, body]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function matchTagText(html: string, tag: string): string | null {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] ? stripHtml(match[1]) : null;
}

function matchMetaContent(html: string, name: string): string | null {
  const escaped = escapeRegExp(name);
  const patterns = [
    new RegExp(`<meta\\b(?=[^>]*(?:name|property)=["']${escaped}["'])(?=[^>]*content=["']([^"']+)["'])[^>]*>`, "i"),
    new RegExp(`<meta\\b(?=[^>]*content=["']([^"']+)["'])(?=[^>]*(?:name|property)=["']${escaped}["'])[^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return null;
}

function stripHtml(html: string): string {
  return decodeHtml(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
