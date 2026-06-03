import type { Signal } from "../primitives/index.ts";

export interface ExaSignalInfluence {
  provider: "exa";
  signal_id: string;
  source_id: string | null;
  request_id: string | null;
  external_id: string | null;
  url: string | null;
  evidence_urls: string[];
}

export function exaInfluenceFromSignal(signal: Signal): ExaSignalInfluence | null {
  const provider = stringField(signal.provenance.provider) ?? stringField(signal.properties.source);
  const adapter = stringField(signal.provenance.adapter) ?? stringField(signal.properties.adapter);
  if (provider !== "exa" && adapter !== "exa") return null;
  const urls = uniqueStrings([
    signal.url,
    stringField(signal.provenance.url),
    stringField(signal.properties.url),
    stringField(signal.provenance.external_id),
  ]);
  return {
    provider: "exa",
    signal_id: signal.id,
    source_id: signal.source_id,
    request_id: stringField(signal.provenance.request_id),
    external_id: stringField(signal.provenance.external_id),
    url: urls[0] ?? null,
    evidence_urls: urls,
  };
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = value?.trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}
