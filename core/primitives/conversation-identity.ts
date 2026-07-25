import { createHash } from "node:crypto";

export interface ConversationIdentityInput {
  workspace_id: string;
  counterparty_person_id: string;
  counterparty_company_id?: string | null;
}

export function deterministicConversationId(input: ConversationIdentityInput): string {
  return uuidFromHash([
    "bombsell:conversation:v2",
    input.workspace_id,
    input.counterparty_person_id,
    input.counterparty_company_id ?? "no-company",
  ].join("\u0000"));
}

function uuidFromHash(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex");
  const variantByte = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, "0");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variantByte}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}
