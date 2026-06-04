#!/usr/bin/env node
/**
 * Verify the live AWS SES account is ready for owned-domain outbound sends.
 *
 * This intentionally checks account/identity/provider wiring, not the app's
 * local bounce projector. Use `npm run verify:ses` for the local bounce path.
 */

import {
  GetAccountCommand,
  GetConfigurationSetEventDestinationsCommand,
  GetEmailIdentityCommand,
  ListEmailIdentitiesCommand,
  SESv2Client,
  type GetAccountCommandOutput,
} from "@aws-sdk/client-sesv2";
import { pathToFileURL } from "node:url";

interface Step {
  label: string;
  status: "ok" | "fail";
  detail?: string;
}

const steps: Step[] = [];
const note = (label: string, ok: boolean, detail?: string): void => {
  steps.push({ label, status: ok ? "ok" : "fail", detail });
};

const region = process.env.AWS_REGION?.trim() || "us-east-1";
const configurationSet = process.env.SES_CONFIGURATION_SET?.trim() || "bombsell-outbound";
const expectedIdentity = process.env.SES_SENDING_DOMAIN?.trim();
const trustedTopics = (process.env.AWS_SNS_TOPIC_ARNS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const client = new SESv2Client({ region });

async function main(): Promise<void> {
  try {
    const account = await client.send(new GetAccountCommand({}));
    note(
      "ses: production access enabled",
      account.ProductionAccessEnabled === true,
      describeProductionAccessFailure(account),
    );
    note(
      "ses: sending enabled",
      account.SendingEnabled === true,
      account.SendingEnabled === true ? undefined : "SES sending is disabled",
    );

    const identities = await client.send(new ListEmailIdentitiesCommand({}));
    const identityNames = (identities.EmailIdentities ?? [])
      .map((identity) => identity.IdentityName)
      .filter((name): name is string => Boolean(name));
    const verificationResults = await Promise.all(
      identityNames
        .filter((name) => !expectedIdentity || name === expectedIdentity)
        .map(async (name) => {
          const identity = await client.send(
            new GetEmailIdentityCommand({ EmailIdentity: name }),
          );
          return {
            name,
            verified: identity.VerifiedForSendingStatus === true,
            dkim: identity.DkimAttributes?.Status,
            configurationSet: identity.ConfigurationSetName,
          };
        }),
    );
    const verified = verificationResults.filter((identity) => identity.verified);
    note(
      "ses: at least one verified sending identity",
      verified.length > 0,
      verified.length > 0
        ? verified
            .map((identity) => {
              const extras = [
                identity.dkim ? `dkim=${identity.dkim}` : null,
                identity.configurationSet
                  ? `config=${identity.configurationSet}`
                  : null,
              ].filter(Boolean);
              return `${identity.name}${extras.length ? ` (${extras.join(", ")})` : ""}`;
            })
            .join(", ")
        : expectedIdentity
          ? `${expectedIdentity} is not verified in ${region}`
          : "no verified identities",
    );

    const destinations = await client.send(
      new GetConfigurationSetEventDestinationsCommand({
        ConfigurationSetName: configurationSet,
      }),
    );
    const snsDestination = (destinations.EventDestinations ?? []).find((destination) => {
      const events = new Set(destination.MatchingEventTypes ?? []);
      const topic = destination.SnsDestination?.TopicArn;
      return (
        destination.Enabled === true &&
        Boolean(topic) &&
        (trustedTopics.length === 0 || trustedTopics.includes(topic!)) &&
        events.has("BOUNCE") &&
        events.has("COMPLAINT") &&
        events.has("DELIVERY")
      );
    });

    note(
      "ses: config set publishes delivery/bounce/complaint to trusted SNS",
      Boolean(snsDestination),
      snsDestination
        ? `${configurationSet} → ${snsDestination.SnsDestination?.TopicArn}`
        : `${configurationSet} missing enabled SNS destination for BOUNCE, COMPLAINT, DELIVERY`,
    );
  } catch (err) {
    note("uncaught", false, err instanceof Error ? err.message : String(err));
  }

  const failed = steps.filter((step) => step.status === "fail");
  for (const step of steps) {
    const prefix = step.status === "ok" ? "  ok  " : "  FAIL";
    console.log(`${prefix}  ${step.label}${step.detail ? ` — ${step.detail}` : ""}`);
  }

  if (failed.length > 0) {
    console.error(`\n${failed.length} AWS SES readiness check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAWS SES outbound readiness verified.");
}

export function describeProductionAccessFailure(
  account: Pick<GetAccountCommandOutput, "ProductionAccessEnabled" | "Details">,
): string | undefined {
  if (account.ProductionAccessEnabled === true) return undefined;

  const details = account.Details;
  const review = details?.ReviewDetails;
  const fields = [
    "SES account is still in sandbox",
    review?.Status ? `review=${review.Status}` : null,
    review?.CaseId ? `case=${review.CaseId}` : null,
    details?.MailType ? `mailType=${details.MailType}` : null,
    details?.WebsiteURL ? `website=${details.WebsiteURL}` : null,
  ].filter(Boolean);
  return fields.join("; ");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
