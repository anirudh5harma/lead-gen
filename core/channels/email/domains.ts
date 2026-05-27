import { z } from "zod";

const ResendDomainRecord = z.object({
  record: z.string(),
  name: z.string(),
  type: z.string(),
  value: z.string(),
  status: z.string().nullable().optional(),
  priority: z.number().int().nullable().optional(),
  ttl: z.string().nullable().optional(),
});

const ResendDomain = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.string(),
  region: z.string().nullable().optional(),
  records: z.array(ResendDomainRecord).default([]),
});

const ResendDomainList = z.object({
  data: z.array(ResendDomain),
});

export interface EmailDomainDnsRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  status?: string | null;
  priority?: number | null;
  ttl?: string | null;
}

export interface EmailDomainSnapshot {
  provider_domain_id: string;
  domain: string;
  status: string;
  records: EmailDomainDnsRecord[];
  region?: string | null;
}

export interface EmailDomainTransport {
  provision(domain: string): Promise<EmailDomainSnapshot>;
  verify(provider_domain_id: string): Promise<EmailDomainSnapshot>;
  retrieve(provider_domain_id: string): Promise<EmailDomainSnapshot>;
}

export interface ResendDomainTransportOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

function snapshot(input: z.infer<typeof ResendDomain>): EmailDomainSnapshot {
  return {
    provider_domain_id: input.id,
    domain: input.name,
    status: input.status,
    records: input.records,
    region: input.region ?? null,
  };
}

export function createResendDomainTransport(
  opts: ResendDomainTransportOptions,
): EmailDomainTransport {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const baseUrl = opts.baseUrl ?? "https://api.resend.com";

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "Bombsell/0.1",
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Resend domain request failed (${response.status}): ${text.slice(0, 500)}`);
    }
    return response.json();
  }

  async function retrieve(provider_domain_id: string): Promise<EmailDomainSnapshot> {
    return snapshot(
      ResendDomain.parse(
        await request(`/domains/${encodeURIComponent(provider_domain_id)}`),
      ),
    );
  }

  return {
    async provision(domain) {
      const existing = ResendDomainList.parse(await request("/domains")).data.find(
        (candidate) => candidate.name.toLowerCase() === domain.toLowerCase(),
      );
      if (existing) return retrieve(existing.id);
      return snapshot(
        ResendDomain.parse(
          await request("/domains", {
            method: "POST",
            body: JSON.stringify({
              name: domain,
              tls: "enforced",
              capabilities: { sending: "enabled", receiving: "disabled" },
            }),
          }),
        ),
      );
    },

    async verify(provider_domain_id) {
      await request(`/domains/${encodeURIComponent(provider_domain_id)}/verify`, {
        method: "POST",
      });
      return retrieve(provider_domain_id);
    },

    retrieve,
  };
}
