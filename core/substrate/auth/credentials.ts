import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

export interface CredentialBinding {
  workspace_id: string;
  channel_account_id: string;
}

export interface EncryptedCredentials {
  encrypted: true;
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
}

export class CredentialEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialEncryptionError";
  }
}

export function encryptCredentials<T extends object>(
  value: T,
  binding: CredentialBinding,
  env: Record<string, string | undefined> = process.env,
): EncryptedCredentials {
  const key = derivedKey(binding, env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(binding));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    encrypted: true,
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptCredentials<T extends object>(
  envelope: unknown,
  binding: CredentialBinding,
  env: Record<string, string | undefined> = process.env,
): T {
  if (!isEncryptedCredentials(envelope)) {
    throw new CredentialEncryptionError("stored credentials are not encrypted");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      derivedKey(binding, env),
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAAD(aad(binding));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const cleartext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(cleartext.toString("utf8")) as T;
  } catch (err) {
    if (err instanceof CredentialEncryptionError) throw err;
    throw new CredentialEncryptionError("stored credentials could not be decrypted");
  }
}

function isEncryptedCredentials(value: unknown): value is EncryptedCredentials {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EncryptedCredentials>;
  return (
    candidate.encrypted === true &&
    candidate.version === 1 &&
    candidate.algorithm === "aes-256-gcm" &&
    typeof candidate.iv === "string" &&
    typeof candidate.tag === "string" &&
    typeof candidate.ciphertext === "string"
  );
}

function derivedKey(
  binding: CredentialBinding,
  env: Record<string, string | undefined>,
): Buffer {
  const configured = env.CREDENTIALS_ENCRYPTION_KEY;
  if (!configured) {
    throw new CredentialEncryptionError("CREDENTIALS_ENCRYPTION_KEY is not configured");
  }
  const rootKey = Buffer.from(configured, "base64");
  if (rootKey.length !== 32) {
    throw new CredentialEncryptionError(
      "CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
    );
  }
  return Buffer.from(
    hkdfSync(
      "sha256",
      rootKey,
      Buffer.from(binding.workspace_id, "utf8"),
      Buffer.from(`bombsell/outlook/${binding.channel_account_id}`, "utf8"),
      32,
    ),
  );
}

function aad(binding: CredentialBinding): Buffer {
  return Buffer.from(
    `bombsell:v1:${binding.workspace_id}:${binding.channel_account_id}`,
    "utf8",
  );
}
