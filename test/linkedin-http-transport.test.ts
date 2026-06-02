import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHttpLinkedInTransport,
  createUnconfiguredLinkedInTransport,
  LinkedInTransportError,
} from "../core/channels/index.ts";

const envelope = {
  action: "linkedin_dm" as const,
  account_id: "11111111-1111-4111-8111-111111111111",
  from: "Maya LinkedIn",
  target_profile_url: "https://www.linkedin.com/in/nisha-rao",
  body: "Worth comparing notes?",
};

test("linkedin HTTP transport posts provider envelope and returns external id", async () => {
  const seen: Array<{ url: string; headers: Headers; body: unknown }> = [];
  const transport = createHttpLinkedInTransport({
    endpoint: "https://provider.example/send",
    apiKey: "provider-key",
    fetchImpl: async (url, init) => {
      seen.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ external_id: "li-provider-1" }), {
        status: 200,
      });
    },
  });

  const result = await transport.send(envelope);

  assert.equal(result.external_id, "li-provider-1");
  assert.equal(seen[0]?.url, "https://provider.example/send");
  assert.equal(seen[0]?.headers.get("Authorization"), "Bearer provider-key");
  assert.deepEqual(seen[0]?.body, envelope);
});

test("linkedin HTTP transport maps provider rate limits to typed transport errors", async () => {
  const transport = createHttpLinkedInTransport({
    endpoint: "https://provider.example/send",
    apiKey: "provider-key",
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: "slow down" }), {
        status: 429,
        headers: { "Retry-After": "120" },
      }),
  });

  await assert.rejects(
    transport.send(envelope),
    (err) => {
      assert.ok(err instanceof LinkedInTransportError);
      assert.equal(err.reason, "rate_limited");
      assert.match(err.message, /slow down/);
      assert.ok(err.retry_after);
      return true;
    },
  );
});

test("linkedin HTTP transport fails closed when provider omits external id", async () => {
  const transport = createHttpLinkedInTransport({
    endpoint: "https://provider.example/send",
    apiKey: "provider-key",
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  });

  await assert.rejects(
    transport.send(envelope),
    (err) => {
      assert.ok(err instanceof LinkedInTransportError);
      assert.equal(err.reason, "provider_error_permanent");
      assert.match(err.message, /external_id/);
      return true;
    },
  );
});

test("unconfigured LinkedIn transport fails closed", async () => {
  await assert.rejects(
    createUnconfiguredLinkedInTransport().send(envelope),
    (err) => {
      assert.ok(err instanceof LinkedInTransportError);
      assert.equal(err.reason, "provider_error_permanent");
      assert.match(err.message, /not configured/);
      return true;
    },
  );
});
