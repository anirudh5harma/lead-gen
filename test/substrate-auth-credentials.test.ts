import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decryptCredentials,
  encryptCredentials,
  CredentialEncryptionError,
} from "../core/substrate/auth/credentials.ts";

const env = {
  CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};
const binding = {
  workspace_id: randomUUID(),
  channel_account_id: randomUUID(),
};

test("OAuth credentials encrypt and decrypt only with their tenant binding", () => {
  const value = {
    access_token: "access",
    refresh_token: "refresh",
    expires_at: "2026-05-27T12:00:00.000Z",
  };
  const protectedValue = encryptCredentials(value, binding, env);
  assert.notEqual(protectedValue.ciphertext, JSON.stringify(value));
  assert.deepEqual(decryptCredentials(protectedValue, binding, env), value);

  assert.throws(
    () =>
      decryptCredentials(
        protectedValue,
        { ...binding, workspace_id: randomUUID() },
        env,
      ),
    CredentialEncryptionError,
  );
});

test("plaintext OAuth credentials are rejected", () => {
  assert.throws(
    () => decryptCredentials({ access_token: "leaked" }, binding, env),
    CredentialEncryptionError,
  );
});
