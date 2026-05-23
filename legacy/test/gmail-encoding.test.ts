import assert from 'node:assert/strict'
import test from 'node:test'

import { buildGmailRawMessage } from '../lib/oauth/gmail-message.ts'

test('gmail raw messages preserve euro amounts in the MIME body', () => {
  const body = 'Pricing changed from $99 to €89 for EU accounts.'
  const raw = buildGmailRawMessage({
    fromEmail: 'sender@example.com',
    fromName: 'Bombsell',
    to: 'buyer@example.com',
    subject: 'EU pricing',
    body,
    unsubLink: 'https://example.com/unsubscribe',
  })

  const message = Buffer.from(raw, 'base64url').toString('utf8')
  const [headers, encodedBody] = message.split('\r\n\r\n')

  assert.match(headers, /Content-Type: text\/plain; charset=UTF-8/)
  assert.match(headers, /Content-Transfer-Encoding: base64/)
  assert.equal(Buffer.from(encodedBody.replace(/\r\n/g, ''), 'base64').toString('utf8'), body)
  assert.doesNotMatch(message, /Ã¢Â‚Â¬/)
})

test('gmail raw messages MIME-encode non-ASCII subjects and display names', () => {
  const raw = buildGmailRawMessage({
    fromEmail: 'sender@example.com',
    fromName: 'Bømbsell',
    to: 'buyer@example.com',
    subject: '€ pricing update',
    body: 'Plain body',
    unsubLink: 'https://example.com/unsubscribe',
  })

  const message = Buffer.from(raw, 'base64url').toString('utf8')
  const [headers] = message.split('\r\n\r\n')

  assert.match(headers, /From: =\?UTF-8\?B\?QsO4bWJzZWxs\?= <sender@example\.com>/)
  assert.match(headers, /Subject: =\?UTF-8\?B\?4oKsIHByaWNpbmcgdXBkYXRl\?=/)
})
