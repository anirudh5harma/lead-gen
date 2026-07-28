import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchPublicHttpUrl,
  type PublicHostResolver,
  type PinnedHttpRequest,
} from "../lib/network/safe-public-fetch.ts";

function resolver(
  answers: Record<string, Array<{ address: string; family: 4 | 6 }>>,
): PublicHostResolver {
  return async (hostname) => answers[hostname] ?? [];
}

test("safe public fetch rejects DNS aliases to private addresses before requesting", async () => {
  let requested = false;
  const request: PinnedHttpRequest = async () => {
    requested = true;
    return new Response("should not run");
  };

  const response = await fetchPublicHttpUrl("https://metadata.example", {
    resolveHost: resolver({
      "metadata.example": [{ address: "169.254.169.254", family: 4 }],
    }),
    request,
  });

  assert.equal(response, null);
  assert.equal(requested, false);
});

test("safe public fetch rejects hosts with mixed public and private DNS answers", async () => {
  let requested = false;
  const request: PinnedHttpRequest = async () => {
    requested = true;
    return new Response("should not run");
  };

  const response = await fetchPublicHttpUrl("https://mixed.example", {
    resolveHost: resolver({
      "mixed.example": [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.8", family: 4 },
      ],
    }),
    request,
  });

  assert.equal(response, null);
  assert.equal(requested, false);
});

test("safe public fetch pins the validated DNS answer into the request", async () => {
  const calls: Array<{ hostname: string; address: string; family: 4 | 6 }> = [];
  const request: PinnedHttpRequest = async (url, address, family) => {
    calls.push({ hostname: url.hostname, address, family });
    return new Response("ok", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  };

  const response = await fetchPublicHttpUrl("https://public.example", {
    resolveHost: resolver({
      "public.example": [{ address: "93.184.216.34", family: 4 }],
    }),
    request,
  });

  assert.equal(await response?.text(), "ok");
  assert.deepEqual(calls, [
    {
      hostname: "public.example",
      address: "93.184.216.34",
      family: 4,
    },
  ]);
});

test("safe public fetch revalidates redirect targets before following", async () => {
  const requestedHosts: string[] = [];
  const request: PinnedHttpRequest = async (url) => {
    requestedHosts.push(url.hostname);
    return new Response(null, {
      status: 302,
      headers: { location: "http://private.example/admin" },
    });
  };

  const response = await fetchPublicHttpUrl("https://public.example", {
    resolveHost: resolver({
      "public.example": [{ address: "93.184.216.34", family: 4 }],
      "private.example": [{ address: "127.0.0.1", family: 4 }],
    }),
    request,
  });

  assert.equal(response, null);
  assert.deepEqual(requestedHosts, ["public.example"]);
});

test("safe public fetch rejects empty DNS answers", async () => {
  const response = await fetchPublicHttpUrl("https://missing.example", {
    resolveHost: resolver({}),
    request: async () => new Response("should not run"),
  });

  assert.equal(response, null);
});

test("safe public fetch aborts while DNS resolution is still pending", async () => {
  const controller = new AbortController();
  const pendingResolver: PublicHostResolver = () => new Promise(() => {});
  const request: PinnedHttpRequest = async () => new Response("should not run");
  const result = fetchPublicHttpUrl("https://slow.example", {
    resolveHost: pendingResolver,
    request,
    signal: controller.signal,
  });

  controller.abort(new Error("DNS timed out"));

  await assert.rejects(result, /DNS timed out/);
});
