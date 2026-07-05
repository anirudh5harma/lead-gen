const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

export function signalDisplayTitle(value: string, maxLength = 150): string {
  const normalized = decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-|:•·\s]+|[-|:•·\s]+$/g, "")
    .trim();
  if (normalized.length <= maxLength) return normalized;
  const clipped = normalized.slice(0, Math.max(1, maxLength - 1));
  const boundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary > maxLength * 0.6 ? boundary : undefined).trim()}…`;
}

export function signalSourceLabel(input: {
  sourceName?: string | null;
  sourceKind?: string | null;
  url?: string | null;
}): string {
  const name = cleanSourceName(input.sourceName);
  if (name) return name;
  const hostname = hostnameFromUrl(input.url);
  if (hostname) return hostname;
  return (input.sourceKind ?? "Signal")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function contactResolutionStatusLabel(reason: string | null): string {
  if (reason === "no_email_ready_contact") {
    return "No contact with a verified email and LinkedIn profile was found.";
  }
  if (reason === "no_linkedin_ready_contact") {
    return "No contact with a LinkedIn profile was found.";
  }
  if (reason === "email_auto_enrich_disabled") {
    return "Email enrichment is disabled in workspace settings.";
  }
  if (reason?.includes("provider_")) {
    return "A contact provider is temporarily unavailable. Retry later.";
  }
  return "Contact search paused. Retry when ready.";
}

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, key: string) => {
    const lower = key.toLowerCase();
    if (lower.startsWith("#x")) {
      return safeCodePoint(Number.parseInt(lower.slice(2), 16), entity);
    }
    if (lower.startsWith("#")) {
      return safeCodePoint(Number.parseInt(lower.slice(1), 10), entity);
    }
    return NAMED_ENTITIES[lower] ?? entity;
  });
}

function safeCodePoint(value: number, fallback: string): string {
  try {
    return Number.isFinite(value) ? String.fromCodePoint(value) : fallback;
  } catch {
    return fallback;
  }
}

function cleanSourceName(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return signalDisplayTitle(value, 60)
    .replace(/\s+(feed|source)$/i, "")
    .trim() || null;
}

function hostnameFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
