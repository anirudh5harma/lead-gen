import type { EmailTransport, EmailTransportResult, EmailSendEnvelope } from "./types.ts";

export interface ResendEmailTransportOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function createResendEmailTransport(
  opts: ResendEmailTransportOptions,
): EmailTransport {
  const baseUrl = (opts.baseUrl ?? "https://api.resend.com").replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  return {
    async send(envelope: EmailSendEnvelope): Promise<EmailTransportResult> {
      const response = await fetchImpl(`${baseUrl}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": envelope.idempotency_key,
        },
        body: JSON.stringify({
          from: envelope.from,
          to: [envelope.to],
          subject: envelope.subject,
          text: envelope.body,
          headers: {
            "X-Bombsell-Channel-Account": envelope.account_id,
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Resend email send failed (${response.status}): ${text.slice(0, 500)}`);
      }

      const json = (await response.json()) as { id?: string };
      if (!json.id) {
        throw new Error("Resend email send response did not include an id");
      }
      return { external_id: json.id };
    },
  };
}
