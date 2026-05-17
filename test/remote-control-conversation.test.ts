import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatContentIdeasForChat,
  formatPipelineForChat,
  rankRemotePipelineLeads,
  type RemoteContentIdea,
  type RemotePipelineLead,
} from '../lib/remote-control/conversation.ts'

const ideas: RemoteContentIdea[] = [
  {
    id: 'idea-1',
    platform: 'linkedin',
    angle: 'Why high-intent signals should change outbound timing',
    hook: 'Your best outbound window is shorter than your CRM thinks.',
    score: 91,
    status: 'proposed',
  },
  {
    id: 'idea-2',
    platform: 'x',
    angle: 'A teardown of noisy lead scoring workflows',
    score: 83,
    status: 'approved',
  },
]

const leads: RemotePipelineLead[] = [
  {
    id: 'lead-low',
    target_company: 'Nova Security',
    relevance_score: 74,
    status: 'new',
    contact_name: 'Alex Chen',
    contact_title: 'VP Sales',
  },
  {
    id: 'lead-top',
    target_company: 'Acme Robotics',
    relevance_score: 94,
    status: 'new',
    relevance_reason: 'Hiring RevOps and expanding outbound motion.',
  },
]

test('remote conversation formats content ideas with numbered chat actions', () => {
  const response = formatContentIdeasForChat(ideas)

  assert.match(response, /^Content ideas \(2\):/)
  assert.match(response, /1\. Why high-intent signals/)
  assert.match(response, /Hook: Your best outbound window/)
  assert.match(response, /approve idea 1/)
  assert.doesNotMatch(response, /Open content/)
})

test('remote conversation formats pipeline as an in-chat list', () => {
  const response = formatPipelineForChat(leads)

  assert.match(response, /^Pipeline \(2\):/)
  assert.match(response, /1\. Acme Robotics/)
  assert.match(response, /2\. Nova Security/)
  assert.match(response, /draft lead 1/)
  assert.doesNotMatch(response, /Open pipeline/)
})

test('remote pipeline ranking prefers active high-fit leads', () => {
  assert.equal(rankRemotePipelineLeads(leads)[0]?.id, 'lead-top')
})
