import { test } from "node:test";
import assert from "node:assert/strict";
import { describeProductionAccessFailure } from "../scripts/verify-aws-ses.ts";

test("AWS SES verifier includes review context when production access is denied", () => {
  assert.equal(
    describeProductionAccessFailure({
      ProductionAccessEnabled: false,
      Details: {
        MailType: "TRANSACTIONAL",
        WebsiteURL: "https://www.bombsell.com",
        ReviewDetails: {
          Status: "DENIED",
          CaseId: "177998710600026",
        },
      },
    }),
    "SES account is still in sandbox; review=DENIED; case=177998710600026; mailType=TRANSACTIONAL; website=https://www.bombsell.com",
  );
});

test("AWS SES verifier omits failure detail when production access is enabled", () => {
  assert.equal(
    describeProductionAccessFailure({ ProductionAccessEnabled: true }),
    undefined,
  );
});
