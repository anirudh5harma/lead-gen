import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('lead review drawer exposes evidence, message reasoning, and next action surfaces', async () => {
  const source = await readFile(new URL('../components/dashboard/LeadDrawer.tsx', import.meta.url), 'utf8')

  for (const label of ['Evidence', 'Next best action', 'Message reasoning']) {
    assert.match(source, new RegExp(label), `${label} should be visible in the lead review drawer`)
  }

  assert.match(source, /buildLeadProof/, 'lead drawer should derive source proof from lead and signal context')
  assert.match(source, /buildMessageReasoning/, 'lead drawer should explain why the draft is ready or risky')
  assert.match(source, /buildNextAction/, 'lead drawer should turn lead state into an operational next move')
  assert.match(source, /quality_eval/, 'lead drawer should surface existing outreach draft quality checks')
  assert.match(source, /Open source/, 'lead drawer should expose source provenance when a source URL exists')
})

test('campaign detail surfaces learning loop, content air cover, and target next actions', async () => {
  const source = await readFile(new URL('../components/dashboard/CampaignsView.tsx', import.meta.url), 'utf8')

  for (const label of ['Learning loop', 'Content air cover']) {
    assert.match(source, new RegExp(label), `${label} should be visible in campaign detail`)
  }

  assert.match(source, /buildCampaignLearning/, 'campaign detail should summarize outcome learning')
  assert.match(source, /buildContentAirCover/, 'campaign detail should suggest companion content when none is attached')
  assert.match(source, /targetNextAction/, 'campaign targets should show the operational next move')
  assert.match(source, /contentItems\.length > 0[\s\S]*contentItems\.slice/, 'attached campaign content should be shown before suggestions')
})
