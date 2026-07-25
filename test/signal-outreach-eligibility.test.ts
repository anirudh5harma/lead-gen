import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessSignalResearchEligibility,
  assessSignalOutreachEligibility,
  type SignalOutreachEligibilityInput,
} from "../core/product/signal-outreach-eligibility.ts";

const researchedSignal: SignalOutreachEligibilityInput = {
  company_name: "Acme Labs",
  company_domain: "acme.ai",
  signal_url: "https://example.com/research/acme-funding",
  contacts: [
    {
      full_name: "Ada Founder",
      emails: ["ada@acme.ai"],
      email_verified: true,
      linkedin_url: null,
    },
  ],
};

test("researched Signal is eligible with a valid company, source, and verified contact", () => {
  assert.deepEqual(assessSignalOutreachEligibility(researchedSignal), {
    eligible: true,
    reasons: [],
  });
});

test("research gate requires a named company, source evidence, and domain or LinkedIn identity", () => {
  assert.deepEqual(
    assessSignalResearchEligibility({
      company_name: "Acme Labs",
      company_domain: null,
      signal_url: "https://news.example/acme",
      linkedin_urls: ["https://linkedin.com/company/acme-labs"],
    }),
    { eligible: true, reasons: [] },
  );
  assert.deepEqual(
    assessSignalResearchEligibility({
      company_name: "Unknown",
      company_domain: "techcrunch.com",
      signal_url: null,
      linkedin_urls: [],
    }),
    {
      eligible: false,
      reasons: [
        "missing_company_name",
        "missing_signal_evidence",
        "missing_company_identity",
      ],
    },
  );
});

test("LinkedIn identity can qualify a researched Signal without a company domain", () => {
  assert.equal(
    assessSignalOutreachEligibility({
      ...researchedSignal,
      company_domain: null,
      contacts: [
        {
          full_name: "Ada Founder",
          emails: [],
          email_verified: false,
          linkedin_url: "https://www.linkedin.com/in/ada-founder",
        },
      ],
    }).eligible,
    true,
  );
});

test("Signal outreach rejects incomplete or placeholder research", () => {
  assert.deepEqual(
    assessSignalOutreachEligibility({
      ...researchedSignal,
      company_name: "Unknown company",
      signal_url: "not-a-source",
      company_domain: "linkedin.com",
      contacts: [],
    }),
    {
      eligible: false,
      reasons: [
        "missing_company_name",
        "missing_signal_evidence",
        "missing_company_identity",
        "missing_reachable_contact",
      ],
    },
  );
});

test("unverified email alone does not make a Signal outreach-ready", () => {
  assert.deepEqual(
    assessSignalOutreachEligibility({
      ...researchedSignal,
      contacts: [
        {
          full_name: "Ada Founder",
          emails: ["ada@acme.ai"],
          email_verified: false,
          linkedin_url: null,
        },
      ],
    }),
    {
      eligible: false,
      reasons: ["missing_reachable_contact"],
    },
  );
});

test("Signal outreach rejects unnamed contacts even when a handle exists", () => {
  assert.deepEqual(
    assessSignalOutreachEligibility({
      ...researchedSignal,
      contacts: [
        {
          full_name: "Unknown",
          emails: ["ada@acme.ai"],
          email_verified: true,
          linkedin_url: "https://linkedin.com/in/ada-founder",
        },
      ],
    }),
    {
      eligible: false,
      reasons: ["missing_reachable_contact"],
    },
  );
});
