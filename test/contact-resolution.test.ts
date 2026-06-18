import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  CONTACT_RESOLUTION_WORKFLOW,
  contactDiscoveryDomain,
  contactPersonFromExaResult,
  createContactResolutionWorkflow,
  createHunterContactDiscoveryProvider,
  createZeroBounceEmailVerifier,
  rankContactRows,
  type ContactResolutionInput,
  type ContactResolutionOutput,
} from "../core/contacts/index.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import { createInProcessWorkflowRuntime } from "../core/substrate/workflows/index.ts";
import type { Pool } from "pg";

type ContactRows = Parameters<typeof rankContactRows>[0];

test("contact resolution ranks top three channel-ready graph contacts", () => {
  const companyId = randomUUID();
  const rows: ContactRows = [
    person({
      full_name: "General Person",
      title: "Operations Manager",
      company_id: companyId,
      emails: ["ops@example.com"],
      email_status: "valid",
    }),
    person({
      full_name: "Founder One",
      title: "Co-founder and CEO",
      company_id: companyId,
      emails: ["founder@example.com"],
      email_status: "valid",
    }),
    person({
      full_name: "Sales Lead",
      title: "VP Sales",
      company_id: companyId,
      emails: ["sales@example.com"],
      contact_fit_score: 0.9,
    }),
    person({
      full_name: "Blocked Contact",
      title: "CEO",
      company_id: companyId,
      emails: ["blocked@example.com"],
      email_status: "valid",
      do_not_contact: true,
    }),
  ];

  const ranked = rankContactRows(rows, "email").slice(0, 3);

  assert.deepEqual(ranked.map((candidate) => candidate.full_name), [
    "Founder One",
    "Sales Lead",
    "General Person",
  ]);
  assert.equal(ranked[0]?.verification.email_verified, true);
  assert.ok(ranked[1]?.reasons.includes("provider_contact_fit"));
});

test("contact resolution prefers the verified alternate email on a person", () => {
  const companyId = randomUUID();
  const row = person({
    full_name: "Founder One",
    title: "Founder and CEO",
    company_id: companyId,
    emails: ["old@acme.example", "founder@acme.example"],
  });
  row.properties.email_verification = {
    "old@acme.example": { status: "invalid", verified: false },
    "founder@acme.example": { status: "valid", verified: true },
  };

  const ranked = rankContactRows([row], "email");

  assert.equal(ranked[0]?.verification.email_verified, true);
  assert.equal(ranked[0]?.verification.email_status, "valid");
  assert.deepEqual(ranked[0]?.emails, [
    "founder@acme.example",
    "old@acme.example",
  ]);
});

test("contact resolution events are typed bus events", async () => {
  const bus = createInMemoryEventBus();
  const workspaceId = randomUUID();
  const signalId = randomUUID();
  const companyId = randomUUID();
  const playId = randomUUID();
  const repId = randomUUID();
  const personId = randomUUID();

  const event = await bus.publish({
    workspace_id: workspaceId,
    event_type: "contact.resolved",
    source: "system",
    producer_ref: "test:contact-resolution",
    payload: {
      contact_resolution_id: randomUUID(),
      signal_id: signalId,
      company_id: companyId,
      play_id: playId,
      rep_id: repId,
      channel: "email",
      selected_person_id: personId,
      provider_order: ["graph_cache", "exa.find_people", "hunter", "zerobounce"],
      candidates: [
        {
          rank: 1,
          person_id: personId,
          full_name: "Founder One",
          title: "CEO",
          score: 0.8,
          reasons: ["executive_or_founder", "verified_email"],
          emails: ["founder@example.com"],
          linkedin_url: null,
          verification: { email_status: "valid", email_verified: true },
          provenance: { source: "graph_cache" },
        },
      ],
    },
  });

  assert.equal(event.event_type, "contact.resolved");
});

test("contact resolution workflow resolves from verified graph cache without provider spend", async () => {
  const workspaceId = randomUUID();
  const signalId = randomUUID();
  const companyId = randomUUID();
  const playId = randomUUID();
  const repId = randomUUID();
  const rows: ContactRows = [
    person({
      full_name: "Ava Founder",
      title: "Founder and CEO",
      company_id: companyId,
      emails: ["ava@example.com"],
      email_status: "valid",
    }),
    person({
      full_name: "Ben Revenue",
      title: "VP Revenue",
      company_id: companyId,
      emails: ["ben@example.com"],
      email_status: "valid",
    }),
    person({
      full_name: "Cara Growth",
      title: "Head of Growth",
      company_id: companyId,
      emails: ["cara@example.com"],
      email_status: "valid",
    }),
  ];
  let providerCalls = 0;
  let verifierCalls = 0;
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  runtime.register(
    createContactResolutionWorkflow({
      pool: mockContactRowsPool(rows),
      discoveryProviders: [{
        name: "provider.should_not_run",
        async discover() {
          providerCalls += 1;
          return [];
        },
      }],
      emailVerifier: {
        name: "verifier.should_not_run",
        async verify() {
          verifierCalls += 1;
          return { status: "valid", verified: true };
        },
      },
    }),
  );

  const run = await runtime.start<ContactResolutionInput, ContactResolutionOutput>({
    workspace_id: workspaceId,
    workflow_name: CONTACT_RESOLUTION_WORKFLOW,
    input: {
      workspace_id: workspaceId,
      signal_id: signalId,
      company_id: companyId,
      play_id: playId,
      rep_id: repId,
      channel: "email",
    },
  });
  const completed = await waitForCompletedRun(runtime, run.id);
  const resolved = bus.published.find((event) => event.event_type === "contact.resolved");

  assert.equal(completed.output?.decision, "resolved");
  assert.equal(completed.output?.candidates.length, 3);
  assert.equal(completed.output?.selected_person_id, rows[0]?.id);
  assert.equal(providerCalls, 0);
  assert.equal(verifierCalls, 0);
  assert.deepEqual(resolved?.payload.provider_order, ["graph_cache"]);
  assert.equal(resolved?.payload.candidates[0]?.full_name, "Ava Founder");
});

test("contact resolution workflow resolves with fewer than three verified contacts after waterfall", async () => {
  const workspaceId = randomUUID();
  const signalId = randomUUID();
  const companyId = randomUUID();
  const playId = randomUUID();
  const repId = randomUUID();
  const rows: ContactRows = [
    person({
      full_name: "Ava Founder",
      title: "Founder and CEO",
      company_id: companyId,
      emails: ["ava@example.com"],
      email_status: "valid",
    }),
  ];
  let providerCalls = 0;
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  runtime.register(
    createContactResolutionWorkflow({
      pool: mockContactRowsPool(rows),
      discoveryProviders: [{
        name: "provider.no_extra_contacts",
        async discover() {
          providerCalls += 1;
          return [];
        },
      }],
    }),
  );

  const run = await runtime.start<ContactResolutionInput, ContactResolutionOutput>({
    workspace_id: workspaceId,
    workflow_name: CONTACT_RESOLUTION_WORKFLOW,
    input: {
      workspace_id: workspaceId,
      signal_id: signalId,
      company_id: companyId,
      play_id: playId,
      rep_id: repId,
      channel: "email",
    },
  });
  const completed = await waitForCompletedRun(runtime, run.id);
  const resolved = bus.published.find((event) => event.event_type === "contact.resolved");
  const deferred = bus.published.find((event) => event.event_type === "contact.resolution.deferred");

  assert.equal(completed.output?.decision, "resolved");
  assert.equal(completed.output?.candidates.length, 1);
  assert.equal(completed.output?.selected_person_id, rows[0]?.id);
  assert.equal(providerCalls, 1);
  assert.equal(deferred, undefined);
  assert.deepEqual(resolved?.payload.provider_order, ["graph_cache", "provider.no_extra_contacts"]);
  assert.equal(resolved?.payload.candidates[0]?.full_name, "Ava Founder");
});

test("contact resolution workflow defers email outreach when contacts are not verified", async () => {
  const workspaceId = randomUUID();
  const signalId = randomUUID();
  const companyId = randomUUID();
  const playId = randomUUID();
  const repId = randomUUID();
  const rows: ContactRows = [
    person({
      full_name: "Ava Founder",
      title: "Founder and CEO",
      company_id: companyId,
      emails: ["ava@example.com"],
    }),
    person({
      full_name: "Ben Revenue",
      title: "VP Revenue",
      company_id: companyId,
      emails: ["ben@example.com"],
    }),
    person({
      full_name: "Cara Growth",
      title: "Head of Growth",
      company_id: companyId,
      emails: ["cara@example.com"],
    }),
  ];
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  runtime.register(
    createContactResolutionWorkflow({
      pool: mockContactRowsPool(rows),
    }),
  );

  const run = await runtime.start<ContactResolutionInput, ContactResolutionOutput>({
    workspace_id: workspaceId,
    workflow_name: CONTACT_RESOLUTION_WORKFLOW,
    input: {
      workspace_id: workspaceId,
      signal_id: signalId,
      company_id: companyId,
      play_id: playId,
      rep_id: repId,
      channel: "email",
    },
  });
  const completed = await waitForCompletedRun(runtime, run.id);
  const resolved = bus.published.find((event) => event.event_type === "contact.resolved");
  const deferred = bus.published.find((event) => event.event_type === "contact.resolution.deferred");

  assert.equal(completed.output?.decision, "deferred");
  assert.equal(completed.output?.candidates.length, 0);
  assert.equal(completed.output?.selected_person_id, null);
  assert.equal(resolved, undefined);
  assert.equal(deferred?.payload.defer_reason, "no_email_ready_contact");
  assert.equal(deferred?.payload.candidate_count, 0);
});

test("contact resolution honors profile auto-enrich preference before provider spend", async () => {
  const workspaceId = randomUUID();
  const signalId = randomUUID();
  const companyId = randomUUID();
  const playId = randomUUID();
  const repId = randomUUID();
  const rows: ContactRows = [
    person({
      full_name: "Ava Founder",
      title: "Founder and CEO",
      company_id: companyId,
      emails: ["ava@example.com"],
    }),
  ];
  let providerCalls = 0;
  let verifierCalls = 0;
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  runtime.register(
    createContactResolutionWorkflow({
      pool: mockContactRowsPool(rows, {
        auto_enrich_email_addresses: false,
      }),
      discoveryProviders: [{
        name: "provider.should_not_run",
        async discover() {
          providerCalls += 1;
          return [];
        },
      }],
      emailVerifier: {
        name: "verifier.should_not_run",
        async verify() {
          verifierCalls += 1;
          return { status: "valid", verified: true };
        },
      },
    }),
  );

  const run = await runtime.start<ContactResolutionInput, ContactResolutionOutput>({
    workspace_id: workspaceId,
    workflow_name: CONTACT_RESOLUTION_WORKFLOW,
    input: {
      workspace_id: workspaceId,
      signal_id: signalId,
      company_id: companyId,
      play_id: playId,
      rep_id: repId,
      channel: "email",
      limit: 1,
    },
  });
  const completed = await waitForCompletedRun(runtime, run.id);
  const deferred = bus.published.find((event) => event.event_type === "contact.resolution.deferred");

  assert.equal(completed.output?.decision, "deferred");
  assert.equal(completed.output?.defer_reason, "email_auto_enrich_disabled");
  assert.equal(completed.output?.candidates[0]?.full_name, "Ava Founder");
  assert.equal(providerCalls, 0);
  assert.equal(verifierCalls, 0);
  assert.equal(deferred?.payload.defer_reason, "email_auto_enrich_disabled");
  assert.deepEqual(deferred?.payload.provider_order, ["graph_cache"]);
  assert.equal(deferred?.payload.candidate_count, 1);
});

test("contact resolution duplicate prevention skips already-worked contacts", async () => {
  const workspaceId = randomUUID();
  const signalId = randomUUID();
  const companyId = randomUUID();
  const playId = randomUUID();
  const repId = randomUUID();
  const alreadyWorked = person({
    full_name: "Ava Founder",
    title: "Founder and CEO",
    company_id: companyId,
    emails: ["ava@example.com"],
    email_status: "valid",
    already_worked: true,
  });
  const fresh = person({
    full_name: "Ben Revenue",
    title: "VP Revenue",
    company_id: companyId,
    emails: ["ben@example.com"],
    email_status: "valid",
  });
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  runtime.register(
    createContactResolutionWorkflow({
      pool: mockContactRowsPool([alreadyWorked, fresh], {
        prevent_team_contact_duplication: true,
      }),
    }),
  );

  const run = await runtime.start<ContactResolutionInput, ContactResolutionOutput>({
    workspace_id: workspaceId,
    workflow_name: CONTACT_RESOLUTION_WORKFLOW,
    input: {
      workspace_id: workspaceId,
      signal_id: signalId,
      company_id: companyId,
      play_id: playId,
      rep_id: repId,
      channel: "email",
      limit: 1,
    },
  });
  const completed = await waitForCompletedRun(runtime, run.id);
  const resolved = bus.published.find((event) => event.event_type === "contact.resolved");

  assert.equal(completed.output?.decision, "resolved");
  assert.equal(completed.output?.selected_person_id, fresh.id);
  assert.equal(completed.output?.candidates[0]?.full_name, "Ben Revenue");
  assert.equal(resolved?.payload.selected_person_id, fresh.id);
});

test("contact resolution workflow verifies alternate emails and persists the verified one first", async () => {
  const workspaceId = randomUUID();
  const signalId = randomUUID();
  const companyId = randomUUID();
  const playId = randomUUID();
  const repId = randomUUID();
  const rows: ContactRows = [
    person({
      full_name: "Ava Founder",
      title: "Founder and CEO",
      company_id: companyId,
      emails: ["ava.old@acme.example", "ava@acme.example"],
    }),
  ];
  const verifierCalls: string[] = [];
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  runtime.register(
    createContactResolutionWorkflow({
      pool: mutableContactRowsPool(rows),
      emailVerifier: {
        name: "zerobounce.validate",
        async verify(email) {
          verifierCalls.push(email);
          return email === "ava@acme.example"
            ? { status: "valid", verified: true }
            : { status: "invalid", verified: false };
        },
      },
    }),
  );

  const run = await runtime.start<ContactResolutionInput, ContactResolutionOutput>({
    workspace_id: workspaceId,
    workflow_name: CONTACT_RESOLUTION_WORKFLOW,
    input: {
      workspace_id: workspaceId,
      signal_id: signalId,
      company_id: companyId,
      play_id: playId,
      rep_id: repId,
      channel: "email",
      limit: 1,
    },
  });
  const completed = await waitForCompletedRun(runtime, run.id);
  const resolved = bus.published.find((event) => event.event_type === "contact.resolved");

  assert.equal(completed.output?.decision, "resolved");
  assert.deepEqual(verifierCalls, ["ava.old@acme.example", "ava@acme.example"]);
  assert.equal(completed.output?.candidates[0]?.emails[0], "ava@acme.example");
  assert.equal(resolved?.payload.candidates[0]?.emails[0], "ava@acme.example");
  assert.equal(rows[0]?.emails[0], "ava@acme.example");
  assert.equal(
    (rows[0]?.properties.email_verification as Record<string, { verified?: boolean }> | undefined)
      ?.["ava@acme.example"]?.verified,
    true,
  );
});

test("Exa people search results map structured person entities into contacts", () => {
  const people = contactPersonFromExaResult({
    id: "exa-1",
    url: "https://www.linkedin.com/in/jane-doe",
    title: "Jane Doe - VP Revenue",
    score: 0.92,
    publishedDate: null,
    author: null,
    text: null,
    highlights: [],
    summary: "VP Revenue at Acme",
    image: null,
    favicon: null,
    raw: {
      entities: [{
        id: "person_1",
        type: "person",
        properties: {
          name: "Jane Doe",
          workHistory: [{
            title: "VP Revenue",
            dates: { from: "2025-01-01", to: null },
            company: { id: "company_1", name: "Acme" },
          }],
        },
      }],
    },
  }, "Acme");

  assert.equal(people.length, 1);
  assert.equal(people[0]?.full_name, "Jane Doe");
  assert.equal(people[0]?.title, "VP Revenue");
  assert.equal(people[0]?.linkedin_url, "https://www.linkedin.com/in/jane-doe");
  assert.equal(people[0]?.source, "exa");
});

test("Hunter discovery combines domain search and email finder for graph people", async () => {
  const workspaceId = randomUUID();
  const companyId = randomUUID();
  const signalId = randomUUID();
  const playId = randomUUID();
  const repId = randomUUID();
  const requestedUrls: string[] = [];
  const pool = mockContactProviderPool({
    company_id: companyId,
    company_name: "Acme",
    domain: "acme.example",
    signal_id: signalId,
    missing_email_people: [{
      full_name: "Jane Doe",
      title: "VP Revenue",
      linkedin_url: "https://www.linkedin.com/in/jane-doe",
    }],
  });
  const provider = createHunterContactDiscoveryProvider({
    pool,
    apiKey: "hunter-key",
    baseUrl: "https://hunter.test/v2",
    fetchImpl: async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));
      requestedUrls.push(url.toString());
      if (url.pathname.endsWith("/domain-search")) {
        return jsonResponse({
          data: {
            emails: [{
              value: "ceo@acme.example",
              first_name: "Alex",
              last_name: "Founder",
              position: "CEO",
              confidence: 97,
            }],
          },
        });
      }
      return jsonResponse({
        data: {
          email: "jane@acme.example",
          score: 93,
        },
      });
    },
  });

  const people = await provider.discover({
    workspace_id: workspaceId,
    company_id: companyId,
    signal_id: signalId,
    play_id: playId,
    rep_id: repId,
    channel: "email",
  });

  assert.deepEqual(people.map((person) => person.emails?.[0]), [
    "ceo@acme.example",
    "jane@acme.example",
  ]);
  assert.ok(requestedUrls.some((url) => url.includes("/domain-search")));
  assert.ok(requestedUrls.some((url) => url.includes("/email-finder")));
});

test("Hunter discovery uses a registrable contact domain", async () => {
  const workspaceId = randomUUID();
  const companyId = randomUUID();
  const signalId = randomUUID();
  const playId = randomUUID();
  const repId = randomUUID();
  const requestedDomains: string[] = [];
  const pool = mockContactProviderPool({
    company_id: companyId,
    company_name: "Anthropic",
    domain: "www-cdn.anthropic.com",
    signal_id: signalId,
    missing_email_people: [{
      full_name: "Jane Doe",
      title: "VP Revenue",
      linkedin_url: "https://www.linkedin.com/in/jane-doe",
    }],
  });
  const provider = createHunterContactDiscoveryProvider({
    pool,
    apiKey: "hunter-key",
    baseUrl: "https://hunter.test/v2",
    fetchImpl: async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));
      requestedDomains.push(url.searchParams.get("domain") ?? "");
      return jsonResponse({ data: { emails: [] } });
    },
  });

  await provider.discover({
    workspace_id: workspaceId,
    company_id: companyId,
    signal_id: signalId,
    play_id: playId,
    rep_id: repId,
    channel: "email",
  });

  assert.deepEqual([...new Set(requestedDomains)], ["anthropic.com"]);
});

test("contact discovery domain rejects junk and keeps registrable domains", () => {
  assert.equal(contactDiscoveryDomain("www-cdn.anthropic.com"), "anthropic.com");
  assert.equal(contactDiscoveryDomain("https://careers.example.co.uk/jobs"), "example.co.uk");
  assert.equal(contactDiscoveryDomain("2.0.0.0"), null);
  assert.equal(contactDiscoveryDomain("operator.i"), null);
});

test("ZeroBounce verifier maps valid response to verified email status", async () => {
  const verifier = createZeroBounceEmailVerifier({
    apiKey: "zb-key",
    baseUrl: "https://zerobounce.test/v2",
    fetchImpl: async (input) => {
      const url = input instanceof URL ? input : new URL(String(input));
      assert.equal(url.pathname, "/v2/validate");
      assert.equal(url.searchParams.get("api_key"), "zb-key");
      assert.equal(url.searchParams.get("email"), "jane@acme.example");
      return jsonResponse({
        address: "jane@acme.example",
        status: "valid",
        sub_status: "",
      });
    },
  });

  const result = await verifier.verify("jane@acme.example", {
    workspace_id: randomUUID(),
    company_id: randomUUID(),
    signal_id: randomUUID(),
    play_id: randomUUID(),
    rep_id: randomUUID(),
    channel: "email",
  });

  assert.equal(result.status, "valid");
  assert.equal(result.verified, true);
});

function person(input: {
  full_name: string;
  title: string;
  company_id: string;
  emails?: string[];
  linkedin_url?: string | null;
  email_status?: string;
  contact_fit_score?: number;
  do_not_contact?: boolean;
  already_worked?: boolean;
}): ContactRows[number] {
  const email = input.emails?.[0]?.toLowerCase();
  return {
    id: randomUUID(),
    full_name: input.full_name,
    title: input.title,
    company_id: input.company_id,
    emails: input.emails ?? [],
    linkedin_url: input.linkedin_url ?? null,
    properties: {
      ...(email && input.email_status
        ? {
            email_verification: {
              [email]: { status: input.email_status },
            },
          }
        : {}),
      ...(input.contact_fit_score != null
        ? { contact_fit: { score: input.contact_fit_score } }
        : {}),
      ...(input.do_not_contact ? { do_not_contact: true } : {}),
      ...(input.already_worked ? { already_worked: true } : {}),
    },
    provenance: { source: "test" },
    created_at: new Date(0),
    updated_at: new Date(0),
  };
}

function mockContactProviderPool(input: {
  company_id: string;
  company_name: string;
  domain: string;
  signal_id: string;
  missing_email_people: Array<{
    full_name: string;
    title: string | null;
    linkedin_url: string | null;
  }>;
}): Pool {
  return {
    async query(sql: string) {
      if (sql.includes("from graph_companies")) {
        return {
          rows: [{
            name: input.company_name,
            domain: input.domain,
            industry: null,
            description: null,
          }],
        };
      }
      if (sql.includes("from signals")) {
        return {
          rows: [{
            kind: "hiring",
            title: "Acme is hiring sales leaders",
            content: "Hiring for revenue roles",
            freshness_at: new Date("2026-06-08T00:00:00Z"),
          }],
        };
      }
      if (sql.includes("from graph_persons")) {
        return { rows: input.missing_email_people };
      }
      return { rows: [] };
    },
  } as unknown as Pool;
}

function mockContactRowsPool(
  rows: ContactRows,
  policy: {
    auto_enrich_email_addresses?: boolean;
    prevent_team_contact_duplication?: boolean;
  } = {},
): Pool {
  return {
    async query(sql: string, params?: unknown[]) {
      if (sql.includes("from graph_companies")) {
        return {
          rows: [{
            auto_enrich_email_addresses:
              policy.auto_enrich_email_addresses ?? true,
            prevent_team_contact_duplication:
              policy.prevent_team_contact_duplication ?? true,
          }],
        };
      }
      if (sql.includes("from graph_persons")) {
        const preventDuplication = params?.[3] === true;
        return {
          rows: preventDuplication
            ? rows.filter((row) => row.properties.already_worked !== true)
            : rows,
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as Pool;
}

function mutableContactRowsPool(
  rows: ContactRows,
  policy: {
    auto_enrich_email_addresses?: boolean;
    prevent_team_contact_duplication?: boolean;
  } = {},
): Pool {
  return {
    async query(sql: string, params?: unknown[]) {
      if (sql.includes("from graph_companies")) {
        return {
          rows: [{
            auto_enrich_email_addresses:
              policy.auto_enrich_email_addresses ?? true,
            prevent_team_contact_duplication:
              policy.prevent_team_contact_duplication ?? true,
          }],
        };
      }
      if (sql.includes("from graph_persons")) {
        const preventDuplication = params?.[3] === true;
        return {
          rows: preventDuplication
            ? rows.filter((row) => row.properties.already_worked !== true)
            : rows,
        };
      }
      if (sql.includes("set properties = properties")) {
        const personId = params?.[1];
        const properties = typeof params?.[2] === "string"
          ? JSON.parse(params[2]) as Record<string, unknown>
          : {};
        const row = rows.find((candidate) => candidate.id === personId);
        if (row) {
          row.properties = { ...row.properties, ...properties };
          row.updated_at = new Date();
        }
        return { rows: [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes("set emails = array_prepend")) {
        const personId = params?.[1];
        const email = typeof params?.[2] === "string" ? params[2] : null;
        const row = rows.find((candidate) => candidate.id === personId);
        if (row && email) {
          row.emails = [
            email,
            ...row.emails.filter((candidateEmail) =>
              candidateEmail.toLowerCase() !== email.toLowerCase()
            ),
          ];
          row.updated_at = new Date();
        }
        return { rows: [], rowCount: row ? 1 : 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as Pool;
}

async function waitForCompletedRun(
  runtime: ReturnType<typeof createInProcessWorkflowRuntime>,
  runId: string,
): Promise<Awaited<ReturnType<typeof runtime.get<ContactResolutionInput, ContactResolutionOutput>>>> {
  for (let i = 0; i < 50; i += 1) {
    const current = await runtime.get<ContactResolutionInput, ContactResolutionOutput>(runId);
    if (current?.status === "completed" || current?.status === "failed") {
      assert.equal(current.status, "completed", current.error?.message);
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("contact resolution workflow did not complete");
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
