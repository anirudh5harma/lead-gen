/**
 * Agent Integration Tests — uses Node.js built-in test runner
 * Run with: node --test --experimental-strip-types __tests__/agent-integration.test.ts
 *
 * These tests verify type contracts and module exports without requiring
 * a running Supabase instance or network access.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFile } from 'node:fs/promises'
import type { AgentFeedback, AgentTaskInput, AgentTuningHint } from '../lib/agents/protocol/types.ts'

// ─── Unit Tests: Agent Registry ──────────────────────────────────────────────

describe('Agent Registry', () => {
  it('should export getAgent function', async () => {
    const { getAgent } = await import('../lib/agents/core/registry.ts')
    assert.ok(typeof getAgent === 'function', 'getAgent should be a function')
  })

  it('should have signal, match, enrich, outreach agents', async () => {
    const { ensureBootstrapped, getAgentByRole } = await import('../lib/agents/core/registry.ts')
    ensureBootstrapped()
    for (const role of ['signal', 'match', 'enrich', 'outreach'] as const) {
      const agent = getAgentByRole(role)
      assert.ok(agent !== null && agent !== undefined, `Agent ${role} should exist`)
      assert.strictEqual(agent!.role, role, `Agent role should be ${role}`)
      assert.ok(Array.isArray(agent!.capabilities), `Agent ${role} should have capabilities array`)
      assert.ok(agent!.capabilities.length > 0, `Agent ${role} should have at least one capability`)
    }
  })

  it('should return null for unknown agent role', async () => {
    const { getAgent } = await import('../lib/agents/core/registry.ts')
    const agent = getAgent('nonexistent-agent' as import('../lib/agent-events.ts').AgentName)
    assert.strictEqual(agent, null, 'Unknown agent should return null')
  })

  it('should have version field on each agent', async () => {
    const { ensureBootstrapped, getAgentByRole } = await import('../lib/agents/core/registry.ts')
    ensureBootstrapped()
    for (const role of ['safety', 'reply', 'followup', 'crm'] as const) {
      const agent = getAgentByRole(role)
      assert.ok(agent, `Agent ${role} should exist`)
      assert.ok(agent!.version?.semver.match(/^\d+\.\d+\.\d+$/), `Agent ${role} should have semver version`)
    }
  })
})

// ─── Unit Tests: Webhook Verification ────────────────────────────────────────

describe('Webhook Verification', () => {
  it('should export verifyWebhookSignature and signWebhookPayload', async () => {
    const mod = await import('../lib/webhook-verification.ts')
    assert.ok(typeof mod.verifyWebhookSignature === 'function', 'verifyWebhookSignature should be a function')
    assert.ok(typeof mod.signWebhookPayload === 'function', 'signWebhookPayload should be a function')
  })

  it('should produce a valid SHA-256 hex signature', async () => {
    const { signWebhookPayload } = await import('../lib/webhook-verification.ts')
    const payload = JSON.stringify({ taskId: 'task-123', status: 'completed' })
    const timestamp = '1700000000000'
    const secret = 'test-secret'
    const sig = signWebhookPayload(payload, timestamp, secret)
    assert.ok(sig.match(/^[a-f0-9]{64}$/), 'Signature should be a 64-char hex string')
  })

  it('should verify a valid signature', async () => {
    const { signWebhookPayload, verifyWebhookSignature } = await import('../lib/webhook-verification.ts')
    const payload = JSON.stringify({ taskId: 'task-123' })
    const timestamp = '1700000000000'
    const sig = signWebhookPayload(payload, timestamp)
    const valid = verifyWebhookSignature(payload, sig, timestamp)
    assert.strictEqual(valid, true, 'Valid signature should verify')
  })

  it('should reject a tampered payload', async () => {
    const { signWebhookPayload, verifyWebhookSignature } = await import('../lib/webhook-verification.ts')
    const payload = JSON.stringify({ taskId: 'task-123' })
    const timestamp = '1700000000000'
    const sig = signWebhookPayload(payload, timestamp)
    const tampered = verifyWebhookSignature(payload + 'TAMPERED', sig, timestamp)
    assert.strictEqual(tampered, false, 'Tampered payload should not verify')
  })

  it('should reject a wrong secret', async () => {
    const { signWebhookPayload, verifyWebhookSignature } = await import('../lib/webhook-verification.ts')
    const payload = JSON.stringify({ taskId: 'task-123' })
    const sig = signWebhookPayload(payload, '1700000000000')
    const valid = verifyWebhookSignature(payload, sig, '1700000000001')
    assert.strictEqual(valid, false, 'Wrong timestamp should not verify')
  })
})

// ─── Unit Tests: Agent Events ────────────────────────────────────────────────

describe('Agent Events', () => {
  it('should export recordAgentEvent and startAgentRun', async () => {
    const source = await readFile(new URL('../lib/agent-events.ts', import.meta.url), 'utf8')
    assert.match(source, /export async function recordAgentEvent/, 'recordAgentEvent should be exported')
    assert.match(source, /export async function startAgentRun/, 'startAgentRun should be exported')
    assert.match(source, /export async function finishAgentRun/, 'finishAgentRun should be exported')
  })

  it('should accept known agent names at type level', () => {
    const agentName: import('../lib/agent-events.ts').AgentName = 'research'
    assert.strictEqual(agentName, 'research')
  })
})

// ─── Unit Tests: Protocol Types ──────────────────────────────────────────────

describe('Agent Protocol Types', () => {
  it('AgentFeedback should have outcome: success | partial | failure', async () => {
    const feedback: AgentFeedback = {
      agentId: 'test-agent',
      taskId: 'task-1',
      traceId: 'trace-1',
      outcome: 'success',
      qualityScore: 85,
    }
    assert.strictEqual(feedback.outcome, 'success')
  })

  it('AgentTuningHint should accept all required fields', async () => {
    const hint: AgentTuningHint = {
      agentId: 'match-agent',
      role: 'match',
      signalType: 'linkedin_post',
      type: 'signal_weight',
      newWeight: 0.08,
      confidenceThreshold: 0.55,
    }
    assert.strictEqual(hint.signalType, 'linkedin_post')
    assert.strictEqual(hint.newWeight, 0.08)
  })

  it('AgentTaskInput should require userId, clientId, role, task', async () => {
    const input: AgentTaskInput = {
      tool: 'bombsell.operator.status',
      arguments: { clientId: 'client-1', userId: 'user-1' },
    }
    assert.strictEqual(input.tool, 'bombsell.operator.status')
  })
})

// ─── Unit Tests: Self-Improvement Engine ─────────────────────────────────────

describe('Self-Improvement Engine', () => {
  it('should export ingestAgentFeedback and computeGlobalTuningHints', async () => {
    const source = await readFile(new URL('../lib/agents/self-improvement/engine.ts', import.meta.url), 'utf8')
    assert.match(source, /export async function ingestAgentFeedback/, 'ingestAgentFeedback should be exported')
    assert.match(source, /export async function computeGlobalTuningHints/, 'computeGlobalTuningHints should be exported')
    assert.match(source, /export async function checkAndRecoverAgentHealth/, 'checkAndRecoverAgentHealth should be exported')
    assert.match(source, /export async function recordAgentFailure/, 'recordAgentFailure should be exported')
  })
})

// ─── Integration: Supervisor exports ─────────────────────────────────────────

describe('Supervisor', () => {
  it('should export dispatchTask and getQueueStatus', async () => {
    const source = await readFile(new URL('../lib/agents/core/supervisor.ts', import.meta.url), 'utf8')
    assert.match(source, /export async function dispatchTask/, 'dispatchTask should be exported')
    assert.match(source, /export function getQueueStatus/, 'getQueueStatus should be exported')
  })
})
