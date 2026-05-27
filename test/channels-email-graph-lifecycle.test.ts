import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  type JWK,
} from "jose";
import {
  createLifecycleTokenValidator,
  extractLifecycleEvents,
  isLifecycleEnvelope,
} from "../core/channels/email/graph-lifecycle.ts";

interface KeyMaterial {
  privateKey: CryptoKey;
  publicJwk: JWK & { kid: string; use: string; alg: string };
}

async function makeRsaKey(kid: string): Promise<KeyMaterial> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const jwk = await exportJWK(publicKey);
  return {
    privateKey,
    publicJwk: { ...jwk, kid, use: "sig", alg: "RS256" } as JWK & {
      kid: string;
      use: string;
      alg: string;
    },
  };
}

function makeFakeJwksFetch(keys: JWK[]) {
  return (async (_url: unknown) => {
    return new Response(JSON.stringify({ keys }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

async function signToken(
  privateKey: CryptoKey,
  kid: string,
  claims: {
    iss: string;
    aud: string;
    exp?: number;
    nbf?: number;
  },
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(claims.iss)
    .setAudience(claims.aud)
    .setIssuedAt(now)
    .setNotBefore(claims.nbf ?? now)
    .setExpirationTime(claims.exp ?? now + 600)
    .sign(privateKey);
}

test("lifecycle validator: accepts well-signed token with matching aud + v2 issuer", async () => {
  const key = await makeRsaKey("k1");
  const validator = createLifecycleTokenValidator({
    clientId: "client-a",
    fetchImpl: makeFakeJwksFetch([key.publicJwk]),
  });
  const token = await signToken(key.privateKey, "k1", {
    iss: "https://login.microsoftonline.com/tenant-x/v2.0",
    aud: "client-a",
  });

  const result = await validator.validate([token]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.payloads.length, 1);
});

test("lifecycle validator: accepts v1.0 issuer (sts.windows.net)", async () => {
  const key = await makeRsaKey("k1");
  const validator = createLifecycleTokenValidator({
    clientId: "client-a",
    fetchImpl: makeFakeJwksFetch([key.publicJwk]),
  });
  const token = await signToken(key.privateKey, "k1", {
    iss: "https://sts.windows.net/tenant-x/",
    aud: "client-a",
  });
  const result = await validator.validate([token]);
  assert.equal(result.ok, true);
});

test("lifecycle validator: rejects wrong audience", async () => {
  const key = await makeRsaKey("k1");
  const validator = createLifecycleTokenValidator({
    clientId: "client-a",
    fetchImpl: makeFakeJwksFetch([key.publicJwk]),
  });
  const token = await signToken(key.privateKey, "k1", {
    iss: "https://login.microsoftonline.com/tenant-x/v2.0",
    aud: "client-b",
  });
  const result = await validator.validate([token]);
  assert.equal(result.ok, false);
});

test("lifecycle validator: rejects unknown issuer", async () => {
  const key = await makeRsaKey("k1");
  const validator = createLifecycleTokenValidator({
    clientId: "client-a",
    fetchImpl: makeFakeJwksFetch([key.publicJwk]),
  });
  const token = await signToken(key.privateKey, "k1", {
    iss: "https://evil.example/v2.0",
    aud: "client-a",
  });
  const result = await validator.validate([token]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /issuer/);
});

test("lifecycle validator: rejects expired token", async () => {
  const key = await makeRsaKey("k1");
  const validator = createLifecycleTokenValidator({
    clientId: "client-a",
    fetchImpl: makeFakeJwksFetch([key.publicJwk]),
  });
  const now = Math.floor(Date.now() / 1000);
  const token = await signToken(key.privateKey, "k1", {
    iss: "https://login.microsoftonline.com/tenant-x/v2.0",
    aud: "client-a",
    nbf: now - 1200,
    exp: now - 600,
  });
  const result = await validator.validate([token]);
  assert.equal(result.ok, false);
});

test("lifecycle validator: rejects empty token list", async () => {
  const key = await makeRsaKey("k1");
  const validator = createLifecycleTokenValidator({
    clientId: "client-a",
    fetchImpl: makeFakeJwksFetch([key.publicJwk]),
  });
  const result = await validator.validate([]);
  assert.equal(result.ok, false);
});

test("lifecycle validator: tenantId restriction enforces exact tenant", async () => {
  const key = await makeRsaKey("k1");
  const validator = createLifecycleTokenValidator({
    clientId: "client-a",
    tenantId: "tenant-x",
    fetchImpl: makeFakeJwksFetch([key.publicJwk]),
  });
  const okToken = await signToken(key.privateKey, "k1", {
    iss: "https://login.microsoftonline.com/tenant-x/v2.0",
    aud: "client-a",
  });
  const otherToken = await signToken(key.privateKey, "k1", {
    iss: "https://login.microsoftonline.com/tenant-y/v2.0",
    aud: "client-a",
  });
  assert.equal((await validator.validate([okToken])).ok, true);
  assert.equal((await validator.validate([otherToken])).ok, false);
});

test("isLifecycleEnvelope + extractLifecycleEvents: pick lifecycle entries", () => {
  const envelope = {
    value: [
      { subscriptionId: "s1", resource: "/me/messages", clientState: "c" },
      {
        subscriptionId: "s2",
        lifecycleEvent: "reauthorizationRequired",
        clientState: "c",
      },
      {
        subscriptionId: "s3",
        lifecycleEvent: "subscriptionRemoved",
      },
    ],
  };
  assert.equal(isLifecycleEnvelope(envelope), true);
  const events = extractLifecycleEvents(envelope);
  assert.equal(events.length, 2);
  assert.equal(events[0].lifecycleEvent, "reauthorizationRequired");
  assert.equal(events[1].lifecycleEvent, "subscriptionRemoved");
});

test("isLifecycleEnvelope: pure change envelope returns false", () => {
  const envelope = {
    value: [
      { subscriptionId: "s1", resource: "/me/messages", clientState: "c" },
    ],
  };
  assert.equal(isLifecycleEnvelope(envelope), false);
  assert.equal(extractLifecycleEvents(envelope).length, 0);
});
