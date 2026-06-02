import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface LinkedInOAuthState {
  workspace_id: string;
  user_id: string;
  nonce: string;
  iat: number;
}

export function createLinkedInOAuthState(
  input: Omit<LinkedInOAuthState, "nonce" | "iat">,
  secret: string,
): string {
  return signLinkedInOAuthState(
    {
      ...input,
      nonce: randomBytes(12).toString("base64url"),
      iat: Date.now(),
    },
    secret,
  );
}

export function signLinkedInOAuthState(
  state: LinkedInOAuthState,
  secret: string,
): string {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyLinkedInOAuthState(
  token: string,
  secret: string,
): LinkedInOAuthState | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(sig);
  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as LinkedInOAuthState;
    if (Date.now() - parsed.iat > 10 * 60_000) return null;
    return parsed;
  } catch {
    return null;
  }
}
