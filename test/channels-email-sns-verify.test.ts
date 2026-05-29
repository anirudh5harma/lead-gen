import { createSign, generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SnsMessageEnvelope } from "../core/channels/email/ses-inbound.ts";
import {
  snsStringToSign,
  validSnsUrl,
  verifySnsMessage,
  SnsVerificationError,
} from "../core/channels/email/sns-verify.ts";

const topicArn = "arn:aws:sns:us-east-1:123456789012:bombsell-ses";
const certUrl =
  "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

function signedNotification(): SnsMessageEnvelope {
  const envelope: SnsMessageEnvelope = {
    Type: "Notification",
    MessageId: "message-1",
    Message: "{\"notificationType\":\"Bounce\"}",
    Timestamp: "2026-05-27T12:00:00.000Z",
    TopicArn: topicArn,
    SignatureVersion: "2",
    SigningCertURL: certUrl,
  };
  const signer = createSign("RSA-SHA256");
  signer.update(snsStringToSign(envelope), "utf8");
  signer.end();
  envelope.Signature = signer.sign(privateKey).toString("base64");
  return envelope;
}

const certFetch: typeof fetch = async () =>
  new Response(publicPem, { status: 200 });

test("SNS verification accepts a signed message from an allowed topic", async () => {
  await verifySnsMessage(signedNotification(), {
    allowedTopicArns: [topicArn],
    fetchImpl: certFetch,
  });
});

test("SNS string-to-sign keeps the final newline AWS signs", () => {
  assert.equal(snsStringToSign(signedNotification()).endsWith("\n"), true);
});

test("SNS verification rejects tampered message content", async () => {
  const envelope = signedNotification();
  envelope.Message = "tampered";
  await assert.rejects(
    verifySnsMessage(envelope, {
      allowedTopicArns: [topicArn],
      fetchImpl: certFetch,
    }),
    SnsVerificationError,
  );
});

test("SNS verification rejects an unapproved topic before fetching certificates", async () => {
  let fetched = false;
  await assert.rejects(
    verifySnsMessage(signedNotification(), {
      allowedTopicArns: ["arn:aws:sns:us-east-1:123456789012:other"],
      fetchImpl: async () => {
        fetched = true;
        return new Response(publicPem);
      },
    }),
    SnsVerificationError,
  );
  assert.equal(fetched, false);
});

test("SNS URLs must be HTTPS endpoints on the SNS AWS host", () => {
  assert.equal(validSnsUrl(certUrl, ".pem"), true);
  assert.equal(
    validSnsUrl("https://sns.us-east-1.amazonaws.com.evil.invalid/cert.pem", ".pem"),
    false,
  );
  assert.equal(validSnsUrl("http://sns.us-east-1.amazonaws.com/cert.pem", ".pem"), false);
});
