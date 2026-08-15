import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessAccountAttainability,
  hasLargeCompanyScaleEvidence,
} from "../core/product/account-attainability.ts";

test("attainability blocks prominent accounts for an early seller without proof", () => {
  const result = assessAccountAttainability({
    seller_age_days: 72,
    seller_has_proof: false,
    target_size_bucket: "10000+",
    recent_target_signal_count: 12,
    target_scale_evidence: false,
    recent_sent_count: 0,
    has_reply: false,
    has_positive_outcome: false,
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, "early_seller_prominent_target");
});

test("attainability allows a prominent account after real positive evidence", () => {
  const result = assessAccountAttainability({
    seller_age_days: 72,
    seller_has_proof: false,
    target_size_bucket: "10000+",
    recent_target_signal_count: 20,
    target_scale_evidence: true,
    recent_sent_count: 1,
    has_reply: true,
    has_positive_outcome: true,
  });

  assert.equal(result.eligible, true);
  assert.equal(result.reason, "positive_relationship_evidence");
});

test("attainability applies a company cooldown after unanswered outreach", () => {
  const result = assessAccountAttainability({
    seller_age_days: 400,
    seller_has_proof: true,
    target_size_bucket: "11-50",
    recent_target_signal_count: 2,
    target_scale_evidence: false,
    recent_sent_count: 1,
    has_reply: false,
    has_positive_outcome: false,
  });

  assert.equal(result.eligible, false);
  assert.equal(result.reason, "unanswered_company_cooldown");
});

test("attainability keeps peer startup accounts eligible", () => {
  const result = assessAccountAttainability({
    seller_age_days: 45,
    seller_has_proof: false,
    target_size_bucket: "1-10",
    recent_target_signal_count: 2,
    target_scale_evidence: false,
    recent_sent_count: 0,
    has_reply: false,
    has_positive_outcome: false,
  });

  assert.equal(result.eligible, true);
  assert.equal(result.reason, "attainable");
});

test("attainability does not mistake repeated small-company signals for prominence", () => {
  assert.deepEqual(assessAccountAttainability({
    seller_age_days: 60,
    seller_has_proof: false,
    target_size_bucket: "1-10",
    recent_target_signal_count: 12,
    target_scale_evidence: false,
    recent_sent_count: 0,
    has_reply: false,
    has_positive_outcome: false,
  }), { eligible: true, reason: "attainable" });
});

test("attainability detects large valuation and funding evidence", () => {
  assert.equal(
    hasLargeCompanyScaleEvidence("Lovable reaches a $13.3B valuation and raises $400M"),
    true,
  );
  assert.equal(
    hasLargeCompanyScaleEvidence("Quantum Systems lands €1 billion Series D"),
    true,
  );
  assert.equal(hasLargeCompanyScaleEvidence("Acme raises a $4M seed round"), false);
});
