import { validUuid } from "./uuid.ts";

export interface AuthUserRef {
  id?: string | null;
}

export async function resolvePostAuthUserId(
  exchangeUser: AuthUserRef | null | undefined,
  loadVerifiedUser: () => Promise<AuthUserRef | null | undefined>,
): Promise<string | null> {
  const exchanged = validUuid(exchangeUser?.id);
  if (exchanged) return exchanged;

  return validUuid((await loadVerifiedUser())?.id);
}
