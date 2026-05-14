import assert from 'node:assert/strict'
import test from 'node:test'

import {
  interpretDashboardCommand,
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
    company_domain: 'novasecurity.com',
    contact_name: 'Alex Chen',
    relevance_score: 77,
    status: 'drafted',
  },
]

test('dashboard command layer interprets navigation commands', () => {
  const result = interpretDashboardCommand({
    transcript: 'show me the pipeline',
    activeView: 'home',
    leads,
  })

  assert.equal(result.kind, 'command')
  if (result.kind === 'command') {
    assert.equal(result.command.type, 'navigate')
    assert.equal(result.command.view, 'outreach')
  }
})

test('dashboard command layer routes setup questions to exact integration sections', () => {
  const social = interpretDashboardCommand({
    transcript: 'where can i connect my social accounts',
    activeView: 'home',
    leads,
  })
  const remote = interpretDashboardCommand({
    transcript: 'i need to connect telegram',
    activeView: 'home',
    leads,
  })
  const inbox = interpretDashboardCommand({
    transcript: 'how do i connect gmail',
    activeView: 'home',
    leads,
  })

  assert.equal(social.kind, 'command')
  assert.equal(remote.kind, 'command')
  assert.equal(inbox.kind, 'command')
  if (social.kind === 'command') {
    assert.equal(social.command.type, 'navigate')
    assert.equal(social.command.view, 'integrations')
    assert.equal(social.command.sectionId, 'integrations-social')
  }
  if (remote.kind === 'command') {
    assert.equal(remote.command.type, 'navigate')
    assert.equal(remote.command.view, 'integrations')
    assert.equal(remote.command.sectionId, 'integrations-remote')
  }
  if (inbox.kind === 'command') {
    assert.equal(inbox.command.type, 'navigate')
    assert.equal(inbox.command.view, 'integrations')
    assert.equal(inbox.command.sectionId, 'integrations-sending')
  }
})

test('dashboard command layer routes vague dashboard questions without side effects', () => {
  const replies = interpretDashboardCommand({
    transcript: 'where are my replies',
    activeView: 'home',
    leads,
  })
  const billing = interpretDashboardCommand({
    transcript: 'where do i change billing',
    activeView: 'home',
    leads,
  })
  const sendHelp = interpretDashboardCommand({
    transcript: 'where can i send outreach',
    activeView: 'home',
    leads,
  })

  assert.equal(replies.kind, 'command')
  assert.equal(billing.kind, 'command')
  assert.equal(sendHelp.kind, 'command')
  if (replies.kind === 'command') {
    assert.equal(replies.command.type, 'navigate')
    assert.equal(replies.command.view, 'outreach')
  }
  if (billing.kind === 'command') {
    assert.equal(billing.command.type, 'navigate')
    assert.equal(billing.command.view, 'settings')
    assert.equal(billing.command.sectionId, 'settings-billing')
  }
  if (sendHelp.kind === 'command') {
    assert.equal(sendHelp.command.type, 'navigate')
    assert.equal(sendHelp.command.view, 'outreach')
    assert.equal('requiresConfirmation' in sendHelp.command, false)
  }
})

test('dashboard command layer resolves draft command to the requested lead', () => {
  const result = interpretDashboardCommand({
    transcript: 'prepare an outreach draft for Acme',
    activeView: 'home',
    leads,
  })

  assert.equal(result.kind, 'command')
  if (result.kind === 'command') {
    assert.equal(result.command.type, 'lead')
    assert.equal(result.command.action, 'draft')
    assert.equal(result.command.leadId, 'lead-acme')
  }
})

test('dashboard command layer treats top lead as highest fit account', () => {
  const result = interpretDashboardCommand({
    transcript: 'review the top lead',
    activeView: 'home',
    leads,
  })

  assert.equal(result.kind, 'command')
  if (result.kind === 'command') {
    assert.equal(result.command.type, 'lead')
    assert.equal(result.command.action, 'review')
    assert.equal(result.command.leadId, 'lead-acme')
  }
})

test('dashboard command layer requires confirmation for send and dismiss commands', () => {
  const send = interpretDashboardCommand({
    transcript: 'send outreach to Nova Security',
    activeView: 'outreach',
    leads,
  })
  const dismiss = interpretDashboardCommand({
    transcript: 'dismiss Acme Robotics',
    activeView: 'accounts',
    leads,
  })

  assert.equal(send.kind, 'command')
  assert.equal(dismiss.kind, 'command')
  if (send.kind === 'command') assert.equal(send.command.requiresConfirmation, true)
  if (dismiss.kind === 'command') assert.equal(dismiss.command.requiresConfirmation, true)
})

test('dashboard command layer exposes confirmation and cancellation phrases', () => {
  assert.equal(isVoiceConfirmation('go ahead'), true)
  assert.equal(isVoiceConfirmation('please continue'), false)
  assert.equal(isVoiceCancellation('never mind'), true)
  assert.equal(isVoiceCancellation('show pipeline'), false)
})
