import { normalizeCompanyDomain } from "./company-domain.ts";

export type SocialPlatform = "x" | "linkedin";

export interface SocialStructuredInput {
  platform: SocialPlatform;
  query?: string | null;
  source_name?: string | null;
  post_url?: string | null;
  post_type?: string | null;
  author_name?: string | null;
  author_handle?: string | null;
  author_profile_url?: string | null;
  author_kind?: string | null;
  company_name?: string | null;
  company_domain?: string | null;
  matched_keywords?: string[] | null;
  engagement?: Record<string, unknown> | null;
  link_reason?: string | null;
}

export interface SocialCompanyHint {
  name: string;
  domain: string | null;
  source: string;
  confidence: "explicit" | "derived";
}

export function socialCompanyHintFromEvidence(input: {
  title?: string | null;
  content?: string | null;
  highlights?: string[] | null;
}): SocialCompanyHint | null {
  const evidence = [input.title, input.content, ...(input.highlights ?? [])]
    .map(cleanString)
    .filter((value): value is string => Boolean(value));
  const name = firstSocialCompanyName(evidence);
  if (!name) return null;
  return {
    name,
    domain: firstCompanyDomain(evidence),
    source: "social_evidence",
    confidence: "derived",
  };
}

export function socialPlatformFromUrl(url: string | null | undefined): SocialPlatform | null {
  const text = cleanString(url);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (
      (host === "linkedin.com" || host.endsWith(".linkedin.com")) &&
      /\/posts\/|\/feed\/update\/|\/activity-/.test(parsed.pathname)
    ) {
      return "linkedin";
    }
    if (
      (host === "x.com" || host === "twitter.com" || host.endsWith(".x.com") || host.endsWith(".twitter.com")) &&
      /\/status\//.test(parsed.pathname)
    ) {
      return "x";
    }
  } catch {
    return null;
  }
  return null;
}

export function buildSocialStructured(
  input: SocialStructuredInput,
): Record<string, unknown> {
  return compactRecord({
    source: "social",
    platform: input.platform,
    query: cleanString(input.query),
    source_name: cleanString(input.source_name),
    post_url: cleanString(input.post_url),
    post_type: cleanString(input.post_type) ?? "post",
    author_name: cleanString(input.author_name),
    author_handle: cleanString(input.author_handle),
    author_profile_url: cleanString(input.author_profile_url),
    author_kind: cleanString(input.author_kind) ?? "unknown",
    company_name: cleanString(input.company_name),
    company_domain: normalizeCompanyDomain(input.company_domain),
    matched_keywords: cleanedStringArray(input.matched_keywords),
    engagement: compactRecord(input.engagement ?? {}),
    link_reason: cleanString(input.link_reason),
  });
}

export function socialCompanyHintFromStructured(
  structured: Record<string, unknown> | null | undefined,
): SocialCompanyHint | null {
  if (!structured) return null;

  const companyRecord = recordValue(structured.company);
  const explicitName = cleanString(companyRecord?.name) ?? cleanString(structured.company_name);
  const explicitDomain =
    normalizeCompanyDomain(companyRecord?.domain) ??
    normalizeCompanyDomain(structured.company_domain);
  if (explicitName) {
    return {
      name: explicitName,
      domain: explicitDomain,
      source: companyRecord ? "social_structured_company" : "social_company_name",
      confidence: companyRecord ? "explicit" : "derived",
    };
  }

  const authorKind = cleanString(structured.author_kind)?.toLowerCase();
  const authorName = cleanString(structured.author_name);
  if (
    authorName &&
    (authorKind === "company" || authorKind === "brand" || authorKind === "organization")
  ) {
    return {
      name: authorName,
      domain: explicitDomain,
      source: "social_author",
      confidence: explicitDomain ? "explicit" : "derived",
    };
  }

  return null;
}

export function matchedKeywordsFromQuery(
  query: string | null | undefined,
  text: string | null | undefined,
): string[] {
  const cleanQuery = cleanString(query)?.toLowerCase();
  const haystack = cleanString(text)?.toLowerCase();
  if (!cleanQuery || !haystack) return [];

  const phrases = cleanQuery
    .split(/\s+or\s+|\|/i)
    .flatMap((part) => {
      const quoted = [...part.matchAll(/"([^"]+)"/g)].map((match) => match[1]?.trim() ?? "");
      if (quoted.length > 0) return quoted;
      return part.split(/\s+/);
    })
    .map((part) => part.replace(/^[()]+|[()]+$/g, "").trim())
    .filter((part) =>
      part &&
      part.length >= 4 &&
      !part.startsWith("-") &&
      !/[:]/.test(part) &&
      !["lang", "from", "is", "min_faves", "since_time"].includes(part)
    );

  const matches: string[] = [];
  for (const phrase of phrases) {
    if (haystack.includes(phrase.toLowerCase())) matches.push(phrase);
  }
  return [...new Set(matches)].slice(0, 8);
}

function compactRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry == null) continue;
    if (Array.isArray(entry) && entry.length === 0) continue;
    if (
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      Object.keys(entry as Record<string, unknown>).length === 0
    ) {
      continue;
    }
    out[key] = entry;
  }
  return out;
}

function cleanedStringArray(
  value: string[] | null | undefined,
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value.flatMap((item) => {
    const text = cleanString(item);
    return text ? [text] : [];
  });
  return cleaned.length ? cleaned : undefined;
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstSocialCompanyName(evidence: string[]): string | null {
  const patterns = [
    /(?:^|\n)#\s+([^\n]{2,100}?)[\u2019']s Post(?:\n|$)/i,
    /\bpost from ([A-Z][A-Za-z0-9&.\- ]{1,80}?) \(via LinkedIn\)/i,
    /\s\|\s([^|\n]{2,100})\s*$/,
  ];
  for (const text of evidence) {
    for (const pattern of patterns) {
      const candidate = cleanString(text.match(pattern)?.[1]);
      if (candidate && !/^(linkedin|x|twitter)$/i.test(candidate)) return candidate;
    }
  }
  return null;
}

function firstCompanyDomain(evidence: string[]): string | null {
  for (const text of evidence) {
    for (const match of text.matchAll(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+\b/gi)) {
      const domain = normalizeCompanyDomain(match[0]);
      if (domain) return domain;
    }
  }
  return null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
