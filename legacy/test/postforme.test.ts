import assert from 'node:assert/strict'
import test from 'node:test'

import { createConnectUrl } from '../lib/social/postforme.ts'

test('postforme connect URL surfaces provider outage diagnostics', async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.POSTFORME_API_KEY
  process.env.POSTFORME_API_KEY = 'pfm_test'
  globalThis.fetch = (async () => new Response(JSON.stringify({
    status: 'error',
    code: 502,
    message: 'Application failed to respond',
    request_id: 'req_123',
  }), {
    status: 502,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch

  try {
    const result = await createConnectUrl({ platform: 'x', externalId: 'workspace-a' })
    assert.equal(result.ok, false)
    assert.equal(result.status, 502)
    assert.equal(result.error, 'Application failed to respond')
    assert.equal(result.requestId, 'req_123')
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.POSTFORME_API_KEY
    else process.env.POSTFORME_API_KEY = originalKey
  }
})
