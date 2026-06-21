/**
 * Shared company-domain normalization for ingestion, graph identity, and
 * contact discovery. `contactDiscoveryDomain` collapses arbitrary subdomains
 * to a registrable/apex domain; `normalizeCompanyDomain` adds the ingest
 * blacklist used when deriving company identity from open-web signals.
 */

const MULTI_PART_PUBLIC_SUFFIXES = new Set([
  "ac.in",
  "ac.uk",
  "co.in",
  "co.jp",
  "co.uk",
  "com.au",
  "com.br",
  "com.sg",
  "com.mx",
  "com.tr",
  "net.au",
  "org.au",
  "org.uk",
]);

const BLOCKED_COMPANY_DOMAINS = new Set([
  "businesswire.com",
  "facebook.com",
  "forbes.com",
  "github.com",
  "globenewswire.com",
  "linkedin.com",
  "medium.com",
  "news.google.com",
  "news.ycombinator.com",
  "old.reddit.com",
  "prnewswire.com",
  "producthunt.com",
  "reddit.com",
  "substack.com",
  "techcrunch.com",
  "theverge.com",
  "twitter.com",
  "x.com",
  "ycombinator.com",
  "youtu.be",
  "youtube.com",
]);

export function contactDiscoveryDomain(
  value: string | null | undefined,
): string | null {
  const raw = cleanString(value)?.toLowerCase();
  if (!raw || raw.includes("@")) return null;
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let hostname: string;
  try {
    hostname = new URL(withProtocol).hostname
      .replace(/\.$/, "")
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return null;
  }
  if (!isUsableDomain(hostname)) return null;
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length <= 2) return hostname;
  const suffix = parts.slice(-2).join(".");
  const threePartSuffix = parts.slice(-3).join(".");
  if (MULTI_PART_PUBLIC_SUFFIXES.has(suffix) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  if (MULTI_PART_PUBLIC_SUFFIXES.has(threePartSuffix) && parts.length >= 4) {
    return parts.slice(-4).join(".");
  }
  return parts.slice(-2).join(".");
}

export function normalizeCompanyDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const domain = contactDiscoveryDomain(value);
  if (!domain) return null;
  return isBlockedCompanyDomain(domain) ? null : domain;
}

export function isBlockedCompanyDomain(domain: string): boolean {
  for (const blocked of BLOCKED_COMPANY_DOMAINS) {
    if (domain === blocked || domain.endsWith(`.${blocked}`)) {
      return true;
    }
  }
  return false;
}

function isUsableDomain(hostname: string): boolean {
  if (!hostname.includes(".")) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const labels = hostname.split(".");
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    return false;
  }
  const tld = labels[labels.length - 1];
  if (!tld || tld.length < 2 || /^\d+$/.test(tld)) return false;
  return true;
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
