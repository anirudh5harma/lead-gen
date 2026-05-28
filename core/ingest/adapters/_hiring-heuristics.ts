/**
 * Shared hiring-signal heuristics. ATS adapters return structured rows but
 * the upstream taxonomies differ — Greenhouse uses "departments", Lever
 * "categories.team", Ashby "department", Workable "department". The
 * function + seniority inference is identical across providers; centralise
 * it here so adding a new ATS is the same shape every time.
 */

// Order matters: more specific keywords first. `designer` precedes the
// marketing regex because "Brand Designer" should classify as design,
// not as marketing-brand. Conversely "Brand Manager" should land in
// marketing — so `brand` only appears under marketing.
const FUNCTION_KEYWORDS: Array<[string, RegExp]> = [
  ["engineering", /(engineer|developer|software|platform|infra|sre|data)/i],
  ["product", /(product\s*manager|product\s*designer|product\s*lead)/i],
  ["design", /(designer|\bux\b|\bui\b)/i],
  ["sales", /(sales|account|business\s*development|bdr|sdr)/i],
  ["marketing", /(marketing|growth|\bbrand\b|content)/i],
  ["operations", /(operations|ops|finance|legal|\bhr\b|people)/i],
  ["support", /(support|customer\s*success|\bcs\b)/i],
];

/**
 * Infer a coarse function from a haystack of (departments + title).
 * Returns null when nothing matches.
 */
export function inferFunction(parts: ReadonlyArray<string | null | undefined>): string | null {
  const haystack = parts.filter(Boolean).join(" ").toLowerCase();
  for (const [name, re] of FUNCTION_KEYWORDS) {
    if (re.test(haystack)) return name;
  }
  return null;
}

const SENIORITY_RULES: Array<[string, RegExp]> = [
  ["c_level", /\b(chief|cxo|ceo|cto|cfo|coo|cmo|cro|cpo)\b/i],
  ["vp", /\b(vp|vice\s*president)\b/i],
  ["director", /\b(director|head\s*of)\b/i],
  ["principal", /\b(principal|distinguished)\b/i],
  ["staff", /\b(staff)\b/i],
  ["senior", /\b(senior|sr\.)\b/i,],
  ["lead", /\b(lead|team\s*lead)\b/i],
  ["mid", /\b(mid\s*level|ii\b|iii\b)\b/i],
  ["junior", /\b(junior|jr\.|entry\s*level|intern)\b/i],
];

/**
 * Heuristic seniority class from a job title.
 */
export function inferSeniority(title: string): string | null {
  for (const [level, re] of SENIORITY_RULES) {
    if (re.test(title)) return level;
  }
  return null;
}

/**
 * Lightweight HTML → text. Each ATS sends some HTML in their job
 * descriptions; the intent classifier sees the text form, so a clean
 * approximation suffices. body_html is preserved separately when the
 * downstream needs to render.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
