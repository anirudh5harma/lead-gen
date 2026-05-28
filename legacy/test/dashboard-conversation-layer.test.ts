import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('dashboard conversation layer supports content and pipeline collections', async () => {
  const source = await readFile(new URL('../lib/dashboard-conversation-layer.ts', import.meta.url), 'utf8')
  assert.match(source, /DashboardConversationCollection = 'contentIdeas' \| 'pipeline'/)
  assert.match(source, /case 'list_pipeline':/)
  assert.match(source, /case 'list_content_ideas':/)
  assert.match(source, /case 'content_idea_approve':/)
  assert.match(source, /case 'lead_send':/)
})

test('dashboard conversation keeps risky sends behind confirmation', async () => {
  const source = await readFile(new URL('../lib/dashboard-conversation-layer.ts', import.meta.url), 'utf8')
  assert.match(source, /requiresConfirmation: action === 'send'/)
  assert.match(source, /requiresConfirmation: status === 'dismissed'/)
})
