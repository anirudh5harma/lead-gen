export type AutoDiscoveredSourceAdapter =
  | "rss"
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable";

export interface AutoDiscoveredSignalSource {
  adapter: AutoDiscoveredSourceAdapter;
  name: string;
  url?: string;
  board_slug?: string;
  company_name?: string;
  company_domain?: string;
  signal_kind: "hiring" | "press_mention";
  poll_interval_minutes: number;
  source_tier: "official";
  source_reason: string;
}

export interface DiscoverCompanySourcesInput {
  company_name: string;
  website_url?: string | null;
  fetchImpl?: typeof fetch;
  timeout_ms?: number;
}

const DEFAULT_TIMEOUT_MS = 4_000;
const MAX_PAGES = 4;

interface FetchedPage {
  url: string;
  html: string;
}

export async function discoverCompanyOwnedSignalSources(
  input: DiscoverCompanySourcesInput,
): Promise<AutoDiscoveredSignalSource[]> {
  const website = normalizeUrl(input.website_url);
  if (!website) return [];
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const timeoutMs = Math.max(500, Math.min(input.timeout_ms ?? DEFAULT_TIMEOUT_MS, 10_000));
  const pages: FetchedPage[] = [];
  const first = await fetchHtml(fetchImpl, website, timeoutMs);
  if (first) pages.push(first);

  const homepageLinks = first ? extractLinks(first.html, first.url) : [];
  const candidates = [
    ...homepageLinks.filter(isCareersLikeUrl),
    new URL("/careers", website).toString(),
    new URL("/jobs", website).toString(),
  ];
  const followUpUrls = unique(candidates).slice(0, MAX_PAGES - pages.length);
  const followUpPages = await Promise.all(
    followUpUrls.map((url) => fetchHtml(fetchImpl, url, timeoutMs)),
  );
  for (const page of followUpPages) {
    if (page) pages.push(page);
  }

  const discovered: AutoDiscoveredSignalSource[] = [];
  for (const page of pages) {
    for (const feedUrl of extractFeedUrls(page.html, page.url)) {
      discovered.push({
        adapter: "rss",
        name: `${input.company_name} official updates`,
        url: feedUrl,
        company_name: input.company_name,
        company_domain: domainFromUrl(website) ?? undefined,
        signal_kind: isCareersLikeUrl(feedUrl) ? "hiring" : "press_mention",
        poll_interval_minutes: isCareersLikeUrl(feedUrl) ? 360 : 60,
        source_tier: "official",
        source_reason: "autodiscovered_rss_or_atom",
      });
    }
    for (const link of extractLinks(page.html, page.url)) {
      const ats = atsSourceFromUrl(link, input.company_name, website);
      if (ats) discovered.push(ats);
    }
  }

  return dedupeSources(discovered).slice(0, 8);
}

export function atsSourceFromUrl(
  rawUrl: string,
  companyName: string,
  websiteUrl?: string | null,
): AutoDiscoveredSignalSource | null {
  const url = normalizeUrl(rawUrl);
  if (!url) return null;
  const parsed = new URL(url);
  const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const parts = parsed.pathname.split("/").filter(Boolean);
  const companyDomain = domainFromUrl(websiteUrl) ?? undefined;

  if (hostname === "boards.greenhouse.io" || hostname === "job-boards.greenhouse.io") {
    const slug = parts[0];
    if (!slug) return null;
    return jobBoardSource("greenhouse", slug, companyName, companyDomain);
  }
  if (hostname === "boards-api.greenhouse.io" && parts[0] === "v1" && parts[1] === "boards") {
    const slug = parts[2];
    if (!slug) return null;
    return jobBoardSource("greenhouse", slug, companyName, companyDomain);
  }
  if (hostname === "jobs.lever.co") {
    const slug = parts[0];
    if (!slug) return null;
    return jobBoardSource("lever", slug, companyName, companyDomain);
  }
  if (hostname === "api.lever.co" && parts[0] === "v0" && parts[1] === "postings") {
    const slug = parts[2];
    if (!slug) return null;
    return jobBoardSource("lever", slug, companyName, companyDomain);
  }
  if (hostname === "jobs.ashbyhq.com") {
    const slug = parts[0];
    if (!slug) return null;
    return jobBoardSource("ashby", slug, companyName, companyDomain);
  }
  if (hostname === "api.ashbyhq.com" && parts.includes("job-board")) {
    const slug = parts[parts.indexOf("job-board") + 1];
    if (!slug) return null;
    return jobBoardSource("ashby", slug, companyName, companyDomain);
  }
  if (hostname === "apply.workable.com") {
    const slug = parts[0] === "api" ? parts[3] : parts[0];
    if (!slug || slug === "jobs") return null;
    return jobBoardSource("workable", slug, companyName, companyDomain);
  }
  return null;
}

function jobBoardSource(
  adapter: Exclude<AutoDiscoveredSourceAdapter, "rss">,
  slug: string,
  companyName: string,
  companyDomain?: string,
): AutoDiscoveredSignalSource {
  return {
    adapter,
    name: `${companyName} ${adapterTitle(adapter)} hiring`,
    board_slug: slug,
    company_name: companyName,
    company_domain: companyDomain,
    signal_kind: "hiring",
    poll_interval_minutes: 360,
    source_tier: "official",
    source_reason: "autodiscovered_careers_ats",
  };
}

function adapterTitle(adapter: Exclude<AutoDiscoveredSourceAdapter, "rss">): string {
  switch (adapter) {
    case "greenhouse":
      return "Greenhouse";
    case "lever":
      return "Lever";
    case "ashby":
      return "Ashby";
    case "workable":
      return "Workable";
  }
}

async function fetchHtml(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<FetchedPage | null> {
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Bombsell-source-discovery/1.0 (+https://www.bombsell.com)",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/html|xml|text/i.test(contentType)) return null;
    return { url: response.url || url, html: await response.text() };
  } catch {
    return null;
  }
}

function extractFeedUrls(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const linkRe = /<link\b[^>]*>/gi;
  for (const [tag] of html.matchAll(linkRe)) {
    if (!/\brel\s*=\s*["'][^"']*alternate/i.test(tag)) continue;
    if (!/\btype\s*=\s*["'](?:application\/(?:rss|atom)\+xml|application\/xml|text\/xml)/i.test(tag)) {
      continue;
    }
    const href = attr(tag, "href");
    const absolute = absolutize(href, baseUrl);
    if (absolute) urls.push(absolute);
  }
  for (const link of extractLinks(html, baseUrl)) {
    if (/\b(feed|rss|atom)\b/i.test(link) && /\.(xml|rss|atom)(?:[?#].*)?$/i.test(link)) {
      urls.push(link);
    }
  }
  return unique(urls);
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const anchorRe = /<a\b[^>]*>/gi;
  for (const [tag] of html.matchAll(anchorRe)) {
    const absolute = absolutize(attr(tag, "href"), baseUrl);
    if (absolute) links.push(absolute);
  }
  return unique(links);
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(re);
  return match?.[2] ?? match?.[3] ?? match?.[4] ?? null;
}

function isCareersLikeUrl(url: string): boolean {
  return /\/(careers?|jobs?|join-us|work-with-us)\b/i.test(url) ||
    /greenhouse|lever\.co|ashbyhq|workable/i.test(url);
}

function dedupeSources(
  sources: AutoDiscoveredSignalSource[],
): AutoDiscoveredSignalSource[] {
  const seen = new Set<string>();
  const out: AutoDiscoveredSignalSource[] = [];
  for (const source of sources) {
    const key = source.adapter === "rss"
      ? `${source.adapter}:${source.url}`
      : `${source.adapter}:${source.board_slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

function absolutize(value: string | null, baseUrl: string): string | null {
  if (!value || value.startsWith("#") || /^mailto:|^tel:|^javascript:/i.test(value)) {
    return null;
  }
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function normalizeUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const withScheme = value.includes("://") ? value : `https://${value}`;
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}

function domainFromUrl(value: string | null | undefined): string | null {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;
  return new URL(normalized).hostname.replace(/^www\./, "").toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
