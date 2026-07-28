import { BlockList, isIP } from "node:net";
import { hasValidDnsHostname } from "./hostname.ts";

const NON_PUBLIC_IPS = createNonPublicIpBlockList();

export function normalizePublicHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    const hostname = normalizePublicHostname(url.hostname);
    if (!hostname) return null;
    url.hostname = hostname;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function normalizePublicHostname(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const parsed = new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`,
    );
    const hostname = parsed.hostname.replace(/^www\./, "").replace(/\.$/, "");
    if (!hostname || !hostname.includes(".")) return null;
    if (!hasValidHostnameSyntax(hostname)) return null;
    if (isForbiddenHostname(hostname)) return null;
    return hostname;
  } catch {
    return null;
  }
}

export function publicHostnameFromUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return normalizePublicHostname(new URL(raw).hostname);
  } catch {
    return null;
  }
}

export function publicHostMatches(candidate: string, allowed: string): boolean {
  return candidate === allowed || candidate.endsWith(`.${allowed}`);
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  return !NON_PUBLIC_IPS.check(address, family === 4 ? "ipv4" : "ipv6");
}

function hasValidHostnameSyntax(hostname: string): boolean {
  if (isIP(hostname)) return true;
  return hasValidDnsHostname(hostname);
}

function isForbiddenHostname(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    /^\d+$/.test(hostname)
  ) {
    return true;
  }

  const family = isIP(hostname);
  if (family) return !isPublicIpAddress(hostname);
  return false;
}

function createNonPublicIpBlockList(): BlockList {
  const blockList = new BlockList();
  for (const [network, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ] as const) {
    blockList.addSubnet(network, prefix, "ipv4");
  }
  for (const [network, prefix] of [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001:db8::", 32],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
  ] as const) {
    blockList.addSubnet(network, prefix, "ipv6");
  }
  return blockList;
}
