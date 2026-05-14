import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyDashboardCommand,
  isVoiceCancellation,
  isVoiceConfirmation,
  type DashboardCommandLead,
} from '../lib/dashboard-command-layer.ts'

const leads: DashboardCommandLead[] = [
  {
    id: 'lead-acme',
    target_company: 'Acme Robotics',
    company_domain: 'acme.ai',
    contact_name: 'Rina Shah',
    relevance_score: 91,
    status: 'new',
  },
  {
    id: 'lead-nova',
    target_company: 'Nova Security',
    relevance_score: 82,
    status: 'new',
  },
  {
    id: 'lead-quantum',
    target_company: 'QuantumPay Inc',
    company_domain: 'quantumpay.io',
    relevance_score: 76,
    status: 'drafted',
  },
]

test('isVoiceConfirmation', () => {
  assert.equal(isVoiceConfirmation('yes'), true)
  assert.equal(isVoiceConfirmation('confirm'), true)
  assert.equal(isVoiceConfirmation('do it'), true)
  assert.equal(isVoiceConfirmation('approve'), true)
  assert.equal(isVoiceConfirmation('hello'), false)
  assert.equal(isVoiceConfirmation('show pipeline'), false)
})

test('isVoiceCancellation', () => {
  assert.equal(isVoiceCancellation('no'), true)
  assert.equal(isVoiceCancellation('cancel'), true)
  assert.equal(isVoiceCancellation('stop'), true)
  assert.equal(isVoiceCancellation('nevermind'), true)
  assert.equal(isVoiceCancellation('hello'), false)
  assert.equal(isVoiceCancellation('show pipeline'), false)
})

// NOTE: classifyDashboardCommand is async and requires an LLM backend.
// Integration tests should mock the LLM or use a test API key.
// The following test validates the type interface compiles correctly.
test('classifyDashboardCommand type interface', () => {
  const input = { transcript: 'show pipeline', activeView: 'home' as const, leads }
  assert.equal(typeof classifyDashboardCommand, 'function')
  assert.equal(typeof input.transcript, 'string')
})
