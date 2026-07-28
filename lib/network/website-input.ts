import { hasValidDnsHostname } from "./hostname.ts";

const RESERVED_HOSTNAME_SUFFIX_PATTERN =
  "(?:[Ll][Oo][Cc][Aa][Ll]|[Ll][Oo][Cc][Aa][Ll][Hh][Oo][Ss][Tt]|[Ii][Nn][Tt][Ee][Rr][Nn][Aa][Ll])";
const PUBLIC_PORT_PATTERN =
  "(?:[0-9]{1,4}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])";

export const PUBLIC_WEBSITE_INPUT_PATTERN =
  `(?:[Hh][Tt][Tt][Pp][Ss]?://)?(?![^\\/?#:]+\\.${RESERVED_HOSTNAME_SUFFIX_PATTERN}\\.?(?::${PUBLIC_PORT_PATTERN})?(?:[\\/?#]|$))(?:[\\p{L}\\p{N}](?:[\\p{L}\\p{N}\\-]{0,61}[\\p{L}\\p{N}])?\\.)+(?:[\\p{L}]{2,63}|xn--[A-Za-z0-9](?:[A-Za-z0-9\\-]{0,57}[A-Za-z0-9]))\\.?(?::${PUBLIC_PORT_PATTERN})?(?:[\\/?#][^\\s]*)?`;

export function normalizeWebsiteInputUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const trimmed = raw.trim();
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/\.$/, "");
    if (!hasValidCompanyHostname(hostname)) return null;
    if (
      hostname.endsWith(".local") ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".internal")
    ) {
      return null;
    }
    url.hostname = hostname;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function hasValidCompanyHostname(hostname: string): boolean {
  if (!hostname.includes(".") || !hasValidDnsHostname(hostname)) return false;
  const topLevelDomain = hostname.split(".").at(-1) ?? "";
  return /^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(topLevelDomain);
}
