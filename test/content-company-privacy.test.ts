import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collectPrivateCompanyNames,
  containsPrivateCompanyReference,
  inferPrivateCompanyNamesFromText,
  sanitizePublicCompanyReferences,
} from '../lib/gtm/content-company-privacy.ts'

test('content company privacy collects lead company aliases but allows own company', () => {
  const names = collectPrivateCompanyNames({
    ownCompanyName: 'Bombsell',
    leadCompanyNames: ['Acme Robotics, Inc.', 'Bombsell', 'Northwind AI LLC'],
  })

  assert.ok(names.includes('Acme Robotics'))
  assert.ok(names.includes('Acme'))
  assert.ok(names.includes('Northwind AI'))
  assert.ok(names.includes('Northwind'))
  assert.ok(!names.includes('Bombsell'))
})

test('content company privacy redacts lead company names from public post content', () => {
  const names = collectPrivateCompanyNames({
    ownCompanyName: 'Bombsell',
    leadCompanyNames: ['Acme Robotics, Inc.', 'Northwind AI LLC'],
  })
  const body = 'Acme Robotics just exposed the timing problem. Northwind should not be named either.'
  const sanitized = sanitizePublicCompanyReferences(body, names)

  assert.equal(containsPrivateCompanyReference(body, names), true)
  assert.equal(containsPrivateCompanyReference(sanitized, names), false)
  assert.doesNotMatch(sanitized, /Acme|Northwind/i)
  assert.match(sanitized, /a company in the market/)
})

test('content company privacy infers private company names from signal evidence', () => {
  const names = inferPrivateCompanyNamesFromText([
    'Acme Robotics: hiring revenue operations leaders',
    'Funding signal: category demand is rising',
  ])

  assert.ok(names.includes('Acme Robotics'))
  assert.ok(names.includes('Acme'))
})
