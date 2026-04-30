import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

const requiredFiles = [
  'supabase/migrations/042_gtm_infrastructure_mvp.sql',
  'lib/gtm/identity.ts',
  'lib/gtm/graph.ts',
  'lib/gtm/memory.ts',
  'lib/workflows/runtime.ts',
  'lib/policies/outbound.ts',
  'app/api/gtm/ops/route.ts',
]

const requiredTables = [
  'gtm_accounts',
  'gtm_people',
  'gtm_signals',
  'gtm_relationships',
  'gtm_touchpoints',
  'gtm_memories',
  'gtm_entity_embeddings',
  'gtm_workflow_runs',
  'gtm_workflow_steps',
  'gtm_agent_checkpoints',
  'gtm_agent_tool_calls',
  'gtm_policy_decisions',
  'gtm_integration_outbox',
]

const requiredAutomationHooks = [
  'startWorkflowRun',
  'startWorkflowStep',
  'evaluateOutboundPolicy',
  'upsertLeadIntoGtmGraph',
  'recordGtmTouchpoint',
  'recordGtmMemory',
  'recordToolCall',
]

const requiredManualSendHooks = [
  'createServiceClient',
  'evaluateOutboundPolicy',
  'startWorkflowRun',
  'upsertLeadIntoGtmGraph',
  'recordGtmTouchpoint',
  'recordGtmMemory',
]

const failures = []

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) failures.push(`Missing required file: ${file}`)
}

const migration = read('supabase/migrations/042_gtm_infrastructure_mvp.sql')
for (const table of requiredTables) {
  if (!migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) {
    failures.push(`Migration missing table: ${table}`)
  }
  if (!migration.includes(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)) {
    failures.push(`Migration missing RLS enablement: ${table}`)
  }
}

const automation = read('app/api/cron/send-automation/route.ts')
for (const hook of requiredAutomationHooks) {
  if (!automation.includes(hook)) failures.push(`send-automation missing hook: ${hook}`)
}

const manualSend = read('app/api/outreach/send/route.ts')
for (const hook of requiredManualSendHooks) {
  if (!manualSend.includes(hook)) failures.push(`manual send route missing hook: ${hook}`)
}

const followups = read('app/api/cron/send-followups/route.ts')
for (const hook of requiredAutomationHooks) {
  if (!followups.includes(hook)) failures.push(`send-followups missing hook: ${hook}`)
}

const opsRoute = read('app/api/gtm/ops/route.ts')
for (const table of ['gtm_workflow_runs', 'gtm_policy_decisions', 'gtm_memories', 'gtm_accounts']) {
  if (!opsRoute.includes(table)) failures.push(`GTM ops route does not read ${table}`)
}

if (failures.length > 0) {
  console.error('GTM MVP audit failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('GTM MVP audit passed.')

function read(file) {
  const path = join(root, file)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}
