import assert from "node:assert/strict";
import test from "node:test";
import {
  contactResolutionStatusLabel,
  decodeHtmlEntities,
  normalizedSignalHeading,
  signalCategoryLabel,
  signalDisplayTitle,
  signalSourceLabel,
} from "../core/signals/presentation.ts";

test("Signal titles decode feed markup and collapse post-like whitespace", () => {
  assert.equal(
    signalDisplayTitle("  Dashdoc | Product&#x2F;Software Engineer\n\n&lt;strong&gt;Paris&lt;/strong&gt;  "),
    "Dashdoc | Product/Software Engineer Paris",
  );
  assert.equal(decodeHtmlEntities("R&amp;D &#39;launch&#39;"), "R&D 'launch'");
});

test("Contact resolution reasons are presented as user-facing explanations", () => {
  assert.equal(
    contactResolutionStatusLabel("no_email_ready_contact"),
    "No contact with a verified email and LinkedIn profile was found.",
  );
  assert.equal(
    contactResolutionStatusLabel("hunter.contact_discovery.provider_unavailable"),
    "A contact provider is temporarily unavailable. Retry later.",
  );
});

test("Signal titles truncate on a word boundary", () => {
  assert.equal(signalDisplayTitle("Alpha beta gamma delta", 17), "Alpha beta gamma…");
});

test("Signal source labels prefer configured names then public domains", () => {
  assert.equal(signalSourceLabel({ sourceName: "LinkedIn Feed" }), "LinkedIn");
  assert.equal(signalSourceLabel({ url: "https://www.example.com/jobs/1" }), "example.com");
  assert.equal(signalSourceLabel({ sourceKind: "job_board" }), "Job Board");
});

test("Signal categories and headings use a stable operator vocabulary", () => {
  assert.equal(signalCategoryLabel("product_launch"), "Product launch");
  assert.equal(signalCategoryLabel("leadership_change"), "Leadership");
  assert.equal(signalCategoryLabel("unknown_kind"), "Other");
  assert.equal(
    normalizedSignalHeading({
      kind: "funding",
      companyName: "Acme",
      evidenceTitle: "Acme secures Series A",
    }),
    "Acme raised funding",
  );
  assert.equal(
    normalizedSignalHeading({
      kind: "hiring",
      companyName: null,
      evidenceTitle: "Founding account executive",
    }),
    "Company is hiring",
  );
});
