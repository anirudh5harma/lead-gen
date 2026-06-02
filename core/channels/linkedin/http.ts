import type {
  LinkedInTransport,
  LinkedInTransportResult,
} from "./types.ts";
import {
  LinkedInTransportError,
  type LinkedInTransportErrorReason,
} from "./types.ts";

export interface HttpLinkedInTransportOptions {
  endpoint: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export function createHttpLinkedInTransport(
  opts: HttpLinkedInTransportOptions,
): LinkedInTransport {
  const endpoint = opts.endpoint.trim();
  const apiKey = opts.apiKey.trim();
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (!endpoint) {
    throw new LinkedInTransportError(
      "provider_error_permanent",
      "LinkedIn provider endpoint is not configured.",
    );
  }
  if (!apiKey) {
    throw new LinkedInTransportError(
      "provider_error_permanent",
      "LinkedIn provider API key is not configured.",
    );
  }

  return {
    async send(envelope) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(envelope),
      });
      const text = await response.text();
      const body = parseJsonRecord(text);
      if (!response.ok) {
        throw new LinkedInTransportError(
          httpErrorReason(response.status),
          providerErrorMessage(response.status, body, text),
          {
            retry_after: retryAfter(response.headers),
            detail: textField(body.detail) ?? textField(body.error) ?? (text || null),
          },
        );
      }
      const external_id = textField(body.external_id) ?? textField(body.externalId);
      if (!external_id) {
        throw new LinkedInTransportError(
          "provider_error_permanent",
          "LinkedIn provider response did not include external_id.",
          { detail: text || null },
        );
      }
      return { external_id } satisfies LinkedInTransportResult;
    },
  };
}

export function createUnconfiguredLinkedInTransport(): LinkedInTransport {
  return {
    async send() {
      throw new LinkedInTransportError(
        "provider_error_permanent",
        "LinkedIn provider transport is not configured.",
      );
    },
  };
}

function httpErrorReason(status: number): LinkedInTransportErrorReason {
  if (status === 401 || status === 403) return "needs_reauth";
  if (status === 409 || status === 423) return "suspended";
  if (status === 410) return "disconnected";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_error_transient";
  return "provider_error_permanent";
}

function retryAfter(headers: Headers): string | null {
  const raw = headers.get("Retry-After");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return new Date(Date.now() + seconds * 1000).toISOString();
  }
  const asDate = new Date(raw);
  return Number.isNaN(asDate.getTime()) ? null : asDate.toISOString();
}

function providerErrorMessage(
  status: number,
  body: Record<string, unknown>,
  text: string,
): string {
  return (
    textField(body.message) ??
    textField(body.error) ??
    (text || `LinkedIn provider returned HTTP ${status}`)
  );
}

function parseJsonRecord(text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function textField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
