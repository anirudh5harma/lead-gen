import { createPublicKey, verify } from 'crypto'

const ED25519_SPKI_PREFIX = '302a300506032b6570032100'

export function verifyDiscordRequest(input: {
  body: string
  signature: string | null
  timestamp: string | null
  publicKey: string | undefined
}): boolean {
  if (!input.signature || !input.timestamp || !input.publicKey) return false
  try {
    const key = createPublicKey({
      key: Buffer.from(`${ED25519_SPKI_PREFIX}${input.publicKey}`, 'hex'),
      format: 'der',
      type: 'spki',
    })
    return verify(
      null,
      Buffer.from(`${input.timestamp}${input.body}`),
      key,
      Buffer.from(input.signature, 'hex'),
    )
  } catch {
    return false
  }
}
