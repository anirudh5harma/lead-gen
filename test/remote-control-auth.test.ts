import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveEnvPrincipal } from '../lib/remote-control/auth.ts'
import { listRemoteControlConnections } from '../lib/remote-control/linking.ts'

test('remote control auth resolves structured env mapping', () => {
  const previous = process.env.REMOTE_CONTROL_USERS
  process.env.REMOTE_CONTROL_USERS = JSON.stringify({
    telegram: {
      '12345': { user_id: 'user-a', client_id: 'client-a' },
    },
    discord: {
      '67890': 'user-b',
    },
  })

  try {
    assert.deepEqual(resolveEnvPrincipal('telegram', '12345'), { userId: 'user-a', clientId: 'client-a' })
    assert.deepEqual(resolveEnvPrincipal('discord', '67890'), { userId: 'user-b', clientId: null })
    assert.equal(resolveEnvPrincipal('telegram', 'missing'), null)
  } finally {
    if (previous === undefined) delete process.env.REMOTE_CONTROL_USERS
    else process.env.REMOTE_CONTROL_USERS = previous
  }
})

test('remote control auth resolves provider env mapping', () => {
  const previous = process.env.REMOTE_CONTROL_TELEGRAM_USERS
  delete process.env.REMOTE_CONTROL_USERS
  process.env.REMOTE_CONTROL_TELEGRAM_USERS = '111:user-one,222:user-two:client-two'

  try {
    assert.deepEqual(resolveEnvPrincipal('telegram', '111'), { userId: 'user-one', clientId: null })
    assert.deepEqual(resolveEnvPrincipal('telegram', '222'), { userId: 'user-two', clientId: 'client-two' })
    assert.equal(resolveEnvPrincipal('telegram', '333'), null)
  } finally {
    if (previous === undefined) delete process.env.REMOTE_CONTROL_TELEGRAM_USERS
    else process.env.REMOTE_CONTROL_TELEGRAM_USERS = previous
  }
})

test('remote control connection listing tolerates unapplied migration during setup', async () => {
  const fakeSupabase = {
    from() {
      return {
        select() { return this },
        eq() { return this },
        order() {
          return Promise.resolve({
            data: null,
            error: { message: "Could not find the table 'public.remote_control_identities' in the schema cache" },
          })
        },
      }
    },
  }

  const connections = await listRemoteControlConnections(fakeSupabase as never, 'user-a')
  assert.deepEqual(connections, [])
})
