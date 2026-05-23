import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('voice intent fast paths include confirmation and cancellation phrases', async () => {
  const source = await readFile(new URL('../lib/voice-intent-core.ts', import.meta.url), 'utf8')
  assert.match(source, /const CONFIRM_PATTERN = .*confirm.*approve.*do it.*go ahead/)
  assert.match(source, /const CANCEL_PATTERN = .*cancel.*stop.*nevermind.*don't send/)
  assert.match(source, /export function isVoiceConfirmation/)
  assert.match(source, /export function isVoiceCancellation/)
})

test('dashboard command layer exposes campaigns as a first-class view', async () => {
  const source = await readFile(new URL('../lib/dashboard-command-layer.ts', import.meta.url), 'utf8')
  assert.match(source, /\|\s+'campaigns'/)
  assert.match(source, /campaigns:\s+'Campaigns'/)
  assert.match(source, /summary: `Open \$\{viewLabels\[view\]\}/)
})
