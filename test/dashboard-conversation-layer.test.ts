import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyDashboardConversation,
  type DashboardConversationContext,
} from '../lib/dashboard-conversation-layer.ts'

const context: DashboardConversationContext = {
  activeView: 'home',
  lastCollection: null,
  contentIdeas: [
    { id: 'idea-1', angle: 'Signal-led outbound timing', score: 92, status: 'proposed' },
    { id: 'idea-2', angle: 'CRM scoring teardown', score: 84, status: 'proposed' },
  ],
  pipelineLeads: [
    { id: 'lead-a', target_company: 'Acme Robotics', relevance_score: 95, status: 'new' },
    { id: 'lead-b', target_company: 'Nova Security', relevance_score: 81, status: 'drafted' },
  ],
}

test('dashboard conversation shows content ideas as a UI collection', () => {
  const result = interpretDashboardConversation('what are the content ideas for today', context)

  assert.equal(result.kind, 'action')
  if (result.kind === 'action') {
    assert.equal(result.action.type, 'show_collection')
    assert.equal(result.action.collection, 'contentIdeas')
  }
})

test('dashboard conversation resolves follow-up list requests from session context', () => {
  const result = interpretDashboardConversation('list them here', { ...context, lastCollection: 'pipeline' })

  assert.equal(result.kind, 'action')
  if (result.kind === 'action') {
    assert.equal(result.action.type, 'show_collection')
    assert.equal(result.action.collection, 'pipeline')
  }
})

test('dashboard conversation takes explicit numbered content actions', () => {
  const approve = interpretDashboardConversation('approve the second one', { ...context, lastCollection: 'contentIdeas' })
  const draft = interpretDashboardConversation('draft idea 1', context)

  assert.equal(approve.kind, 'action')
  assert.equal(draft.kind, 'action')
  if (approve.kind === 'action') {
    assert.equal(approve.action.type, 'content_idea')
    assert.equal(approve.action.action, 'approve')
    assert.equal(approve.action.ideaId, 'idea-2')
  }
  if (draft.kind === 'action') {
    assert.equal(draft.action.type, 'content_idea')
    assert.equal(draft.action.action, 'draft')
    assert.equal(draft.action.ideaId, 'idea-1')
  }
})

test('dashboard conversation asks for context when numbered target is ambiguous', () => {
  const result = interpretDashboardConversation('draft the first one', context)

  assert.equal(result.kind, 'clarify')
  if (result.kind === 'clarify') assert.match(result.reason, /visible list first/i)
})

test('dashboard conversation turns pipeline list and actions into typed actions', () => {
  const show = interpretDashboardConversation('show pipeline', context)
  const send = interpretDashboardConversation('send lead 1', context)
  const booked = interpretDashboardConversation('mark lead 2 booked', context)

  assert.equal(show.kind, 'action')
  assert.equal(send.kind, 'action')
  assert.equal(booked.kind, 'action')
  if (show.kind === 'action') {
    assert.equal(show.action.type, 'show_collection')
    assert.equal(show.action.collection, 'pipeline')
  }
  if (send.kind === 'action') {
    assert.equal(send.action.type, 'pipeline_item')
    assert.equal(send.action.action, 'send')
    assert.equal(send.action.requiresConfirmation, true)
  }
  if (booked.kind === 'action') {
    assert.equal(booked.action.type, 'pipeline_item')
    assert.equal(booked.action.action, 'status')
    assert.equal(booked.action.status, 'booked')
  }
})

test('dashboard conversation asks for the action when only the numbered item is clear', () => {
  const result = interpretDashboardConversation('the second one', { ...context, lastCollection: 'contentIdeas' })

  assert.equal(result.kind, 'clarify')
  if (result.kind === 'clarify') assert.match(result.reason, /What should I do with idea 2/)
})
