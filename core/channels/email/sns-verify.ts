import { createVerify } from "node:crypto";
import type { SnsMessageEnvelope } from "./ses-inbound.ts";

export class SnsVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnsVerificationError";
  }
}

export class SnsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnsConfigurationError";
  }
}

export interface VerifySnsMessageOptions {
  allowedTopicArns: readonly string[];
  fetchImpl?: typeof fetch;
}

export function allowedSnsTopicArns(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return (env.AWS_SNS_TOPIC_ARNS ?? "")
    .split(",")
    .map((topic) => topic.trim())
    .filter(Boolean);
}

/**
 * Authenticates SNS before channel processing. AWS requires the exact
 * message-type field list and ordering used here.
 */
export async function verifySnsMessage(
  envelope: SnsMessageEnvelope,
  opts: VerifySnsMessageOptions,
): Promise<void> {
  if (opts.allowedTopicArns.length === 0) {
    throw new SnsConfigurationError("AWS_SNS_TOPIC_ARNS is not configured");
  }
  if (!envelope.TopicArn || !opts.allowedTopicArns.includes(envelope.TopicArn)) {
    throw new SnsVerificationError("SNS message came from an untrusted topic");
  }
  if (!envelope.SigningCertURL || !validSnsUrl(envelope.SigningCertURL, ".pem")) {
    throw new SnsVerificationError("SNS message has an untrusted signing certificate URL");
  }
  if (!envelope.Signature) {
    throw new SnsVerificationError("SNS message is missing its signature");
  }

  const algorithm =
    envelope.SignatureVersion === "1"
      ? "RSA-SHA1"
      : envelope.SignatureVersion === "2"
        ? "RSA-SHA256"
        : null;
  if (!algorithm) {
    throw new SnsVerificationError("SNS message has an unsupported signature version");
  }

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const certificateResponse = await fetchImpl(envelope.SigningCertURL);
  if (!certificateResponse.ok) {
    throw new SnsVerificationError("could not load the SNS signing certificate");
  }
  const certificate = await certificateResponse.text();
  const verifier = createVerify(algorithm);
  verifier.update(snsStringToSign(envelope), "utf8");
  verifier.end();
  if (!verifier.verify(certificate, Buffer.from(envelope.Signature, "base64"))) {
    throw new SnsVerificationError("SNS message signature is invalid");
  }
}

export function snsStringToSign(envelope: SnsMessageEnvelope): string {
  const keys =
    envelope.Type === "Notification"
      ? (["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"] as const)
      : ([
          "Message",
          "MessageId",
          "SubscribeURL",
          "Timestamp",
          "Token",
          "TopicArn",
          "Type",
        ] as const);

  const fields: string[] = [];
  for (const key of keys) {
    const value = envelope[key];
    if (key === "Subject" && value === undefined) continue;
    if (typeof value !== "string" || value.length === 0) {
      throw new SnsVerificationError(`SNS message is missing signed field ${key}`);
    }
    fields.push(key, value);
  }
  return `${fields.join("\n")}\n`;
}

export function validSnsUrl(raw: string, requiredSuffix?: string): boolean {
  try {
    const url = new URL(raw);
    const hostnameAllowed =
      /^sns\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/i.test(url.hostname);
    return (
      url.protocol === "https:" &&
      hostnameAllowed &&
      (requiredSuffix === undefined || url.pathname.endsWith(requiredSuffix))
    );
  } catch {
    return false;
  }
}
