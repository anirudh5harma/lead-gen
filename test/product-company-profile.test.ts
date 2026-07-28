import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeCompanyWebsite,
  normalizeCompanyWebsiteUrl,
} from "../core/product/company-profile.ts";
import type {
  CompletionRequest,
  CompletionResponse,
  LLMClient,
} from "../core/agents/llm/types.ts";

function mockLLM(content: string): LLMClient & { calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = [];
  return {
    calls,
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      calls.push(req);
      return {
        content,
        model: "test-model",
        finish_reason: "stop",
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    },
  };
}

test("normalizes company website urls for onboarding", () => {
  assert.equal(normalizeCompanyWebsiteUrl("bombsell.com"), "https://bombsell.com");
  assert.equal(normalizeCompanyWebsiteUrl("https://www.bombsell.com/#top"), "https://bombsell.com");
  assert.equal(normalizeCompanyWebsiteUrl("localhost:3000"), null);
  assert.equal(normalizeCompanyWebsiteUrl("http://127.0.0.1:3000"), null);
  assert.equal(normalizeCompanyWebsiteUrl("http://10.0.0.8"), null);
  assert.equal(normalizeCompanyWebsiteUrl("ftp://bombsell.com"), null);
});

test("extracts profile from Firecrawl markdown and the product LLM", async () => {
  const previousKey = process.env.FIRECRAWL_API_KEY;
  process.env.FIRECRAWL_API_KEY = "fc-test";
  const llm = mockLLM(
    JSON.stringify({
      company_name: "Acme AI",
      industry: "AI",
      description:
        "Acme AI helps revenue teams find timely account signals. It turns public company movement into outbound context.",
    }),
  );
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        data: {
          markdown:
            "# Acme AI\nAcme AI helps revenue teams find timely account signals. It monitors hiring, launches, funding news, founder posts, and product announcements so teams can act when there is a real reason to talk.",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const profile = await analyzeCompanyWebsite({
      websiteUrl: "acme.ai",
      allowedIndustries: ["AI", "Fintech"],
      fetchImpl: fetchImpl as typeof fetch,
      llm,
    });

    assert.equal(profile?.company_name, "Acme AI");
    assert.equal(profile?.industry, "AI");
    assert.equal(profile?.domain, "acme.ai");
    assert.equal(profile?.source, "firecrawl");
    assert.equal(llm.calls.length, 1);
  } finally {
    if (previousKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = previousKey;
  }
});

test("falls back to direct homepage content when Firecrawl is unavailable", async () => {
  const previousKey = process.env.FIRECRAWL_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;
  const directFetchImpl = async () =>
    new Response(
      `<!doctype html>
      <html>
        <head>
          <title>Acme GTM</title>
          <meta name="description" content="Acme GTM helps founders monitor buying signals and draft useful outbound." />
        </head>
        <body>
          <h1>Find the right moment to reach out.</h1>
          <p>Acme GTM watches public company movement, explains why it matters, and prepares careful founder-led outreach.</p>
        </body>
      </html>`,
      { status: 200, headers: { "content-type": "text/html" } },
    );

  try {
    const profile = await analyzeCompanyWebsite({
      websiteUrl: "https://acmegtm.example",
      directFetchImpl,
      llm: mockLLM("not json"),
    });

    assert.equal(profile?.company_name, "Acmegtm");
    assert.equal(profile?.source, "fallback");
    assert.match(profile?.description ?? "", /founders monitor buying signals/i);
  } finally {
    if (previousKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = previousKey;
  }
});

test("still returns a starter profile when no website content can be read", async () => {
  const previousKey = process.env.FIRECRAWL_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;
  const directFetchImpl = async () => new Response("blocked", { status: 403 });

  try {
    const profile = await analyzeCompanyWebsite({
      websiteUrl: "https://blocked.example",
      companyHint: "Blocked Co",
      directFetchImpl,
    });

    assert.equal(profile?.company_name, "Blocked Co");
    assert.equal(profile?.source, "fallback");
    assert.match(profile?.description ?? "", /could not read enough website content/i);
  } finally {
    if (previousKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = previousKey;
  }
});
